/**
 * Source status for a period, by each source's cadence (sources.config_json
 * .cadence, default src/ingest/config.ts SOURCE_CADENCE).
 * - A run belongs to the period if ingest_runs.period = period (monthly files)
 *   or its business_date falls in the period (daily / weekly files).
 * - "As of" = the latest business day with any ingested file (the data's
 *   clock; the demo data stops at 2026-10-03). A day is DUE once it is over,
 *   i.e. every day of the period before the as-of day.
 * - daily: "missing" when a due day has no file (missingDates lists them). A
 *   monthly run (prior-year history) covers every day of its period. A period
 *   with no due day yet is "not_due".
 * - weekly / monthly: no run and the period is the running (or a future)
 *   month → "not_due" (the file is not out yet); no run for a past month →
 *   "missing".
 * - Otherwise "warnings" (a run parsed with warnings or failed, or open
 *   exceptions), else "received".
 * - openExceptions: open exceptions tied to the period via their ingest run,
 *   their close, or (when neither is set) their created_at month.
 * Server-only (uses the DB client).
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cadenceOf } from "@/ingest/config";
import { addDays, businessDateOf, periodBounds } from "./dates";
import type { SourceStatus, SourceStatusView } from "./types";
import { cachedView } from "./cache";

async function getSourceStatusUncached(period: string): Promise<SourceStatusView> {
  const db = getDb();
  const like = `${period}-%`;

  const sources = await db.all<{ id: string; name: string; config_json: string | null }>(
    sql`select id, name, config_json from sources where active = 1 order by rowid`,
  );

  const runs = await db.all<{
    source_id: string;
    runs: number;
    row_count: number;
    last_at: string | null;
    flagged: number;
    monthly: number;
  }>(sql`
    select source_id, count(*) as runs, coalesce(sum(row_count), 0) as row_count,
           max(uploaded_at) as last_at,
           count(case when status in ('parsed_with_warnings', 'failed') then 1 end) as flagged,
           count(case when business_date is null and period = ${period} and status != 'failed' then 1 end) as monthly
    from ingest_runs
    where period = ${period} or business_date like ${like}
    group by source_id`);

  const days = await db.all<{ source_id: string; business_date: string }>(sql`
    select distinct source_id, business_date from ingest_runs
    where business_date like ${like} and status != 'failed'`);

  const [clock] = await db.all<{ as_of: string | null }>(
    sql`select max(business_date) as as_of from ingest_runs where status != 'failed'`,
  );
  const asOf = clock?.as_of ?? businessDateOf(new Date());
  // A source is expected from its first delivery on (the ops feeds have no prior-year history).
  const firstRows = await db.all<{ source_id: string; first: string }>(sql`
    select source_id, min(coalesce(business_date, period || '-01')) as first
    from ingest_runs where status != 'failed' group by source_id`);
  const firstBy = new Map(firstRows.map((r) => [r.source_id, r.first]));

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
  const daysBy = new Map<string, Set<string>>();
  for (const d of days) {
    const set = daysBy.get(d.source_id) ?? new Set<string>();
    set.add(d.business_date);
    daysBy.set(d.source_id, set);
  }

  // Due days of the period: from its first day up to (not including) the as-of day.
  const { start, end } = periodBounds(period);
  const dueDays: string[] = [];
  for (let d = start; d <= end && d < asOf; d = addDays(d, 1)) dueDays.push(d);
  const periodRunning = period >= asOf.slice(0, 7);

  const out: SourceStatus[] = sources.map((s) => {
    const r = runBy.get(s.id);
    const cadence = cadenceOf(s.id, s.config_json);
    const openExceptions = excBy.get(s.id) ?? 0;
    let missingDates: string[] = [];
    let status: SourceStatus["status"];
    const since = firstBy.get(s.id) ?? "";
    const due = dueDays.filter((d) => d >= since);
    if (cadence === "daily") {
      const have = daysBy.get(s.id) ?? new Set<string>();
      const coveredByMonthly = Number(r?.monthly ?? 0) > 0;
      missingDates = coveredByMonthly ? [] : due.filter((d) => !have.has(d));
      if (!r && due.length === 0) status = "not_due";
      else if (missingDates.length > 0) status = "missing";
      else if (!r) status = "missing";
      else status = Number(r.flagged) > 0 || openExceptions > 0 ? "warnings" : "received";
    } else if (!r) {
      status = periodRunning || since > end ? "not_due" : "missing";
    } else {
      status = Number(r.flagged) > 0 || openExceptions > 0 ? "warnings" : "received";
    }
    return {
      sourceId: s.id,
      name: s.name,
      cadence,
      status,
      lastIngestAt: r?.last_at ?? null,
      rowCount: Number(r?.row_count ?? 0),
      openExceptions,
      ...(missingDates.length ? { missingDates } : {}),
    };
  });

  return { period, asOf, sources: out };
}

export const getSourceStatus = cachedView("getSourceStatus", getSourceStatusUncached);
