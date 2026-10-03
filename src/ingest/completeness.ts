/**
 * Missing-source check: which active sources / channels have no successful
 * ingest run for a business day or a period?
 *
 * Cadence-aware (src/ingest/config.ts SOURCE_CADENCE / sources.config_json),
 * and a source is only expected from its first delivery on.
 * - Period (YYYY-MM): a source is present if it has a non-failed run with
 *   period = P or a business_date inside P. A daily source must also have a
 *   file for every finished day of P (days before the latest business day
 *   with any file), unless a monthly run covers P. A weekly/monthly source
 *   with no file for the running month is not due (notDueSources), not missing.
 * - Day (YYYY-MM-DD): only daily-cadence sources are expected;
 *   a run counts if business_date = day, or it is a monthly run (no business_date)
 *   with period = the day's month (a monthly
 *   file covers every day). A channel is present if one of its own sources is
 *   present, or any ingested order of a counted run carries that channel for that
 *   day (e.g. Upright covering eBay).
 *
 * With `writeExceptions: true`, one open `missing_source` exception per missing
 * source is written; re-running does not duplicate it (same message, still open).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { channels, exceptions, ingestRuns, orders, sources } from "@/db/schema";
import { addDays } from "@/lib/views/dates";
import { CHANNEL_SOURCES, cadenceOf, ensureConfig, type ChannelId } from "./config";
import { IngestError } from "./errors";

export type CompletenessScope = { businessDate: string } | { period: string };

export interface CompletenessResult {
  businessDate: string | null;
  period: string | null;
  expectedSources: string[];
  presentSources: string[];
  /** Due but absent. A daily source with gaps lists the finished days without a file. */
  missingSources: { id: string; name: string; missingDates?: string[] }[];
  /** No file yet and none expected yet (weekly/monthly file of the running month). */
  notDueSources: string[];
  missingChannels: { id: ChannelId; name: string }[];
  exceptionsWritten: number;
}

export async function checkCompleteness(
  scope: CompletenessScope,
  opts: { writeExceptions?: boolean; db?: Db } = {},
): Promise<CompletenessResult> {
  const db = opts.db ?? getDb();
  await ensureConfig(db);
  const businessDate = "businessDate" in scope ? scope.businessDate : null;
  const period = "period" in scope ? scope.period : businessDate!.slice(0, 7);
  if (businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new IngestError("bad_input", `businessDate must be YYYY-MM-DD, got "${businessDate}"`);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new IngestError("bad_input", `period must be YYYY-MM, got "${period}"`);
  }

  const activeSources = await db.select().from(sources).where(eq(sources.active, 1));
  const cadence = new Map(activeSources.map((s) => [s.id, cadenceOf(s.id, s.configJson)]));
  // A source is expected from its first delivery on (the ops feeds start in 2026-08, no prior-year history).
  const firstRows = await db
    .select({ sourceId: ingestRuns.sourceId, first: sql<string>`min(coalesce(${ingestRuns.businessDate}, ${ingestRuns.period} || '-01'))` })
    .from(ingestRuns)
    .where(ne(ingestRuns.status, "failed"))
    .groupBy(ingestRuns.sourceId);
  const first = new Map(firstRows.map((r) => [r.sourceId, r.first]));
  // A day expects every daily-cadence source delivering by then; a period expects all sources.
  const expected = activeSources.filter(
    (s) => !businessDate || (cadence.get(s.id) === "daily" && (first.get(s.id) ?? "") <= businessDate),
  );

  // A daily run (business_date set) covers only its own day; only a monthly
  // run (no business_date) covers every day of its period.
  const runMatch = businessDate
    ? or(eq(ingestRuns.businessDate, businessDate), and(isNull(ingestRuns.businessDate), eq(ingestRuns.period, period)))
    : or(eq(ingestRuns.period, period), like(ingestRuns.businessDate, `${period}-%`));
  const runs = await db
    .select({ id: ingestRuns.id, sourceId: ingestRuns.sourceId, businessDate: ingestRuns.businessDate })
    .from(ingestRuns)
    .where(and(ne(ingestRuns.status, "failed"), runMatch));
  const present = new Set(runs.map((r) => r.sourceId));

  // Period scope, by cadence (same rule as getSourceStatus): "as of" is the
  // latest business day with a file; days before it are due. A daily source
  // must have a file for every due day (a monthly run covers the whole
  // period); a weekly/monthly file for the running month is not due yet.
  const notDue = new Set<string>();
  const missingDays = new Map<string, string[]>();
  if (!businessDate) {
    const [clock] = await db
      .select({ asOf: sql<string | null>`max(${ingestRuns.businessDate})` })
      .from(ingestRuns)
      .where(ne(ingestRuns.status, "failed"));
    const asOf = clock?.asOf ?? new Date().toISOString().slice(0, 10);
    const [y, m] = period.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const dueDays: string[] = [];
    for (let d = `${period}-01`; d <= last && d < asOf; d = addDays(d, 1)) dueDays.push(d);
    const days = new Map<string, Set<string>>();
    const monthly = new Set<string>();
    for (const r of runs) {
      if (r.businessDate) days.set(r.sourceId, (days.get(r.sourceId) ?? new Set()).add(r.businessDate));
      else monthly.add(r.sourceId);
    }
    for (const s of expected) {
      const c = cadence.get(s.id);
      const since = first.get(s.id) ?? "";
      const due = dueDays.filter((d) => d >= since);
      if (c === "daily") {
        if (!present.has(s.id) && due.length === 0) notDue.add(s.id);
        else if (!monthly.has(s.id)) {
          const gaps = due.filter((d) => !days.get(s.id)?.has(d));
          if (gaps.length) missingDays.set(s.id, gaps);
        }
      } else if (!present.has(s.id) && (period >= asOf.slice(0, 7) || since > last)) {
        notDue.add(s.id);
      }
    }
  }

  // Channels seen in orders of those runs (for the day, or the whole period).
  const seenChannels = new Set<string>();
  const runIds = runs.map((r) => r.id);
  for (let i = 0; i < runIds.length; i += 500) {
    const ids = runIds.slice(i, i + 500);
    const rows = await db
      .selectDistinct({ channel: orders.channel })
      .from(orders)
      .where(
        and(
          inArray(orders.ingestRunId, ids),
          businessDate ? eq(orders.businessDate, businessDate) : like(orders.businessDate, `${period}-%`),
        ),
      );
    for (const r of rows) seenChannels.add(r.channel);
  }

  const channelRows = await db.select().from(channels).orderBy(channels.sortOrder);
  const missingChannels = channelRows
    .filter((c) => {
      const own = CHANNEL_SOURCES[c.id as ChannelId] ?? [];
      return !seenChannels.has(c.id) && !own.some((s) => present.has(s));
    })
    .map((c) => ({ id: c.id as ChannelId, name: c.name }));

  const missingSources = expected
    .filter((s) => !notDue.has(s.id) && (!present.has(s.id) || missingDays.has(s.id)))
    .map((s) => ({ id: s.id, name: s.name, ...(missingDays.has(s.id) ? { missingDates: missingDays.get(s.id)! } : {}) }));

  let exceptionsWritten = 0;
  if (opts.writeExceptions && missingSources.length > 0) {
    const label = businessDate ? `business date ${businessDate}` : `period ${period}`;
    const wanted = missingSources.map((s) => ({
      sourceId: s.id,
      message: `No ${s.name} file ingested for ${label}.`,
    }));
    const open = await db
      .select({ sourceId: exceptions.sourceId, message: exceptions.message })
      .from(exceptions)
      .where(and(eq(exceptions.kind, "missing_source"), eq(exceptions.status, "open")));
    const have = new Set(open.map((e) => `${e.sourceId}|${e.message}`));
    const fresh = wanted.filter((w) => !have.has(`${w.sourceId}|${w.message}`));
    if (fresh.length > 0) {
      await db.insert(exceptions).values(
        fresh.map((w) => ({ id: randomUUID(), kind: "missing_source" as const, ...w })),
      );
    }
    exceptionsWritten = fresh.length;
  }

  return {
    businessDate,
    period: businessDate ? null : period,
    expectedSources: expected.map((s) => s.id),
    presentSources: [...present],
    missingSources,
    notDueSources: expected.filter((s) => notDue.has(s.id)).map((s) => s.id),
    missingChannels,
    exceptionsWritten,
  };
}
