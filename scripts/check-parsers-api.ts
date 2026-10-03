/**
 * Check for the JSON API parsers (src/sources/ebay_api.ts, easypost_api.ts)
 * and the connector mocks. No DB, no network.
 *
 *   npm run check:parsers-api
 *
 * 1. Every JSON sample in src/sources/__samples__/api/ is read through
 *    src/ingest/read.ts and auto-detected by the registry; it must go to the
 *    right JSON parser and parse cleanly (UTC timestamps, Indianapolis
 *    business dates, net = gross + shipping − refund − fee).
 * 2. Twins: the eBay getOrders JSON and the eBay Orders CSV for 2026-10-01
 *    must yield the SAME dedupe keys and amounts; the EasyPost shipments JSON
 *    and the EasyPost Shipment CSV must yield the SAME money lines.
 * 3. Isolation: no CSV parser accepts a JSON document and no JSON parser
 *    accepts any CSV sample.
 * 4. Mock connectors (amazon, ebay, easypost) for 2026-10-01..03: every file
 *    is detected as its connector's source and parses with no warnings.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readTable } from "../src/ingest/read";
import { detectParser, getParser, jsonParsers, parsers } from "../src/sources";
import { businessDateOf } from "../src/sources/_shared/table";
import type { ParsedMoneyLine, ParsedOrder, ParseResult } from "../src/sources/types";
import { amazonConnector } from "../src/connectors/amazon";
import { ebayConnector } from "../src/connectors/ebay";
import { easypostConnector } from "../src/connectors/easypost";

const TZ = "America/Indiana/Indianapolis" as const;
const SAMPLES = join(__dirname, "..", "src", "sources", "__samples__");
const failures: string[] = [];
const fail = (m: string) => failures.push(m);
const key = (o: ParsedOrder) => `${o.channel}:${o.externalOrderId}:${o.externalItemId ?? ""}`;

async function parseFile(path: string, fileName: string, expectSource?: string): Promise<ParseResult | null> {
  const table = await readTable(readFileSync(path), fileName);
  const parser = detectParser(table, fileName);
  if (!parser) {
    fail(`${fileName}: no parser accepts it`);
    return null;
  }
  if (expectSource && parser.sourceId !== expectSource) fail(`${fileName}: detected ${parser.sourceId}, expected ${expectSource}`);
  return parser.parse(table, { fileName, timezone: TZ });
}

function checkOrders(file: string, res: ParseResult) {
  for (const o of res.orders) {
    if (!o.orderTs.endsWith("Z") || businessDateOf(new Date(o.orderTs)) !== o.businessDate) {
      fail(`${file}: ${key(o)} business date ${o.businessDate} does not match ${o.orderTs}`);
    }
    const net = (o.grossCents ?? 0) + (o.shippingCents ?? 0) - (o.refundCents ?? 0) - (o.feeCents ?? 0);
    if (o.netCents !== net) fail(`${file}: ${key(o)} net ${o.netCents} != ${net}`);
  }
  for (const m of res.moneyLines) if (m.period !== m.lineDate.slice(0, 7)) fail(`${file}: money line period mismatch`);
}

const usd = (c: number) => (c / 100).toFixed(2);

async function main() {
  // 1. JSON samples
  const apiDir = join(SAMPLES, "api");
  const expectOf = (f: string) => (f.startsWith("ebay_api") ? "ebay" : f.startsWith("easypost_api") ? "shipping_osm_pb_easypost" : undefined);
  const parsed = new Map<string, ParseResult>();
  for (const f of readdirSync(apiDir).filter((n) => n.endsWith(".json")).sort()) {
    const res = await parseFile(join(apiDir, f), f, expectOf(f));
    if (!res) continue;
    parsed.set(f, res);
    console.log(`== api/${f}: ${res.orders.length} orders, ${res.moneyLines.length} money lines, ${res.warnings.length} warnings, period ${res.period ?? "-"}, businessDate ${res.businessDate ?? "-"}`);
    for (const w of res.warnings) console.log(`   - ${w.row ? `row ${w.row}: ` : ""}${w.message}`);
    checkOrders(f, res);
  }

  // 2a. eBay twins
  const ebayJson = parsed.get("ebay_api_orders_2026-10-01.json");
  const ebayCsv = await parseFile(join(SAMPLES, "ebay_2026-10-01.csv"), "ebay_2026-10-01.csv", "ebay");
  if (!ebayJson || !ebayCsv) fail("eBay twin samples missing");
  else {
    const csvByKey = new Map(ebayCsv.orders.map((o) => [key(o), o]));
    const jsonKeys = ebayJson.orders.map(key);
    const same = jsonKeys.filter((k) => csvByKey.has(k));
    console.log(`\n== eBay JSON vs CSV (2026-10-01): ${same.length}/${jsonKeys.length} JSON keys found in the CSV (${ebayCsv.orders.length} CSV rows)`);
    if (same.length !== jsonKeys.length || jsonKeys.length !== ebayCsv.orders.length) fail("eBay JSON and CSV dedupe keys differ");
    for (const j of ebayJson.orders) {
      const c = csvByKey.get(key(j));
      if (!c) continue;
      for (const f of ["orderTs", "businessDate", "grossCents", "shippingCents", "taxCents", "refundCents", "status", "quantity", "buyerId"] as const) {
        if (j[f] !== c[f]) fail(`eBay twin ${key(j)}: ${f} JSON=${j[f]} CSV=${c[f]}`);
      }
    }
    const ex = ebayJson.orders[0];
    const cx = csvByKey.get(key(ex))!;
    console.log(`   example: JSON orderId=${ex.externalOrderId} legacyItemId=${ex.externalItemId} → dedupe_key ${key(ex)}`);
    console.log(`            CSV  Order Number=${cx.externalOrderId} Item Number=${cx.externalItemId} → dedupe_key ${key(cx)}`);
    console.log(`            gross ${usd(ex.grossCents ?? 0)}/${usd(cx.grossCents ?? 0)} ship ${usd(ex.shippingCents ?? 0)}/${usd(cx.shippingCents ?? 0)} tax ${usd(ex.taxCents ?? 0)}/${usd(cx.taxCents ?? 0)} ts ${ex.orderTs}/${cx.orderTs}`);
    const refunded = ebayJson.orders.find((o) => o.status === "refunded");
    if (refunded) console.log(`   refunded: ${key(refunded)} refund ${usd(refunded.refundCents ?? 0)} (CSV ${usd(csvByKey.get(key(refunded))?.refundCents ?? 0)})`);
  }

  // 2b. EasyPost twins
  const epJson = parsed.get("easypost_api_shipments_2026-09.json");
  const epCsv = await parseFile(
    join(SAMPLES, "other", "shipping_osm_pb_easypost_2026-09.csv"),
    "shipping_osm_pb_easypost_2026-09.csv",
    "shipping_osm_pb_easypost",
  );
  if (!epJson || !epCsv) fail("EasyPost twin samples missing");
  else {
    const sig = (m: ParsedMoneyLine) => [m.lineDate, m.amountType, m.amountCents, m.reference, m.memo, m.channel].join("|");
    const a = epJson.moneyLines.map(sig).sort();
    const b = epCsv.moneyLines.map(sig).sort();
    const equal = a.length === b.length && a.every((x, i) => x === b[i]);
    console.log(`\n== EasyPost JSON vs CSV (2026-09): JSON ${a.length} money lines, CSV ${b.length}; identical: ${equal}`);
    const sum = (ms: ParsedMoneyLine[]) => ms.reduce((t, m) => t + m.amountCents, 0);
    console.log(`   Σ JSON ${usd(sum(epJson.moneyLines))}  Σ CSV ${usd(sum(epCsv.moneyLines))}; warnings JSON ${epJson.warnings.length} CSV ${epCsv.warnings.length}`);
    if (!equal) {
      fail("EasyPost JSON and CSV money lines differ");
      console.log("   only JSON:", a.filter((x) => !b.includes(x)));
      console.log("   only CSV: ", b.filter((x) => !a.includes(x)));
    }
    if (epJson.warnings.length !== epCsv.warnings.length) fail("EasyPost JSON and CSV warning counts differ");
  }

  // 3. Isolation
  const jsonTables = await Promise.all(
    readdirSync(apiDir).filter((n) => n.endsWith(".json")).map(async (f) => [f, await readTable(readFileSync(join(apiDir, f)), f)] as const),
  );
  for (const [f, t] of jsonTables) {
    for (const p of parsers) if (p.accepts(t, f)) fail(`CSV parser ${p.sourceId} accepts JSON ${f}`);
  }
  const csvFiles = [
    ...readdirSync(SAMPLES).filter((n) => n.endsWith(".csv")),
    ...readdirSync(join(SAMPLES, "other")).filter((n) => n.endsWith(".csv")).map((n) => `other/${n}`),
  ];
  for (const f of csvFiles) {
    const t = await readTable(readFileSync(join(SAMPLES, f)), f);
    for (const p of jsonParsers) if (p.accepts(t, f)) fail(`JSON parser ${p.sourceId} accepts CSV ${f}`);
    // getParser(sourceId) dispatches by content: CSV still goes to the file parser.
    const sid = f.replace(/^other\//, "").startsWith("shipping_osm_pb_easypost") ? "shipping_osm_pb_easypost" : f.split("_")[0];
    const gp = getParser(sid);
    if (gp && !gp.accepts(t, f)) fail(`getParser(${sid}) no longer accepts ${f}`);
  }
  console.log(`\n== Isolation: ${jsonTables.length} JSON docs x ${parsers.length} CSV parsers, ${csvFiles.length} CSV samples x ${jsonParsers.length} JSON parsers`);

  // 4. Mock connectors
  console.log("\n== Mock connectors 2026-10-01..2026-10-03");
  for (const c of [amazonConnector, ebayConnector, easypostConnector]) {
    const files = await c.pull({ from: "2026-10-01", to: "2026-10-03", mock: true });
    const again = await c.pull({ from: "2026-10-01", to: "2026-10-03", mock: true });
    if (files.some((f, i) => !again[i] || !f.bytes.equals(again[i].bytes))) fail(`${c.sourceId}: mock is not deterministic`);
    let orders = 0, lines = 0, warnings = 0;
    for (const f of files) {
      const t = await readTable(f.bytes, f.fileName);
      const p = detectParser(t, f.fileName);
      if (!p || p.sourceId !== c.sourceId) { fail(`${c.sourceId}: ${f.fileName} detected as ${p?.sourceId ?? "nothing"}`); continue; }
      const res = p.parse(t, { fileName: f.fileName, timezone: TZ });
      checkOrders(f.fileName, res);
      orders += res.orders.length;
      lines += res.moneyLines.length;
      warnings += res.warnings.length;
      for (const w of res.warnings) fail(`${f.fileName}: warning ${w.message}`);
      if (!res.orders.length && !res.moneyLines.length) fail(`${f.fileName}: no rows`);
    }
    console.log(`   ${c.sourceId.padEnd(26)} ${files.length} files, ${orders} orders, ${lines} money lines, ${warnings} warnings`);
  }

  if (failures.length) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nOK: JSON parsers, twins, isolation and mocks all passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
