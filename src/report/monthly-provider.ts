import { getScorecard, getOrders, getIngestRuns, getSourceStatus } from "../lib/views";
import type { IngestRunsView, IngestRunRow } from "../lib/views/types";
import { parseScorecard, ReportError, validPeriod } from "../export/validation";
import { monthlyData, type MonthlyOrder, type MonthlySource } from "./monthly-data";

interface Readers {
  getScorecard(period: string): Promise<unknown>;
  getOrders(query: { period: string; limit: number; offset: number }): Promise<{ rows: MonthlyOrder[]; total: number }>;
  getIngestRuns(query: { period: string; limit: number; offset: number }): Promise<IngestRunsView>;
  getSourceStatus(period: string): Promise<{ period: string; sources: MonthlySource[]; asOf?: string }>;
}
// Keep stable report metadata only. Signed archive links expire between reads,
// and buyer identifiers returned by newer views are outside this export.
function fileReference(f: IngestRunRow): IngestRunRow {
  return { id: f.id, sourceId: f.sourceId, sourceName: f.sourceName, fileName: f.fileName, period: f.period,
    businessDate: f.businessDate, periodLabel: f.periodLabel, status: f.status, rowCount: f.rowCount,
    warnings: f.warnings, isSynthetic: f.isSynthetic, uploadedAt: f.uploadedAt };
}
function orderReference(r: MonthlyOrder): MonthlyOrder {
  return { id: r.id, channel: r.channel, sourceId: r.sourceId, externalOrderId: r.externalOrderId,
    businessDate: r.businessDate, category: r.category, grossCents: r.grossCents, netCents: r.netCents,
    status: r.status, ingestRunId: r.ingestRunId, sourceRow: r.sourceRow, ...(r.currency === undefined ? {} : { currency: r.currency }) };
}
async function allRows<T extends { id: string }>(read: (offset: number) => Promise<{ rows: T[]; total: number }>): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | undefined;
  do {
    const page = await read(rows.length);
    if (!Number.isSafeInteger(page.total) || page.total < 0 || (expected !== undefined && page.total !== expected)) throw new Error("Record count changed during collection");
    expected = page.total;
    if (rows.length < expected && !page.rows.length) throw new Error("Incomplete monthly record collection");
    rows.push(...page.rows);
    if (rows.length > expected) throw new Error("Invalid monthly record count");
  } while (rows.length < expected!);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Duplicate monthly records");
  return rows;
}
/** Denis-owned composition of existing views; no shared view or cost formula is duplicated. */
export function createMonthlyProvider(readers: Readers) {
  return async (period: string) => {
    if (!validPeriod(period)) throw new ReportError(400, "invalid_period", "Use YYYY-MM.");
    try {
      const before = parseScorecard(await readers.getScorecard(period), period);
      const files = (await allRows(offset => readers.getIngestRuns({ period, limit: 500, offset }))).map(fileReference);
      const orders = (await allRows(offset => readers.getOrders({ period, limit: 1000, offset }))).map(orderReference);
      const sources = await readers.getSourceStatus(period);
      const afterFiles = (await allRows(offset => readers.getIngestRuns({ period, limit: 500, offset }))).map(fileReference);
      const afterSources = await readers.getSourceStatus(period);
      const after = parseScorecard(await readers.getScorecard(period), period);
      if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(files) !== JSON.stringify(afterFiles)) throw new Error("Source changed during collection");
      if (sources.period !== period || JSON.stringify(sources) !== JSON.stringify(afterSources)) throw new Error("Source status changed during collection");
      const revenue = before.kpis.find(kpi => kpi.id === "total_revenue")?.value;
      if (orders.some(row => !Number.isSafeInteger(row.netCents))) throw new Error("Invalid order amount");
      if (revenue !== null && revenue !== undefined && orders.reduce((sum, row) => sum + BigInt(row.netCents), 0n) !== BigInt(revenue)) throw new Error("Order lines and monthly revenue do not reconcile");
      const confirmedCurrency = orders.length > 0 && orders.every(order => order.currency === "USD");
      if (orders.some(order => order.currency !== undefined && order.currency !== "USD")) throw new Error("Monthly currency is inconsistent with the USD scorecard");
      return monthlyData(before, { orders, files, sources: sources.sources, ...(sources.asOf ? { sourceAsOf: sources.asOf } : {}), currency: "USD",
        currencyConfirmation: confirmedCurrency ? `USD confirmed in all ${orders.length.toLocaleString("en-US")} supplied order lines. Source amounts are stored in cents.` : "USD confirmed by Joao Carvalho (project data owner). Per-record currency is incomplete in the supplied order view.",
        collection: "shared-views", generatedAt: new Date().toISOString() });
    } catch (error) {
      if (error instanceof ReportError) throw error;
      throw new ReportError(503, "monthly_snapshot_unavailable", "A complete, reconciled monthly collection could not be prepared. Retry when ingestion is stable.");
    }
  };
}
export const monthlyProvider = { load: createMonthlyProvider({ getScorecard, getOrders, getIngestRuns, getSourceStatus }) };
export const loadMonthlyData = (period: string) => monthlyProvider.load(period);
