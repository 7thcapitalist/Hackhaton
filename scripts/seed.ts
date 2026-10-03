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
 * The core lives in scripts/seed/run.ts (also used by POST /api/demo/reset).
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  // Import after dotenv so the client sees the env vars.
  const { getDb } = await import("../src/db/client");
  const { resolveDbConfig, redactSecrets } = await import("../src/db/env");
  const { runSeed } = await import("./seed/run");

  const { isLocalFile } = resolveDbConfig();
  console.log(`Database: ${isLocalFile ? "local file" : "remote Turso"}`);

  let result;
  try {
    result = await runSeed(getDb());
  } catch (err) {
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    throw new Error(redactSecrets(root instanceof Error ? root.message : String(root)));
  }

  for (const [name, n] of Object.entries(result.counts)) console.log(`${name.padEnd(14)} ${n}`);
  console.log(`Seeded in ${(result.ms / 1000).toFixed(1)}s (all rows synthetic).`);
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
