/**
 * Pull data from the connectors and ingest it (same code as POST /api/connectors/pull).
 *
 *   npm run pull -- --from 2026-10-01 --to 2026-10-03 [--mock] [--source ebay] [--source amazon]
 *   npm run pull -- --status            # connector status table
 *   npm run pull -- --dry --mock --from 2026-10-01 --source ebay --out tmp/   # save files, no ingest
 *
 * Without --mock, API connectors run only if their credentials are set
 * (.env.local), and email/manual connectors read data/inbox/<source_id>/.
 * Uses TURSO_DATABASE_URL from .env.local / .env (default file:local.db).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function parseArgs(argv: string[]) {
  const sources: string[] = [];
  let from: string | undefined;
  let to: string | undefined;
  let mock = false;
  let status = false;
  let dry = false;
  let out: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const val = () => v ?? argv[++i];
    if (k === "--from") from = val();
    else if (k === "--to") to = val();
    else if (k === "--source" || k === "-s") sources.push(...val().split(","));
    else if (k === "--mock") mock = true;
    else if (k === "--status") status = true;
    else if (k === "--dry") dry = true;
    else if (k === "--out") out = val();
    else if (k === "--json") json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return { sources, from, to: to ?? from, mock, status, dry, out, json };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { pullAndIngest, getConnectorStatus, getConnector, connectors } = await import("../src/connectors");

  if (args.status) {
    const rows = await getConnectorStatus();
    if (args.json) return console.log(JSON.stringify(rows, null, 2));
    for (const r of rows) {
      console.log(
        `${r.sourceId.padEnd(26)} ${r.mode.padEnd(10)} configured=${String(r.configured).padEnd(5)} real=${r.realPull.padEnd(22)} last pull=${r.lastPull?.at ?? "-"}`,
      );
    }
    return;
  }
  if (!args.from) {
    console.error("Usage: npm run pull -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--mock] [--source <id>]");
    process.exit(2);
  }

  if (args.dry) {
    const list = args.sources.length ? args.sources.map((s) => getConnector(s)!).filter(Boolean) : connectors;
    for (const c of list) {
      const files = await c.pull({ from: args.from, to: args.to!, mock: args.mock });
      for (const f of files) {
        if (args.out) {
          await mkdir(args.out, { recursive: true });
          await writeFile(join(args.out, f.fileName), f.bytes);
        }
        console.log(`${c.sourceId}: ${f.fileName} (${f.bytes.length} bytes)`);
      }
    }
    return;
  }

  const summary = await pullAndIngest({
    from: args.from,
    to: args.to!,
    mock: args.mock,
    sourceIds: args.sources.length ? args.sources : undefined,
  });
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Pull ${summary.from}..${summary.to} (${summary.mock ? "mock" : "real"})`);
    for (const c of summary.connectors) {
      console.log(`\n${c.sourceId} [${c.mode}] ${c.outcome === "skipped_no_credentials" ? `skipped: ${c.reason}` : `${c.used}: ${c.summary}`}`);
      for (const f of c.files) {
        console.log(
          `  ${f.status.padEnd(20)} ${f.fileName}  orders+${f.ordersInserted} lines+${f.moneyLinesInserted} dup ${f.duplicates} warn ${f.warnings}${f.error ? `  ${f.error}` : ""}`,
        );
      }
    }
    const t = summary.totals;
    console.log(
      `\nTotals: ${t.files} files, ${t.ordersInserted} orders, ${t.moneyLinesInserted} money lines, ${t.duplicates} duplicates, ${t.failedFiles} failed files, ${t.connectorErrors} connector errors`,
    );
  }
  if (!summary.ok) process.exit(1);
}

main().catch((err) => {
  console.error("Pull failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
