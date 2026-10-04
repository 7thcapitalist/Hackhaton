/** Small helpers shared by the close modules. */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { closes, type Close } from "@/db/schema";

export type CloseErrorCode = "bad_input" | "not_found" | "conflict";

export class CloseError extends Error {
  constructor(
    public code: CloseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CloseError";
  }
  get httpStatus(): number {
    return this.code === "bad_input" ? 400 : this.code === "not_found" ? 404 : 409;
  }
}

export function assertPeriod(period: unknown): asserts period is string {
  if (typeof period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new CloseError("bad_input", `period must be YYYY-MM, got "${String(period)}"`);
  }
}

/** Last calendar day of the period, YYYY-MM-DD (the posting date). */
export function periodEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

/** "2026-09" → "2609" (Document No. / batch suffix). */
export const periodCode = (period: string) => period.slice(2, 4) + period.slice(5, 7);

/** "2026-09" → "Sep 2026". */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${y}`;
}

export const JOURNAL_TEMPLATE = "GENERAL";
/** BC batch names are Code[10]. */
export const journalBatch = (period: string) => `ECOM-${periodCode(period)}`;
export const documentNo = (period: string, sourceCode: string) => `ECOM-${periodCode(period)}-${sourceCode}`.slice(0, 20);

export const BC_DESCRIPTION_MAX = 50;
export const truncate = (s: string, n = BC_DESCRIPTION_MAX) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

export async function findClose(db: Db, period: string): Promise<Close | undefined> {
  const [row] = await db.select().from(closes).where(eq(closes.period, period)).limit(1);
  return row;
}

export async function requireClose(db: Db, period: string): Promise<Close> {
  const row = await findClose(db, period);
  if (!row) throw new CloseError("not_found", `No close generated for ${period}. Generate it first.`);
  return row;
}

/** Compress sorted row numbers into "2-14,17,20-22". */
export function rowRanges(rows: number[]): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(",");
}

/** Shape of journal_lines.trace_json / ar_invoice_lines.trace_json. */
export interface FactTrace {
  kind: "facts";
  table: "orders" | "money_lines" | "mixed";
  count: number;
  /** Fact row ids; omitted when count > TRACE_ID_LIMIT (use runs instead). */
  ids?: string[];
  runs: { ingestRunId: string; fileName: string; rows: string }[];
}
export interface BalancingTrace {
  kind: "balancing";
  documentNo: string;
  /** Line numbers this line balances. */
  lineNos: number[];
}
export type LineTrace = FactTrace | BalancingTrace;
export const TRACE_ID_LIMIT = 200;

export function parseTrace(json: string | null): LineTrace | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LineTrace;
  } catch {
    return null;
  }
}

export const centsToDecimal = (c: number) => Math.round(c) / 100;
export const fmtUsd = (c: number) =>
  (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- Audit trail (closes.events_json) ---------------------------------------

export type CloseEventAction =
  | "generated"
  | "reconciled"
  | "workbook_imported"
  | "exception_resolved"
  | "exception_waived"
  | "approved"
  | "exported"
  | "evidence_exported"
  | "imported"
  | "import_failed"
  | "posted";

export interface CloseEvent {
  at: string;
  action: CloseEventAction;
  actor: string;
  detail?: string;
}

export function parseEvents(json: string | null | undefined): CloseEvent[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as CloseEvent[]) : [];
  } catch {
    return [];
  }
}

/** Append one event to a close's audit trail (read-modify-write; closes are low traffic). */
export async function appendEvent(db: Db, closeId: string, e: Omit<CloseEvent, "at"> & { at?: string }): Promise<CloseEvent> {
  const event: CloseEvent = { at: e.at ?? new Date().toISOString(), action: e.action, actor: e.actor || "system", detail: e.detail };
  const [row] = await db.select({ eventsJson: closes.eventsJson }).from(closes).where(eq(closes.id, closeId)).limit(1);
  const events = parseEvents(row?.eventsJson);
  events.push(event);
  await db.update(closes).set({ eventsJson: JSON.stringify(events) }).where(eq(closes.id, closeId));
  return event;
}

/** Most recent event of an action, or null. */
export function lastEvent(events: CloseEvent[], action: CloseEventAction): CloseEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].action === action) return events[i];
  return null;
}

/** Parse "1,234.56", "-43.18", "(43.18)", "$1,000" → integer cents. NaN on garbage. */
export function parseMoneyToCents(raw: unknown): number {
  if (typeof raw === "number") return Math.round(raw * 100);
  let s = String(raw ?? "").trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const c = Math.round(Number(s) * 100);
  return neg ? -c : c;
}
