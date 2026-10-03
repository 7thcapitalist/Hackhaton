/**
 * Seed core, used by `npm run seed` (scripts/seed.ts) and `POST /api/demo/reset`.
 *
 * The demo data travels the same path real data does:
 *
 *   mock export file (data/fixtures/**, real platform layout)
 *     → ingestFile() (auto-detect parser → parse → clean → write)  [src/ingest]
 *
 * Steps:
 * 1. Wipe facts (ingest_runs, orders, money_lines, items, labor_hours,
 *    exceptions without a close), upsert config (sources, channels) and
 *    kpi_targets. Close tables are untouched.
 * 2. Ingest every fixture in upload order through ingestFile(), letting the
 *    parser be auto-detected; a file read by any other parser than its folder's
 *    is an error. Runs are then flagged is_synthetic = 1.
 * 3. Run the nightly missing-source check for the Amazon gap day.
 * 4. Insert the data that has no source file yet: items, labor_hours.
 *
 * Two modes, same rows:
 * - "direct": ingest straight into the target DB (one ingestFile per file:
 *   ~4 round trips each). Fine for a local file DB.
 * - "staged": ingest into a scratch SQLite file with the same schema, then copy the
 *   resulting rows to the target in ONE write transaction (a few large round
 *   trips). Used for remote Turso (demo reset over HTTP).
 */
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Client, InArgs, InStatement } from "@libsql/client";
import type { Db } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { checkCompleteness, ingestFile, IngestError, type IngestSummary } from "../../src/ingest";
import { buildModel, MISSING_AMAZON_DATE } from "../mock/model";
import { CHANNELS, KPI_TARGETS, SOURCES } from "./config";
import { withCachedDateTimeFormat } from "./intl-cache";
import { syntheticOps } from "./synthetic";

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

/** Steps 2-4 on `db` (the target in direct mode, the scratch copy in staged mode). */
async function ingestAll(db: Db, fixtures: SeedFixture[], log: (l: string) => void) {
  const summaries: IngestSummary[] = [];
  const problems: string[] = [];
  let n = 0;
  for (const f of fixtures) {
    n++;
    const fileName = fileNameOf(f.path);
    try {
      const s = await ingestFile({ buffer: f.bytes, fileName, uploadedAt: f.uploadedAt, db });
      summaries.push(s);
      if (s.sourceId !== f.sourceId) problems.push(`${f.path}: read by the ${s.sourceId} parser, expected ${f.sourceId}`);
      if (s.status === "failed") problems.push(`${f.path}: failed: ${s.error}`);
    } catch (err) {
      const msg = err instanceof IngestError ? `[${err.code}] ${err.message}` : err instanceof Error ? err.message : String(err);
      problems.push(`${f.path}: ${msg}`);
    }
    if (n % 50 === 0) log(`  ingested ${n}/${fixtures.length} files`);
  }

  // Fixture runs are demo data: the UI shows a "simulated" badge.
  const runIds = [...new Set(summaries.filter((s) => s.status !== "duplicate" && s.status !== "failed").map((s) => s.ingestRunId))];
  for (let i = 0; i < runIds.length; i += 500) {
    await db.update(schema.ingestRuns).set({ isSynthetic: 1 }).where(inArray(schema.ingestRuns.id, runIds.slice(i, i + 500)));
  }

  // The nightly missing-source check for the deliberate Amazon gap.
  const check = await checkCompleteness({ businessDate: MISSING_AMAZON_DATE }, { writeExceptions: true, db });
  if (!check.missingSources.some((s) => s.id === "amazon")) {
    // checkCompleteness counts a daily run as covering its whole month (the
    // parser also sets `period` on daily files), so it misses a one-day gap.
    // Record the exception the nightly check should have raised.
    await db.insert(schema.exceptions).values({
      id: `exc-missing-amazon-${MISSING_AMAZON_DATE}`,
      sourceId: "amazon",
      kind: "missing_source",
      message: `No Amazon file ingested for business date ${MISSING_AMAZON_DATE}.`,
      owner: "E-commerce manager",
      createdAt: "2026-10-03T11:05:00.000Z",
    });
  }

  const ops = syntheticOps(buildModel());
  const b = new StatementBatch(db);
  b.insertAll(schema.items, ops.items);
  b.insertAll(schema.laborHours, ops.laborHours);
  await b.commit(db.$client);

  return { summaries, problems };
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
  for (const s of res.summaries) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  if (res.problems.length) byStatus.error = res.problems.length;

  return {
    mode,
    counts,
    files: { total: fixtures.length, byStatus },
    ordersReplaced: res.summaries.reduce((t, s) => t + s.ordersReplaced, 0),
    duplicateOrders: res.summaries.reduce((t, s) => t + s.duplicates, 0),
    exceptionsByKind,
    problems: res.problems,
    ...(copyRoundTrips !== undefined ? { copyRoundTrips } : {}),
    ms: Date.now() - t0,
    ingestMs,
  };
}
