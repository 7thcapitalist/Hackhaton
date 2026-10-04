/**
 * Nightly pulse (slide 31): revenue and customers per pulse row, then totals.
 *
 * Rules:
 * - revenue = Σ orders.net_cents; orders = count of non-cancelled order lines.
 * - customers = unique buyers per marketplace (channel + buyer_key, non-cancelled).
 *   A row with no buyer_key counts as its own customer (channel +
 *   external_order_id): Amazon's report has no buyer id at all, and CashMonkey,
 *   Jewelry and some Upright rows have none either, so those still count one per
 *   transaction (Gabriel, 2026-10-03, option A; the Daily Pulse says so).
 * - Rows are pulse groups from `channels.pulse_group`; the row's channelId is
 *   the group's first channel by sort_order (e.g. "other" for "Other e-commerce",
 *   which also includes goodwill_books).
 * - A row is "missing" (nulls, not 0) when none of its channels has an ingest
 *   run for that business date from a source mapped to the channel
 *   (sources.config_json.channels) and no orders landed for it that day.
 * - Totals sum only "ok" rows. Total customers = sum of row counts.
 * Server-only (uses the DB client).
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { BUSINESS_TZ, dateRange } from "./dates";
import type { ChannelId, PulseRow, PulseSeriesView, PulseView } from "./types";
import { cachedView } from "./cache";

interface PulseGroup {
  channelId: ChannelId;
  label: string;
  channels: string[];
}

interface DayGroupCell {
  status: "ok" | "missing";
  revenueCents: number | null;
  customers: number | null;
  orders: number | null;
}

interface PulseDays {
  groups: PulseGroup[];
  cells: Map<string, DayGroupCell[]>; // date -> one cell per group
  synthetic: Map<string, boolean>;
}

async function loadGroups(): Promise<{ groups: PulseGroup[]; channelSources: Map<string, string[]> }> {
  const db = getDb();
  const channels = await db.all<{ id: string; name: string; pulse_group: string; sort_order: number }>(
    sql`select id, name, pulse_group, sort_order from channels order by sort_order, id`,
  );
  const groups: PulseGroup[] = [];
  for (const c of channels) {
    let g = groups.find((x) => x.label === c.pulse_group);
    if (!g) {
      g = { channelId: c.id as ChannelId, label: c.pulse_group, channels: [] };
      groups.push(g);
    }
    g.channels.push(c.id);
  }

  const sources = await db.all<{ id: string; config_json: string | null }>(
    sql`select id, config_json from sources where active = 1`,
  );
  const channelSources = new Map<string, string[]>();
  for (const s of sources) {
    let mapped: string[] = [];
    try {
      const parsed = s.config_json ? (JSON.parse(s.config_json) as { channels?: unknown }) : {};
      if (Array.isArray(parsed.channels)) mapped = parsed.channels.filter((x): x is string => typeof x === "string");
    } catch {
      // bad config_json: the source maps to no channel
    }
    for (const ch of mapped) channelSources.set(ch, [...(channelSources.get(ch) ?? []), s.id]);
  }
  return { groups, channelSources };
}

async function computePulseDays(from: string, to: string): Promise<PulseDays> {
  const db = getDb();
  const { groups, channelSources } = await loadGroups();

  const runs = await db.all<{ source_id: string; business_date: string; is_synthetic: number }>(sql`
    select source_id, business_date, max(is_synthetic) as is_synthetic
    from ingest_runs
    where business_date between ${from} and ${to} and status != 'failed'
    group by source_id, business_date`);

  const agg = await db.all<{
    business_date: string;
    pulse_group: string;
    revenue: number;
    orders: number;
    customers: number;
  }>(sql`
    select o.business_date, c.pulse_group,
           coalesce(sum(o.net_cents), 0) as revenue,
           count(case when o.status != 'cancelled' then 1 end) as orders,
           count(distinct case when o.status != 'cancelled' then
             coalesce('b:' || o.channel || ':' || o.buyer_key, 't:' || o.channel || ':' || o.external_order_id) end) as customers
    from orders o join channels c on c.id = o.channel
    where o.business_date between ${from} and ${to}
    group by o.business_date, c.pulse_group`);

  const orderChannels = await db.all<{ business_date: string; channel: string; is_synthetic: number }>(sql`
    select o.business_date, o.channel, max(r.is_synthetic) as is_synthetic
    from orders o join ingest_runs r on r.id = o.ingest_run_id
    where o.business_date between ${from} and ${to}
    group by o.business_date, o.channel`);

  const runKey = new Set(runs.map((r) => `${r.business_date}|${r.source_id}`));
  const orderKey = new Set(orderChannels.map((r) => `${r.business_date}|${r.channel}`));
  const aggKey = new Map(agg.map((a) => [`${a.business_date}|${a.pulse_group}`, a]));

  const synthetic = new Map<string, boolean>();
  for (const r of runs) if (r.is_synthetic) synthetic.set(r.business_date, true);
  for (const r of orderChannels) if (r.is_synthetic) synthetic.set(r.business_date, true);

  const cells = new Map<string, DayGroupCell[]>();
  for (const date of dateRange(from, to)) {
    cells.set(
      date,
      groups.map((g) => {
        const present = g.channels.some(
          (ch) => orderKey.has(`${date}|${ch}`) || (channelSources.get(ch) ?? []).some((s) => runKey.has(`${date}|${s}`)),
        );
        if (!present) return { status: "missing", revenueCents: null, customers: null, orders: null };
        const a = aggKey.get(`${date}|${g.label}`);
        return {
          status: "ok",
          revenueCents: Number(a?.revenue ?? 0),
          customers: Number(a?.customers ?? 0),
          orders: Number(a?.orders ?? 0),
        };
      }),
    );
  }
  return { groups, cells, synthetic };
}

/** Nightly pulse for one business date (`YYYY-MM-DD`, Indianapolis). */
async function getPulseUncached(businessDate: string): Promise<PulseView> {
  const { groups, cells, synthetic } = await computePulseDays(businessDate, businessDate);
  const dayCells = cells.get(businessDate) ?? [];
  const rows: PulseRow[] = groups.map((g, i) => ({ channelId: g.channelId, label: g.label, ...dayCells[i]! }));
  const ok = rows.filter((r) => r.status === "ok");
  return {
    businessDate,
    timezone: BUSINESS_TZ,
    rows,
    totals: {
      revenueCents: ok.reduce((s, r) => s + (r.revenueCents ?? 0), 0),
      customers: ok.reduce((s, r) => s + (r.customers ?? 0), 0),
      orders: ok.reduce((s, r) => s + (r.orders ?? 0), 0),
    },
    missingChannels: rows.filter((r) => r.status === "missing").map((r) => r.channelId),
    isSynthetic: synthetic.get(businessDate) ?? false,
  };
}

/** Pulse per day for an inclusive date range (for trend charts). */
async function getPulseSeriesUncached(from: string, to: string): Promise<PulseSeriesView> {
  const { groups, cells } = await computePulseDays(from, to);
  const dates = dateRange(from, to);
  const series = groups.map((g, i) => ({
    channelId: g.channelId,
    label: g.label,
    revenueCents: dates.map((d) => cells.get(d)![i]!.revenueCents),
    customers: dates.map((d) => cells.get(d)![i]!.customers),
  }));
  return {
    from,
    to,
    dates,
    series,
    totals: {
      revenueCents: dates.map((d) => cells.get(d)!.reduce((s, c) => s + (c.revenueCents ?? 0), 0)),
      customers: dates.map((d) => cells.get(d)!.reduce((s, c) => s + (c.customers ?? 0), 0)),
    },
  };
}

export const getPulse = cachedView("getPulse", getPulseUncached);
export const getPulseSeries = cachedView("getPulseSeries", getPulseSeriesUncached);
