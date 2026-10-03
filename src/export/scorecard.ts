import { centsText, tableToCsv } from "./csv";
import type { KpiUnit, ReportCell, ReportTable, ScorecardExportData } from "./types";

export function kpiDisplay(value: number | null, unit: KpiUnit): ReportCell {
  if (value === null) return "awaiting data";
  if (unit === "cents" || unit === "cents_per_hour") {
    return { numeric: Number.isSafeInteger(value) ? centsText(value) : String(value / 100) };
  }
  // Percent scale is not confirmed: preserve the supplied value, never multiply.
  return value;
}

export function kpiDisplayUnit(unit: KpiUnit): string {
  if (unit === "cents") return "currency units";
  if (unit === "cents_per_hour") return "currency units per hour";
  return unit;
}

export function scorecardTables(view: ScorecardExportData): ReportTable[] {
  return [
    { name: "Scorecard", columns: ["period", "kpi_id", "label", "pillar", "unit",
      "value_raw", "value", "previous_raw", "previous", "target_raw", "target",
      "status", "anchor_2027", "note", "percent_scale", "display_unit"],
    rows: view.kpis.map(kpi => [view.period, kpi.id, kpi.label, kpi.pillar, kpi.unit,
      kpi.value, kpiDisplay(kpi.value, kpi.unit), kpi.previous, kpiDisplay(kpi.previous, kpi.unit),
      kpi.target, kpiDisplay(kpi.target, kpi.unit), kpi.status, kpi.anchor2027, kpi.note ?? "",
      kpi.unit === "percent" ? "as supplied; scale unconfirmed" : "", kpiDisplayUnit(kpi.unit)]) },
    { name: "Categories Revenue", columns: ["period", "category", "revenue_cents", "revenue"],
      rows: view.topCategoriesByRevenue.map(row => [view.period, row.category,
        row.revenueCents, { numeric: centsText(row.revenueCents) }]) },
    { name: "Categories Margin", columns: ["period", "category", "margin_cents", "margin"],
      rows: view.topCategoriesByMargin.map(row => [view.period, row.category,
        row.marginCents, { numeric: centsText(row.marginCents) }]) },
  ];
}

export function scorecardCsv(view: ScorecardExportData): string {
  const tables = scorecardTables(view);
  const columns = ["record_type", ...new Set(tables.flatMap(table => table.columns))];
  const kinds = ["kpi", "category_revenue", "category_margin"];
  return tableToCsv({ name: "Monthly Scorecard", columns,
    rows: tables.flatMap((table, i) => table.rows.map(row => columns.map(column => {
      if (column === "record_type") return kinds[i];
      const index = table.columns.indexOf(column);
      return index === -1 ? null : row[index];
    }))) });
}
