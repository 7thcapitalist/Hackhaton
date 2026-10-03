import { centsText, tableToCsv } from "./csv";
import type { KpiUnit, ReportCell, ReportTable, ScorecardExportData } from "./types";

export function kpiDisplay(value: number | null, unit: KpiUnit): ReportCell {
  if (value === null) return "awaiting data";
  if (unit === "cents" || unit === "cents_per_hour") {
    return { numeric: Number.isSafeInteger(value) ? centsText(value) : String(value / 100) };
  }
  // The shared view supplies percentage points: 2.4 means 2.4%, not 240%.
  return value;
}

export function kpiDisplayUnit(unit: KpiUnit): string {
  if (unit === "cents") return "currency units";
  if (unit === "cents_per_hour") return "currency units per hour";
  return unit;
}

export function scorecardTables(view: ScorecardExportData): ReportTable[] {
  const tables: ReportTable[] = [
    { name: "Scorecard", columns: ["period", "kpi_id", "label", "pillar", "unit",
      "value_raw", "value", "previous_raw", "previous", "target_raw", "target",
      "status", "anchor_2027", "note", "percent_scale", "display_unit", "kpi_group"],
    rows: view.kpis.map(kpi => [view.period, kpi.id, kpi.label, kpi.pillar, kpi.unit,
      kpi.value, kpiDisplay(kpi.value, kpi.unit), kpi.previous, kpiDisplay(kpi.previous, kpi.unit),
      kpi.target, kpiDisplay(kpi.target, kpi.unit), kpi.status, kpi.anchor2027, kpi.note ?? "",
      kpi.unit === "percent" ? "percentage points (2.4 = 2.4%)" : "", kpiDisplayUnit(kpi.unit), kpi.group]) },
    { name: "Categories Revenue", columns: ["period", "category", "revenue_cents", "revenue"],
      rows: view.topCategoriesByRevenue.map(row => [view.period, row.category,
        row.revenueCents, { numeric: centsText(row.revenueCents) }]) },
    { name: "Categories Margin", columns: ["period", "category", "margin_cents", "margin"],
      rows: view.topCategoriesByMargin.map(row => [view.period, row.category,
        row.marginCents, { numeric: centsText(row.marginCents) }]) },
    { name: "Category Detail", columns: ["period", "category", "revenue_cents", "revenue",
      "margin_cents", "margin", "units", "sell_through_pct", "asp_cents", "asp",
      "percent_scale", "sell_through_data_basis"],
      rows: view.categories.map(row => [view.period, row.category, row.revenueCents,
        { numeric: centsText(row.revenueCents) }, row.marginCents, { numeric: centsText(row.marginCents) },
        row.units, row.sellThroughPct, row.aspCents,
        row.aspCents === null ? "awaiting data" : { numeric: centsText(row.aspCents) },
        "percentage points (2.4 = 2.4%)", "synthetic item data"]) },
    { name: "Marketplace Metrics", columns: ["period", "channel", "csat", "nps",
      "conversion_rate_pct", "seller_rating", "percent_scale"],
      rows: view.marketplaceMetrics.map(row => [view.period, row.channel, row.csat, row.nps,
        row.conversionRate, row.sellerRating, "percentage points (2.4 = 2.4%)"]) },
  ];
  return tables.map(table => ({ ...table, columns: [...table.columns, "dataset_provenance"],
    rows: table.rows.map(row => [...row, "unknown"]) }));
}

export function scorecardCsv(view: ScorecardExportData): string {
  const tables = scorecardTables(view);
  // Keep every existing CSV column in place; append the additive view fields.
  const existingColumns = [...new Set(tables.slice(0, 3).flatMap(table =>
    table.columns.filter(column => column !== "kpi_group" && column !== "dataset_provenance")))];
  const addedColumns = [...new Set(tables.flatMap(table => table.columns))]
    .filter(column => !existingColumns.includes(column));
  const columns = ["record_type", ...existingColumns, ...addedColumns];
  const kinds = ["kpi", "category_revenue", "category_margin", "category_detail", "marketplace_metrics"];
  return tableToCsv({ name: "Monthly Scorecard", columns,
    rows: tables.flatMap((table, i) => table.rows.map(row => columns.map(column => {
      if (column === "record_type") return kinds[i];
      const index = table.columns.indexOf(column);
      return index === -1 ? null : row[index];
    }))) });
}
