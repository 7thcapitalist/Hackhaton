/**
 * Upload history: one row per ingested file (ingest_runs), newest first.
 *
 * Filters (optional): sourceId, period. A run belongs to a period if
 * ingest_runs.period = period (monthly files) or its business_date falls in
 * the period (nightly files), same rule as getSourceStatus.
 *
 * warnings: the first 20 messages from warnings_json, as "row N: message".
 * For a failed run warnings_json is { error } and that error is the only entry.
 * Server-only (uses the DB client).
 */
import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ingestRuns, sources } from "@/db/schema";
import type { IngestRunRow, IngestRunsView } from "./types";
import { signedArchivePath } from "@/archive/link";

export interface IngestRunsQuery {
  sourceId?: string;
  period?: string;
  limit?: number;
  offset?: number;
}

export const INGEST_RUNS_DEFAULT_LIMIT = 50;
export const INGEST_RUNS_MAX_LIMIT = 500;
const MAX_WARNINGS = 20;

/** warnings_json → up to 20 readable strings. Never throws on bad JSON. */
export function warningMessages(json: string | null, max = MAX_WARNINGS): string[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [json.slice(0, 500)];
  }
  const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const out: string[] = [];
  for (const w of list) {
    if (out.length >= max) break;
    if (typeof w === "string") out.push(w);
    else if (w && typeof w === "object") {
      const o = w as { row?: unknown; message?: unknown; error?: unknown };
      const msg = o.message ?? o.error;
      if (msg == null) continue;
      out.push(o.row != null ? `row ${String(o.row)}: ${String(msg)}` : String(msg));
    }
  }
  return out;
}

export async function getIngestRuns(q: IngestRunsQuery = {}): Promise<IngestRunsView> {
  const db = getDb();
  const filters: SQL[] = [];
  if (q.sourceId) filters.push(eq(ingestRuns.sourceId, q.sourceId));
  if (q.period) filters.push(or(eq(ingestRuns.period, q.period), like(ingestRuns.businessDate, `${q.period}-%`))!);
  const where = filters.length ? and(...filters) : undefined;

  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? INGEST_RUNS_DEFAULT_LIMIT)), INGEST_RUNS_MAX_LIMIT);
  const offset = Math.max(0, Math.floor(q.offset ?? 0));

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: ingestRuns.id,
        sourceId: ingestRuns.sourceId,
        sourceName: sources.name,
        fileName: ingestRuns.fileName,
        period: ingestRuns.period,
        businessDate: ingestRuns.businessDate,
        periodLabel: ingestRuns.periodLabel,
        status: ingestRuns.status,
        rowCount: ingestRuns.rowCount,
        warningsJson: ingestRuns.warningsJson,
        isSynthetic: ingestRuns.isSynthetic,
        uploadedAt: ingestRuns.uploadedAt,
        archiveKey: ingestRuns.archiveKey,
        archiveUrl: ingestRuns.archiveUrl,
        archiveBackend: ingestRuns.archiveBackend,
      })
      .from(ingestRuns)
      .leftJoin(sources, eq(sources.id, ingestRuns.sourceId))
      .where(where)
      .orderBy(desc(ingestRuns.uploadedAt), desc(ingestRuns.id))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(ingestRuns).where(where),
  ]);

  return {
    rows: rows.map(({ warningsJson, isSynthetic, sourceName, ...r }): IngestRunRow => ({
      ...r,
      sourceName: sourceName ?? r.sourceId,
      warnings: warningMessages(warningsJson),
      isSynthetic: isSynthetic === 1,
      archiveDownloadPath: r.archiveKey ? signedArchivePath(r.id) : null,
    })),
    total: Number(totalRow[0]?.n ?? 0),
  };
}
