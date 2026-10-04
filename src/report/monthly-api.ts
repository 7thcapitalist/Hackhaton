import { getReportOrigin } from "../emails/pulse";
import { validBusinessDate } from "../export/validation";
import type { IngestRunRow } from "../lib/views/types";
import { createMonthlyProvider } from "./monthly-provider";
import type { MonthlyOrder, MonthlySource } from "./monthly-data";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid report API object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("Invalid report API text");
  return value;
}
function optionalText(value: unknown): string | null { return value === null ? null : text(value); }
function integer(value: unknown, nonnegative = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (nonnegative && value < 0)) throw new Error("Invalid report API number");
  return value;
}
function date(value: unknown): string { const result = text(value); if (!validBusinessDate(result)) throw new Error("Invalid report API date"); return result; }
function timestamp(value: unknown): string { const result = text(value); if (!Number.isFinite(Date.parse(result))) throw new Error("Invalid report API timestamp"); return result; }
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error("Invalid report API status");
  return value as T;
}
function page<T>(value: unknown, limit: number, parse: (row: Record<string, unknown>) => T): { rows: T[]; total: number } {
  const data = object(value);
  if (!Array.isArray(data.rows) || data.rows.length > limit) throw new Error("Invalid report API page");
  return { total: integer(data.total, true), rows: data.rows.map(row => parse(object(row))) };
}
export function apiOrder(row: Record<string, unknown>): MonthlyOrder {
  // Explicit fields exclude buyerKey and any other customer data from the API.
  return { id: text(row.id), channel: choice(row.channel, ["shopgoodwill", "amazon", "ebay", "goodwill_books", "other"]),
    sourceId: text(row.sourceId), externalOrderId: text(row.externalOrderId), businessDate: date(row.businessDate),
    category: optionalText(row.category), grossCents: integer(row.grossCents), netCents: integer(row.netCents),
    status: text(row.status), ingestRunId: text(row.ingestRunId), sourceRow: integer(row.sourceRow, true),
    ...(row.currency === undefined ? {} : { currency: text(row.currency) }) };
}
export function apiFile(row: Record<string, unknown>): IngestRunRow {
  if (typeof row.isSynthetic !== "boolean" || !Array.isArray(row.warnings) || row.warnings.length > 20) throw new Error("Invalid file origin or warnings");
  return { id: text(row.id), sourceId: text(row.sourceId), sourceName: text(row.sourceName), fileName: text(row.fileName),
    period: optionalText(row.period), businessDate: row.businessDate === null ? null : date(row.businessDate),
    periodLabel: optionalText(row.periodLabel), status: choice(row.status, ["parsed", "parsed_with_warnings", "failed"]),
    rowCount: integer(row.rowCount, true), warnings: row.warnings.map(text), isSynthetic: row.isSynthetic, uploadedAt: timestamp(row.uploadedAt) };
}
export function apiSource(row: Record<string, unknown>): MonthlySource {
  const missing = row.missingDates;
  if (missing !== undefined && (!Array.isArray(missing) || missing.length > 31)) throw new Error("Invalid missing source days");
  return { sourceId: text(row.sourceId), name: text(row.name), status: choice(row.status, ["received", "warnings", "missing", "not_due"]),
    lastIngestAt: row.lastIngestAt === null ? null : timestamp(row.lastIngestAt), rowCount: integer(row.rowCount, true), openExceptions: integer(row.openExceptions, true),
    ...(row.cadence === undefined ? {} : { cadence: choice(row.cadence, ["daily", "weekly", "monthly"] as const) }),
    ...(missing === undefined ? {} : { missingDates: (missing as unknown[]).map(date) }) };
}

/** Read Joao's existing JSON views, then use the same collector as server exports.
 * No connector pulls, ingestion, resets, recalculations or email sends occur here.
 */
export function createViewApi(origin: string, fetcher: typeof fetch = fetch) {
  const base = getReportOrigin({ REPORTS_VIEW_ORIGIN: origin, NODE_ENV: "development" });
  return async function read(path: string, query: Record<string, string | number>): Promise<unknown> {
    const url = new URL(path.startsWith("/api/close/") ? path : `/api/views/${path}`, base);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
    const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("Report API is unavailable");
    return response.json();
  };
}
export function createMonthlyApiProvider(origin: string, fetcher: typeof fetch = fetch) {
  const read = createViewApi(origin, fetcher);
  return createMonthlyProvider({
    getScorecard: period => read("scorecard", { period }),
    getOrders: async query => page(await read("orders", query), query.limit, apiOrder),
    getIngestRuns: async query => page(await read("ingest-runs", query), query.limit, apiFile),
    getSourceStatus: async period => {
      const data = object(await read("sources", { period }));
      if (!Array.isArray(data.sources) || data.sources.length > 1000) throw new Error("Invalid report API sources");
      return { period: text(data.period), sources: data.sources.map(row => apiSource(object(row))), ...(data.asOf === undefined ? {} : { asOf: date(data.asOf) }) };
    },
  });
}
