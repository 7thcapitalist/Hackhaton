/**
 * Golden snapshot of the demo data, kept INSIDE the same database.
 *
 * `npm run seed` loads the demo once (slow: ~1000 mock files through ingest),
 * then saveGolden() copies every fact table to a `golden_<table>` twin with
 * server-side `CREATE TABLE … AS SELECT *`. A demo reset (restoreGolden, used
 * by `npm run demo:reset` and `POST /api/demo/reset`) then rewrites the live
 * tables from those twins in ONE write batch. Only SQL text crosses the wire,
 * never rows, so a reset on Turso takes one round trip for the metadata and
 * one for the write.
 *
 * Covered: the facts the seed writes (ingest_runs, items, orders, money_lines,
 * labor_hours, marketplace_metrics, exceptions), kpi_targets, and the close
 * tables (closes, journal_lines, ar_invoices, ar_invoice_lines), so a close
 * made during a demo is undone too. Because closes are restored, ALL
 * exceptions are snapshotted (close-linked ones included). Config tables
 * (sources, channels, gl_rules, workbook_baseline) are not touched.
 *
 * The golden_* tables are not in the Drizzle schema; drizzle.config.ts
 * excludes them with `tablesFilter` so `drizzle-kit push` never drops them.
 */
import type { Client, InStatement } from "@libsql/client";

/** Parent-first (insert) order. Restore deletes in the reverse order. */
export const GOLDEN_TABLES = [
  "kpi_targets",
  "ingest_runs",
  "items",
  "orders",
  "money_lines",
  "labor_hours",
  "marketplace_metrics",
  "closes",
  "journal_lines",
  "ar_invoices",
  "ar_invoice_lines",
  "exceptions",
] as const;

const META = "golden_meta";
const golden = (t: string) => `golden_${t}`;
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export interface GoldenInfo {
  createdAt: string;
  counts: Record<string, number>;
}

async function existingTables(client: Client): Promise<Set<string>> {
  const r = await client.execute("select name from sqlite_master where type = 'table'");
  return new Set(r.rows.map((row) => String(row.name)));
}

/** Snapshot the live tables into golden_* (one write batch, server side). */
export async function saveGolden(client: Client): Promise<GoldenInfo> {
  const have = await existingTables(client);
  const tables = GOLDEN_TABLES.filter((t) => have.has(t));
  const createdAt = new Date().toISOString();
  const stmts: InStatement[] = [];
  for (const t of tables) {
    stmts.push(`drop table if exists ${q(golden(t))}`);
    stmts.push(`create table ${q(golden(t))} as select * from ${q(t)}`);
  }
  // Drop twins of tables that no longer exist, so restore never sees stale ones.
  for (const t of GOLDEN_TABLES) if (!have.has(t)) stmts.push(`drop table if exists ${q(golden(t))}`);
  stmts.push(`drop table if exists ${META}`);
  stmts.push(`create table ${META} (id integer primary key check (id = 1), created_at text not null, counts_json text not null)`);
  // Counts computed server side in the same transaction.
  const countsExpr = tables.length
    ? `json_object(${tables.map((t) => `'${t}', (select count(*) from ${q(golden(t))})`).join(", ")})`
    : "json_object()";
  stmts.push({ sql: `insert into ${META} (id, created_at, counts_json) select 1, ?, ${countsExpr}`, args: [createdAt] });
  await client.batch(stmts, "write");
  const info = await goldenInfo(client);
  if (!info) throw new Error("Golden snapshot was not recorded");
  return info;
}

/** The snapshot's metadata, or null when there is none. */
export async function goldenInfo(client: Client): Promise<GoldenInfo | null> {
  const have = await existingTables(client);
  if (!have.has(META)) return null;
  const r = await client.execute(`select created_at, counts_json from ${META} where id = 1`);
  const row = r.rows[0];
  if (!row) return null;
  return { createdAt: String(row.created_at), counts: JSON.parse(String(row.counts_json)) as Record<string, number> };
}

export async function hasGolden(client: Client): Promise<boolean> {
  return (await goldenInfo(client)) !== null;
}

export interface RestoreResult {
  createdAt: string;
  counts: Record<string, number>;
  /** Tables restored, in insert order. */
  tables: string[];
  ms: number;
}

/**
 * Replace the live tables with the golden snapshot in ONE write batch:
 * delete children first, then insert parents first. Columns are listed
 * explicitly (live ∩ golden), so it survives a column added by a later
 * db:push, and the order is FK-safe whether PRAGMA foreign_keys is on or off
 * (it is switched off around the batch only for speed, see below).
 */
export async function restoreGolden(client: Client): Promise<RestoreResult> {
  const t0 = Date.now();
  const info = await goldenInfo(client);
  if (!info) throw new NoGoldenError();
  const tables = GOLDEN_TABLES.filter((t) => t in info.counts);

  // One metadata read: columns of every live table and its golden twin.
  const names = tables.flatMap((t) => [t, golden(t)]);
  const cols = await client.execute({
    sql: `select m.name as t, p.name as c from sqlite_master m join pragma_table_info(m.name) p
          where m.type = 'table' and m.name in (${names.map(() => "?").join(", ")}) order by m.name, p.cid`,
    args: names,
  });
  const colsOf = new Map<string, string[]>();
  for (const r of cols.rows) {
    const t = String(r.t);
    if (!colsOf.has(t)) colsOf.set(t, []);
    colsOf.get(t)!.push(String(r.c));
  }

  const stmts: InStatement[] = [];
  for (const t of [...tables].reverse()) stmts.push(`delete from ${q(t)}`);
  for (const t of tables) {
    const live = colsOf.get(t);
    const snap = new Set(colsOf.get(golden(t)) ?? []);
    if (!live || snap.size === 0) throw new Error(`Golden snapshot is missing table ${t}; run \`npm run seed\` again`);
    const shared = live.filter((c) => snap.has(c)).map(q).join(", ");
    stmts.push(`insert into ${q(t)} (${shared}) select ${shared} from ${q(golden(t))}`);
  }
  // migrate() = the same single transaction (one HTTP request on Turso), run
  // with foreign_keys off around it. The order above is FK-safe anyway; FK off
  // only lets SQLite use its truncate fast path for `delete from` (with FKs on,
  // deletes go row by row: ~2.1 s vs ~1.3 s for the whole restore of the
  // 75k-row demo set on a local file).
  await client.migrate(stmts);

  const counted = await client.execute(
    `select ${tables.map((t, i) => `(select count(*) from ${q(t)}) as c${i}`).join(", ")}`,
  );
  const counts: Record<string, number> = {};
  tables.forEach((t, i) => (counts[t] = Number(counted.rows[0]?.[`c${i}`] ?? 0)));
  return { createdAt: info.createdAt, counts, tables, ms: Date.now() - t0 };
}

export class NoGoldenError extends Error {
  constructor() {
    super("No golden snapshot in this database. Run `npm run seed` once (it saves the snapshot), then reset.");
    this.name = "NoGoldenError";
  }
}
