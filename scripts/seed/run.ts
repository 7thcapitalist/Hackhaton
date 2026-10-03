/**
 * Seed core, used by `npm run seed` (scripts/seed.ts) and `POST /api/demo/reset`.
 *
 * The demo data travels the same path real data does, through the fake APIs:
 *
 *   mock export files (data/fixtures/**, or rendered in memory)
 *     → mock connectors (src/connectors, mock mode: API JSON / report files /
 *       email and portal drop files, exactly as the real pull would return)
 *     → ingestFile() (parse → clean → write)  [src/ingest]
 *
 * Steps:
 * 1. Wipe facts (ingest_runs, orders, money_lines, items, labor_hours,
 *    marketplace_metrics, exceptions without a close), upsert config (sources,
 *    channels) and kpi_targets. Close tables are untouched.
 * 2. pullAndIngest({ mock: true }) month by month over the mock range, with the
 *    connectors reading only the given fixture set. Every fact (orders, money
 *    lines, items, labor hours, marketplace metrics) comes from an ingest run;
 *    mock runs are flagged is_synthetic = 1 by the pull runner.
 * 3. Check completeness for every finished day and month (read-only): the
 *    baseline must have every due file and zero open exceptions.
 * Nothing else is inserted directly: only config and KPI targets.
 *
 * Two modes, same rows:
 * - "direct": ingest straight into the target DB (one ingestFile per file:
 *   ~4 round trips each). Fine for a local file DB.
 * - "staged": ingest into a scratch SQLite file with the same schema, then copy the
 *   resulting rows to the target in ONE write transaction (a few large round
 *   trips). Used for remote Turso (demo reset over HTTP).
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Client, InArgs, InStatement } from "@libsql/client";
import type { Db } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { pullAndIngest, type PulledFileResult } from "../../src/connectors";
import { useMockFixtures } from "../../src/connectors/fixtures";
import { checkCompleteness } from "../../src/ingest";
import { dateRange } from "../../src/lib/views/dates";
import { END_DATE, PY_END, PY_START, SEED_NOW, START_DATE } from "../mock/model";
import { dailyUpload, monthlyUpload } from "../mock/schedule";
import { CHANNELS, KPI_TARGETS, SOURCES } from "./config";
import { withCachedDateTimeFormat } from "./intl-cache";

/** Rows per INSERT statement. */
const ROWS_PER_INSERT = 400;
/** Bound parameters per round trip (keeps each HTTP request a few MB). */
const PARAMS_PER_BATCH = 40_000;

export interface SeedFixture {
  /** Path relative to data/fixtures. */
  path: string;
  /** Folder = the parser that must accept it. */
  sourceId: string;
  bytes: Uint8Array;
  uploadedAt: string;
}

export type SeedMode = "direct" | "staged";

export interface SeedOptions {
  fixtures: SeedFixture[];
  mode?: SeedMode;
  log?: (line: string) => void;
}

export interface SeedResult {
  mode: SeedMode;
  counts: Record<string, number>;
  files: { total: number; byStatus: Record<string, number> };
  /** Rows written by ingest runs (summed over the pulled files). */
  viaIngest: { orders: number; moneyLines: number; items: number; laborHours: number; marketplaceMetrics: number };
  ordersReplaced: number;
  duplicateOrders: number;
  exceptionsByKind: Record<string, number>;
  /** Files whose result was unexpected (wrong parser, failed). Empty = good. */
  problems: string[];
  /** Round trips to the target DB in the final copy (staged mode). */
  copyRoundTrips?: number;
  ms: number;
  ingestMs: number;
}

interface ToSql {
  toSQL(): { sql: string; params: unknown[] };
}

/** Collects Drizzle statements and sends them in a few big batches, in one write transaction. */
class StatementBatch {
  stmts: InStatement[] = [];
  constructor(private db: Db) {}
  add(q: ToSql) {
    const { sql: text, params } = q.toSQL();
    this.stmts.push({ sql: text, args: params as InArgs });
  }
  insertAll<T>(table: Parameters<Db["insert"]>[0], rows: T[]) {
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.add(this.db.insert(table).values(rows.slice(i, i + ROWS_PER_INSERT) as any));
    }
  }
  /** Returns the number of round trips used. */
  async commit(client: Client): Promise<number> {
    const groups: InStatement[][] = [];
    let cur: InStatement[] = [];
    let params = 0;
    for (const s of this.stmts) {
      const n = typeof s === "string" ? 0 : Array.isArray(s.args) ? s.args.length : 0;
      if (cur.length > 0 && params + n > PARAMS_PER_BATCH) {
        groups.push(cur);
        cur = [];
        params = 0;
      }
      cur.push(s);
      params += n;
    }
    if (cur.length) groups.push(cur);
    // Over HTTP (Turso), an idle keep-alive connection can be closed by the
    // server while the staged ingest runs locally; the next request then fails
    // with ECONNRESET. The transaction is all-or-nothing, so retrying is safe.
    for (let attempt = 1; ; attempt++) {
      const tx = await client.transaction("write");
      try {
        for (const g of groups) await tx.batch(g);
        await tx.commit();
        return groups.length + 2; // + begin/commit
      } catch (err) {
        await tx.rollback().catch(() => {});
        if (attempt >= 3 || !isConnectionReset(err)) throw err;
      } finally {
        tx.close();
      }
    }
  }
}

function isConnectionReset(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string } } | null;
  const text = `${e?.code ?? ""} ${e?.cause?.code ?? ""} ${e?.message ?? ""}`;
  return /ECONNRESET|socket hang up|other side closed|fetch failed/i.test(text);
}

/** Wipe facts, upsert config and KPI targets (statements only). */
function resetStatements(db: Db, b: StatementBatch) {
  b.add(db.delete(schema.exceptions).where(sql`close_id is null`));
  b.add(db.delete(schema.moneyLines));
  b.add(db.delete(schema.marketplaceMetrics));
  b.add(db.delete(schema.orders));
  b.add(db.delete(schema.items));
  b.add(db.delete(schema.laborHours));
  b.add(db.delete(schema.ingestRuns));
  b.add(db.delete(schema.kpiTargets));
  for (const s of SOURCES) {
    b.add(
      db.insert(schema.sources).values(s).onConflictDoUpdate({
        target: schema.sources.id,
        set: {
          name: s.name,
          kind: s.kind,
          channelGroup: s.channelGroup ?? null,
          acquisition: s.acquisition ?? null,
          owner: s.owner ?? null,
          active: 1,
          revenueAuthority: s.revenueAuthority ?? 0,
          configJson: s.configJson ?? null,
        },
      }),
    );
  }
  for (const c of CHANNELS) {
    b.add(
      db.insert(schema.channels).values(c).onConflictDoUpdate({
        target: schema.channels.id,
        set: { name: c.name, pulseGroup: c.pulseGroup, sortOrder: c.sortOrder ?? 0 },
      }),
    );
  }
  b.insertAll(schema.kpiTargets, KPI_TARGETS);
}

const fileNameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Pull windows: one per calendar month of the mock data (connectors take at
 * most 62 days), clipped to the data range. Month-aligned, so a monthly file
 * is pulled exactly once.
 */
function pullWindows(): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const [start, end] of [[PY_START, PY_END], [START_DATE, END_DATE]] as const) {
    for (let from: string = start; from <= end; ) {
      const [y, m] = from.split("-").map(Number) as [number, number];
      const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const to = monthEnd < end ? monthEnd : end;
      out.push({ from, to });
      from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    }
  }
  return out;
}

/** Upload time of a pulled file: the mock upload time of its fixture, else from the date in its name. */
function uploadTimes(fixtures: SeedFixture[]) {
  const byName = new Map(fixtures.map((f) => [fileNameOf(f.path), f.uploadedAt]));
  return (_sourceId: string, fileName: string): string => {
    const known = byName.get(fileName.replace(/^pull_/, ""));
    if (known) return known;
    const day = /(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1];
    if (day) return dailyUpload(day, 3);
    const month = /(\d{4}-\d{2})(?!-?\d)/.exec(fileName)?.[1];
    return month ? monthlyUpload(month, 3) : SEED_NOW;
  };
}

/** Steps 2-3 on `db` (the target in direct mode, the scratch copy in staged mode). */
async function ingestAll(db: Db, fixtures: SeedFixture[], log: (l: string) => void) {
  const results: PulledFileResult[] = [];
  const problems: string[] = [];
  const uploadedAt = uploadTimes(fixtures);
  // Mock connectors read exactly this fixture set (no inbox, samples or generated data).
  const restore = useMockFixtures(fixtures);
  try {
    for (const w of pullWindows()) {
      const summary = await pullAndIngest({ from: w.from, to: w.to, mock: true, db, uploadedAt });
      for (const c of summary.connectors) {
        if (c.error) problems.push(`${c.sourceId} ${w.from}..${w.to}: ${c.error}`);
        for (const f of c.files) {
          results.push(f);
          if (f.status === "error" || f.status === "failed" || f.error) {
            problems.push(`${c.sourceId}/${f.fileName}: ${f.status}${f.code ? ` [${f.code}]` : ""}${f.error ? `: ${f.error}` : ""}`);
          }
        }
      }
      log(`  pulled ${w.from}..${w.to}: ${summary.totals.files} files`);
    }
  } finally {
    restore();
  }

  // The baseline is clean: every file that is due must be there. Run the
  // completeness check (read-only; no deliberate missing_source exception)
  // for every finished day and every month, and report any gap as a problem.
  for (const day of dateRange(START_DATE, END_DATE).filter((d) => d < END_DATE)) {
    const c = await checkCompleteness({ businessDate: day }, { db });
    for (const s of c.missingSources) problems.push(`completeness: no ${s.id} file for ${day}`);
  }
  for (const period of [...new Set([...dateRange(PY_START, PY_END), ...dateRange(START_DATE, END_DATE)].map((d) => d.slice(0, 7)))]) {
    const c = await checkCompleteness({ period }, { db });
    for (const s of c.missingSources) problems.push(`completeness: ${s.id} missing for ${period}${s.missingDates ? ` (${s.missingDates.join(", ")})` : ""}`);
  }
  const open = await db.$client.execute("select kind, count(*) as n from exceptions where status = 'open' group by kind");
  for (const r of open.rows) problems.push(`baseline has ${Number(r.n)} open ${String(r.kind)} exception(s)`);

  return { results, problems };
}

/**
 * An empty scratch SQLite DB (temp file; /tmp is writable on Vercel) with the
 * target's schema (DDL read from the target). Not ":memory:": the libSQL
 * client reopens its connection after a transaction, which would lose an
 * in-memory database.
 */
async function stagingDb(target: Db): Promise<{ db: Db; cleanup: () => Promise<void> }> {
  const { createClient } = await import("@libsql/client");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "seed-staging-"));
  const client = createClient({ url: `file:${join(dir, "staging.db").replace(/\\/g, "/")}` });
  const ddl = await target.$client.execute(
    "select sql from sqlite_master where sql is not null and name not like 'sqlite_%' and name not like '_litestream%' and name not like 'libsql_%' order by case type when 'table' then 0 else 1 end, rowid",
  );
  if (ddl.rows.length === 0) throw new Error("Target database has no tables. Run `npm run db:push` first.");
  // Scratch data: no journal, no fsync (several times faster; nothing to recover).
  await client.execute("PRAGMA journal_mode = OFF");
  await client.execute("PRAGMA synchronous = OFF");
  await client.batch(ddl.rows.map((r) => String(r.sql)), "write");
  const db = drizzle(client, { schema }) as Db;
  return {
    db,
    cleanup: async () => {
      client.close();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

const FACT_TABLES = [
  ["ingest_runs", schema.ingestRuns],
  ["items", schema.items],
  ["labor_hours", schema.laborHours],
  ["orders", schema.orders],
  ["money_lines", schema.moneyLines],
  ["exceptions", schema.exceptions],
  ["marketplace_metrics", schema.marketplaceMetrics],
] as const;

export async function runSeed(db: Db, opts: SeedOptions): Promise<SeedResult> {
  const t0 = Date.now();
  const mode = opts.mode ?? "direct";
  const log = opts.log ?? (() => {});
  const fixtures = opts.fixtures;
  let copyRoundTrips: number | undefined;
  let ingestMs: number;
  let res: Awaited<ReturnType<typeof ingestAll>>;

  if (mode === "direct") {
    const b = new StatementBatch(db);
    resetStatements(db, b);
    await b.commit(db.$client);
    const t1 = Date.now();
    res = await withCachedDateTimeFormat(() => ingestAll(db, fixtures, log));
    ingestMs = Date.now() - t1;
  } else {
    const staging = await stagingDb(db);
    const mem = staging.db;
    try {
      const seedConfig = new StatementBatch(mem);
      resetStatements(mem, seedConfig);
      await seedConfig.commit(mem.$client);
      const t1 = Date.now();
      res = await withCachedDateTimeFormat(() => ingestAll(mem, fixtures, log));
      ingestMs = Date.now() - t1;
      // Copy the pipeline's output to the target in one transaction.
      const b = new StatementBatch(db);
      resetStatements(db, b);
      for (const [, table] of FACT_TABLES) {
        const rows = await mem.select().from(table);
        b.insertAll(table, rows);
      }
      copyRoundTrips = await b.commit(db.$client);
    } finally {
      await staging.cleanup();
    }
  }

  // Summary from the target.
  const counts: Record<string, number> = { sources: SOURCES.length, channels: CHANNELS.length, kpi_targets: KPI_TARGETS.length };
  for (const [name] of FACT_TABLES) {
    const r = await db.$client.execute(`select count(*) as n from ${name}`);
    counts[name] = Number(r.rows[0]?.n ?? 0);
  }
  const exc = await db.$client.execute("select kind, count(*) as n from exceptions where close_id is null group by kind order by kind");
  const exceptionsByKind = Object.fromEntries(exc.rows.map((r) => [String(r.kind), Number(r.n)]));
  const byStatus: Record<string, number> = {};
  for (const s of res.results) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  if (res.problems.length) byStatus.error = res.problems.length;

  return {
    mode,
    counts,
    files: { total: res.results.length, byStatus },
    viaIngest: {
      orders: res.results.reduce((t, s) => t + s.ordersInserted, 0),
      moneyLines: res.results.reduce((t, s) => t + s.moneyLinesInserted, 0),
      items: res.results.reduce((t, s) => t + s.itemsInserted, 0),
      laborHours: res.results.reduce((t, s) => t + s.laborHoursInserted, 0),
      marketplaceMetrics: res.results.reduce((t, s) => t + s.marketplaceMetricsInserted, 0),
    },
    ordersReplaced: res.results.reduce((t, s) => t + s.ordersReplaced, 0),
    duplicateOrders: res.results.reduce((t, s) => t + s.duplicates, 0),
    exceptionsByKind,
    problems: res.problems,
    ...(copyRoundTrips !== undefined ? { copyRoundTrips } : {}),
    ms: Date.now() - t0,
    ingestMs,
  };
}
