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
 *    Upright: the /reports/order_items JSON and the Paid Order Items CSV
 *    (2026-09) yield the SAME dedupe keys and, per order, the same gross,
 *    shipping, fee, refund, tax, net and status (order-level money is counted
 *    once per order in the JSON). Amazon: the Finances listTransactions JSON
 *    and the Date Range Transaction CSV (2026-10-01) yield the SAME orders
 *    (keys + amounts) and the same money lines.
 * 3. Isolation: no CSV parser accepts a JSON document and no JSON parser
 *    accepts any CSV sample.
 * 4. Mock connectors (amazon, ebay, easypost, upright) for 2026-10-01..03:
 *    every file is detected as its connector's source and parses with no
 *    warnings.
 *
 * upright_api / amazon_api are added to the JSON pool here even before they
 * are registered in src/sources/index.ts (a no-op once they are).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readTable } from "../src/ingest/read";
import { detectParser as registryDetect, getParser, jsonParsers as registeredJson, parsers } from "../src/sources";
import { isJsonTable } from "../src/sources/_shared/json";
import { amazonApiParser } from "../src/sources/amazon_api";
import { uprightApiParser } from "../src/sources/upright_api";
import { businessDateOf } from "../src/sources/_shared/table";
import type { ParsedMoneyLine, ParsedOrder, ParseResult } from "../src/sources/types";
import { amazonConnector } from "../src/connectors/amazon";
import { ebayConnector } from "../src/connectors/ebay";
import { easypostConnector } from "../src/connectors/easypost";
import { uprightConnector } from "../src/connectors/upright";
import type { RawTable, SourceParser } from "../src/sources/types";

const jsonParsers: SourceParser[] = [
  ...registeredJson,
  ...[uprightApiParser, amazonApiParser].filter(
    (p) => !registeredJson.some((r) => r.sourceId === p.sourceId && r.version === p.version),
  ),
];
function detectParser(table: RawTable, fileName: string): SourceParser | undefined {
  if (!isJsonTable(table)) return registryDetect(table, fileName);
  return jsonParsers.find((p) => {
    try {
      return p.accepts(table, fileName);
    } catch {
      return false;
    }
  });
}

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
  const expectOf = (f: string) =>
    f.startsWith("ebay_api") ? "ebay"
    : f.startsWith("easypost_api") ? "shipping_osm_pb_easypost"
    : f.startsWith("upright_api") ? "upright"
    : f.startsWith("amazon_api") ? "amazon"
    : undefined;
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

  // 2c. Upright twins (per item: keys, gross, ts; per order: order-level money)
  const upJson = parsed.get("upright_api_order_items_2026-09.json");
  const upCsv = await parseFile(join(SAMPLES, "upright_2026-09.csv"), "upright_2026-09.csv", "upright");
  if (!upJson || !upCsv) fail("Upright twin samples missing");
  else {
    const csvByKey = new Map(upCsv.orders.map((o) => [key(o), o]));
    const jsonKeys = upJson.orders.map(key);
    const same = jsonKeys.filter((k) => csvByKey.has(k));
    console.log(`\n== Upright JSON vs CSV (2026-09): ${same.length}/${jsonKeys.length} JSON keys found in the CSV (${upCsv.orders.length} CSV rows)`);
    if (same.length !== jsonKeys.length || jsonKeys.length !== upCsv.orders.length) fail("Upright JSON and CSV dedupe keys differ");
    for (const j of upJson.orders) {
      const c = csvByKey.get(key(j));
      if (!c) continue;
      for (const f of ["orderTs", "businessDate", "grossCents", "quantity", "buyerId", "channel"] as const) {
        if (j[f] !== c[f]) fail(`Upright twin ${key(j)}: ${f} JSON=${j[f]} CSV=${c[f]}`);
      }
    }
    const perOrder = (os: ParsedOrder[]) => {
      const groups = new Map<string, ParsedOrder[]>();
      for (const o of os) {
        const k = `${o.channel}:${o.externalOrderId}`;
        groups.set(k, [...(groups.get(k) ?? []), o]);
      }
      const out = new Map<string, string>();
      for (const [k, xs] of groups) {
        const t = (f: "grossCents" | "shippingCents" | "feeCents" | "refundCents" | "taxCents" | "netCents") =>
          xs.reduce((a, o) => a + (o[f] ?? 0), 0);
        const st = xs.some((o) => o.status === "cancelled") ? "cancelled" : xs.some((o) => o.status === "refunded") ? "refunded" : "paid";
        out.set(k, `gross ${t("grossCents")} ship ${t("shippingCents")} fee ${t("feeCents")} refund ${t("refundCents")} tax ${t("taxCents")} net ${t("netCents")} ${st}`);
      }
      return out;
    };
    const pj = perOrder(upJson.orders);
    const pc = perOrder(upCsv.orders);
    let diff = 0;
    for (const [k, v] of pj) {
      if (pc.get(k) !== v) {
        diff++;
        fail(`Upright twin order ${k}: JSON ${v} | CSV ${pc.get(k)}`);
      }
    }
    const net = (os: ParsedOrder[]) => os.reduce((a, o) => a + (o.netCents ?? 0), 0);
    console.log(`   ${pj.size} orders, ${diff} with different order-level money; Σ net JSON ${usd(net(upJson.orders))} CSV ${usd(net(upCsv.orders))}`);
    const ex = upJson.orders[0];
    const cx = csvByKey.get(key(ex));
    console.log(`   example: JSON channel_order_id=${ex.externalOrderId} channel_item_id=${ex.externalItemId} → dedupe_key ${key(ex)}`);
    if (cx) console.log(`            CSV  Channel Order ID=${cx.externalOrderId} Channel Item ID=${cx.externalItemId} → dedupe_key ${key(cx)}`);
    const multi = [...pj.keys()].find((k) => upJson.orders.filter((o) => `${o.channel}:${o.externalOrderId}` === k).length > 1);
    if (multi) console.log(`   multi-item order ${multi}: order-level money counted once (${pj.get(multi)})`);
  }

  // 2d. Amazon twins (orders by key + money lines)
  const azJson = parsed.get("amazon_api_transactions_2026-10-01.json");
  const azCsv = await parseFile(join(SAMPLES, "amazon_2026-10-01.csv"), "amazon_2026-10-01.csv", "amazon");
  if (!azJson || !azCsv) fail("Amazon twin samples missing");
  else {
    const csvByKey = new Map(azCsv.orders.map((o) => [key(o), o]));
    const jsonKeys = azJson.orders.map(key);
    const same = jsonKeys.filter((k) => csvByKey.has(k));
    console.log(`\n== Amazon Finances JSON vs Transaction CSV (2026-10-01): ${same.length}/${jsonKeys.length} JSON keys found in the CSV (${azCsv.orders.length} CSV orders)`);
    if (same.length !== jsonKeys.length || jsonKeys.length !== azCsv.orders.length) fail("Amazon JSON and CSV dedupe keys differ");
    for (const j of azJson.orders) {
      const c = csvByKey.get(key(j));
      if (!c) continue;
      for (const f of ["orderTs", "businessDate", "grossCents", "shippingCents", "taxCents", "feeCents", "refundCents", "netCents", "status", "quantity"] as const) {
        if (j[f] !== c[f]) fail(`Amazon twin ${key(j)}: ${f} JSON=${j[f]} CSV=${c[f]}`);
      }
    }
    const sig = (m: ParsedMoneyLine) => [m.lineDate, m.amountType, m.amountCents, m.reference, m.settlementId, m.memo].join("|");
    const a = azJson.moneyLines.map(sig).sort();
    const b = azCsv.moneyLines.map(sig).sort();
    const equal = a.length === b.length && a.every((x, i) => x === b[i]);
    console.log(`   money lines: JSON ${a.length}, CSV ${b.length}; identical: ${equal}; warnings JSON ${azJson.warnings.length} CSV ${azCsv.warnings.length}`);
    if (!equal) {
      fail("Amazon JSON and CSV money lines differ");
      console.log("   only JSON:", a.filter((x) => !b.includes(x)));
      console.log("   only CSV: ", b.filter((x) => !a.includes(x)));
    }
    if (azJson.warnings.length !== azCsv.warnings.length) fail("Amazon JSON and CSV warning counts differ");
    const net = (os: ParsedOrder[]) => os.reduce((t, o) => t + (o.netCents ?? 0), 0);
    const tax = (os: ParsedOrder[]) => os.reduce((t, o) => t + (o.taxCents ?? 0), 0);
    console.log(`   Σ net JSON ${usd(net(azJson.orders))} CSV ${usd(net(azCsv.orders))}; Σ tax (never revenue) JSON ${usd(tax(azJson.orders))} CSV ${usd(tax(azCsv.orders))}`);
    const refunded = azJson.orders.find((o) => o.status === "refunded");
    if (refunded) console.log(`   refunded: ${key(refunded)} refund ${usd(refunded.refundCents ?? 0)} (CSV ${usd(csvByKey.get(key(refunded))?.refundCents ?? 0)})`);
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
  for (const c of [amazonConnector, ebayConnector, easypostConnector, uprightConnector]) {
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
      // A daily EasyPost payment log can hold only label service_fee rows, which the
      // parser leaves to the shipment pages (counted once): no money lines is fine there.
      const labelOnlyPaylog = /pay.?log/i.test(f.fileName) && t.length > 1;
      if (!res.orders.length && !res.moneyLines.length && !labelOnlyPaylog) fail(`${f.fileName}: no rows`);
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
