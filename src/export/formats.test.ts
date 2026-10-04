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
import { monthlyProvider } from "../report/monthly-provider";
import { monthlyData } from "../report/monthly-data";
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
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Scorecard", "Categories", "Category Rankings", "Marketplaces", "Sources"]);
  assert.equal(workbook.getWorksheet("Scorecard")!.getCell("D10").value, 0.0015);
  assert.ok(workbook.getWorksheet("Scorecard")!.getCell("D10").numFmt?.includes("%"));
  assert.equal(workbook.getWorksheet("Scorecard")!.getCell("G15").value, "Data unavailable");
  assert.equal(workbook.getWorksheet("Category Rankings")!.getCell("C9").value, "'=Not a formula");
  assert.equal(workbook.getWorksheet("Category Rankings")!.getCell("C9").type, ExcelJS.ValueType.String);
  assert.equal(workbook.getWorksheet("Category Rankings")!.getCell("D10").value, -1.05);
});

test("fractional metrics beyond Excel precision are preserved as text", async () => {
  const value = 1.2345678901234567;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await scorecardXlsx({ ...sampleScorecard,
    kpis: [{ ...sampleScorecard.kpis[1], value, previous: value, target: value }] })).buffer);
  for (const column of ["D", "E", "F"]) assert.equal(workbook.getWorksheet("Scorecard")!.getCell(`${column}8`).value, String(value) + "%");
});

test("monthly HTML identifies simulation, unavailable data and safely renders text", () => {
  const html = monthlyReportHtml({ ...sampleScorecard, kpis: [{ ...sampleScorecard.kpis[0],
    label: '<img src=x onerror="alert(1)">', note: "<script>unsafe</script>" }, ...sampleScorecard.kpis.slice(1)] });
  assert.ok(html.includes("Simulated inputs"));
  assert.ok(html.includes("Unavailable = missing"));
  assert.ok(html.includes("1,234.56"));
  assert.ok(html.includes("Currency is unconfirmed"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<script>"));
  assert.equal((html.match(/data-kpi-group="coo15"/g) ?? []).length, 15);
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

test("CSV routes retain metadata and detailed reports require server access by default", async t => {
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
  assert.ok([401, 503].includes(xlsx.status)); // Detailed records never leave an unprotected route.

});

test("route upstream errors return explicit failures instead of a downloaded error page", async t => {
  t.mock.method(reportProvider, "loadScorecard", async () => { throw new ReportError(503, "view_unavailable", "Shared data unavailable."); });
  const response = await scorecardGET(new Request("http://localhost:3000/api/export/scorecard?period=2026-09"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "view_unavailable");
  const invalid = await scorecardGET(new Request("http://localhost:3000/api/export/scorecard?period=2026-13"));
  assert.equal(invalid.status, 400);
  const format = await pulseGET(new Request("http://localhost:3000/api/export/pulse?date=2026-10-02&format=zip"));
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
  const detail = workbook.getWorksheet("Categories")!;
  assert.equal(detail.getCell("B8").value, 123.45);
  assert.equal(detail.getCell("C8").value, -1.05);
  assert.equal(detail.getCell("E8").value, 0.5);
  assert.equal(detail.getCell("F9").value, null);
  const metrics = workbook.getWorksheet("Marketplaces")!;
  assert.equal(metrics.getCell("C8").value, -15);
  assert.equal(metrics.getCell("D8").value, 0.024);
  assert.equal(metrics.getCell("B9").value, null);
  assert.equal(workbook.getWorksheet("Scorecard")!.rowCount - 7, view.kpis.length);
  assert.equal(workbook.getWorksheet("Scorecard")!.getCell("A23").value, "Supporting");
  assert.equal(workbook.getWorksheet("Scorecard")!.getCell("D23").value, 0.255);
  const html = monthlyReportHtml(view);
  assert.ok(!html.includes('data-kpi-group="extended"'));
  assert.equal((html.match(/data-kpi-group="coo15"/g) ?? []).length, 15);
  assert.ok(html.includes("not proof of real data"));
});

test("invalid group and invalid new monetary details fail explicitly", () => {
  assert.throws(() => parseScorecard({ ...sampleScorecard,
    kpis: [{ ...sampleScorecard.kpis[0], group: "unknown" }] }, "2026-09"));
  assert.throws(() => parseScorecard({ ...sampleScorecard,
    categories: [{ ...sampleScorecard.categories[0], aspCents: 1.2 }] }, "2026-09"));
});
