/**
 * Smoke check for the ops parsers (production_tracking, upright_inventory,
 * timekeeping, marketplace_ratings, bank_1st_source) against
 * src/sources/__samples__/ops/*.csv.
 *
 *   npm run check:parsers-ops
 *
 * For each sample: auto-detect must pick the parser named by the file prefix,
 * and parsing must yield rows with no warnings. Also: no ops parser may accept
 * another source's sample (top-level and other/ samples). Exits 1 on failure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readTable } from "../src/ingest/read";
import { detectParser } from "../src/sources";
import { bank1stSourceParser } from "../src/sources/bank_1st_source";
import { marketplaceRatingsParser } from "../src/sources/marketplace_ratings";
import { productionTrackingParser } from "../src/sources/production_tracking";
import { timekeepingParser } from "../src/sources/timekeeping";
import { uprightInventoryParser } from "../src/sources/upright_inventory";
import { TIMEZONE } from "../src/sources/_shared/table";

const OPS = [productionTrackingParser, uprightInventoryParser, timekeepingParser, marketplaceRatingsParser, bank1stSourceParser];
const ROOT = join(__dirname, "..", "src", "sources", "__samples__");
let failures = 0;
const fail = (m: string) => {
  failures++;
  console.error(`FAIL ${m}`);
};

async function main() {
  for (const name of readdirSync(join(ROOT, "ops")).filter((n) => n.endsWith(".csv")).sort()) {
    const expected = OPS.find((p) => name.startsWith(`${p.sourceId}_`));
    const table = await readTable(readFileSync(join(ROOT, "ops", name)), name);
    const got = detectParser(table, name);
    if (!expected || got?.sourceId !== expected.sourceId) {
      fail(`${name}: detected ${got?.sourceId ?? "nothing"}, expected ${expected?.sourceId ?? "?"}`);
      continue;
    }
    const r = got.parse(table, { fileName: name, timezone: TIMEZONE });
    const n = (r.items?.length ?? 0) + (r.laborHours?.length ?? 0) + (r.marketplaceMetrics?.length ?? 0) + r.moneyLines.length;
    if (n === 0) fail(`${name}: no rows parsed`);
    if (r.orders.length) fail(`${name}: ops parser emitted orders`);
    if (r.warnings.length) fail(`${name}: warnings: ${r.warnings.map((w) => w.message).join("; ")}`);
    console.log(
      `ok  ${name.padEnd(36)} items ${r.items?.length ?? 0}, labor ${r.laborHours?.length ?? 0}, metrics ${r.marketplaceMetrics?.length ?? 0}, money ${r.moneyLines.length}, period ${r.period ?? "-"}`,
    );
  }
  for (const dir of [ROOT, join(ROOT, "other")]) {
    for (const name of readdirSync(dir).filter((n) => /\.(csv|txt|tsv)$/i.test(n))) {
      const table = await readTable(readFileSync(join(dir, name)), name);
      for (const p of OPS) if (p.accepts(table, name)) fail(`${p.sourceId} accepts foreign sample ${name}`);
    }
  }
  if (failures) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nOK: ops parsers detect, parse and stay isolated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
