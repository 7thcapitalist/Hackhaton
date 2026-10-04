import { apiFile, apiOrder, apiSource, createViewApi } from "./monthly-api";
import { parsePulse, parseScorecard, validBusinessDate, validPeriod } from "../export/validation";
import { addDays, previousPeriod, businessDateOf } from "../lib/views/dates";
import type { ExceptionRow, IngestRunRow, PulseSeriesView, ScorecardView, PulseView } from "../lib/views/types";
import type { MonthlyOrder, MonthlySource } from "./monthly-data";
import { authorizeReport, digest, type ReportPlan } from "./profiles";

export interface CloseEvidence {
  status: string; approvedAt: string | null; closeId: string | null;
  journalLines: number; placeholderLines: number; openExceptions: number;
  documents: { reference: string; source: string; date: string; debitCents: number; creditCents: number; balanceCents: number; balanced: boolean }[];
  invoice: { reference: string | null; date: string | null; totalCents: number; lineCount: number } | null;
}
export interface SalesDay {
  date: string; channel: string; label: string; revenueCents: number | null; customers: number | null;
  coverage: "reported" | "missing" | "records_only";
}
export interface ProfileSnapshot {
  plan: ReportPlan; generatedAt: string; version: string; currency: "USD";
  days: SalesDay[]; dailyTotals: { date: string; revenueCents: number | null }[]; pulses: PulseView[]; scorecard: ScorecardView | null;
  orders: MonthlyOrder[]; sources: MonthlySource[]; files: IngestRunRow[]; exceptions: ExceptionRow[];
  close: CloseEvidence | null; sourceAsOf: string | null; collectionNotes: string[];
  syntheticEvidence: string;
}
export type ViewReader = (path: string, query: Record<string, string | number>) => Promise<unknown>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid profile report source object");
  return value as Record<string, unknown>;
}
function str(value: unknown): string { if (typeof value !== "string" || value.length > 4096) throw new Error("Invalid source text"); return value; }
function optional(value: unknown): string | null { return value === null ? null : str(value); }
function amount(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Invalid source integer"); return value; }
function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error("Invalid source list"); return value; }
const nullableAmount = (value: unknown) => value === null ? null : amount(value);
async function pages<T extends { id: string }>(read: ViewReader, endpoint: string, query: Record<string, string | number>, limit: number, parse: (row: Record<string, unknown>) => T): Promise<T[]> {
  const result: T[] = []; let total: number | undefined;
  do {
    const data = object(await read(endpoint, { ...query, limit, offset: result.length }));
    const count = amount(data.total), rows = list(data.rows);
    if (count < 0 || (total !== undefined && count !== total) || rows.length > limit || (result.length < count && !rows.length)) throw new Error("Incomplete or changing report pagination");
    total = count; result.push(...rows.map(row => parse(object(row))));
    if (result.length > total) throw new Error("Unexpected report records");
  } while (result.length < total!);
  if (new Set(result.map(row => row.id)).size !== result.length) throw new Error("Duplicate report record IDs");
  return result;
}
function parseException(row: Record<string, unknown>): ExceptionRow {
  if (!["open", "resolved", "waived"].includes(String(row.status))) throw new Error("Invalid exception status");
  return { id: str(row.id), kind: str(row.kind) as ExceptionRow["kind"], sourceId: optional(row.sourceId), sourceName: optional(row.sourceName), message: str(row.message), owner: optional(row.owner), status: row.status as ExceptionRow["status"], expectedCents: nullableAmount(row.expectedCents), actualCents: nullableAmount(row.actualCents), ingestRunId: optional(row.ingestRunId), createdAt: str(row.createdAt), resolvedAt: optional(row.resolvedAt) };
}
function parseClose(value: unknown, period: string): CloseEvidence {
  const data = object(value), summary = object(data.summary);
  if (data.period !== period || !["collecting", "generated", "reconciled", "approved", "exported"].includes(String(data.status))) throw new Error("Invalid close state");
  const invoice = data.invoice === null ? null : object(data.invoice);
  return { status: str(data.status), approvedAt: optional(data.approvedAt), closeId: optional(data.closeId),
    journalLines: amount(summary.journalLines), placeholderLines: amount(summary.placeholderLines), openExceptions: amount(summary.openExceptions),
    documents: list(data.documents).map(value => { const d = object(value); if (typeof d.balanced !== "boolean") throw new Error("Invalid reconciliation flag"); return { reference: str(d.documentNo), source: str(d.sourceName), date: str(d.postingDate), debitCents: amount(d.debitCents), creditCents: amount(d.creditCents), balanceCents: amount(d.balanceCents), balanced: d.balanced }; }),
    invoice: invoice ? { reference: optional(invoice.externalDocumentNo), date: optional(invoice.invoiceDate), totalCents: amount(invoice.totalCents), lineCount: list(invoice.lines).length } : null };
}
function monthEnd(period: string): string {
  const date = new Date(`${period}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); return addDays(date.toISOString().slice(0, 10), -1);
}
function parseSeries(value: unknown, from: string, to: string): SalesDay[] {
  const v = object(value);
  if (v.from !== from || v.to !== to) throw new Error("Series dates do not match the authorized request");
  const dates = list(v.dates).map(str), expected: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) expected.push(d);
  if (JSON.stringify(dates) !== JSON.stringify(expected)) throw new Error("Series has missing or duplicate dates");
  return list(v.series).flatMap(value => {
    const s = object(value), revenue = list(s.revenueCents), customers = list(s.customers);
    if (revenue.length !== dates.length || customers.length !== dates.length) throw new Error("Incomplete source series");
    return dates.map((date, i): SalesDay => ({ date, channel: str(s.channelId), label: str(s.label), revenueCents: nullableAmount(revenue[i]), customers: nullableAmount(customers[i]), coverage: revenue[i] === null ? "missing" : "reported" }));
  });
}
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Scope is checked before any read. This adapter is demo-only, never an employee auth system. */
export async function collectProfileSnapshot(plan: ReportPlan, read: ViewReader, generatedAt = new Date().toISOString()): Promise<ProfileSnapshot> {
  const approved = authorizeReport(plan.profile, plan.access, plan.frequency, plan.period);
  if (approved.signature !== plan.signature) throw new Error("The authorized report plan was modified");
  const daily = plan.frequency === "daily", period = plan.period.slice(0, 7), config = plan.profile.reports[plan.frequency];
  if (daily ? !validBusinessDate(plan.period) : !validPeriod(plan.period)) throw new Error("Invalid report period");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("Invalid report generation time");
  const cutoff = daily ? plan.period : monthEnd(period);
  if (cutoff > businessDateOf(new Date(generatedAt))) throw new Error("Future or unfinished report periods require an explicit as-of contract");
  const wants = (d: typeof config.datasets[number]) => config.datasets.includes(d);
  const notes: string[] = ["One collected dataset is used for all files. The API does not provide an atomic snapshot; source changes detected during collection stop generation."], pulses: PulseView[] = [], orders: MonthlyOrder[] = [];
  const totals = new Map<string, number | null>();
  const seriesChecks: { from: string; to: string; fingerprint: string }[] = [];
  async function series(from: string, to: string): Promise<SalesDay[]> {
    const raw = object(await read("pulse-series", { from, to })), rows = parseSeries(raw, from, to);
    const dates = list(raw.dates).map(str), amounts = list(object(raw.totals).revenueCents).map(amount);
    if (dates.length !== amounts.length) throw new Error("Incomplete source daily totals");
    dates.forEach((date, i) => {
      const value = rows.some(r => r.date === date && r.revenueCents !== null) ? amounts[i] : null;
      if (totals.has(date) && totals.get(date) !== value) throw new Error("Daily views disagree during collection");
      totals.set(date, value);
    });
    seriesChecks.push({ from, to, fingerprint: JSON.stringify(raw) });
    return rows;
  }
  let days: SalesDay[] = [], scorecard: ScorecardView | null = null, sources: MonthlySource[] = [], files: IngestRunRow[] = [], exceptions: ExceptionRow[] = [], close: CloseEvidence | null = null, sourceAsOf: string | null = null;
  const scope = plan.access.scope;
  if (scope.kind === "channel") {
    // Never call the all-company pulse, scorecard, source-status, close or exception endpoints.
    const queries: Record<string, string | number>[] = [];
    if (daily) {
      const count = config.comparisons.includes("previous_7_days") ? 8 : 1;
      for (let i = 0; i < count; i++) queries.push({ channel: scope.channel, date: addDays(cutoff, -i) });
    } else {
      queries.push({ channel: scope.channel, period });
      if (config.comparisons.includes("previous_month")) queries.push({ channel: scope.channel, period: previousPeriod(period) });
    }
    for (const query of queries) {
      const rows = await pages(read, "orders", query, 1000, apiOrder);
      if (rows.some(r => r.channel !== scope.channel || (query.date ? r.businessDate !== query.date : !r.businessDate.startsWith(String(query.period) + "-")))) throw new Error("The API returned records outside the requested channel or period");
      if (rows.some(r => r.currency !== "USD")) throw new Error("Channel record currency is unconfirmed");
      if (JSON.stringify(rows) !== JSON.stringify(await pages(read, "orders", query, 1000, apiOrder))) throw new Error("Scoped records changed during collection");
      orders.push(...rows);
    }
    if (new Set(orders.map(row => row.id)).size !== orders.length) throw new Error("Repeated scoped order records");
    const from = daily ? addDays(cutoff, config.comparisons.includes("previous_7_days") ? -7 : 0) : `${config.comparisons.includes("previous_month") ? previousPeriod(period) : period}-01`;
    for (let date = from; date <= cutoff; date = addDays(date, 1)) {
      const rows = orders.filter(r => r.businessDate === date);
      days.push({ date, channel: scope.channel, label: scope.channel, revenueCents: rows.length ? rows.reduce((sum, r) => sum + r.netCents, 0) : null, customers: null, coverage: rows.length ? "records_only" : "missing" });
    }
    notes.push("Channel revenue sums supplied net order amounts. Empty days are unknown, not zero; completeness of all channel feeds is not confirmed.");
    notes.push("Scoped customer counts, inventory and productivity are unavailable from the current shared views. No company-wide indicators or totals are substituted.");
  } else {
    if (daily) {
      const dates = new Set([cutoff]);
      if (config.comparisons.includes("previous_day")) dates.add(addDays(cutoff, -1));
      if (config.comparisons.includes("previous_week")) dates.add(addDays(cutoff, -7));
      for (const date of dates) {
        const pulse = parsePulse(await read("pulse", { date }), date);
        if (!pulse.isSynthetic) throw new Error("The demo requires synthetic pulse evidence");
        pulses.push(pulse);
        totals.set(date, pulse.rows.some(r => r.revenueCents !== null) ? pulse.totals.revenueCents : null);
        days.push(...pulse.rows.map(r => ({ date, channel: r.channelId, label: r.label, revenueCents: r.revenueCents, customers: r.customers, coverage: r.status === "missing" ? "missing" as const : "reported" as const })));
      }
      if (config.comparisons.includes("month_to_date")) days = [...days.filter(d => !d.date.startsWith(period)), ...await series(`${period}-01`, cutoff)];
    } else {
      days = await series(`${period}-01`, cutoff);
      if (config.comparisons.includes("previous_month")) {
        const previous = previousPeriod(period), end = monthEnd(previous);
        days.push(...await series(`${previous}-01`, end));
      }
      if (wants("metrics") || wants("categories")) scorecard = parseScorecard(await read("scorecard", { period }), period);
    }
    if (wants("quality")) {
      const data = object(await read("sources", { period }));
      if (data.period !== period) throw new Error("Source status period mismatch");
      sources = list(data.sources).map(r => apiSource(object(r))); sourceAsOf = data.asOf === undefined ? null : str(data.asOf);
      files = await pages(read, "ingest-runs", { period }, 500, apiFile);
      if (files.some(f => !f.isSynthetic)) throw new Error("This recipient-free demonstration accepts synthetic source files only");
      if (daily) notes.push(`Monthly source status${sourceAsOf ? ` is assessed through ${sourceAsOf}` : " is supplied at generation time"}; file counts dated ${cutoff} are shown separately. This is not a historical daily close approval.`);
    }
    if (wants("records")) {
      const query: Record<string, string | number> = daily ? { date: cutoff } : { period };
      orders.push(...await pages(read, "orders", query, 1000, apiOrder));
      if (orders.some(r => (r.currency !== undefined && r.currency !== "USD") || (daily ? r.businessDate !== cutoff : !r.businessDate.startsWith(period + "-")))) throw new Error("Invalid period or currency in report records");
      if (orders.some(r => r.currency === undefined)) notes.push("USD is confirmed by Joao Carvalho, the project data owner. This version of the shared order view does not return currency for every record.");
    }
    if (wants("exceptions")) {
      exceptions = await pages(read, "exceptions", { period }, 1000, parseException);
      if (daily) notes.push("The exception register reflects the reporting month as retrieved, not the historical state at the report date. Items are not all new today.");
    }
    if (wants("close")) close = parseClose(await read(`/api/close/${period}`, {}), period);
    // Stability guards are not a replacement for a future atomic scoped snapshot.
    if (scorecard && JSON.stringify(scorecard) !== JSON.stringify(parseScorecard(await read("scorecard", { period }), period))) throw new Error("Scorecard changed during collection");
    if (files.length && JSON.stringify(files) !== JSON.stringify(await pages(read, "ingest-runs", { period }, 500, apiFile))) throw new Error("Source files changed during collection");
    for (const pulse of pulses) if (JSON.stringify(pulse) !== JSON.stringify(parsePulse(await read("pulse", { date: pulse.businessDate }), pulse.businessDate))) throw new Error("Daily source changed during collection");
    for (const check of seriesChecks) if (JSON.stringify(await read("pulse-series", { from: check.from, to: check.to })) !== check.fingerprint) throw new Error("Daily series changed during collection");
  }
  if (days.some(d => d.revenueCents !== null && !Number.isSafeInteger(d.revenueCents))) throw new Error("Revenue is outside supported integer precision");
  const content = { plan: approved, currency: "USD" as const, days, dailyTotals: [...totals].map(([date, revenueCents]) => ({ date, revenueCents })), pulses, scorecard, orders, sources, files, exceptions, close, sourceAsOf, collectionNotes: notes,
    syntheticEvidence: scope.kind === "channel" ? "Demo database identified by the project team; the scoped order API has no per-record synthetic flag." : files.length ? "Supplied ingest files are marked synthetic." : "Project-team demonstration database; shared pulse/scorecard views." };
  return freeze({ ...content, generatedAt, version: digest(content) });
}
/** Caller must select a known synthetic demonstration origin; this never provisions real permissions. */
export function profileDemoApi(origin: string, fetcher: typeof fetch = fetch): ViewReader { return createViewApi(origin, fetcher); }
