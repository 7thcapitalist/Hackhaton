// Server-only: turns the view functions (src/lib/views, Joao's lane) into what each screen
// needs. Nothing here reads the database directly. Never import from a client component.
import { cache } from "react";
import {
  INGEST_RUNS_MAX_LIMIT, ORDERS_MAX_LIMIT,
  getExceptions, getIngestRuns, getOrders, getPulse, getPulseSeries, getScorecard, getSourceStatus,
  isValidDate, isValidPeriod,
  type ExceptionRow, type IngestRunRow, type OrdersView, type PulseView as ViewPulse,
} from "@/lib/views";
import { addDays, businessDateOf, dateRange, daysBetween, periodBounds } from "@/lib/views/dates";
import { GROUP_MEMBERS } from "./channels";
import { statsOf, weekdayOf, type PulseBaseline } from "../pulse/summary";
import { formatDay, formatStamp } from "./format";
import type { CategoryRow, ChannelId, Kpi, PulseRow, PulseTotals, PulseView, Source, SourceIssue, SourceOrder } from "./types";

// ---- Data range: which days and months have data ----

/** Every ingest run, newest first (paged; a few hundred rows). */
const getAllRuns = cache(async (): Promise<IngestRunRow[]> => {
  const out: IngestRunRow[] = [];
  for (let offset = 0; ; offset += INGEST_RUNS_MAX_LIMIT) {
    const page = await getIngestRuns({ limit: INGEST_RUNS_MAX_LIMIT, offset });
    out.push(...page.rows);
    if (out.length >= page.total || page.rows.length === 0) return out;
  }
});

export type DataRange = {
  earliestDate: string;
  latestDate: string;     // newest day with any file (may be partial)
  completeDate: string;   // newest day whose files arrived after the day ended; the default view
  periods: string[];      // YYYY-MM with nightly data, oldest first
  defaultPeriod: string;  // last complete month (or the only one)
  lastImportAt: string;   // ISO, newest upload
};

/** null when the database has no nightly files yet. */
export const getDataRange = cache(async (): Promise<DataRange | null> => {
  const runs = (await getAllRuns()).filter(r => r.status !== "failed");
  const all = [...new Set(runs.map(r => r.businessDate).filter((d): d is string => !!d))].sort();
  if (all.length === 0) return null;
  // Only the latest unbroken run of nightly files: older blocks (e.g. last year's files,
  // kept for year-over-year) would make the day arrows walk through empty months.
  let first = all.length - 1;
  while (first > 0 && daysBetween(all[first - 1], all[first]) <= 7) first--;
  const dates = all.slice(first);
  const earliestDate = dates[0], latestDate = dates[dates.length - 1];
  // A day is complete once a file for it was uploaded after the day ended (Eastern Time).
  const complete = runs.filter(r => r.businessDate && r.businessDate >= earliestDate && businessDateOf(r.uploadedAt) > r.businessDate).map(r => r.businessDate!).sort();
  const completeDate = complete[complete.length - 1] ?? latestDate;
  const periods: string[] = [];
  for (let p = earliestDate.slice(0, 7); p <= latestDate.slice(0, 7); p = nextPeriod(p)) periods.push(p);
  const monthComplete = addDays(completeDate, 1).slice(0, 7) !== completeDate.slice(0, 7);
  const last = periods[periods.length - 1];
  const defaultPeriod = monthComplete || periods.length === 1 ? last : periods[periods.length - 2];
  return { earliestDate, latestDate, completeDate, periods, defaultPeriod, lastImportAt: runs[0].uploadedAt };
});

export function nextPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

export function resolveDate(range: DataRange, requested: string | undefined) {
  return isValidDate(requested) && requested >= range.earliestDate && requested <= range.latestDate ? requested : range.completeDate;
}

export function resolvePeriod(range: DataRange, requested: string | undefined) {
  return isValidPeriod(requested) && range.periods.includes(requested) ? requested : range.defaultPeriod;
}

export const periodLabel = (period: string) => formatDay(`${period}-01`, { month: "long", year: "numeric" });
export const periodShort = (period: string) => formatDay(`${period}-01`, { month: "short" });

// ---- Daily Pulse ----

const SUBLABEL: Record<string, string> = {
  shopgoodwill: "shopgoodwill.com auctions",
  amazon: "Seller Central settlement",
  ebay: "Seller Hub transactions",
  other: "Goodwill Books and smaller channels",
};

/** The pulse row (channel group) an order's channel belongs to, from the seed config (channels.ts). */
function rowFor(channel: string, rows: { channelId: ChannelId }[]): ChannelId {
  return rows.find(r => (GROUP_MEMBERS[r.channelId] ?? [r.channelId]).includes(channel as ChannelId))?.channelId ?? "other";
}

function totalsOf(rows: { status: string; revenueCents: number | null; customers: number | null; orders: number | null }[]): PulseTotals {
  const ok = rows.filter(r => r.status === "ok");
  return {
    revenueCents: ok.reduce((a, r) => a + (r.revenueCents ?? 0), 0),
    customers: ok.reduce((a, r) => a + (r.customers ?? 0), 0),
    orders: ok.reduce((a, r) => a + (r.orders ?? 0), 0),
  };
}

const pct = (cur: number, prev: number) => (prev ? ((cur - prev) / prev) * 100 : null);

export type PulseScreenData = {
  view: PulseView;
  orders: SourceOrder[];
  ordersTotal: number;      // all order rows that day (orders may be capped)
  compare: { date: string; changes: { revenue: number | null; customers: number | null; orders: number | null } } | null;
  series: Awaited<ReturnType<typeof getPulseSeries>>;
  prevDate: string | null;
  nextDate: string | null;
  isPartial: boolean;       // files for this day arrived before it ended
};

function buildRows(view: ViewPulse, orders: OrdersView, runsById: Map<string, IngestRunRow>): PulseRow[] {
  return view.rows.map(r => {
    const runIds = [...new Set(orders.rows.filter(o => rowFor(o.channel, view.rows) === r.channelId).map(o => o.ingestRunId))];
    const runs = runIds.map(id => runsById.get(id)).filter((x): x is IngestRunRow => !!x);
    return {
      ...r,
      sublabel: SUBLABEL[r.channelId] ?? "",
      sourceFiles: runs.map(x => x.fileName),
      importedAt: runs.map(x => x.uploadedAt).sort().pop() ?? null,
      expectedFile: r.channelId === "other" ? null : `${r.channelId}_${view.businessDate}.csv`,
    };
  });
}

/** Unique-customer key, same rule as the pulse view (src/lib/views/pulse.ts): buyer per marketplace, else the transaction. */
export function customerKeyOf(o: OrdersView["rows"][number]): string {
  return o.buyerKey ? `b:${o.channel}:${o.buyerKey}` : `t:${o.channel}:${o.externalOrderId}`;
}

function toSourceOrders(orders: OrdersView, rows: PulseRow[], runsById: Map<string, IngestRunRow>): SourceOrder[] {
  return orders.rows.map(o => ({
    id: o.id,
    orderId: o.externalOrderId,
    customerKey: customerKeyOf(o),
    channelLabel: rows.find(r => r.channelId === rowFor(o.channel, rows))?.label ?? o.channel,
    category: o.category ?? "Uncategorized",
    status: o.status,
    grossCents: o.grossCents,
    netCents: o.netCents,
    sourceFile: runsById.get(o.ingestRunId)?.fileName ?? `run ${o.ingestRunId.slice(0, 8)}`,
    sourceRow: o.sourceRow,
  }));
}

export async function getPulseScreen(range: DataRange, date: string): Promise<PulseScreenData> {
  const cmpDate = addDays(date, -7);
  // 30-day chart window that always contains the selected day; stops at the last complete day when it can.
  const end = [addDays(date, 14), date > range.completeDate ? range.latestDate : range.completeDate].sort()[0];
  const start = [addDays(end, -29), range.earliestDate].sort().pop()!;
  const [raw, orders, runs, cmp, series] = await Promise.all([
    getPulse(date),
    getOrders({ date, limit: ORDERS_MAX_LIMIT }),
    getAllRuns(),
    cmpDate >= range.earliestDate ? getPulse(cmpDate) : null,
    getPulseSeries(start, end),
  ]);
  const runsById = new Map(runs.map(r => [r.id, r]));
  const rows = buildRows(raw, orders, runsById);

  let compare: PulseScreenData["compare"] = null;
  if (cmp && date <= range.completeDate) { // a partial day would compare a half day to a full one
    // Week over week compares only marketplaces that reported on both days.
    const both = raw.rows.filter(r => r.status === "ok" && cmp.rows.find(c => c.channelId === r.channelId)?.status === "ok").map(r => r.channelId);
    const a = totalsOf(raw.rows.filter(r => both.includes(r.channelId)));
    const b = totalsOf(cmp.rows.filter(r => both.includes(r.channelId)));
    compare = { date: cmpDate, changes: { revenue: pct(a.revenueCents, b.revenueCents), customers: pct(a.customers, b.customers), orders: pct(a.orders, b.orders) } };
  }

  return {
    view: { businessDate: date, rows, totals: raw.totals, missingChannels: raw.missingChannels, isSynthetic: raw.isSynthetic },
    orders: toSourceOrders(orders, rows, runsById),
    ordersTotal: orders.total,
    compare,
    series,
    prevDate: date > range.earliestDate ? addDays(date, -1) : null,
    nextDate: date < range.latestDate ? addDays(date, 1) : null,
    isPartial: date > range.completeDate,
  };
}

/**
 * Daily Pulse comparison: the selected day vs the same weekday over the previous `weeks` weeks
 * (sales have a strong weekly rhythm, so a plain 30-day average is the wrong yardstick).
 * Like for like: only marketplaces that reported on the selected day are summed, and an earlier
 * day where one of them had no file is skipped (a missing day is not a $0 day).
 * Null for a partial day, which would compare half a day to full ones.
 */
export async function getPulseBaseline(range: DataRange, view: PulseView, weeks = 4): Promise<PulseBaseline | null> {
  const date = view.businessDate;
  if (date > range.completeDate) return null;
  const reporting = view.rows.filter(r => r.status === "ok").map(r => r.channelId);
  if (reporting.length === 0) return null;
  const candidates = Array.from({ length: weeks }, (_, k) => addDays(date, -7 * (k + 1))).filter(d => d >= range.earliestDate);
  const days = await Promise.all(candidates.map(d => getPulse(d)));
  const used = days.filter(d => reporting.every(id => d.rows.find(r => r.channelId === id)?.status === "ok"));
  const totals = used.map(d => totalsOf(d.rows.filter(r => reporting.includes(r.channelId))));
  return {
    weekday: weekdayOf(date),
    dates: used.map(d => d.businessDate),
    wanted: weeks,
    stats: {
      revenue: statsOf(totals.map(t => t.revenueCents)),
      customers: statsOf(totals.map(t => t.customers)),
      orders: statsOf(totals.map(t => t.orders)),
    },
  };
}

// ---- Daily Pulse: category mix and month-to-date pace ----

export type CategoryMixRow = { category: string; revenueCents: number; sharePct: number; typicalSharePct: number | null };
export type CategoryMix = {
  rows: CategoryMixRow[];         // categorized revenue, largest first; the tail folded into "Other categories"
  uncategorized: CategoryMixRow;  // orders whose source has no category (all of Amazon, most of eBay)
  totalCents: number;
  weekday: string;
  baselineDays: number;           // same weekdays averaged for "usually"
  complete: boolean;              // false when the day has more order rows than were loaded
};

const NO_CATEGORY = "Uncategorized";
export const CATEGORY_MIX_TOP = 6;

function revenueByCategory(rows: { category: string | null; netCents: number }[]) {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.category ?? NO_CATEGORY, (by.get(r.category ?? NO_CATEGORY) ?? 0) + r.netCents);
  return by;
}

/**
 * The day's revenue by item category, as a share of total revenue (net, so it sums to the pulse
 * total), next to the usual share on the same weekday over the previous `weeks` weeks.
 */
export async function getCategoryMix(range: DataRange, date: string, orders: SourceOrder[], ordersTotal: number, weeks = 4): Promise<CategoryMix> {
  const today = revenueByCategory(orders.map(o => ({ category: o.category === NO_CATEGORY ? null : o.category, netCents: o.netCents })));
  const totalCents = [...today.values()].reduce((a, v) => a + v, 0);
  const days = Array.from({ length: weeks }, (_, k) => addDays(date, -7 * (k + 1))).filter(d => d >= range.earliestDate);
  const earlier = (await Promise.all(days.map(d => getOrders({ date: d, limit: ORDERS_MAX_LIMIT }))))
    .map(v => revenueByCategory(v.rows.map(o => ({ category: o.category, netCents: o.netCents }))))
    .filter(m => [...m.values()].reduce((a, v) => a + v, 0) > 0);
  const typical = (cats: string[]) => earlier.length === 0 ? null : earlier.reduce((sum, m) => {
    const t = [...m.values()].reduce((a, v) => a + v, 0);
    return sum + cats.reduce((a, c) => a + (m.get(c) ?? 0), 0) / t;
  }, 0) / earlier.length * 100;
  const share = (cents: number) => (totalCents ? (cents / totalCents) * 100 : 0);

  const named = [...today.entries()].filter(([c]) => c !== NO_CATEGORY).sort((a, b) => b[1] - a[1]);
  const top = named.slice(0, CATEGORY_MIX_TOP), rest = named.slice(CATEGORY_MIX_TOP);
  const rows: CategoryMixRow[] = top.map(([category, cents]) => ({ category, revenueCents: cents, sharePct: share(cents), typicalSharePct: typical([category]) }));
  if (rest.length) {
    const cents = rest.reduce((a, [, v]) => a + v, 0);
    rows.push({ category: `Other categories (${rest.length})`, revenueCents: cents, sharePct: share(cents), typicalSharePct: typical(rest.map(([c]) => c)) });
  }
  const noCat = today.get(NO_CATEGORY) ?? 0;
  return {
    rows, totalCents, weekday: weekdayOf(date), baselineDays: earlier.length, complete: orders.length >= ordersTotal,
    uncategorized: { category: "No category", revenueCents: noCat, sharePct: share(noCat), typicalSharePct: typical([NO_CATEGORY]) },
  };
}

export type MonthPace = {
  period: string;            // YYYY-MM of the selected day
  daysInMonth: number;
  through: string | null;    // last complete day counted (null = none yet this month)
  daily: number[];           // revenue per day of the month from day 1 through `through`
  targetCents: number | null;
};

/** Month-to-date revenue through the selected day (complete days only) against the month's revenue target. */
export async function getMonthPace(range: DataRange, date: string): Promise<MonthPace> {
  const period = date.slice(0, 7);
  const { start, end } = periodBounds(period);
  const last = [date, range.completeDate].sort()[0];
  const through = last >= start ? last : null;
  const [series, scorecard] = await Promise.all([
    through ? getPulseSeries(start, through) : null,
    getScorecard(period),
  ]);
  return {
    period, daysInMonth: daysBetween(start, end) + 1, through,
    daily: series?.totals.revenueCents ?? [],
    targetCents: scorecard.kpis.find(k => k.id === "total_revenue")?.target ?? null,
  };
}

// ---- COO Scorecard ----

export { PILLARS } from "../scorecard/kpiFormat";

const TEAM_LEVEL = new Set(["listings_per_employee", "sales_per_employee"]);
export const getScorecardScreen = cache(async (period: string) => {
  const view = await getScorecard(period);

  const total = view.kpis.find(k => k.id === "total_revenue")?.value ?? null;
  const kpis: Kpi[] = view.kpis.filter(k => k.group === "coo15").map(k => {
    const extra: Partial<Kpi> = { teamLevel: TEAM_LEVEL.has(k.id) };
    if (k.id === "top10_categories_revenue" && k.value != null && total) extra.valueNote = `${Math.round((k.value / total) * 100)}% of revenue`;
    if (k.id === "top10_categories_margin" && k.value != null) extra.valueNote = "margin";
    return { ...k, ...extra };
  });

  // Categories: the union of the two Top-10 lists, with which list(s) each one is in.
  const inRev = new Set(view.topCategoriesByRevenue.map(c => c.category));
  const inMargin = new Set(view.topCategoriesByMargin.map(c => c.category));
  const categories: CategoryRow[] = view.categories
    .filter(c => inRev.has(c.category) || inMargin.has(c.category))
    .map(c => ({ category: c.category, revenueCents: c.revenueCents, marginCents: c.marginCents, inRevenueTop10: inRev.has(c.category), inMarginTop10: inMargin.has(c.category) }));

  return {
    period, kpis, categories, totalRevenueCents: total,
  };
});

// ---- Data Sources ----

const SOURCE_KIND: Record<string, string> = {
  shopgoodwill: "Marketplace", amazon: "Marketplace", ebay: "Marketplace", cashmonkey: "Marketplace",
  upright: "Order hub", jewelry: "Specialty", shipping_osm_pb_easypost: "Shipping",
  fedex: "Carrier", goodwill_books: "Marketplace",
  production_tracking: "Production", upright_inventory: "Inventory", timekeeping: "Labor hours",
  marketplace_ratings: "Ratings", bank_1st_source: "Bank",
};

export const getSourcesScreen = cache(async (range: DataRange, period: string) => {
  const [status, runs, exceptions] = await Promise.all([
    getSourceStatus(period),
    getAllRuns(),
    getExceptions({ status: "open", period, limit: 1000 }),
  ]);
  const { start, end } = periodBounds(period);
  const days = dateRange(start, [end, range.latestDate].sort()[0]);
  const ok = runs.filter(r => r.status !== "failed");
  const runsById = new Map(runs.map(r => [r.id, r]));

  const triaged = exceptions.rows.map(e => ({ e, ...triage(e, runsById) }));
  const actionable = triaged.filter(t => t.verdict === "action");
  const issuesBySource = new Map<string, number>();
  for (const t of actionable) if (t.e.sourceId) issuesBySource.set(t.e.sourceId, (issuesBySource.get(t.e.sourceId) ?? 0) + 1);
  const actionRuns = new Set(actionable.map(t => t.e.ingestRunId).filter(Boolean));
  const formatNotes = new Set(triaged.filter(t => t.format).map(t => t.e.sourceId));

  const sources: Source[] = status.sources.map(s => {
    const mine = ok.filter(r => r.sourceId === s.sourceId);
    const daily = mine.some(r => r.businessDate?.startsWith(period)) || (!mine.some(r => r.period === period) && mine.some(r => r.businessDate));
    // A day is amber only when one of its files has something that needs action.
    const byDay = new Map<string, "received" | "warning">();
    for (const r of mine) if (r.businessDate?.startsWith(period)) byDay.set(r.businessDate, byDay.get(r.businessDate) === "warning" || actionRuns.has(r.id) ? "warning" : "received");
    const earlier = mine.find(r => (r.period ?? r.businessDate?.slice(0, 7) ?? "") < period);
    const openIssues = issuesBySource.get(s.sourceId) ?? 0;
    return {
      id: s.sourceId,
      name: s.name,
      sublabel: `${SOURCE_KIND[s.sourceId] ?? "Source"} · ${daily ? "daily" : "monthly"}`,
      cadence: daily ? "daily" : "monthly",
      status: s.status === "missing" ? "missing" : openIssues > 0 ? "warnings" : "received",
      openIssues,
      formatUnconfirmed: formatNotes.has(s.sourceId),
      lastImportAt: s.lastIngestAt,
      lastFileLabel: earlier ? `${formatStamp(earlier.uploadedAt, { month: "short", day: "numeric" })} (${earlier.periodLabel ?? earlier.period ?? earlier.businessDate})` : undefined,
      rowCount: s.status === "missing" ? null : s.rowCount,
      days: daily ? days.map(d => byDay.get(d) ?? "missing") : undefined,
    };
  });

  return {
    sources,
    issues: groupIssues(actionable),
    openIssues: actionable.length,
    dueLabel: formatDay(`${nextPeriod(period)}-05`, { month: "short", day: "numeric" }),
    firstDayLabel: formatDay(days[0], { month: "short", day: "numeric" }),
    lastDayLabel: formatDay(days[days.length - 1], { month: "short", day: "numeric" }),
  };
});

// ---- Exception triage: what needs a person vs what the import already handled ----
// Rules match the messages written by src/ingest and the parsers. Anything unmatched
// needs action, so a new kind of problem is never hidden.

type Verdict = "action" | "handled" | "format";
const WARNING_RULES: { test: RegExp; verdict: Verdict }[] = [
  { test: /^Channels mapped to "other"/, verdict: "handled" }, // Facebook Marketplace and Mercari sales counted under Other e-commerce
  { test: /refund submitted, not yet granted; not counted/, verdict: "handled" }, // Shipping refunds still pending; each counts once it is granted
  { test: /Refund for order .* not found in this file; recorded as a refund money line/, verdict: "handled" }, // Refunds for orders from earlier files, still counted
  { test: /billed by the carrier .*postage not counted here, it comes from the carrier's invoice/, verdict: "handled" }, // Counted once, from the carrier invoice
  { test: /layout is a guess/, verdict: "format" },
];

type Triage = { verdict: Verdict; format: boolean; detail: string };

function triage(e: ExceptionRow, runsById: Map<string, IngestRunRow>): Triage {
  // Every duplicate the import settled says which copy it kept (Upright over the marketplaces,
  // ShopGoodwill over Jewelry, the first of two identical rows in one file): counted once.
  if (e.kind === "duplicate_order" && /; kept /.test(e.message))
    return { verdict: "handled", format: false, detail: e.message };
  if (e.kind === "duplicate_file")
    return { verdict: "handled", format: false, detail: e.message }; // second copy ignored
  if (e.kind !== "parse_warning") return { verdict: "action", format: false, detail: e.message };

  const run = e.ingestRunId ? runsById.get(e.ingestRunId) : undefined;
  const total = Number(/^(\d+) warnings? in/.exec(e.message)?.[1] ?? 0);
  // The view returns at most 20 warnings per run; if some are unseen, a person should look.
  if (!run || run.warnings.length === 0 || total > run.warnings.length) return { verdict: "action", format: false, detail: e.message.replace(/^.*?First: /, "") };
  const verdicts = run.warnings.map(w => ({ w, rule: WARNING_RULES.find(r => r.test.test(w)) }));
  const open = verdicts.filter(v => !v.rule);
  return {
    verdict: open.length ? "action" : verdicts.every(v => v.rule!.verdict === "format") ? "format" : "handled",
    format: verdicts.some(v => v.rule?.verdict === "format"),
    detail: open.length ? `${open[0].w.replace(/^row \d+: /, "")} (${run.fileName})` : e.message,
  };
}

const ISSUE_TEXT: Partial<Record<ExceptionRow["kind"], (n: number) => string>> = {
  duplicate_order: n => `${n} order${n > 1 ? "s" : ""} reported by two sources need a decision`,
  missing_source: n => `${n} expected file${n > 1 ? "s" : ""} missing`,
};

/** One line per source and problem, biggest first. */
function groupIssues(rows: (Triage & { e: ExceptionRow })[]): SourceIssue[] {
  const groups = new Map<string, (Triage & { e: ExceptionRow })[]>();
  for (const r of rows) {
    const k = `${r.e.sourceName ?? "Unknown source"}|${r.e.kind}|${r.e.kind === "parse_warning" ? r.detail : ""}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()]
    .sort((a, b) => b.length - a.length)
    .map(list => {
      const { e, detail } = list[0];
      const text = e.kind === "parse_warning" ? detail.replace(/ \([^)]*\)$/, "") : ISSUE_TEXT[e.kind]?.(list.length) ?? e.message;
      const source = e.sourceName ?? "Unknown source";
      return { text: text.startsWith(`${source}: `) ? text.slice(source.length + 2) : text, source, detail: e.kind === "parse_warning" ? detail.match(/\(([^)]*)\)$/)?.[1] ?? "" : e.message };
    });
}

export function summarizeSources(sources: Source[]) {
  return {
    total: sources.length,
    arrived: sources.filter(s => s.status !== "missing").length,
    received: sources.filter(s => s.status === "received"),
    warnings: sources.filter(s => s.status === "warnings"),
    missing: sources.filter(s => s.status === "missing"),
  };
}
