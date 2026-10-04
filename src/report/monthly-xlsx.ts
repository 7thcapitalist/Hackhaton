import ExcelJS from "exceljs";
import { spreadsheetText } from "../export/csv";
import type { ScorecardExportData } from "../export/types";
import { previousPeriod } from "../lib/views/dates";
import { brandedWorkbook } from "./branded-workbook";
import { dataLabel, formatReportNumber, formatReportValue, growthBasis, kpiMeaning, monthName, netMarginCostBasis, pillarNames, type ReportKpi } from "./monthly-content";
import { asMonthlyData, detailAvailability, friendlyNote, moneyUnit, originLabel, targetLabel, type MonthlyData } from "./monthly-data";

const blue = "FF01539C", light = "FFF2F6F9", ink = "FF232020";
type Value = string | number | Date | null;
const moneyFormat = "#,##0.00";
function normalized(value: number | null, kpi: ReportKpi): Value {
  if (value === null) return null;
  if (String(value).replace(/[^0-9]/g, "").replace(/^0+|0+$/g, "").length > 15) return formatReportValue(value, kpi.unit);
  return kpi.unit === "percent" || kpi.unit === "cents" || kpi.unit === "cents_per_hour" ? Number(formatReportNumber(value, -2).replace(/,/g, "")) : value;
}
function money(value: number | null): Value {
  if (value === null) return null;
  const exact = formatReportNumber(value, -2, 2).replace(/,/g, "");
  return exact.replace(/[^0-9]/g, "").replace(/^0+|0+$/g, "").length > 15 ? exact : Number(exact);
}
function percent(value: number | null): Value {
  return value === null ? null : Number(formatReportNumber(value, -2).replace(/,/g, ""));
}
function valueFormat(value: number | null, unit: ReportKpi["unit"]): string {
  const decimals = value === null ? 0 : (formatReportValue(value, unit).replace("%", "").split(".")[1] ?? "").length;
  const count = Math.max(unit === "percent" ? 1 : unit === "cents" || unit === "cents_per_hour" ? 2 : 0, decimals);
  return (unit === "percent" ? "0" : "#,##0") + (count ? "." + "0".repeat(count) : "") + (unit === "percent" ? "%" : "");
}
export async function monthlyXlsx(input: MonthlyData | ScorecardExportData): Promise<Uint8Array> {
  const data = asMonthlyData(input), view = data.scorecard;
  const unit = moneyUnit(data), prior = monthName(previousPeriod(view.period));
  const core = view.kpis.filter(k => k.group === "coo15"), additional = view.kpis.filter(k => k.group === "extended");
  const { sheet, finish, nextTableName } = brandedWorkbook({ periodLabel: monthName(view.period), unit, generatedAt: data.generatedAt, version: data.version });
  const hasReferences = data.sources.length > 0 || data.files.length > 0;
  // A rank can share the category table only when every supplied entry is
  // represented exactly once with the same amount. Never reconcile differences.
  const rankingsShareCategories = ([
    [view.topCategoriesByRevenue.map(r => ({ category: r.category, amount: r.revenueCents })), "revenueCents"],
    [view.topCategoriesByMargin.map(r => ({ category: r.category, amount: r.marginCents })), "marginCents"],
  ] as const).every(([rows, amount]) => new Set(rows.map(r => r.category)).size === rows.length &&
    rows.every(r => view.categories.filter(c => c.category === r.category && c[amount] === r.amount).length === 1));
  function measureUnit(k: ReportKpi): string {
    return k.unit === "percent" ? "%" : k.unit === "cents_per_hour" ? `${unit}/hour` : k.unit === "cents" ? k.id === "sales_per_employee" ? `${unit}/employee` : k.id === "avg_selling_price" || k.id === "median_sale_price" ? `${unit}/item` : unit : kpiMeaning(k).unit ?? k.unit;
  }
  const shortNames: Record<string, string> = {
    total_revenue: "Online sales revenue", revenue_growth_pct: "Revenue growth", net_margin_pct: "Estimated net margin",
    listings_created: "New listings created", revenue_per_labor_hour: "Revenue per labor hour", listings_per_employee: "Listings per employee",
    days_donation_to_listing: "Donation to listing", unlisted_backlog: "Items waiting for listing", unsold_inventory_pct: "Unsold listings older than 60 days",
    avg_selling_price: "Average selling price", sell_through_rate: "Share of available items sold", sales_per_employee: "Revenue per employee",
    top10_categories_revenue: "Top 10 categories: revenue", top10_categories_margin: "Top 10 categories: margin amount", repeat_buyer_rate: "Repeat buyer rate",
  };
  function readingNote(k: ReportKpi): string {
    const partial = k.note?.match(/Partial month: data through (\d{4}-\d{2}-\d{2})/);
    const coverage = partial ? ` Partial month: data through ${partial[1]}.` : "";
    if (k.id === "revenue_growth_pct") return `${growthBasis(k, previousPeriod(view.period))}. Previous report's growth comparison is not supplied.${coverage}`;
    if (k.id === "top10_categories_revenue" || k.id === "top10_categories_margin") return `Combined amount; category names and ranks are in ${rankingsShareCategories ? "Categories" : "Category Rankings"}.${coverage}`;
    const caution = k.id === "net_margin_pct" ? `After ${netMarginCostBasis(k)}. Overhead excluded; not final profit.` : kpiMeaning(k).caution ?? "";
    const notes = [k.anchor2027 ? "2027 priority." : "", caution];
    if (k.id === "total_revenue") notes.push("After fees and refunds; includes shipping collected, excludes tax. Revenue is not profit.");
    if (["avg_selling_price", "median_sale_price", "asp_by_category"].includes(k.id)) notes.push("Gross selling price on paid orders; differs from net revenue.");
    if (["repeat_buyer_rate", "number_of_buyers", "new_buyers"].includes(k.id)) {
      notes.push(k.id === "new_buyers" ? "First purchase in available history; earlier purchases may be unknown." : "Buyers are counted separately within each marketplace.");
      const excluded = k.note?.match(/(\d+) transactions without a buyer id/);
      if (excluded) notes.push(`${formatReportNumber(Number(excluded[1]))} order lines without buyer identification excluded.`);
    }
    const labor = k.note?.match(/Processing labor cost = labor hours [\u00d7x] \$([\d,.]+)\/h loaded rate/);
    if (labor) notes.push(`Labor assumption: ${labor[1]} ${unit}/hour.`);
    if (coverage) notes.push(coverage.trim());
    if (["csat", "nps", "marketplace_conversion"].includes(k.id)) notes.push("Average across marketplaces, weighted by sample size when supplied. See Marketplaces.");
    if (k.id === "listings_per_day") notes.push("Uses elapsed calendar days through the last listing date.");
    return notes.filter(Boolean).join(" ");
  }
  function measures(kpis: ReportKpi[]): ExcelJS.Worksheet {
    const ws = sheet("Scorecard", "Monthly scorecard", `Current: ${monthName(view.period)}. Previous report: ${prior}. ${originLabel(data)} ${targetLabel(data)}${data.targetBasis === "approved" ? "." : "; approval by Goodwill is not confirmed."} Blank = unavailable. Calculated does not confirm real data.`,
      ["Indicator set", "Area", "Indicator and unit", "Current", "Previous report", "Target", "Calculation basis", "Reading note"], [15, 21, 37, 18, 18, 18, 23, 45],
      kpis.map(k => [k.group === "coo15" ? "Core" : "Supporting", pillarNames[k.pillar], `${shortNames[k.id] ?? kpiMeaning(k).name}\n${measureUnit(k)}`, normalized(k.value, k), normalized(k.previous, k), normalized(k.target, k), dataLabel(k), readingNote(k)]));
    ws.mergeCells("A3:H3"); ws.getCell("A3").value = `${core.length} core indicators${additional.length ? ` and ${additional.length} supporting measures` : ""}. ${detailAvailability(data)}`;
    ws.getCell("A3").font = { name: "Arial", size: 11, color: { argb: ink } }; ws.getCell("A3").alignment = { wrapText: true, vertical: "middle" }; ws.getRow(3).height = 24;
    kpis.forEach((k, i) => {
      const row = i + 8;
      // Keep original numbers; emphasis indicates a planning priority, not performance.
      if (k.anchor2027) [3, 4].forEach(col => { ws.getCell(row, col).font = { name: "Arial", size: 11, bold: true, color: { argb: ink } }; });
      if (!i || k.pillar !== kpis[i - 1].pillar || k.group !== kpis[i - 1].group) ws.getRow(row).eachCell({ includeEmpty: true }, cell => { cell.border = { top: { style: "thin", color: { argb: "FF9BB2C8" } } }; });
      for (const [col, key] of [[4, "value"], [5, "previous"], [6, "target"]] as const) {
        const cell = ws.getCell(row, col); if (typeof cell.value === "number") cell.numFmt = valueFormat(k[key], k.unit);
      }
      ws.getCell(row, 7).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    return ws;
  }
  measures([...core, ...additional]);
  const cats = sheet("Categories", "Category detail", `Every supplied category. Category margin excludes customer shipping charges; it is not final profit. Share sold uses simulated item records. ${rankingsShareCategories ? "Sort the rank columns to view the supplied rankings; blank ranks are outside those lists." : "Independent source rankings are retained in Category Rankings."}`,
    ["Category", `Revenue (${unit})`, `Margin amount (${unit})`, "Items sold", "Share sold", `Average price (${unit})`, "Revenue rank", "Margin rank"], [40, 21, 21, 17, 17, 21, 17, 17],
    view.categories.map(row => [row.category, money(row.revenueCents), money(row.marginCents), row.units, percent(row.sellThroughPct), money(row.aspCents),
      view.topCategoriesByRevenue.findIndex(rank => rank.category === row.category && rank.revenueCents === row.revenueCents) + 1 || null,
      view.topCategoriesByMargin.findIndex(rank => rank.category === row.category && rank.marginCents === row.marginCents) + 1 || null]));
  for (let r = 8; r <= cats.rowCount; r++) { [2, 3, 6].forEach(c => cats.getCell(r, c).numFmt = moneyFormat); [4, 7, 8].forEach(c => cats.getCell(r, c).numFmt = "#,##0"); cats.getCell(r, 5).numFmt = valueFormat(view.categories[r - 8].sellThroughPct, "percent"); }
  if (!rankingsShareCategories) {
    const ranks = sheet("Category Rankings", "Independent source rankings", "These supplied rankings differ from the category table or include repeated names. They are retained separately without adjusting either dataset.",
    ["Ranking", "Rank", "Category", `Amount (${unit})`], [26, 12, 45, 24], [
      ...view.topCategoriesByRevenue.map((r, i): Value[] => ["Revenue", i + 1, r.category, money(r.revenueCents)]),
      ...view.topCategoriesByMargin.map((r, i): Value[] => ["Margin amount", i + 1, r.category, money(r.marginCents)])]);
    for (let r = 8; r <= ranks.rowCount; r++) { ranks.getCell(r, 4).numFmt = moneyFormat; ranks.getCell(r, 2).alignment = { horizontal: "center", vertical: "middle" }; }
  }
  const total = view.kpis.find(k => k.id === "total_revenue")?.value ?? null;
  const categorized = view.categories.reduce((sum, r) => sum + r.revenueCents, 0);
  if (cats.rowCount + 8 > 1_048_576) throw new Error("Category detail and coverage exceed Excel's row limit; no records were truncated");
  const coverageHeader = cats.rowCount + 3;
  cats.addTable({ name: nextTableName(), ref: `A${coverageHeader}`, headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [{ name: "Revenue coverage", filterButton: true }, { name: `Amount (${unit})`, filterButton: true }],
    rows: [["All online revenue", money(total)], ["Revenue from categorized orders", money(categorized)], ["Difference: total less category revenue", total === null ? null : money(total - categorized)]] });
  cats.getRow(coverageHeader).height = 32;
  cats.getRow(coverageHeader).eachCell(cell => {
    cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: blue } }; cell.alignment = { wrapText: true, vertical: "middle", indent: 1 };
  });
  for (let row = coverageHeader + 1; row <= coverageHeader + 3; row++) {
    cats.getRow(row).height = 40;
    cats.getRow(row).eachCell(cell => { cell.font = { name: "Arial", size: 11, color: { argb: ink } }; cell.alignment = { wrapText: true, vertical: "middle", horizontal: typeof cell.value === "number" ? "right" : "left", indent: 1 }; });
    cats.getCell(row, 2).numFmt = moneyFormat;
  }
  const coverageNote = coverageHeader + 5;
  cats.mergeCells(coverageNote, 1, coverageNote, 8); cats.getCell(coverageNote, 1).value = "Category revenue covers only orders assigned to a category. The difference above compares data coverage, not months. Totals are not adjusted to make them equal.";
  cats.getCell(coverageNote, 1).font = { name: "Arial", size: 11, color: { argb: ink } }; cats.getCell(coverageNote, 1).alignment = { wrapText: true, vertical: "middle" }; cats.getRow(coverageNote).height = 32;
  cats.pageSetup.printArea = `A1:H${coverageNote}`;
  const channels: Record<string, string> = { ebay: "eBay", amazon: "Amazon", goodwill_books: "GoodwillBooks", shopgoodwill: "ShopGoodwill", other: "Other e-commerce" };
  const markets = sheet("Marketplaces", "Marketplace measures", "Current reporting month. Rating scales are not returned by the shared view; use platform/source confirmation. NPS: -100 to 100.",
    ["Marketplace", "Satisfaction rating", "Recommendation score", "Conversion", "Seller rating"], [25, 24, 26, 20, 20],
    view.marketplaceMetrics.map(r => [channels[r.channel] ?? r.channel.replace(/_/g, " "), r.csat, r.nps, percent(r.conversionRate), r.sellerRating]));
  for (let r = 8; r <= markets.rowCount; r++) markets.getCell(r, 4).numFmt = valueFormat(view.marketplaceMetrics[r - 8].conversionRate, "percent");
  if (data.orders) {
    const fileById = new Map(data.files.map(file => [file.id, file]));
    const fileIndexById = new Map(data.files.map((file, i) => [file.id, i]));
    const tx = sheet("Transactions", "Normalized order lines", "Complete normalized monthly lines; personal buyer data excluded. Gross = item sales. Net includes customer shipping, less fees and refunds; tax excluded. Net is revenue, not profit.",
      ["Business date", "Marketplace", "Category", `Gross (${unit})`, `Net (${unit})`, "Record status", "Record ID", "External order reference", "Source ID", "Ingest reference", "Source file", "Source row", "Origin"], [18, 22, 35, 20, 20, 20, 42, 36, 35, 42, 50, 15, 22],
      data.orders.map(r => { const file = fileById.get(r.ingestRunId); return [new Date(`${r.businessDate}T12:00:00Z`), channels[r.channel] ?? r.channel.replace(/_/g, " "), r.category, money(r.grossCents), money(r.netCents), r.status.replace(/_/g, " "), r.id, r.externalOrderId, r.sourceId, r.ingestRunId, file?.fileName ?? null, r.sourceRow, file ? file.isSynthetic ? "Simulated" : "Not marked synthetic" : "Unconfirmed"]; }));
    for (let r = 8; r <= tx.rowCount; r++) [4, 5].forEach(c => tx.getCell(r, c).numFmt = moneyFormat);
    data.orders.forEach((order, i) => {
      const fileIndex = fileIndexById.get(order.ingestRunId);
      if (fileIndex === undefined) return;
      const cell = tx.getCell(i + 8, 11);
      cell.value = { text: spreadsheetText(data.files[fileIndex].fileName), hyperlink: `#'Sources'!F${8 + data.sources.length + fileIndex}` };
      cell.font = { name: "Arial", size: 11, color: { argb: blue }, underline: true };
    });
  }
  const cadenceAvailable = data.sources.some(s => s.cadence !== undefined);
  const missingDays = data.sources.some(s => s.missingDates?.length);
  const sourceRows: Value[][] = data.sources.map(s => ["Source status", s.name, s.sourceId, s.status.replace(/_/g, " "), null, null, s.rowCount, s.lastIngestAt ? new Date(s.lastIngestAt) : null, s.openExceptions, null,
    ...(cadenceAvailable ? [s.cadence ?? null] : []), ...(missingDays ? [s.missingDates?.join(", ") ?? null] : [])]);
  data.files.forEach(f => sourceRows.push(["Ingested file", f.sourceName, f.sourceId, f.status.replace(/_/g, " "), f.id, f.fileName, f.rowCount, new Date(f.uploadedAt), null, f.isSynthetic ? "Simulated" : "Not marked synthetic",
    ...(cadenceAvailable ? [null] : []), ...(missingDays ? [null] : [])]));
  if (hasReferences) {
    const headers = ["Reference type", "Source", "Source ID", "Status", "Ingest reference", "File name", "Source rows", "Uploaded / last ingest (UTC)", "Open exceptions", "Origin", ...(cadenceAvailable ? ["Frequency"] : []), ...(missingDays ? ["Missing business days"] : [])];
    const sources = sheet("Sources", "Data sources and files", `${originLabel(data)} File row counts describe ingestion, not unique monthly orders.${cadenceAvailable ? "" : " Source cadence is unconfirmed."}`,
      headers, [22, 32, 32, 24, 42, 50, 17, 29, 18, 24, ...(cadenceAvailable ? [16] : []), ...(missingDays ? [48] : [])], sourceRows);
    for (let r = 8; r <= sources.rowCount; r++) sources.getCell(r, 8).numFmt = "yyyy-mm-dd hh:mm:ss";
    sources.mergeCells(3, 1, 3, headers.length); sources.getCell("A3").value = `${data.currencyConfirmation}${data.sourceAsOf ? ` Source availability assessed as of ${data.sourceAsOf}.` : ""}`;
    sources.getCell("A3").font = { name: "Arial", size: 11, color: { argb: ink } }; sources.getCell("A3").alignment = { wrapText: true, vertical: "middle" }; sources.getRow(3).height = 24;
    sources.mergeCells(6, 1, 6, headers.length); sources.getCell("A6").value = "Goodwill requirements: https://innovationsprintlab.com/sprinthack-deck/sprinthack.html (slides 33-36).";
    sources.getCell("A6").font = { name: "Arial", size: 10, color: { argb: ink } }; sources.getRow(6).height = 20;
  } else {
    sheet("Sources", "Data sources", originLabel(data), ["Source / reference", "Available information"], [32, 108], [
      ["Monthly report data", `${data.collection === "shared-views" ? "Shared monthly reporting views." : "Supplied monthly scorecard."} ${data.orders === null ? "Only aggregate figures were supplied; detailed order lines and uploaded-file references were not supplied." : "Normalized order lines are in Transactions; uploaded-file references were not supplied."}`],
      ["Currency confirmation", data.currencyConfirmation],
      ["Goodwill reporting requirements", "https://innovationsprintlab.com/sprinthack-deck/sprinthack.html (slides 33-36). The deck does not confirm numeric monthly targets."]]);
  }
  if (data.files.some(file => file.warnings.length)) sheet("File Warnings", "Supplied file warnings", "Every warning returned by the shared file view. That view supplies at most the first 20 warnings per file; full original logs are outside this export.",
    ["File name", "Ingest reference", "Warning"], [50, 42, 100], data.files.flatMap(file => file.warnings.map(warning => [file.fileName, file.id, friendlyNote(warning)])));
  return finish();
}

export { money as workbookMoney, percent as workbookPercent, valueFormat as workbookNumberFormat };
