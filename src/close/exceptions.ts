/**
 * Resolve or waive one exception of a close, with who and why (audit trail).
 *
 * The exceptions table has no resolved_by column, so the decision is stamped
 * into the message as " [Resolved by <who>, <iso>: <note>]" (or "Waived by"),
 * which reconcile strips when matching (a resolution survives a re-run) and the
 * evidence package parses back into "Resolved by". Also logged as a close event.
 * If no open exception is left on a `generated` close, it becomes `reconciled`.
 */
import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { closes, exceptions } from "@/db/schema";
import { CloseError, appendEvent, assertPeriod, requireClose } from "./common";

export interface ResolveExceptionResult {
  period: string;
  exceptionId: string;
  status: "resolved" | "waived";
  closeStatus: string;
  openExceptions: number;
}

const STAMP = /\[(Resolved|Waived)(?: at approval)? by ([^,\]]+), ([0-9T:.\-Z]+)/;

/** Who resolved/waived an exception, parsed from its message stamp. */
export function resolvedByOf(message: string): string | null {
  const all = [...message.matchAll(new RegExp(STAMP, "g"))];
  return all.length ? all[all.length - 1][2].trim() : null;
}

export async function resolveCloseException(
  period: string,
  exceptionId: string,
  opts: { status: "resolved" | "waived"; by: string; note?: string; db?: Db },
): Promise<ResolveExceptionResult> {
  assertPeriod(period);
  const who = (opts.by ?? "").trim();
  if (!who) throw new CloseError("bad_input", "resolving an exception needs `by` (who decided)");
  if (opts.status !== "resolved" && opts.status !== "waived") throw new CloseError("bad_input", 'status must be "resolved" or "waived"');
  const db = opts.db ?? getDb();
  const close = await requireClose(db, period);
  const [e] = await db
    .select()
    .from(exceptions)
    .where(and(eq(exceptions.id, exceptionId), eq(exceptions.closeId, close.id)))
    .limit(1);
  if (!e) throw new CloseError("not_found", `Exception ${exceptionId} does not belong to the ${period} close.`);
  if (e.status !== "open") throw new CloseError("conflict", `Exception ${exceptionId} is already ${e.status}.`);

  const now = new Date().toISOString();
  const note = (opts.note ?? "").trim().slice(0, 500);
  const verb = opts.status === "resolved" ? "Resolved" : "Waived";
  const message = `${e.message} [${verb} by ${who.replace(/[,\]]/g, " ")}, ${now}${note ? `: ${note}` : ""}]`;
  await db.update(exceptions).set({ status: opts.status, resolvedAt: now, message }).where(eq(exceptions.id, e.id));
  await appendEvent(db, close.id, {
    action: opts.status === "resolved" ? "exception_resolved" : "exception_waived",
    actor: who,
    at: now,
    detail: `${e.kind}${e.sourceId ? ` (${e.sourceId})` : ""}${note ? `: ${note}` : ""}`,
  });

  const open = await db
    .select({ id: exceptions.id })
    .from(exceptions)
    .where(and(eq(exceptions.closeId, close.id), eq(exceptions.status, "open")));
  let closeStatus: string = close.status;
  if (close.status === "generated" && open.length === 0) {
    closeStatus = "reconciled";
    await db.update(closes).set({ status: "reconciled" }).where(eq(closes.id, close.id));
  }
  return { period, exceptionId, status: opts.status, closeStatus, openExceptions: open.length };
}
