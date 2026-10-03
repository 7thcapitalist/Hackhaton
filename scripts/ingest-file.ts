/**
 * Ingest one or more files from disk into the database (same path as the
 * upload route).
 *
 *   npm run ingest -- <path> [more paths] [--source amazon] [--period 2026-09]
 *   npm run ingest -- --check 2026-09        # missing sources for a period
 *   npm run ingest -- --check 2026-10-02     # missing sources/channels for a day
 *
 * Uses TURSO_DATABASE_URL from .env.local / .env (default file:local.db).
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function parseArgs(argv: string[]) {
  const paths: string[] = [];
  let source: string | undefined;
  let period: string | undefined;
  let check: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source" || a === "-s") source = argv[++i];
    else if (a === "--period" || a === "-p") period = argv[++i];
    else if (a === "--check") check = argv[++i];
    else if (a.startsWith("--source=")) source = a.slice(9);
    else if (a.startsWith("--period=")) period = a.slice(9);
    else if (a.startsWith("--check=")) check = a.slice(8);
    else paths.push(a);
  }
  return { paths, source, period, check };
}

async function main() {
  const { paths, source, period, check } = parseArgs(process.argv.slice(2));
  // Import after dotenv so the DB client sees the env vars.
  const { ingestFile, checkCompleteness, IngestError } = await import("../src/ingest");

  if (check) {
    const scope = check.length === 7 ? { period: check } : { businessDate: check };
    console.log(JSON.stringify(await checkCompleteness(scope, { writeExceptions: true }), null, 2));
    return;
  }
  if (paths.length === 0) {
    console.error("Usage: npm run ingest -- <path> [--source <id>] [--period YYYY-MM]");
    process.exit(2);
  }

  let failed = false;
  for (const path of paths) {
    try {
      const buffer = await readFile(path);
      const summary = await ingestFile({ buffer, fileName: basename(path), sourceId: source, period });
      console.log(JSON.stringify(summary, null, 2));
      if (summary.status === "failed") failed = true;
    } catch (err) {
      failed = true;
      if (err instanceof IngestError) console.error(`${basename(path)}: [${err.code}] ${err.message}`);
      else console.error(`${basename(path)}:`, err instanceof Error ? err.message : err);
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("Ingest failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
