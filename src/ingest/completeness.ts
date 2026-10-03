/**
 * Missing-source check: which active sources / channels have no successful
 * ingest run for a business day or a period?
 *
 * - Period (YYYY-MM): a source is present if it has a non-failed run with
 *   period = P or a business_date inside P. All active sources are expected.
 * - Day (YYYY-MM-DD): only nightly-capable sources (DAILY_SOURCES) are expected;
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
import { and, eq, inArray, isNull, like, ne, or } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { channels, exceptions, ingestRuns, orders, sources } from "@/db/schema";
import { CHANNEL_SOURCES, DAILY_SOURCES, ensureConfig, type ChannelId } from "./config";
import { IngestError } from "./errors";

export type CompletenessScope = { businessDate: string } | { period: string };

export interface CompletenessResult {
  businessDate: string | null;
  period: string | null;
  expectedSources: string[];
  presentSources: string[];
  missingSources: { id: string; name: string }[];
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
  const expected = activeSources.filter((s) => !businessDate || DAILY_SOURCES.includes(s.id));

  // A daily run (business_date set) covers only its own day; only a monthly
  // run (no business_date) covers every day of its period.
  const runMatch = businessDate
    ? or(eq(ingestRuns.businessDate, businessDate), and(isNull(ingestRuns.businessDate), eq(ingestRuns.period, period)))
    : or(eq(ingestRuns.period, period), like(ingestRuns.businessDate, `${period}-%`));
  const runs = await db
    .select({ id: ingestRuns.id, sourceId: ingestRuns.sourceId })
    .from(ingestRuns)
    .where(and(ne(ingestRuns.status, "failed"), runMatch));
  const present = new Set(runs.map((r) => r.sourceId));

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

  const missingSources = expected.filter((s) => !present.has(s.id)).map((s) => ({ id: s.id, name: s.name }));

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
    missingChannels,
    exceptionsWritten,
  };
}
