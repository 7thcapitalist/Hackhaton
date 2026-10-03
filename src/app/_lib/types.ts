// UI-side shapes: the view contract from src/lib/views (docs/interfaces.md §2) plus the
// display extras each screen needs. Built on the server in data.ts.
import type { ChannelId, Kpi as ViewKpi, PulseRow as ViewPulseRow, PulseSeriesView } from "@/lib/views/types";

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

export type PulseSeries = Pick<PulseSeriesView, "dates" | "series">;

export type KpiStatus = ViewKpi["status"];
export type Pillar = ViewKpi["pillar"];

export type Kpi = ViewKpi & {
  lowerIsBetter?: boolean;
  teamLevel?: boolean;
  history?: number[]; // oldest → newest
  breakdown?: { label: string; value: number }[]; // Top 10 bars (same unit as the KPI)
  displaySuffix?: string; // overrides the unit suffix, e.g. "56% of total"
};

export type SourceStatus = "received" | "warnings" | "missing";
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
  category: string;
  status: string; // paid | refunded | cancelled
  grossCents: number;
  netCents: number;
  sourceFile: string;
  sourceRow: number;
};

export type BadgeStatus = KpiStatus | SourceStatus;
