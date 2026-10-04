/**
 * View data shapes shared by the UI (Gabriel), exports/email (Denis) and the
 * JSON routes under /api/views. Money is integer cents. Dates are
 * `YYYY-MM-DD` business dates in America/Indiana/Indianapolis; period is `YYYY-MM`.
 * Change only by PR and tell the team.
 */
export type ChannelId = "shopgoodwill" | "amazon" | "ebay" | "goodwill_books" | "other";

export interface PulseRow {
  channelId: ChannelId;
  label: string;
  status: "ok" | "missing";
  revenueCents: number | null;
  customers: number | null;
  orders: number | null;
}

export interface PulseView {
  businessDate: string;
  timezone: "America/Indiana/Indianapolis";
  rows: PulseRow[];
  totals: { revenueCents: number; customers: number; orders: number };
  missingChannels: ChannelId[];
  isSynthetic: boolean;
}

export interface PulseSeriesView {
  from: string;
  to: string;
  dates: string[];
  series: {
    channelId: ChannelId;
    label: string;
    revenueCents: (number | null)[];
    customers: (number | null)[];
  }[];
  totals: { revenueCents: number[]; customers: number[] };
}

export type KpiUnit = "cents" | "percent" | "count" | "days" | "ratio" | "cents_per_hour";

export interface Kpi {
  id: string;
  label: string;
  pillar: "financial" | "productivity" | "inventory" | "sales" | "category_customer";
  unit: KpiUnit;
  value: number | null;
  previous: number | null;
  target: number | null;
  status: "ok" | "simulated" | "awaiting_data";
  anchor2027: boolean;
  /** true = higher is better, false = lower is better. Always set by getScorecard (from the KPI definition). */
  higherIsBetter?: boolean;
  /** "coo15" = the one-page scorecard of slide 35; "extended" = the rest of slides 33-34. */
  group: "coo15" | "extended";
  note?: string;
}

export interface CategoryKpiRow {
  category: string;
  /** Σ net_cents of the category's orders. */
  revenueCents: number;
  /** Σ net_cents minus shipping charged on paid orders. */
  marginCents: number;
  /** Σ quantity of paid order lines. */
  units: number;
  /** Items sold / items available × 100 (synthetic item data); null without item data. */
  sellThroughPct: number | null;
  /** Paid gross / paid units; null when no units sold. */
  aspCents: number | null;
}

export interface MarketplaceMetricsRow {
  channel: string;
  /** Marketplace's own scale (e.g. 4.8 of 5). */
  csat: number | null;
  /** −100..100. */
  nps: number | null;
  /** Percent (2.4 = 2.4%). */
  conversionRate: number | null;
  sellerRating: number | null;
}

export interface ScorecardView {
  period: string;
  /** The 15 KPIs of slide 35 (group "coo15") first, then the extended KPIs of slides 33-34. */
  kpis: Kpi[];
  topCategoriesByRevenue: { category: string; revenueCents: number }[];
  topCategoriesByMargin: { category: string; marginCents: number }[];
  /** Every category with orders or items in the period, sorted by revenue. */
  categories: CategoryKpiRow[];
  /** One row per channel with marketplace metrics in the period; empty = awaiting data. */
  marketplaceMetrics: MarketplaceMetricsRow[];
}

export interface SourceStatus {
  sourceId: string;
  name: string;
  /** How often the source delivers (sources.config_json.cadence). */
  cadence: "daily" | "weekly" | "monthly";
  /**
   * "not_due": no file yet, and none is expected yet (a weekly/monthly file
   * for the running period, or a daily source with no finished day in the
   * period). "missing": a due file is absent (daily: a finished day without
   * a file, see missingDates).
   */
  status: "received" | "warnings" | "missing" | "not_due";
  lastIngestAt: string | null;
  rowCount: number;
  openExceptions: number;
  /** Daily sources: finished days of the period with no file. */
  missingDates?: string[];
}

export interface SourceStatusView {
  period: string;
  /** The data's clock: latest business day with an ingested file. Days before it are due. */
  asOf: string;
  sources: SourceStatus[];
}

export interface OrdersView {
  rows: {
    id: string;
    channel: ChannelId;
    sourceId: string;
    externalOrderId: string;
    buyerKey: string | null;
    businessDate: string;
    category: string | null;
    grossCents: number;
    netCents: number;
    status: string;
    ingestRunId: string;
    sourceRow: number;
  }[];
  total: number;
}

export type ExceptionKind =
  | "missing_source"
  | "parse_warning"
  | "parse_failed"
  | "reconcile_mismatch"
  | "unmapped_amount"
  | "duplicate_file"
  | "duplicate_order"
  | "unbalanced_document";

export type ExceptionStatus = "open" | "resolved" | "waived";

export interface ExceptionRow {
  id: string;
  kind: ExceptionKind;
  sourceId: string | null;
  sourceName: string | null;
  message: string;
  owner: string | null;
  status: ExceptionStatus;
  expectedCents: number | null;
  actualCents: number | null;
  ingestRunId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ExceptionsView {
  rows: ExceptionRow[];
  total: number;
  /** Counts with every filter applied except `kind`. */
  countsByKind: Record<string, number>;
}

export interface IngestRunRow {
  id: string;
  sourceId: string;
  sourceName: string;
  fileName: string;
  period: string | null;
  businessDate: string | null;
  periodLabel: string | null;
  status: "parsed" | "parsed_with_warnings" | "failed";
  rowCount: number;
  /** First 20 warnings, "row N: message"; for a failed run, the error. */
  warnings: string[];
  isSynthetic: boolean;
  uploadedAt: string;
}

export interface IngestRunsView {
  rows: IngestRunRow[];
  total: number;
}
