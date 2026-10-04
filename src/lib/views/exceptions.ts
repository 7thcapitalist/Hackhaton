/**
 * Exceptions inbox: everything the data layer flagged for a human (missing
 * files, parse warnings/failures, duplicates, reconcile mismatches, …), plus
 * the one write the UI needs: resolve / waive / reopen an exception.
 *
 * Filters (all optional): status, sourceId, kind, period. An exception
 * belongs to a period the same way as in getSourceStatus: through its ingest
 * run (run period or business date), its close, or (when it has neither) the
 * month it was created in.
 *
 * countsByKind uses every filter EXCEPT `kind`, so a UI can show one tab per
 * kind with its count while one kind is selected.
 * Newest first. Server-only (uses the DB client).
 */
import { and, count, desc, eq, isNull, like, or, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { closes, exceptions, ingestRuns, sources } from "@/db/schema";
import type { ExceptionKind, ExceptionRow, ExceptionStatus, ExceptionsView } from "./types";
import { cachedView } from "./cache";

export interface ExceptionsQuery {
  status?: ExceptionStatus;
  sourceId?: string;
  kind?: ExceptionKind;
  period?: string;
  limit?: number;
  offset?: number;
}

export const EXCEPTION_STATUSES: readonly ExceptionStatus[] = ["open", "resolved", "waived"];
export const EXCEPTION_KINDS: readonly ExceptionKind[] = [
  "missing_source",
  "parse_warning",
  "parse_failed",
  "reconcile_mismatch",
  "unmapped_amount",
  "duplicate_file",
  "duplicate_order",
  "unbalanced_document",
];
export const EXCEPTIONS_DEFAULT_LIMIT = 100;
export const EXCEPTIONS_MAX_LIMIT = 1000;

/** Columns of one ExceptionRow (needs the sources left join). */
const ROW = {
  id: exceptions.id,
  kind: exceptions.kind,
  sourceId: exceptions.sourceId,
  sourceName: sources.name,
  message: exceptions.message,
  owner: exceptions.owner,
  status: exceptions.status,
  expectedCents: exceptions.expectedCents,
  actualCents: exceptions.actualCents,
  ingestRunId: exceptions.ingestRunId,
  createdAt: exceptions.createdAt,
  resolvedAt: exceptions.resolvedAt,
};

function periodFilter(period: string): SQL {
  const month = `${period}-%`;
  return or(
    eq(ingestRuns.period, period),
    like(ingestRuns.businessDate, month),
    eq(closes.period, period),
    and(isNull(exceptions.ingestRunId), isNull(exceptions.closeId), like(exceptions.createdAt, month)),
  )!;
}

async function getExceptionsUncached(q: ExceptionsQuery = {}): Promise<ExceptionsView> {
  const db = getDb();
  const base: SQL[] = [];
  if (q.status) base.push(eq(exceptions.status, q.status));
  if (q.sourceId) base.push(eq(exceptions.sourceId, q.sourceId));
  if (q.period) base.push(periodFilter(q.period));
  const withKind = q.kind ? [...base, eq(exceptions.kind, q.kind)] : base;
  const where = withKind.length ? and(...withKind) : undefined;
  const whereNoKind = base.length ? and(...base) : undefined;

  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? EXCEPTIONS_DEFAULT_LIMIT)), EXCEPTIONS_MAX_LIMIT);
  const offset = Math.max(0, Math.floor(q.offset ?? 0));

  const from = () =>
    db
      .select(ROW)
      .from(exceptions)
      .leftJoin(sources, eq(sources.id, exceptions.sourceId))
      .leftJoin(ingestRuns, eq(ingestRuns.id, exceptions.ingestRunId))
      .leftJoin(closes, eq(closes.id, exceptions.closeId));

  const [rows, totalRow, kinds] = await Promise.all([
    from().where(where).orderBy(desc(exceptions.createdAt), desc(exceptions.id)).limit(limit).offset(offset),
    db
      .select({ n: count() })
      .from(exceptions)
      .leftJoin(ingestRuns, eq(ingestRuns.id, exceptions.ingestRunId))
      .leftJoin(closes, eq(closes.id, exceptions.closeId))
      .where(where),
    db
      .select({ kind: exceptions.kind, n: count() })
      .from(exceptions)
      .leftJoin(ingestRuns, eq(ingestRuns.id, exceptions.ingestRunId))
      .leftJoin(closes, eq(closes.id, exceptions.closeId))
      .where(whereNoKind)
      .groupBy(exceptions.kind),
  ]);

  const countsByKind: Record<string, number> = {};
  for (const k of kinds) countsByKind[k.kind] = Number(k.n);

  return {
    rows: rows as ExceptionRow[],
    total: Number(totalRow[0]?.n ?? 0),
    countsByKind,
  };
}

export interface SetExceptionStatusInput {
  status: ExceptionStatus;
  /** Optional free-text note; appended to the message with the date. */
  note?: string;
  /** ISO timestamp; defaults to now. */
  at?: string;
}

/**
 * Resolve, waive or reopen one exception. Sets resolved_at for resolved/waived
 * and clears it for open. A note is appended to the message (there is no
 * separate notes column) so the audit trail stays readable in one place.
 * Returns the updated row, or null if the id does not exist.
 */
export async function setExceptionStatus(id: string, input: SetExceptionStatusInput): Promise<ExceptionRow | null> {
  const db = getDb();
  const [current] = await db
    .select({ id: exceptions.id, message: exceptions.message })
    .from(exceptions)
    .where(eq(exceptions.id, id))
    .limit(1);
  if (!current) return null;

  const at = input.at ?? new Date().toISOString();
  const note = input.note?.trim().slice(0, 1000);
  const message = note ? `${current.message}\n[${at.slice(0, 10)} ${input.status}] ${note}` : current.message;

  await db
    .update(exceptions)
    .set({ status: input.status, resolvedAt: input.status === "open" ? null : at, message })
    .where(eq(exceptions.id, id));

  const [row] = await db
    .select(ROW)
    .from(exceptions)
    .leftJoin(sources, eq(sources.id, exceptions.sourceId))
    .where(eq(exceptions.id, id))
    .limit(1);
  return (row as ExceptionRow | undefined) ?? null;
}

export const getExceptions = cachedView("getExceptions", getExceptionsUncached);
