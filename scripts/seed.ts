/**
 * Deterministic synthetic seed. Run: npm run seed
 *
 * - Upserts config: the 9 sources, 5 channels, kpi_targets.
 * - Wipes and reinserts the fact tables it owns: ingest_runs, orders,
 *   money_lines, items, labor_hours, exceptions (idempotent).
 * - Leaves close tables (closes, journal_lines, ar_*, workbook_baseline,
 *   gl_rules) untouched.
 *
 * Uses TURSO_DATABASE_URL (default file:local.db). Run `npm run db:push` first.
 * All data is synthetic; see scripts/seed/generate.ts for the messy cases.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const CHUNK = 400;

async function main() {
  // Import after dotenv so the client sees the env vars.
  const { sql } = await import("drizzle-orm");
  const { getDb, schema } = await import("../src/db/client");
  const { resolveDbConfig, redactSecrets } = await import("../src/db/env");
  const { CHANNELS, KPI_TARGETS, SOURCES } = await import("./seed/config");
  const { generate } = await import("./seed/generate");

  const { isLocalFile } = resolveDbConfig();
  console.log(`Database: ${isLocalFile ? "local file" : "remote Turso"}`);

  const t0 = Date.now();
  const data = generate();
  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      // Wipe facts (children first).
      await tx.delete(schema.exceptions).where(sql`close_id is null`);
      await tx.delete(schema.moneyLines);
      await tx.delete(schema.orders);
      await tx.delete(schema.items);
      await tx.delete(schema.laborHours);
      await tx.delete(schema.ingestRuns);
      await tx.delete(schema.kpiTargets);

      // Upsert config (other tables, e.g. gl_rules, may reference sources).
      for (const s of SOURCES) {
        await tx
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
          });
      }
      for (const c of CHANNELS) {
        await tx
          .insert(schema.channels)
          .values(c)
          .onConflictDoUpdate({
            target: schema.channels.id,
            set: { name: c.name, pulseGroup: c.pulseGroup, sortOrder: c.sortOrder ?? 0 },
          });
      }

      const insertAll = async <T extends Record<string, unknown>>(
        table: Parameters<typeof tx.insert>[0],
        rows: T[],
      ) => {
        for (let i = 0; i < rows.length; i += CHUNK) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await tx.insert(table).values(rows.slice(i, i + CHUNK) as any);
        }
      };

      await insertAll(schema.kpiTargets, KPI_TARGETS);
      await insertAll(schema.ingestRuns, data.ingestRuns);
      await insertAll(schema.items, data.items);
      await insertAll(schema.laborHours, data.laborHours);
      await insertAll(schema.orders, data.orders);
      await insertAll(schema.moneyLines, data.moneyLines);
      await insertAll(schema.exceptions, data.exceptions);
    });
  } catch (err) {
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    throw new Error(redactSecrets(root instanceof Error ? root.message : String(root)));
  }

  const counts: [string, number][] = [
    ["sources", SOURCES.length],
    ["channels", CHANNELS.length],
    ["kpi_targets", KPI_TARGETS.length],
    ["ingest_runs", data.ingestRuns.length],
    ["orders", data.orders.length],
    ["money_lines", data.moneyLines.length],
    ["items", data.items.length],
    ["labor_hours", data.laborHours.length],
    ["exceptions", data.exceptions.length],
  ];
  for (const [name, n] of counts) console.log(`${name.padEnd(14)} ${n}`);
  console.log(`Seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s (all rows synthetic).`);
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
