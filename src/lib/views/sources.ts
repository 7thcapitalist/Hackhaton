/**
 * Source status for a period: which of the 9 source workflows delivered files.
 * - A run belongs to the period if ingest_runs.period = period (monthly files)
 *   or its business_date falls in the period (nightly files).
 * - status: "missing" (no run), "warnings" (a run parsed with warnings or failed,
 *   or open exceptions), else "received".
 * - openExceptions: open exceptions tied to the period via their ingest run,
 *   their close, or (when neither is set) their created_at month.
 * Server-only (uses the DB client).
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { SourceStatus, SourceStatusView } from "./types";

export async function getSourceStatus(period: string): Promise<SourceStatusView> {
  const db = getDb();
  const like = `${period}-%`;

  const sources = await db.all<{ id: string; name: string }>(
    sql`select id, name from sources where active = 1 order by rowid`,
  );

  const runs = await db.all<{
    source_id: string;
    runs: number;
    row_count: number;
    last_at: string | null;
    flagged: number;
  }>(sql`
    select source_id, count(*) as runs, coalesce(sum(row_count), 0) as row_count,
           max(uploaded_at) as last_at,
           count(case when status in ('parsed_with_warnings', 'failed') then 1 end) as flagged
    from ingest_runs
    where period = ${period} or business_date like ${like}
    group by source_id`);

  const exc = await db.all<{ source_id: string; n: number }>(sql`
    select e.source_id, count(*) as n
    from exceptions e
    left join ingest_runs r on r.id = e.ingest_run_id
    left join closes c on c.id = e.close_id
    where e.status = 'open' and e.source_id is not null and (
      r.period = ${period} or r.business_date like ${like} or c.period = ${period}
      or (e.ingest_run_id is null and e.close_id is null and e.created_at like ${like})
    )
    group by e.source_id`);

  const runBy = new Map(runs.map((r) => [r.source_id, r]));
  const excBy = new Map(exc.map((e) => [e.source_id, Number(e.n)]));

  const out: SourceStatus[] = sources.map((s) => {
    const r = runBy.get(s.id);
    const openExceptions = excBy.get(s.id) ?? 0;
    const status: SourceStatus["status"] = !r
      ? "missing"
      : Number(r.flagged) > 0 || openExceptions > 0
        ? "warnings"
        : "received";
    return {
      sourceId: s.id,
      name: s.name,
      status,
      lastIngestAt: r?.last_at ?? null,
      rowCount: Number(r?.row_count ?? 0),
      openExceptions,
    };
  });

  return { period, sources: out };
}
