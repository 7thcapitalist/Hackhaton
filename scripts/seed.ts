/**
 * Demo seed through the real pipeline. Run: npm run seed [-- --direct | --staged] [--no-golden] [--archive]
 *
 * Wipes the facts, upserts config + KPI targets, then pulls every mock export
 * in data/fixtures through the mock connectors (pullAndIngest, mock mode) into
 * ingestFile(), exactly like a real pull. Nothing but config and KPI targets
 * is inserted directly. Close tables are untouched. See scripts/seed/run.ts.
 *
 * Mode: by default the ingest runs in a scratch SQLite file and is copied to
 * the target in one transaction ("staged"); --direct ingests into the target.
 * Uses TURSO_DATABASE_URL (default file:local.db). Run `npm run db:push` and
 * `npm run mock:generate` (or use the committed fixtures) first.
 *
 * Ends by saving the golden snapshot (src/lib/demo/golden.ts) that
 * `npm run demo:reset` and POST /api/demo/reset restore from in one batch.
 * --no-golden skips it (an existing snapshot is left as it was).
 * --archive copies every fixture into the raw-file archive (Vercel Blob or
 * data/archive/); by default runs only point at the versioned fixture path.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  // Import after dotenv so the client sees the env vars.
  const { getDb } = await import("../src/db/client");
  const { resolveDbConfig, redactSecrets } = await import("../src/db/env");
  const { runSeed } = await import("./seed/run");
  const { fixturesFromDisk } = await import("./seed/fixtures");
  const { saveGolden } = await import("../src/lib/demo/golden");

  const { isLocalFile } = resolveDbConfig();
  const argv = process.argv.slice(2);
  // Staged is faster even for a local file (scratch DB without journal); --direct writes straight to the target.
  const mode = argv.includes("--direct") ? "direct" : "staged";
  const fixtures = await fixturesFromDisk();
  console.log(`Database: ${isLocalFile ? "local file" : "remote Turso"} · mode ${mode} · ${fixtures.length} fixture files`);

  let r;
  try {
    r = await runSeed(getDb(), { fixtures, mode, log: (l) => console.log(l), archive: argv.includes("--archive") });
  } catch (err) {
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    throw new Error(redactSecrets(root instanceof Error ? root.message : String(root)));
  }

  console.log(`\nFiles ingested: ${r.files.total} (${Object.entries(r.files.byStatus).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  for (const [name, n] of Object.entries(r.counts)) console.log(`  ${name.padEnd(14)} ${n}`);
  const v = r.viaIngest;
  console.log(
    `Loaded via ingest runs: orders ${v.orders}, money_lines ${v.moneyLines}, items ${v.items} (merged by id), labor_hours ${v.laborHours}, marketplace_metrics ${v.marketplaceMetrics}`,
  );
  console.log(`Duplicate orders: ${r.duplicateOrders} dropped, ${r.ordersReplaced} replaced by Upright`);
  console.log(`Exceptions: ${Object.entries(r.exceptionsByKind).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  if (r.copyRoundTrips !== undefined) console.log(`Copy to target: ${r.copyRoundTrips} round trips`);
  console.log(`Seeded in ${(r.ms / 1000).toFixed(1)}s (ingest ${(r.ingestMs / 1000).toFixed(1)}s). All rows synthetic.`);
  if (r.problems.length) {
    console.error(`\n${r.problems.length} problem(s):`);
    for (const p of r.problems) console.error(`  ${p}`);
    process.exit(1);
  }
  if (argv.includes("--no-golden")) {
    console.log("Golden snapshot: skipped (--no-golden).");
  } else {
    const t = Date.now();
    const g = await saveGolden(getDb().$client);
    const rows = Object.values(g.counts).reduce((a, b) => a + b, 0);
    console.log(
      `Golden snapshot saved in ${Date.now() - t} ms (${rows} rows, ${Object.keys(g.counts).length} tables). Reset with \`npm run demo:reset\`.`,
    );
  }
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
