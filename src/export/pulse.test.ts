import assert from "node:assert/strict";
import test from "node:test";
import { centsText, spreadsheetText, tableToCsv } from "./csv";
import { pulseCsv, pulseTable } from "./pulse";
import { createReportProvider, reportProvider } from "./provider";
import { parsePulse, ReportError, validBusinessDate, validPeriod } from "./validation";
import { GET } from "../app/api/export/pulse/route";
import { samplePulse } from "./testing/fixtures";

test("pulse CSV preserves authoritative values, missing data and metadata", () => {
  const csv = pulseCsv(samplePulse);
  assert.ok(csv.startsWith('\uFEFF"record_type"'));
  assert.ok(csv.includes('"123456","1234.56","12","15","true","partial"'));
  assert.ok(csv.includes('"-105","-1.05","0","0"'));
  assert.ok(csv.includes('"missing","","missing","",""'));
  assert.ok(csv.includes('"90000","900.00","11","14"'));
  assert.ok(csv.includes('"eBay, ""Livros""\nMichiana"'));
  assert.equal(pulseTable(samplePulse).rows.length, 4);
  assert.equal(parsePulse(samplePulse, "2026-10-02").isSynthetic, true);
});

test("money preserves signs, zero and the largest safe integer", () => {
  assert.equal(centsText(0), "0.00");
  assert.equal(centsText(-1), "-0.01");
  assert.equal(centsText(Number.MAX_SAFE_INTEGER), "90071992547409.91");
  assert.throws(() => centsText(1.5));
});

test("a missing metric marks the report partial even when the channel has a file", () => {
  const table = pulseTable({ ...samplePulse, missingChannels: [],
    rows: [{ ...samplePulse.rows[0], customers: null }] });
  assert.equal(table.rows[0][11], "partial");
  assert.equal(table.rows[1][5], "partial");
});

test("CSV text is escaped and spreadsheet formula prefixes are inert", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-cmd", "@SUM(A1)", "  =1", "\tvalue", "\rvalue", "\nvalue"]) {
    assert.equal(spreadsheetText(value), "'" + value);
  }
  assert.equal(tableToCsv({ name: "test", columns: ["x", "y"], rows: [["=1+1", -105]] }),
    '\uFEFF"x","y"\r\n"\'=1+1","-105"\r\n');
});

test("invalid or mismatched upstream data is rejected, never replaced", () => {
  for (const value of [null, {}, { ...samplePulse, businessDate: "2026-10-01" },
    { ...samplePulse, totals: { ...samplePulse.totals, customers: null } },
    { ...samplePulse, rows: [{ ...samplePulse.rows[0], revenueCents: 1.2 }] },
    { ...samplePulse, rows: [{ ...samplePulse.rows[2], revenueCents: 0 }] }]) {
    assert.throws(() => parsePulse(value, "2026-10-02"), (error: unknown) =>
      error instanceof ReportError && error.status === 502);
  }
});

test("calendar validation rejects impossible dates and invalid periods", () => {
  assert.equal(validBusinessDate("2024-02-29"), true);
  assert.equal(validBusinessDate("2026-02-29"), false);
  assert.equal(validBusinessDate("2026-10-32"), false);
  assert.equal(validPeriod("2026-13"), false);
  assert.equal(validPeriod("2026-09"), true);
});

test("provider calls the shared view with the selected date and preserves totals", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No HTTP self-fetch permitted"); });
  const provider = createReportProvider({
    getPulse: async date => { assert.equal(date, "2026-10-02"); return samplePulse; },
    getScorecard: async () => { throw new Error("unexpected"); },
  });
  assert.equal((await provider.loadPulse("2026-10-02")).totals.revenueCents, 90000);
});

test("shared view failures are unavailable and do not expose database errors", async () => {
  const provider = createReportProvider({
    getPulse: async () => { throw new Error("private-database-key"); },
    getScorecard: async () => { throw new Error("unexpected"); },
  });
  await assert.rejects(provider.loadPulse("2026-10-02"), (error: unknown) =>
    error instanceof ReportError && error.status === 503 && !error.message.includes("private-database-key"));
});

test("provider rejects mismatched shared-view dates", async () => {
  const provider = createReportProvider({ getPulse: async () => samplePulse,
    getScorecard: async () => { throw new Error("unexpected"); } });
  await assert.rejects(provider.loadPulse("2026-10-01"), (error: unknown) =>
    error instanceof ReportError && error.status === 502);
});

test("download route rejects invalid input before any upstream call", async t => {
  t.mock.method(reportProvider, "loadPulse", async () => { throw new Error("unexpected view call"); });
  const response = await GET(new Request("https://demo.example/api/export/pulse?date=2026-02-30"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_date");
});
