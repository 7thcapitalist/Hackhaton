import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import ExcelJS from "exceljs";
import { pulseCsv } from "./pulse";
import { scorecardCsv, scorecardTables } from "./scorecard";
import { pulseXlsx, scorecardXlsx } from "./xlsx";
import { reportProvider } from "./provider";
import { parseScorecard, ReportError } from "./validation";
import { monthlyReportHtml } from "../report/monthly";
import { samplePulse, sampleScorecard } from "./testing/fixtures";
import { GET as pulseGET } from "../app/api/export/pulse/route";
import { GET as scorecardGET } from "../app/api/export/scorecard/route";
import { GET as monthlyGET } from "../app/api/export/monthly/route";

test("daily XLSX reopens with typed values, refunds, nulls and source totals", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await pulseXlsx(samplePulse)).buffer);
  const sheet = workbook.getWorksheet("Daily Pulse")!;
  assert.equal(sheet.rowCount, 5);
  assert.equal(sheet.getCell("G2").value, 123456);
  assert.equal(sheet.getCell("H2").value, 1234.56);
  assert.equal(sheet.getCell("H3").value, -1.05);
  assert.equal(sheet.getCell("I3").value, 0);
  assert.equal(sheet.getCell("G4").value, null);
  assert.equal(sheet.getCell("H4").value, "missing");
  assert.equal(sheet.getCell("G5").value, 90000); // not recomputed from channel rows
  assert.equal(sheet.getCell("K2").value, true);
  assert.equal(sheet.getCell("E2").value, 'eBay, "Livros"\nMichiana');
  assert.equal(sheet.views[0].state, "frozen");
});

test("CSV and XLSX encode equivalent daily rows", async () => {
  const csvWorkbook = new ExcelJS.Workbook();
  const csv = await csvWorkbook.csv.read(Readable.from([pulseCsv(samplePulse)]), { map: value => value });
  const xlsx = new ExcelJS.Workbook();
  await xlsx.xlsx.load(Uint8Array.from(await pulseXlsx(samplePulse)).buffer);
  const sheet = xlsx.worksheets[0];
  assert.equal(csv.rowCount, sheet.rowCount);
  for (let r = 1; r <= sheet.rowCount; r++) {
    for (let c = 1; c <= sheet.columnCount; c++) {
      const value = sheet.getCell(r, c).value;
      const csvValue = csv.getCell(r, c).value;
      if (typeof value === "number") assert.equal(Number(csvValue), value);
      else assert.equal(String(csvValue ?? ""), String(value ?? ""));
    }
  }
});

test("large monetary values survive Excel precision limits as text", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await pulseXlsx({ ...samplePulse,
    rows: [{ ...samplePulse.rows[0], revenueCents: Number.MAX_SAFE_INTEGER }] })).buffer);
  assert.equal(workbook.worksheets[0].getCell("G2").value, "9007199254740991");
  assert.equal(workbook.worksheets[0].getCell("H2").value, "90071992547409.91");
});

test("scorecard preserves units, percentage scale, previous, target and category amounts", async () => {
  const parsed = parseScorecard(sampleScorecard, "2026-09");
  assert.equal(parsed.kpis.length, 15);
  const tables = scorecardTables(parsed);
  assert.equal(tables[0].rows[0][5], 123456);
  assert.deepEqual(tables[0].rows[0][6], { numeric: "1234.56" });
  assert.equal(tables[0].rows[1][6], 25.5);
  assert.equal(tables[0].rows[2][6], 0.15);
  assert.deepEqual(tables[0].rows[4][6], { numeric: "12.345" });
  assert.equal(tables[0].rows[7][5], null);
  assert.equal(tables[0].rows[7][6], "awaiting data");
  assert.equal(tables[0].rows[0][15], "currency units");
  assert.equal(tables[0].rows[4][15], "currency units per hour");
  assert.ok(scorecardCsv(parsed).includes('"category_margin"'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await scorecardXlsx(parsed)).buffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Scorecard", "Categories Revenue", "Categories Margin", "Category Detail", "Marketplace Metrics"]);
  assert.equal(workbook.worksheets[0].getCell("G4").value, 0.15);
  assert.ok(!workbook.worksheets[0].getCell("G4").numFmt?.includes("%"));
  assert.equal(workbook.worksheets[0].getCell("L9").value, "awaiting_data");
  assert.equal(workbook.worksheets[1].getCell("B3").value, "'=Not a formula");
  assert.equal(workbook.worksheets[1].getCell("B3").type, ExcelJS.ValueType.String);
  assert.equal(workbook.worksheets[2].getCell("D2").value, -1.05);
});

test("fractional metrics beyond Excel precision are preserved as text", async () => {
  const value = 1.2345678901234567;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await scorecardXlsx({ ...sampleScorecard,
    kpis: [{ ...sampleScorecard.kpis[1], value, previous: value, target: value }] })).buffer);
  for (const column of ["F", "G", "H", "I", "J", "K"]) {
    assert.equal(workbook.worksheets[0].getCell(`${column}2`).value, String(value));
  }
});

test("monthly HTML identifies simulation, unavailable data and safely renders text", () => {
  const html = monthlyReportHtml({ ...sampleScorecard, kpis: [{ ...sampleScorecard.kpis[0],
    label: '<img src=x onerror="alert(1)">', note: "<script>unsafe</script>" }, ...sampleScorecard.kpis.slice(1)] });
  assert.ok(html.includes("Contains simulated indicators"));
  assert.ok(html.includes("Some data is unavailable"));
  assert.ok(html.includes("1234.56"));
  assert.ok(html.includes('<div class="unit">currency units</div>'));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<script>"));
  assert.equal((html.match(/class="card"/g) ?? []).length, 15);
});

test("monetary KPI values, previous and target require integer safe cents", () => {
  for (const field of ["value", "previous", "target"] as const) {
    for (const value of [1.2, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => parseScorecard({ ...sampleScorecard,
        kpis: [{ ...sampleScorecard.kpis[0], [field]: value }] }, "2026-09"));
    }
  }
  assert.equal(parseScorecard(sampleScorecard, "2026-09").kpis[4].value, 1234.5);
});

test("a pulse without channels is marked partial in the file and download headers", async t => {
  const empty = { ...samplePulse, rows: [], missingChannels: [],
    totals: { revenueCents: 0, customers: 0, orders: 0 } };
  assert.ok(pulseCsv(empty).includes('"partial"'));
  t.mock.method(reportProvider, "loadPulse", async () => empty);
  const response = await pulseGET(new Request("http://localhost:3000/api/export/pulse?date=2026-10-02"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Report-Status"), "partial");
});

test("routes deliver CSV, XLSX and HTML with correct filters and metadata", async t => {
  t.mock.method(reportProvider, "loadPulse", async (date: string) => {
    assert.equal(date, "2026-10-02"); return samplePulse;
  });
  t.mock.method(reportProvider, "loadScorecard", async (period: string) => {
    assert.equal(period, "2026-09"); return sampleScorecard;
  });
  const csv = await pulseGET(new Request("https://demo.example/api/export/pulse?date=2026-10-02"));
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get("X-Report-Synthetic"), "true");
  assert.equal(csv.headers.get("X-Report-Status"), "partial");
  assert.equal(csv.headers.get("Cache-Control"), "no-store");
  assert.ok(csv.headers.get("Content-Disposition")?.includes("daily-pulse-2026-10-02.csv"));
  assert.ok((await csv.text()).includes("1234.56"));
  const xlsx = await scorecardGET(new Request("https://demo.example/api/export/scorecard?period=2026-09&format=xlsx"));
  assert.equal(xlsx.status, 200);
  assert.ok(xlsx.headers.get("Content-Type")?.includes("spreadsheetml"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await xlsx.arrayBuffer());
  assert.equal(workbook.worksheets.length, 5);
  const html = await monthlyGET(new Request("https://demo.example/api/export/monthly?period=2026-09"));
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes("Monthly COO scorecard"));
});

test("route upstream errors return explicit failures instead of a downloaded error page", async t => {
  t.mock.method(reportProvider, "loadScorecard", async () => { throw new ReportError(503, "view_unavailable", "Shared data unavailable."); });
  const response = await scorecardGET(new Request("http://localhost:3000/api/export/scorecard?period=2026-09"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "view_unavailable");
  const invalid = await scorecardGET(new Request("http://localhost:3000/api/export/scorecard?period=2026-13"));
  assert.equal(invalid.status, 400);
  const format = await pulseGET(new Request("http://localhost:3000/api/export/pulse?date=2026-10-02&format=pdf"));
  assert.equal(format.status, 400);
});

test("extended groups, category detail and marketplace metrics survive all formats", async () => {
  const view = parseScorecard({ ...sampleScorecard, kpis: [...sampleScorecard.kpis,
    { ...sampleScorecard.kpis[1], id: "extra_growth", label: "Extra growth", group: "extended" }] }, "2026-09");
  assert.equal(view.kpis.length, 16);
  assert.equal(view.kpis[15].group, "extended");
  assert.deepEqual(view.categories, sampleScorecard.categories);
  assert.deepEqual(view.marketplaceMetrics, sampleScorecard.marketplaceMetrics);
  const csv = scorecardCsv(view);
  assert.ok(csv.includes('"category_detail"'));
  assert.ok(csv.includes('"marketplace_metrics"'));
  assert.ok(csv.includes('"kpi_group"'));
  assert.ok(csv.includes('"dataset_provenance"'));
  assert.ok(csv.includes('"extended"'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await scorecardXlsx(view)).buffer);
  const detail = workbook.getWorksheet("Category Detail")!;
  assert.equal(detail.getCell("C2").value, 12345);
  assert.equal(detail.getCell("D2").value, 123.45);
  assert.equal(detail.getCell("F2").value, -1.05);
  assert.equal(detail.getCell("H2").value, 50);
  assert.equal(detail.getCell("I3").value, null);
  assert.equal(detail.getCell("J3").value, "awaiting data");
  const metrics = workbook.getWorksheet("Marketplace Metrics")!;
  assert.equal(metrics.getCell("D2").value, -15);
  assert.equal(metrics.getCell("E2").value, 2.4);
  assert.equal(metrics.getCell("C3").value, null);
  const html = monthlyReportHtml(view);
  assert.ok(html.includes("Extended indicators"));
  assert.ok(html.includes("Extra growth"));
  assert.ok(html.includes("All category performance"));
  assert.ok(html.includes("Marketplace metrics"));
  assert.ok(html.includes("does not certify real data"));
  assert.ok(!html.includes("scale unconfirmed"));
});

test("invalid group and invalid new monetary details fail explicitly", () => {
  assert.throws(() => parseScorecard({ ...sampleScorecard,
    kpis: [{ ...sampleScorecard.kpis[0], group: "unknown" }] }, "2026-09"));
  assert.throws(() => parseScorecard({ ...sampleScorecard,
    categories: [{ ...sampleScorecard.categories[0], aspCents: 1.2 }] }, "2026-09"));
});
