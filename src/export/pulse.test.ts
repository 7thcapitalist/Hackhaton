import assert from "node:assert/strict";
import test from "node:test";
import { centsText, spreadsheetText, tableToCsv } from "./csv";
import { pulseCsv, pulseTable } from "./pulse";
import { loadPulse, reportOrigin } from "./provider";
import { parsePulse, ReportError, validBusinessDate, validPeriod } from "./validation";
import { GET } from "../app/api/export/pulse/route";
import type { PulseExportData } from "./types";

export const samplePulse: PulseExportData = {
  businessDate: "2026-10-02", timezone: "America/Indiana/Indianapolis", isSynthetic: true,
  rows: [
    { channelId: "ebay", label: 'eBay, "Livros"\nMichiana', status: "ok", revenueCents: 123456, customers: 12, orders: 15 },
    { channelId: "amazon", label: "Amazon", status: "ok", revenueCents: -105, customers: 0, orders: 0 },
    { channelId: "other", label: "Other", status: "missing", revenueCents: null, customers: null, orders: null },
  ],
  totals: { revenueCents: 90000, customers: 11, orders: 14 }, // authoritative view totals; do not recompute
  missingChannels: ["other"],
};

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

test("provider requests fixed trusted origin and forwards date without any secrets", async () => {
  const view = await loadPulse("2026-10-02", { env: { REPORTS_VIEW_ORIGIN: "https://demo.example" },
    fetch: (async (input, init) => {
      assert.equal(input, "https://demo.example/api/views/pulse?date=2026-10-02");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.headers, undefined);
      return Response.json(samplePulse);
    }) as typeof fetch });
  assert.equal(view.totals.revenueCents, 90000);
  assert.throws(() => reportOrigin({ NODE_ENV: "production" }));
  assert.throws(() => reportOrigin({ REPORTS_VIEW_ORIGIN: "https://user:password@example.com" }));
});

test("missing upstream returns an explicit unavailable error", async () => {
  await assert.rejects(loadPulse("2026-10-02", { env: { REPORTS_VIEW_ORIGIN: "https://demo.example" },
    fetch: (async () => new Response("not ready", { status: 404 })) as typeof fetch }),
    (error: unknown) => error instanceof ReportError && error.status === 503);
});

test("download route rejects invalid input before any upstream call", async () => {
  const response = await GET(new Request("https://demo.example/api/export/pulse?date=2026-02-30"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_date");
});
