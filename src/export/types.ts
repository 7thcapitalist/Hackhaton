// Structural snapshot of docs/interfaces.md. Replace with imports from Joao's
// shared types when they land; these types contain no business calculations.
export interface PulseExportData {
  businessDate: string;
  timezone: string;
  rows: {
    channelId: string;
    label: string;
    status: "ok" | "missing";
    revenueCents: number | null;
    customers: number | null;
    orders: number | null;
  }[];
  totals: { revenueCents: number; customers: number; orders: number };
  missingChannels: string[];
  isSynthetic: boolean;
}

export type KpiUnit = "cents" | "percent" | "count" | "days" | "ratio" | "cents_per_hour";
export interface ScorecardExportData {
  period: string;
  kpis: {
    id: string;
    label: string;
    pillar: string;
    unit: KpiUnit;
    value: number | null;
    previous: number | null;
    target: number | null;
    status: "ok" | "simulated" | "awaiting_data";
    anchor2027: boolean;
    note?: string;
  }[];
  topCategoriesByRevenue: { category: string; revenueCents: number }[];
  topCategoriesByMargin: { category: string; marginCents: number }[];
}

export type ReportCell = string | number | boolean | null | { numeric: string };
export interface ReportTable {
  name: string;
  columns: string[];
  rows: ReportCell[][];
}
