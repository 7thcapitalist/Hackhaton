// UI-side shapes: the view contract from src/lib/views (docs/interfaces.md §2) plus the
// display extras each screen needs. Built on the server in data.ts.
import type { ChannelId, Kpi as ViewKpi, KpiUnit, MarketplaceMetricsRow, PulseRow as ViewPulseRow, PulseSeriesView } from "@/lib/views/types";

export type { ChannelId, KpiUnit } from "@/lib/views/types";

export type PulseRow = ViewPulseRow & {
  sublabel: string;
  sourceFiles: string[];      // files the row's orders came from
  importedAt: string | null;  // ISO, latest of those files
  expectedFile: string | null; // for missing rows
};

export type PulseTotals = { revenueCents: number; customers: number; orders: number };

export type PulseView = {
  businessDate: string;
  rows: PulseRow[];
  totals: PulseTotals; // ok rows only
  missingChannels: ChannelId[];
  isSynthetic: boolean;
};

/** Marketplaces that reported on a day (reported 0 = no data imported). */
export type DayStatus = { date: string; reported: number; total: number };

export type PulseSeries = Pick<PulseSeriesView, "dates" | "series">;

export type KpiStatus = ViewKpi["status"];
export type Pillar = ViewKpi["pillar"];

/**
 * How a KPI is shown: the view's units plus two display-only ones for KPIs whose view unit is
 * "ratio" but read differently: "score" (CSAT 4.62 of 5, NPS 44.05) and "per_day" (listings per day).
 */
export type DisplayUnit = KpiUnit | "score" | "per_day";

export type Kpi = Omit<ViewKpi, "unit"> & {
  unit: DisplayUnit;
  teamLevel?: boolean;
  valueNote?: string; // shown after the value, e.g. "58% of revenue"
};

/** One row of the scorecard's Categories table: the union of the two Top-10 lists. */
export type CategoryRow = {
  category: string;
  revenueCents: number;
  marginCents: number;
  inRevenueTop10: boolean;
  inMarginTop10: boolean;
  units: number;                 // paid units sold
  sellThroughPct: number | null; // items sold / items available × 100
  aspCents: number | null;       // paid gross / paid units
};

/** Per-channel marketplace metrics (CSAT, NPS, conversion) behind the averaged KPIs. */
export type MarketplaceMetricRow = MarketplaceMetricsRow & { label: string };

export type SourceStatus = "received" | "warnings" | "missing" | "not_due";
export type Source = {
  id: string;
  name: string;
  sublabel: string;
  cadence: "daily" | "monthly";
  status: SourceStatus;
  openIssues: number;          // issues that need a person (handled ones are excluded)
  formatUnconfirmed?: boolean; // parser layout not yet confirmed with a real export
  lastImportAt: string | null; // ISO, this period
  lastFileLabel?: string;      // when this period's file is missing, e.g. "Sep 30 (2026-09)"
  rowCount: number | null;
  days?: ("received" | "warning" | "missing")[]; // daily sources, one per day of the period so far
};

export type SourceIssue = { text: string; source: string; detail: string };

export type SourceOrder = {
  id: string;
  orderId: string;
  channelLabel: string;
  /** Unique-customer key, same rule as the pulse view: buyer per marketplace, else the transaction. */
  customerKey: string;
  category: string;
  status: string; // paid | refunded | cancelled
  grossCents: number;
  netCents: number;
  sourceFile: string;
  sourceRow: number;
};

export type BadgeStatus = KpiStatus | SourceStatus;
