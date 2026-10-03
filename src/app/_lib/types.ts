// UI-side data shapes. They follow the view contract in docs/interfaces.md (§2) plus a few
// display extras. When Joao's src/lib/views lands, swap demo-data.ts for the view functions.

export type ChannelId = "shopgoodwill" | "amazon" | "ebay" | "goodwill_books" | "other";

export type PulseRow = {
  channelId: ChannelId;
  label: string;
  status: "ok" | "missing";
  revenueCents: number | null;
  customers: number | null;
  orders: number | null;
  /** display extras */
  sublabel: string;
  sourceFile: string;
  importedAt: string; // "6:04 AM"
};

export type PulseTotals = { revenueCents: number; customers: number; orders: number };

export type PulseView = {
  businessDate: string; // YYYY-MM-DD
  rows: PulseRow[];
  totals: PulseTotals; // ok rows only
  missingChannels: ChannelId[];
  isSynthetic: boolean;
  /** Most recent file upload timestamp (ISO) behind this pulse, when known. */
  lastImportAt?: string | null;
};

export type PulseSeries = {
  dates: string[];
  series: { channelId: ChannelId; label: string; revenueCents: (number | null)[]; customers: (number | null)[] }[];
};

export type KpiUnit = "cents" | "percent" | "count" | "days" | "ratio" | "cents_per_hour";
export type KpiStatus = "ok" | "simulated" | "awaiting_data";
export type Pillar = "financial" | "productivity" | "inventory" | "sales" | "category_customer";

export type Kpi = {
  id: string;
  label: string;
  pillar: Pillar;
  unit: KpiUnit;
  value: number | null;
  previous: number | null;
  target: number | null;
  status: KpiStatus;
  anchor2027: boolean;
  note?: string;
  /** display extras */
  lowerIsBetter?: boolean;
  teamLevel?: boolean;
  history?: number[]; // oldest → newest
  breakdown?: { label: string; value: number }[]; // Top 10 bars
  displaySuffix?: string; // overrides the unit suffix, e.g. "78% of total"
};

export type SourceStatus = "received" | "warnings" | "missing";
export type Source = {
  id: string;
  name: string;
  sublabel: string;
  cadence: "daily" | "monthly";
  status: SourceStatus;
  openIssues: number;
  lastImportAt: string | null; // ISO timestamp
  lastFileLabel?: string; // shown when the period's file is missing, e.g. "Sep 2 (August file)"
  rowCount: number | null;
  days?: ("received" | "warning" | "missing")[];
  impact?: string; // why the warnings matter, shown on the Overview
};

export type SourceIssue = { text: string; source: string; file: string };

export type SourceOrder = {
  orderId: string;
  /** Minutes after midnight ET, when known. The real order data has no timestamp
   * (src/lib/views/types.ts OrdersView), so this is omitted rather than invented. */
  minute?: number;
  channelLabel: string;
  category: string;
  grossCents: number;
  netCents: number;
  sourceFile: string;
  sourceRow: number;
};

export type BadgeStatus = KpiStatus | SourceStatus;
