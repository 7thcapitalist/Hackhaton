import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { KPI_DEFINITIONS } from "../kpis/definitions";
import { sampleScorecard } from "../export/testing/fixtures";
import type { ScorecardExportData } from "../export/types";
import { monthlyReportHtml } from "./monthly";
import { goodwillLogo } from "./monthly-brand";
import { formatReportNumber, formatReportValue } from "./monthly-content";
import { monthlyData, originLabel, presentationChanges } from "./monthly-data";
import { monthlyXlsx } from "./monthly-xlsx";
import { createMonthlyProvider } from "./monthly-provider";
import { createMonthlyApiProvider } from "./monthly-api";
import { monthlyEmailPreview } from "../emails/monthly-preview";
import { requireMonthlyDetailAccess } from "../export/monthly-access";
import type { OrdersView } from "../lib/views/types";

function fullView(): ScorecardExportData {
  return { ...structuredClone(sampleScorecard), kpis: KPI_DEFINITIONS.map((d, i) => ({
    id: d.id, label: d.label, pillar: d.pillar, unit: d.unit, group: d.group, anchor2027: d.anchor2027,
    value: d.unit === "cents" ? 123456 + i : 20 + i, previous: d.unit === "cents" ? 100000 + i : 10 + i,
    target: d.anchor2027 ? 30 : null, status: d.dataBasis === "synthetic" ? "simulated" : "ok", note: d.note,
  })) };
}
test("source formatting keeps units and precision without multiplying percentages", () => {
  assert.equal(formatReportValue(123456, "cents"), "1,234.56");
  assert.equal(formatReportValue(Number.MAX_SAFE_INTEGER, "cents"), "90,071,992,547,409.91");
  assert.equal(formatReportValue(1234.5, "cents_per_hour"), "12.345");
  assert.equal(formatReportValue(42.7, "percent"), "42.7%");
  assert.equal(formatReportValue(null, "count"), "Not available");
  assert.equal(formatReportNumber(1e-7), "0.0000001");
  assert.throws(() => formatReportNumber(Infinity));
});
test("one immutable snapshot supports the three reading stages, 15 core indicators and offline brand", async () => {
  const view = fullView(), original = structuredClone(view);
  const data = monthlyData(view, { currency: "USD", targetBasis: "illustrative", generatedAt: "2026-10-03T20:00:00Z" });
  const html = monthlyReportHtml(data);
  assert.equal((html.match(/class="report-page"/g) ?? []).length, 3);
  assert.equal((html.match(/data-kpi-group="coo15"/g) ?? []).length, 15);
  assert.ok(!html.includes('data-kpi-group="extended"'));
  assert.equal((html.match(/class="priority"/g) ?? []).length, 3);
  assert.ok(html.indexOf('id="monthly-overview"') < html.indexOf('id="changes"'));
  assert.ok(html.indexOf('id="changes"') < html.indexOf('id="full-scorecard"'));
  assert.equal((html.match(new RegExp(goodwillLogo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 3);
  assert.ok(html.includes(data.version)); assert.ok(html.includes(data.generatedAt));
  assert.deepEqual(view, original); assert.ok(Object.isFrozen(data.scorecard.kpis));
  const calculatedOnly = structuredClone(view); calculatedOnly.kpis.forEach(k => { k.status = "ok"; });
  assert.equal(originLabel(monthlyData(calculatedOnly)), "Record origin unconfirmed.");
  const workbookBytes = await monthlyXlsx(data);
  const archive = await JSZip.loadAsync(workbookBytes);
  for (const file of archive.file(/^xl\/tables\/table\d+\.xml$/)) {
    const xml = await file.async("string");
    assert.ok(xml.includes('totalsRowShown="0" totalsRowCount="0"'), "Final records are not treated as totals");
  }
  for (const file of archive.file(/^xl\/worksheets\/sheet\d+\.xml$/)) {
    const xml = await file.async("string");
    assert.ok(!/<pane\b/.test(xml), "Sheets use a single viewport without frozen or split panes");
    assert.ok(xml.includes('activeCell="A1" sqref="A1"'), "Sheets open with a valid selection at the top");
  }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Uint8Array.from(workbookBytes).buffer);
  const sc = wb.getWorksheet("Scorecard")!;
  assert.equal(wb.worksheets[0], sc, "The workbook opens directly on results");
  assert.equal(sc.rowCount - 7, 34); assert.equal(sc.columnCount, 8);
  const kpis = [...view.kpis.filter(k => k.group === "coo15"), ...view.kpis.filter(k => k.group === "extended")];
  for (const [i, k] of kpis.entries()) {
    assert.equal(sc.getCell(i + 8, 1).value, i < 15 ? "Core" : "Supporting");
    for (const [col, key] of [[4, "value"], [5, "previous"], [6, "target"]] as const) {
      const expected = k[key] === null ? null : ["percent", "cents", "cents_per_hour"].includes(k.unit) ? Number(formatReportNumber(k[key]!, -2).replace(/,/g, "")) : k[key];
      assert.equal(sc.getCell(i + 8, col).value, expected);
    }
  }
  assert.ok(sc.getTable("MonthlyDetail1"), "Both indicator sets remain in one filterable native Excel table");
  assert.equal(sc.getCell("C8").hyperlink, undefined, "Indicator labels have no links to the removed glossary");
  for (const row of [10, 12, 18]) assert.ok(sc.getCell(row, 8).text.includes("2027 priority"));
  assert.ok(wb.getWorksheet("Sources")!.getCell("B10").text.includes("innovationsprintlab.com/sprinthack-deck"));
  for (const name of ["Start Here", "Additional Measures", "Source Values", "PDF Comparisons", "Sources & Files", "Definitions & Sources", "Transactions"]) assert.equal(wb.getWorksheet(name), undefined);
  const sources = wb.getWorksheet("Sources")!;
  assert.equal(sources.rowCount - 7, 3); assert.equal(sources.columnCount, 2);
  assert.ok(sources.getCell("B8").text.includes("were not supplied"), "Absent provenance remains explicit in the short source list");
  for (const ws of wb.worksheets) { assert.ok(ws.getCell("A5").text.includes(data.version)); assert.ok(ws.autoFilter); assert.equal(ws.views[0].state, "normal"); assert.equal(ws.getImages().length, 1); }
});
test("monthly and annual comparisons remain distinct; zero or absent previous data has no invented growth", () => {
  const view = fullView();
  Object.assign(view.kpis.find(k => k.id === "revenue_growth_pct")!, { value: 11.2, note: "YoY vs 2025-09." });
  Object.assign(view.kpis.find(k => k.id === "net_margin_pct")!, { value: 52.5, previous: 53.5 });
  Object.assign(view.kpis.find(k => k.id === "total_revenue")!, { value: 100, previous: 0 });
  const data = monthlyData(view), html = monthlyReportHtml(data);
  assert.ok(html.includes("September 2025")); assert.ok(html.includes("August 2026"));
  assert.ok(html.includes("decreased by 1 percentage point"));
  // Embedded font bytes may contain these strings; only rendered report content matters.
  const content = html.replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.ok(!content.includes("Infinity")); assert.ok(!content.includes("NaN"));
  assert.equal(presentationChanges(data).find(c => c.measure === "Online sales revenue")!.change, 100);
});
test("future months, missing values, hostile labels and calculation limits render safely", async () => {
  const view = fullView(); view.period = "2027-01";
  view.kpis[0].label = '<img src=x onerror="alert(1)">';
  view.topCategoriesByRevenue[0].category = '<script>bad()</script>';
  view.kpis.find(k => k.id === "unlisted_backlog")!.value = null;
  view.kpis.find(k => k.id === "net_margin_pct")!.note = "Processing labor cost = labor hours \u00d7 $18.00/h loaded rate (assumption, LABOR_RATE_CENTS_PER_HOUR). Partial month: data through 2027-01-24.";
  view.kpis.find(k => k.id === "repeat_buyer_rate")!.note = "1686 transactions without a buyer id are excluded.";
  const html = monthlyReportHtml(view);
  assert.ok(html.includes("January 2027")); assert.ok(html.includes("December 2026"));
  assert.ok(html.includes("2027-01-24")); assert.ok(html.includes("1,686")); assert.ok(html.includes("18.00"));
  assert.ok(html.includes("Not available")); assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<img src=x"));
  assert.ok(!/LABOR_RATE_CENTS_PER_HOUR|categories\[\]|CATEGORY_CUSTOMER/.test(html));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Uint8Array.from(await monthlyXlsx(monthlyData(view))).buffer);
  const scorecard = wb.getWorksheet("Scorecard")!;
  assert.ok(scorecard.getCell("H10").text.includes("2027-01-24"));
  assert.ok(scorecard.getCell("H10").text.includes("18.00"));
  assert.ok(scorecard.getCell("H22").text.includes("1,686"));
  assert.ok(!scorecard.getCell("H10").text.includes("LABOR_RATE_CENTS_PER_HOUR"));
});
test("margin presentation follows the supplied cost basis without recalculating the source value", async () => {
  const view = fullView(), margin = view.kpis.find(k => k.id === "net_margin_pct")!;
  margin.value = 52.4; margin.previous = 53.4;
  margin.note = "Fully costed contribution margin: net revenue minus shipping labels, other marketplace/shipping-account charges and processing labor; overhead not included.";
  const data = monthlyData(view), html = monthlyReportHtml(data);
  assert.ok(html.includes("other marketplace and shipping-account charges"));
  assert.ok(html.includes("52.4%")); assert.ok(html.includes("Overhead excluded; not final profit."));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Uint8Array.from(await monthlyXlsx(data)).buffer);
  assert.equal(wb.getWorksheet("Scorecard")!.getCell("D10").value, 0.524);
  assert.ok(wb.getWorksheet("Scorecard")!.getCell("H10").text.includes("other marketplace and shipping-account charges"));
  assert.deepEqual(data.scorecard, view);
  margin.note = "Net revenue minus net shipping and processing labor.";
  assert.ok(!monthlyReportHtml(view).includes("other marketplace and shipping-account charges"));
});
test("category coverage and rankings retain their independent source amounts", async () => {
  const data = monthlyData(fullView());
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Uint8Array.from(await monthlyXlsx(data)).buffer);
  assert.equal(wb.getWorksheet("Categories")!.getCell("B8").value, 123.45);
  assert.equal(wb.getWorksheet("Category Rankings")!.getCell("D8").value, 500);
  assert.ok(monthlyReportHtml(data).includes("Category revenue has a different scope"));
  assert.equal(wb.getWorksheet("Scorecard")!.getCell("D8").value, data.scorecard.kpis[0].value! / 100);
  const categories = wb.getWorksheet("Categories")!; assert.equal(categories.getTables().length, 2);
  let coverage: ExcelJS.Cell | undefined;
  categories.eachRow(row => { if (row.getCell(1).text === "Difference: total less category revenue") coverage = row.getCell(2); });
  assert.ok(coverage); assert.equal(coverage.value, (data.scorecard.kpis[0].value! - data.scorecard.categories.reduce((sum, c) => sum + c.revenueCents, 0)) / 100);
  const categoryTotal = data.scorecard.categories.reduce((sum, c) => sum + c.revenueCents, 0);
  const differentScope = structuredClone(data.scorecard);
  differentScope.kpis.find(k => k.id === "total_revenue")!.value = categoryTotal - 100;
  assert.ok(monthlyReportHtml(monthlyData(differentScope)).includes("above total online revenue"));
  differentScope.kpis.find(k => k.id === "total_revenue")!.value = categoryTotal;
  assert.ok(monthlyReportHtml(monthlyData(differentScope)).includes("matches the supplied total online revenue"));
  const matched = structuredClone(data.scorecard);
  matched.topCategoriesByRevenue = [matched.categories[0]];
  matched.topCategoriesByMargin = [matched.categories[0]];
  const compact = new ExcelJS.Workbook(); await compact.xlsx.load(Uint8Array.from(await monthlyXlsx(monthlyData(matched))).buffer);
  assert.equal(compact.getWorksheet("Category Rankings"), undefined);
  assert.equal(compact.getWorksheet("Categories")!.getCell("G8").value, 1);
  assert.equal(compact.getWorksheet("Categories")!.getCell("H8").value, 1);
  matched.topCategoriesByRevenue.push(matched.categories[0]);
  const repeated = new ExcelJS.Workbook(); await repeated.xlsx.load(Uint8Array.from(await monthlyXlsx(monthlyData(matched))).buffer);
  assert.equal(repeated.getWorksheet("Category Rankings")!.getCell("B9").value, 2, "Repeated source ranking entries remain separate records");
});
function readers(count = 2301) {
  const view = fullView(); view.kpis[0].value = count * 100;
  const rows: OrdersView["rows"] = Array.from({ length: count }, (_, i) => ({ id: `test-line-${i}`, externalOrderId: `test-order-${i}`, businessDate: "2026-09-10", channel: "ebay", category: null, grossCents: 125, netCents: 100, status: "paid", sourceId: "test-fixture", ingestRunId: "test-file", sourceRow: i + 2 }));
  const file = { id: "test-file", sourceId: "test-fixture", sourceName: "Synthetic test fixture", fileName: "synthetic-test.csv", period: view.period, businessDate: null, periodLabel: null, status: "parsed" as const, rowCount: count, warnings: [], isSynthetic: true, uploadedAt: "2026-10-03T19:00:00Z" };
  return { getScorecard: async () => view, getOrders: async (q: { offset: number; limit: number }) => ({ total: rows.length, rows: rows.slice(q.offset, q.offset + q.limit) }), getIngestRuns: async () => ({ total: 1, rows: [file] }), getSourceStatus: async () => ({ period: view.period, sources: [] }) };
}
test("complete pagination survives Excel reopening with typed dates, no PII and no silent truncation", async () => {
  const data = await createMonthlyProvider(readers())("2026-09"); assert.equal(data.orders!.length, 2301);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Uint8Array.from(await monthlyXlsx(data)).buffer);
  const tx = wb.getWorksheet("Transactions")!; assert.equal(tx.rowCount - 7, 2301);
  assert.ok(tx.getCell("A8").value instanceof Date); assert.equal(tx.getCell("E8").value, 1);
  assert.equal(tx.getCell("L2308").value, 2302); assert.equal(tx.getCell("K8").text, "synthetic-test.csv");
  assert.equal(tx.getCell("K8").hyperlink, "#'Sources'!F8");
  assert.equal(tx.getCell("M8").value, "Simulated"); assert.equal(tx.getCell("C8").value, null);
  assert.ok(!/buyer|email|address/i.test((tx.getRow(7).values as ExcelJS.CellValue[]).join(" ")));
  const sources = wb.getWorksheet("Sources")!;
  assert.equal(sources.rowCount - 7, 1); assert.equal(sources.columnCount, 10);
  assert.equal(sources.getCell("F8").value, "synthetic-test.csv");
  assert.ok(sources.getCell("H8").value instanceof Date); assert.equal(sources.getCell("J8").value, "Simulated");
  assert.ok(sources.autoFilter); assert.equal(sources.getTables().length, 1);
});
test("collection fails explicitly when counts, revenue or source versions change", async () => {
  const incomplete = readers(); incomplete.getOrders = async () => ({ total: 2301, rows: [] });
  await assert.rejects(createMonthlyProvider(incomplete)("2026-09"), /complete, reconciled/);
  const mismatch = readers(); const original = mismatch.getScorecard; mismatch.getScorecard = async () => ({ ...await original(), kpis: [{ ...fullView().kpis[0], value: 1 }] });
  await assert.rejects(createMonthlyProvider(mismatch)("2026-09"));
  const changing = readers(); let calls = 0; const base = changing.getScorecard; changing.getScorecard = async () => { const view = structuredClone(await base()); if (++calls > 1) view.kpis[0].previous = 1; return view; };
  await assert.rejects(createMonthlyProvider(changing)("2026-09"));
  const currency = readers(); const originalOrders = currency.getOrders;
  currency.getOrders = async q => { const data = await originalOrders(q); return { ...data, rows: data.rows.map(row => ({ ...row, currency: "EUR" })) }; };
  await assert.rejects(createMonthlyProvider(currency)("2026-09"));
});
test("the JSON API and server collector share complete monthly data, currency and source metadata without buyer data", async () => {
  const views = readers(1001), offsets: number[] = [];
  const source = { sourceId: "test-fixture", name: "Synthetic test fixture", cadence: "daily", status: "received", lastIngestAt: "2026-10-03T19:00:00Z", rowCount: 1001, openExceptions: 0, missingDates: [] };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://demo.example.test");
    assert.equal(url.searchParams.get("period"), "2026-09"); assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    let body: unknown;
    if (url.pathname.endsWith("/scorecard")) body = await views.getScorecard();
    else if (url.pathname.endsWith("/orders")) {
      const offset = Number(url.searchParams.get("offset")); offsets.push(offset);
      const data = await views.getOrders({ offset, limit: Number(url.searchParams.get("limit")) });
      body = { ...data, rows: data.rows.map(row => ({ ...row, currency: "USD", buyerKey: "excluded-test-buyer", buyerEmail: "excluded@example.test" })) };
    } else if (url.pathname.endsWith("/ingest-runs")) body = await views.getIngestRuns();
    else if (url.pathname.endsWith("/sources")) body = { period: "2026-09", asOf: "2026-10-03", sources: [source] };
    else throw new Error("Unexpected report API request");
    return Response.json(body);
  };
  const data = await createMonthlyApiProvider("https://demo.example.test", fetcher)("2026-09");
  assert.deepEqual(offsets, [0, 1000]); assert.equal(data.orders!.length, 1001);
  assert.equal(data.currency, "USD"); assert.ok(data.currencyConfirmation.includes("all 1,001"));
  assert.equal(data.sourceAsOf, "2026-10-03"); assert.equal(data.sources[0].cadence, "daily");
  assert.ok(!JSON.stringify(data).includes("excluded-test-buyer")); assert.ok(!JSON.stringify(data).includes("excluded@example.test"));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Uint8Array.from(await monthlyXlsx(data)).buffer);
  assert.equal(wb.getWorksheet("Sources")!.getCell("K8").value, "daily");
  assert.equal(wb.getWorksheet("Transactions")!.getCell("K8").hyperlink, "#'Sources'!F9");
  assert.ok(monthlyReportHtml(data).includes("Simulated source records"));
  const failed: typeof fetch = async () => new Response("<html>Unavailable</html>", { status: 503 });
  await assert.rejects(createMonthlyApiProvider("https://demo.example.test", failed)("2026-09"), /complete, reconciled/);
});
test("monthly email is a preview with both attachments, period dashboard and no sending or recipient changes", () => {
  const data = monthlyData(fullView());
  const preview = monthlyEmailPreview({ data, pdf: Buffer.from("%PDF-test"), xlsx: Uint8Array.from([0x50, 0x4b]), pdfName: "Goodwill-Monthly-Report-2026-09.pdf", xlsxName: "Goodwill-Monthly-Data-2026-09.xlsx" }, { NODE_ENV: "development" });
  assert.equal(preview.sent, false); assert.equal(preview.status, "preview_only");
  assert.equal(preview.payload.attachments.length, 2);
  assert.ok(preview.dashboardUrl.endsWith("/scorecard?period=2026-09"));
  assert.ok(!("to" in preview.payload)); assert.ok(preview.html.includes("no email sent"));
});
test("transaction export access uses server authorization without exposing secrets", () => {
  const env = { CRON_SECRET: "test-secret" };
  assert.throws(() => requireMonthlyDetailAccess(new Request("https://example.test"), env), /Authorized server access/);
  assert.doesNotThrow(() => requireMonthlyDetailAccess(new Request("https://example.test", { headers: { Authorization: "Bearer test-secret" } }), env));
});
