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
  note?: string;
}

export interface ScorecardView {
  period: string;
  kpis: Kpi[];
  topCategoriesByRevenue: { category: string; revenueCents: number }[];
  topCategoriesByMargin: { category: string; marginCents: number }[];
}

export interface SourceStatus {
  sourceId: string;
  name: string;
  status: "received" | "warnings" | "missing";
  lastIngestAt: string | null;
  rowCount: number;
  openExceptions: number;
}

export interface SourceStatusView {
  period: string;
  sources: SourceStatus[];
}

export interface OrdersView {
  rows: {
    id: string;
    channel: ChannelId;
    sourceId: string;
    externalOrderId: string;
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
