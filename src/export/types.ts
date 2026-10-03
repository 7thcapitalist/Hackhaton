import type { PulseView, ScorecardView } from "@/lib/views/types";
export type PulseExportData = PulseView;
export type ScorecardExportData = ScorecardView;
export type { KpiUnit } from "@/lib/views/types";
export type ReportCell = string | number | boolean | null | { numeric: string };
export interface ReportTable {
  name: string;
  columns: string[];
  rows: ReportCell[][];
}
