/**
 * Seed core, importable by both `npm run seed` (scripts/seed.ts) and
 * `POST /api/demo/reset`.
 *
 * - Upserts config: the 9 sources, 5 channels, kpi_targets.
 * - Wipes and reinserts the fact tables it owns: ingest_runs, orders,
 *   money_lines, items, labor_hours, exceptions without a close (idempotent).
 * - Leaves close tables (closes, journal_lines, ar_*, workbook_baseline,
 *   gl_rules) untouched.
 *
 * Speed: ~25k rows. Statements are built with Drizzle, then sent through ONE
 * libSQL write transaction in a handful of batches (each batch = one round
 * trip), so it is atomic and fast over Turso's HTTP API too.
 */
import { sql } from "drizzle-orm";
import type { InArgs, InStatement } from "@libsql/client";
import type { Db } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { CHANNELS, KPI_TARGETS, SOURCES } from "./config";
import { generate } from "./generate";

/** Rows per INSERT statement. */
const ROWS_PER_INSERT = 400;
/** Bound parameters per round trip (keeps each HTTP request a few MB). */
const PARAMS_PER_BATCH = 40_000;

export interface SeedResult {
  counts: Record<string, number>;
  ms: number;
}

interface ToSql {
  toSQL(): { sql: string; params: unknown[] };
}

export async function runSeed(db: Db): Promise<SeedResult> {
  const t0 = Date.now();
  const data = generate();
  const stmts: InStatement[] = [];
  const add = (q: ToSql) => {
    const { sql: text, params } = q.toSQL();
    stmts.push({ sql: text, args: params as InArgs });
  };

  // Wipe facts (children first).
  add(db.delete(schema.exceptions).where(sql`close_id is null`));
  add(db.delete(schema.moneyLines));
  add(db.delete(schema.orders));
  add(db.delete(schema.items));
  add(db.delete(schema.laborHours));
  add(db.delete(schema.ingestRuns));
  add(db.delete(schema.kpiTargets));

  // Upsert config (other tables, e.g. gl_rules, may reference sources).
  for (const s of SOURCES) {
    add(
      db
        .insert(schema.sources)
        .values(s)
        .onConflictDoUpdate({
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
    add(
      db
        .insert(schema.channels)
        .values(c)
        .onConflictDoUpdate({
          target: schema.channels.id,
          set: { name: c.name, pulseGroup: c.pulseGroup, sortOrder: c.sortOrder ?? 0 },
        }),
    );
  }

  const insertAll = <T>(table: Parameters<typeof db.insert>[0], rows: T[]) => {
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      add(db.insert(table).values(rows.slice(i, i + ROWS_PER_INSERT) as any));
    }
  };
  insertAll(schema.kpiTargets, KPI_TARGETS);
  insertAll(schema.ingestRuns, data.ingestRuns);
  insertAll(schema.items, data.items);
  insertAll(schema.laborHours, data.laborHours);
  insertAll(schema.orders, data.orders);
  insertAll(schema.moneyLines, data.moneyLines);
  insertAll(schema.exceptions, data.exceptions);

  // Group statements into round trips by parameter budget.
  const groups: InStatement[][] = [];
  let cur: InStatement[] = [];
  let params = 0;
  for (const s of stmts) {
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

  const tx = await db.$client.transaction("write");
  try {
    for (const g of groups) await tx.batch(g);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  } finally {
    tx.close();
  }

  return {
    counts: {
      sources: SOURCES.length,
      channels: CHANNELS.length,
      kpi_targets: KPI_TARGETS.length,
      ingest_runs: data.ingestRuns.length,
      orders: data.orders.length,
      money_lines: data.moneyLines.length,
      items: data.items.length,
      labor_hours: data.laborHours.length,
      exceptions: data.exceptions.length,
    },
    ms: Date.now() - t0,
  };
}
