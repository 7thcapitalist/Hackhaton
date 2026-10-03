// Live data: the pages below get their numbers from Joao's real, database-backed
// view functions (src/lib/views, docs/interfaces.md §2) and KPI engine (src/kpis)
// instead of the synthetic numbers in ./demo-data. Server-only (the view functions
// use the DB client) — import this only from Server Components (pages). Client
// components (PulseScreen) call the matching /api/views/* JSON routes instead,
// per docs/interfaces.md §2: "Server code imports and calls them directly. Client
// components use the JSON routes."
//
// Needs a seeded database to show anything (README: `npm run db:push && npm run
// seed`). Until then every view is empty and these wrappers render that honestly
// (status "missing" / "awaiting_data") rather than falling back to fake numbers.
import {
  getExceptions,
  getIngestRuns,
  getOrders as dbGetOrders,
  getPulse as dbGetPulse,
  getPulseSeries as dbGetPulseSeries,
  getScorecard as dbGetScorecard,
  getSourceStatus,
  isValidDate,
} from "@/lib/views";
import { periodBounds } from "@/lib/views/dates";
import { CHANNELS, CHANNEL_LABEL, GROUP_MEMBERS, sourcesForRow } from "./channels";
import { formatStamp, shiftDay } from "./format";
import type {
  ChannelId,
  Kpi,
  Pillar,
  PulseRow,
  PulseSeries,
  PulseTotals,
  PulseView,
  Source,
  SourceIssue,
  SourceOrder,
} from "./types";

export { CHANNELS };

/*
 * The seed (scripts/mock/model.ts) runs START_DATE=2026-08-01 to
 * END_DATE=2026-10-03; Oct 3 is "today" and only partially landed (orders
 * before ~11:30 AM local), so Oct 2 is the latest fully-closed night, and
 * Aug/Sep (CLOSED_PERIODS) are the two closed scorecard periods, Sep the
 * latest. These are the same defaults Gabriel's demo-data.ts hardcoded.
 */
export const SEED_END_DATE = "2026-10-03";
export const LATEST_DATE = "2026-10-02";
export const SCORECARD_PERIOD_ID = "2026-09";
export const SOURCES_DUE = "the 5th";

export function isPulseDate(date: string | undefined): date is string {
  return isValidDate(date);
}

/* ------------------------------------------------------------------------ *
 * Pulse
 * ------------------------------------------------------------------------ */

/** Real file name + upload time behind a pulse row, from ingest_runs for that
 * exact business date — never guessed. `runs` is that whole month's runs,
 * fetched once and reused across all rows. */
function rowFileInfo(channelId: ChannelId, date: string, runs: Awaited<ReturnType<typeof getIngestRuns>>["rows"]) {
  const sourceIds = sourcesForRow(channelId);
  const matches = runs.filter((r) => sourceIds.includes(r.sourceId) && r.businessDate === date);
  if (matches.length === 0) return { file: null as string | null, importedAt: null as string | null };
  const latest = matches.reduce((a, b) => (a.uploadedAt > b.uploadedAt ? a : b));
  return {
    file: matches.length > 1 ? `${matches.length} source files` : matches[0]!.fileName,
    importedAt: latest.uploadedAt,
  };
}

export async function getPulse(date: string): Promise<PulseView> {
  const [view, { rows: runs }] = await Promise.all([dbGetPulse(date), getIngestRuns({ period: date.slice(0, 7), limit: 500 })]);
  const info = view.rows.map((r) => rowFileInfo(r.channelId, date, runs));
  const lastImportAt = info.map((i) => i.importedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const decorated = view.rows.map((r, idx) => {
    const meta = CHANNELS.find((c) => c.id === r.channelId);
    const { file, importedAt } = info[idx]!;
    return {
      ...r,
      sublabel: meta?.sublabel ?? "",
      sourceFile: file ?? `${r.channelId}_${date}.csv`,
      importedAt: importedAt ? formatStamp(importedAt, { hour: "numeric", minute: "2-digit" }) : "",
    } satisfies PulseRow;
  });
  return { ...view, rows: decorated, lastImportAt };
}

/** Totals for `date` over only the given (row) channels — week-over-week compares the same set. */
export async function getPulseTotalsFor(date: string, channelIds: ChannelId[]): Promise<PulseTotals | null> {
  const view = await dbGetPulse(date);
  const rows = channelIds.map((id) => view.rows.find((r) => r.channelId === id));
  if (rows.some((r) => !r || r.status !== "ok")) return null;
  return rows.reduce<PulseTotals>(
    (a, r) => ({
      revenueCents: a.revenueCents + (r!.revenueCents ?? 0),
      customers: a.customers + (r!.customers ?? 0),
      orders: a.orders + (r!.orders ?? 0),
    }),
    { revenueCents: 0, customers: 0, orders: 0 },
  );
}

/** Trailing `days`-day window ending on `toDate`, for the pulse trend chart. */
export async function getPulseSeries(toDate: string, days = 30): Promise<PulseSeries> {
  const from = shiftDay(toDate, -(days - 1));
  const view = await dbGetPulseSeries(from, toDate);
  return {
    dates: view.dates,
    series: view.series.map((s) => ({ channelId: s.channelId, label: s.label, revenueCents: s.revenueCents, customers: s.customers })),
  };
}

/** Source rows behind one pulse row (every member channel, concatenated). Net values sum
 * exactly to the pulse revenue because they come from the same orders table. */
export async function getOrders(channelId: ChannelId, date: string): Promise<SourceOrder[]> {
  const members = GROUP_MEMBERS[channelId] ?? [channelId];
  const { rows } = await getIngestRuns({ period: date.slice(0, 7), limit: 500 });
  const fileById = new Map(rows.map((r) => [r.id, r.fileName]));
  const perChannel = await Promise.all(members.map((c) => dbGetOrders({ channel: c, date, limit: 1000 })));
  return perChannel.flatMap((v) =>
    v.rows.map((o) => ({
      orderId: o.externalOrderId,
      channelLabel: CHANNEL_LABEL[o.channel],
      category: o.category ?? "Uncategorized",
      grossCents: o.grossCents,
      netCents: o.netCents,
      sourceFile: fileById.get(o.ingestRunId) ?? `${o.sourceId}.csv`,
      sourceRow: o.sourceRow,
    })),
  );
}

/* ------------------------------------------------------------------------ *
 * COO Scorecard
 * ------------------------------------------------------------------------ */

export const PILLARS: { id: Pillar; name: string }[] = [
  { id: "financial", name: "Financial" },
  { id: "productivity", name: "Productivity" },
  { id: "inventory", name: "Inventory" },
  { id: "sales", name: "Sales" },
  { id: "category_customer", name: "Category + Cust." },
];

/** UI-only extras the real Kpi type doesn't carry (src/lib/views/types.ts Kpi). */
const KPI_META: Record<string, { lowerIsBetter?: boolean; teamLevel?: boolean }> = {
  unlisted_backlog: { lowerIsBetter: true },
  unsold_inventory_pct: { lowerIsBetter: true },
  days_donation_to_listing: { lowerIsBetter: true },
  listings_per_employee: { teamLevel: true },
  sales_per_employee: { teamLevel: true },
};

const MONTH_FMT = (period: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

export type ScorecardPeriodMeta = { id: string; label: string; short: string; dataThrough: string; generatedAt: string | null };

export async function getPeriodMeta(period: string): Promise<ScorecardPeriodMeta> {
  const { end } = periodBounds(period);
  const { rows } = await getIngestRuns({ period, limit: 1 });
  return {
    id: period,
    label: MONTH_FMT(period, { month: "long", year: "numeric" }),
    short: MONTH_FMT(period, { month: "short" }),
    dataThrough: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${end}T00:00:00Z`)),
    generatedAt: rows[0]?.uploadedAt ?? null,
  };
}

function attachExtras(kpi: Kpi, scorecard: Awaited<ReturnType<typeof dbGetScorecard>>): Kpi & {
  lowerIsBetter?: boolean; teamLevel?: boolean; history?: number[]; breakdown?: { label: string; value: number }[]; displaySuffix?: string;
} {
  const extra = { ...(KPI_META[kpi.id] ?? {}) } as { lowerIsBetter?: boolean; teamLevel?: boolean };
  // Real history has only this month + prior (no multi-month trend); show that
  // honestly as a 2-point line rather than a fabricated 12-month one.
  const history = kpi.value != null && kpi.previous != null
    ? [kpi.previous, kpi.value]
    : kpi.value != null ? [kpi.value] : [];
  if (kpi.id === "top10_categories_revenue") {
    const breakdown = scorecard.topCategoriesByRevenue.map((c) => ({ label: c.category, value: c.revenueCents }));
    const totalRev = scorecard.kpis.find((k) => k.id === "total_revenue")?.value;
    const sum = scorecard.topCategoriesByRevenue.reduce((a, c) => a + c.revenueCents, 0);
    const pct = totalRev ? Math.round((sum / totalRev) * 100) : null;
    return { ...kpi, ...extra, history, breakdown, displaySuffix: pct != null ? `${pct}% of total` : undefined };
  }
  if (kpi.id === "top10_categories_margin") {
    const breakdown = scorecard.topCategoriesByMargin.map((c) => ({ label: c.category, value: c.marginCents }));
    return { ...kpi, ...extra, history, breakdown, displaySuffix: "top 10 by margin" };
  }
  return { ...kpi, ...extra, history };
}

function insightsFrom(scorecard: Awaited<ReturnType<typeof dbGetScorecard>>, meta: ScorecardPeriodMeta): string[] {
  const by = (id: string) => scorecard.kpis.find((k) => k.id === id);
  const out: string[] = [];
  const rev = by("total_revenue");
  const growth = by("revenue_growth_pct");
  if (rev?.value != null) {
    out.push(
      growth?.value != null
        ? `Revenue was $${(rev.value / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} in ${meta.label}, ${growth.value >= 0 ? "up" : "down"} ${Math.abs(growth.value).toFixed(1)}% ${growth.note?.startsWith("YoY") ? "year over year" : "month over month"}.`
        : `Revenue was $${(rev.value / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} in ${meta.label}.`,
    );
  }
  const margin = by("net_margin_pct");
  if (margin?.value != null && margin.target != null) {
    const gap = margin.value - margin.target;
    out.push(`Net margin is ${margin.value.toFixed(1)}% vs. a ${margin.target.toFixed(1)}% target (${gap >= 0 ? "+" : ""}${gap.toFixed(1)} pts).`);
  }
  const awaiting = scorecard.kpis.filter((k) => k.group === "coo15" && k.value == null).length;
  if (awaiting > 0) out.push(`${awaiting} of the 15 KPIs are awaiting data for ${meta.label}.`);
  if (out.length === 0) out.push(`No data computed yet for ${meta.label} — seed the database (README) to populate the scorecard.`);
  return out;
}

export async function getScorecard(period: string = SCORECARD_PERIOD_ID) {
  const [scorecard, meta] = await Promise.all([dbGetScorecard(period), getPeriodMeta(period)]);
  const kpis = scorecard.kpis.filter((k) => k.group === "coo15").map((k) => attachExtras(k, scorecard));
  return { period: meta, kpis, insights: insightsFrom(scorecard, meta) };
}

/* ------------------------------------------------------------------------ *
 * Data Sources
 * ------------------------------------------------------------------------ */

type SourceMeta = { sublabel: string; cadence: "daily" | "monthly"; impact?: string };

/** scripts/seed/config.ts SOURCES — cadence/grouping facts only; every status,
 * count and timestamp below comes from getSourceStatus(). */
const SOURCE_META: Record<string, SourceMeta> = {
  shopgoodwill: { sublabel: "Marketplace · daily", cadence: "daily" },
  amazon: { sublabel: "Marketplace · daily", cadence: "daily" },
  ebay: { sublabel: "Marketplace · daily", cadence: "daily" },
  cashmonkey: { sublabel: "Marketplace · monthly", cadence: "monthly" },
  upright: { sublabel: "Marketplace · daily", cadence: "daily" },
  jewelry: { sublabel: "Specialty sales · monthly", cadence: "monthly" },
  shipping_osm_pb_easypost: { sublabel: "OSM · Pitney Bowes · EasyPost", cadence: "monthly", impact: "Net margin may move once resolved." },
  fedex: { sublabel: "Carrier invoices · monthly", cadence: "monthly" },
  goodwill_books: { sublabel: "Marketplace · monthly", cadence: "monthly", impact: "Category totals may shift slightly." },
};

function daysInPeriod(period: string): number {
  const { end } = periodBounds(period);
  return Number(end.slice(8, 10));
}

/** One "received"/"warning"/"missing" per calendar day of the period, for daily sources. */
async function dailyStrip(sourceId: string, period: string): Promise<("received" | "warning" | "missing")[]> {
  const { rows } = await getIngestRuns({ sourceId, period, limit: 60 });
  // Newest-first; a reupload (e.g. ebay_2026-09-14_reupload.csv) should win over
  // the run it replaced, so keep only the first (newest) status seen per date.
  const byDate = new Map<string, (typeof rows)[number]["status"]>();
  for (const r of rows) if (r.businessDate && !byDate.has(r.businessDate)) byDate.set(r.businessDate, r.status);
  const n = daysInPeriod(period);
  return Array.from({ length: n }, (_, i) => {
    const d = `${period}-${String(i + 1).padStart(2, "0")}`;
    const status = byDate.get(d);
    if (!status) return "missing";
    return status === "parsed" ? "received" : "warning";
  });
}

export async function getSources(period: string = SCORECARD_PERIOD_ID): Promise<Source[]> {
  const { sources } = await getSourceStatus(period);
  return Promise.all(
    sources.map(async (s): Promise<Source> => {
      const meta = SOURCE_META[s.sourceId] ?? { sublabel: "", cadence: "monthly" as const };
      let lastFileLabel: string | undefined;
      if (s.status === "missing") {
        const { rows } = await getIngestRuns({ sourceId: s.sourceId, limit: 1 });
        const last = rows[0];
        lastFileLabel = last ? (last.businessDate ?? last.periodLabel ?? undefined) : undefined;
      }
      return {
        id: s.sourceId,
        name: s.name,
        sublabel: meta.sublabel,
        cadence: meta.cadence,
        status: s.status,
        openIssues: s.openExceptions,
        lastImportAt: s.lastIngestAt,
        lastFileLabel,
        rowCount: s.rowCount,
        days: meta.cadence === "daily" ? await dailyStrip(s.sourceId, period) : undefined,
        impact: s.openExceptions > 0 ? meta.impact : undefined,
      };
    }),
  );
}

export async function getSourceIssues(period: string = SCORECARD_PERIOD_ID): Promise<SourceIssue[]> {
  const [{ rows }, runs] = await Promise.all([
    getExceptions({ status: "open", period, limit: 20 }),
    getIngestRuns({ period, limit: 500 }),
  ]);
  const fileById = new Map(runs.rows.map((r) => [r.id, r.fileName]));
  return rows.map((e) => ({
    text: e.message,
    source: e.sourceName ?? e.kind.replace(/_/g, " "),
    file: (e.ingestRunId && fileById.get(e.ingestRunId)) ?? "—",
  }));
}

export async function getSourceSummary(period: string = SCORECARD_PERIOD_ID) {
  const sources = await getSources(period);
  const received = sources.filter((s) => s.status === "received");
  const warnings = sources.filter((s) => s.status === "warnings");
  const missing = sources.filter((s) => s.status === "missing");
  return {
    total: sources.length,
    arrived: received.length + warnings.length,
    sources,
    received,
    warnings,
    missing,
    openIssues: sources.reduce((a, s) => a + s.openIssues, 0),
  };
}
