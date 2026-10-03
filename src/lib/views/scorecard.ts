/**
 * Monthly COO scorecard (slides 33-36): 15 KPIs with prior month and target.
 * This file only queries aggregates; every formula lives in src/kpis/.
 * Status: "ok" (from order facts), "simulated" (uses synthetic items/labor
 * hours), "awaiting_data" (not computable; value null, never a made-up number).
 * Server-only (uses the DB client).
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  AGED_LISTING_DAYS,
  KPI_DEFINITIONS,
  topCategoriesByMargin,
  topCategoriesByRevenue,
  type PeriodFacts,
} from "@/kpis";
import { addDays, localToUtc, periodBounds, previousPeriod } from "./dates";
import type { Kpi, ScorecardView } from "./types";

const isoUtc = (d: Date) => d.toISOString();

export async function loadPeriodFacts(period: string): Promise<PeriodFacts> {
  const db = getDb();
  const { start, end } = periodBounds(period);
  // Item/labor timestamps are UTC; the period is in business time.
  const startUtc = isoUtc(localToUtc(start, 0));
  const endUtc = isoUtc(localToUtc(addDays(end, 1), 0)); // exclusive
  const agedCutoffUtc = isoUtc(localToUtc(addDays(end, 1 - AGED_LISTING_DAYS), 0));

  const [o] = await db.all<{
    n: number;
    net: number;
    order_count: number;
    paid_gross: number;
    paid_qty: number;
    last_date: string | null;
  }>(sql`
    select count(*) as n,
           coalesce(sum(net_cents), 0) as net,
           count(case when status != 'cancelled' then 1 end) as order_count,
           coalesce(sum(case when status = 'paid' then gross_cents end), 0) as paid_gross,
           coalesce(sum(case when status = 'paid' then quantity end), 0) as paid_qty,
           max(business_date) as last_date
    from orders where business_date between ${start} and ${end}`);

  const [b] = await db.all<{ buyers: number; repeat_buyers: number }>(sql`
    select count(*) as buyers, coalesce(sum(case when n >= 2 then 1 else 0 end), 0) as repeat_buyers
    from (
      select buyer_key, count(*) as n from orders
      where business_date between ${start} and ${end}
        and status != 'cancelled' and buyer_key is not null
      group by buyer_key
    )`);

  const [s] = await db.all<{ lines: number; net: number }>(sql`
    select count(*) as lines, coalesce(sum(amount_cents), 0) as net
    from money_lines
    where period = ${period} and amount_type in ('shipping_label', 'shipping_refund', 'postage_topup')`);

  const [l] = await db.all<{ hours: number; employees: number }>(sql`
    select coalesce(sum(hours), 0) as hours, count(distinct employee) as employees
    from labor_hours where work_date between ${start} and ${end}`);

  const [i] = await db.all<{
    any_items: number;
    listed: number;
    avg_days: number | null;
    backlog: number;
    sold: number;
    available: number;
    active_end: number;
    aged_end: number;
  }>(sql`
    select
      count(case when coalesce(listed_at, sent_to_ecom_at) < ${endUtc} then 1 end) as any_items,
      count(case when listed_at >= ${startUtc} and listed_at < ${endUtc} then 1 end) as listed,
      avg(case when listed_at >= ${startUtc} and listed_at < ${endUtc} and donated_at is not null
               then julianday(listed_at) - julianday(donated_at) end) as avg_days,
      count(case when sent_to_ecom_at < ${endUtc} and (listed_at is null or listed_at >= ${endUtc}) then 1 end) as backlog,
      count(case when sold_at >= ${startUtc} and sold_at < ${endUtc} then 1 end) as sold,
      count(case when listed_at < ${endUtc} and (sold_at is null or sold_at >= ${startUtc}) then 1 end) as available,
      count(case when listed_at < ${endUtc} and (sold_at is null or sold_at >= ${endUtc}) then 1 end) as active_end,
      count(case when listed_at < ${agedCutoffUtc} and (sold_at is null or sold_at >= ${endUtc}) then 1 end) as aged_end
    from items`);

  const cats = await db.all<{ category: string; revenue: number; margin: number }>(sql`
    select category,
           coalesce(sum(net_cents), 0) as revenue,
           coalesce(sum(net_cents - case when status = 'paid' then shipping_cents else 0 end), 0) as margin
    from orders
    where business_date between ${start} and ${end} and category is not null
    group by category`);

  return {
    period,
    periodEnd: end,
    orders:
      o && Number(o.n) > 0
        ? {
            netCents: Number(o.net),
            orderCount: Number(o.order_count),
            paidGrossCents: Number(o.paid_gross),
            paidQuantity: Number(o.paid_qty),
            buyers: Number(b?.buyers ?? 0),
            repeatBuyers: Number(b?.repeat_buyers ?? 0),
            lastBusinessDate: o.last_date,
          }
        : null,
    shipping: s && Number(s.lines) > 0 ? { netShippingCents: Number(s.net), lines: Number(s.lines) } : null,
    labor: l && Number(l.hours) > 0 ? { hours: Number(l.hours), employees: Number(l.employees) } : null,
    items:
      i && Number(i.any_items) > 0
        ? {
            listed: Number(i.listed),
            avgDaysDonationToListing: i.avg_days === null ? null : Number(i.avg_days),
            backlogAtEnd: Number(i.backlog),
            sold: Number(i.sold),
            available: Number(i.available),
            activeAtEnd: Number(i.active_end),
            agedAtEnd: Number(i.aged_end),
          }
        : null,
    categories: cats.map((c) => ({ category: c.category, revenueCents: Number(c.revenue), marginCents: Number(c.margin) })),
  };
}

/** Scorecard for a period (`YYYY-MM`). */
export async function getScorecard(period: string): Promise<ScorecardView> {
  const prevPeriod = previousPeriod(period);
  const [cur, prev, prev2, targets] = await Promise.all([
    loadPeriodFacts(period),
    loadPeriodFacts(prevPeriod),
    loadPeriodFacts(previousPeriod(prevPeriod)),
    getDb().all<{ kpi_key: string; target_value: number }>(
      sql`select kpi_key, target_value from kpi_targets where period = ${period}`,
    ),
  ]);
  const targetByKey = new Map(targets.map((t) => [t.kpi_key, Number(t.target_value)]));

  const lastDate = cur.orders?.lastBusinessDate;
  const partialNote = lastDate && lastDate < cur.periodEnd ? `Partial month: data through ${lastDate}.` : null;

  const kpis: Kpi[] = KPI_DEFINITIONS.map((def) => {
    const value = def.compute(cur, prev);
    const previous = def.compute(prev, prev2);
    const status: Kpi["status"] = value === null ? "awaiting_data" : def.dataBasis === "synthetic" ? "simulated" : "ok";
    const notes = [def.note];
    if (status === "simulated") notes.push("Simulated: uses synthetic item/labor data.");
    if (status === "awaiting_data") notes.push("Awaiting data for this period.");
    if (partialNote && value !== null) notes.push(partialNote);
    const note = notes.filter(Boolean).join(" ");
    return {
      id: def.id,
      label: def.label,
      pillar: def.pillar,
      unit: def.unit,
      value,
      previous,
      target: targetByKey.get(def.id) ?? null,
      status,
      anchor2027: def.anchor2027,
      ...(note ? { note } : {}),
    };
  });

  return {
    period,
    kpis,
    topCategoriesByRevenue: topCategoriesByRevenue(cur.categories),
    topCategoriesByMargin: topCategoriesByMargin(cur.categories),
  };
}
