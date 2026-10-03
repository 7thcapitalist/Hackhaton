/**
 * Smoke check for the marketplace parsers against the synthetic samples in
 * src/sources/__samples__. No DB, no network, no new dependencies.
 *
 * Run: npm run check:parsers
 *
 * For every sample: exactly one parser must accept it (and it must be the one
 * named by the file prefix), parsing must not throw, every order must have a
 * valid UTC timestamp whose Indianapolis date is its business_date, net must
 * equal gross + shipping − refund − fee, and dedupe keys must be unique within
 * a file, and each parser must see at least one late-evening order whose UTC
 * date is the next day (time zone handling). Cross-file dedupe collisions (the same marketplace order reported by
 * Upright and by eBay/ShopGoodwill) are listed, and at least one is expected.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { amazonParser } from "../src/sources/amazon";
import { ebayParser } from "../src/sources/ebay";
import { shopgoodwillParser } from "../src/sources/shopgoodwill";
import { uprightParser } from "../src/sources/upright";
import { businessDateOf, periodOf } from "../src/sources/_shared/table";
import type { ParseResult, RawTable, SourceParser } from "../src/sources/types";

const PARSERS: SourceParser[] = [amazonParser, ebayParser, shopgoodwillParser, uprightParser];
const SAMPLES_DIR = join(__dirname, "..", "src", "sources", "__samples__");

/** Minimal RFC 4180 reader: quotes, "" escapes, commas/newlines inside quotes, CRLF. */
function readCsv(text: string): RawTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const dedupeKey = (o: ParseResult["orders"][number]) => `${o.channel}:${o.externalOrderId}:${o.externalItemId ?? ""}`;

const failures: string[] = [];
const keyOwners = new Map<string, string[]>();
/** Per parser: orders whose UTC date is the next day (late-evening Eastern orders). */
const lateBySource = new Map<string, number>();

const files = readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".csv")).sort();
if (!files.length) failures.push(`No samples found in ${SAMPLES_DIR}`);

for (const file of files) {
  const fail = (msg: string) => failures.push(`${file}: ${msg}`);
  const table = readCsv(readFileSync(join(SAMPLES_DIR, file), "utf8"));
  const accepted = PARSERS.filter((p) => p.accepts(table, file));
  console.log(`\n== ${file}`);
  console.log(`   accepted by: ${accepted.map((p) => p.sourceId).join(", ") || "(none)"}`);
  if (accepted.length !== 1) {
    fail(`expected exactly one parser to accept, got ${accepted.length}`);
    continue;
  }
  const parser = accepted[0];
  const expected = file.split("_")[0];
  if (parser.sourceId !== expected) fail(`accepted by ${parser.sourceId}, expected ${expected}`);

  let res: ParseResult;
  try {
    res = parser.parse(table, { fileName: file, timezone: "America/Indiana/Indianapolis" });
  } catch (e) {
    fail(`parse threw: ${(e as Error).stack ?? e}`);
    continue;
  }

  const sum = (k: "grossCents" | "netCents" | "taxCents" | "refundCents") =>
    res.orders.reduce((a, o) => a + (o[k] ?? 0), 0);
  const nextDayUtc = res.orders.filter((o) => o.orderTs.slice(0, 10) !== o.businessDate).length;
  const channels = [...new Set(res.orders.map((o) => o.channel))].join(", ");

  console.log(`   parser:       ${parser.sourceId} v${parser.version}`);
  console.log(`   header row:   ${res.headerRowIndex} (0-based)`);
  console.log(`   period:       ${res.period ?? "-"}   businessDate: ${res.businessDate ?? "-"}   periodLabel: ${res.periodLabel ?? "-"}`);
  console.log(`   orders:       ${res.orders.length}  (channels: ${channels}; refunded: ${res.orders.filter((o) => o.status === "refunded").length}; cancelled: ${res.orders.filter((o) => o.status === "cancelled").length}; UTC date != business date: ${nextDayUtc})`);
  console.log(`   money lines:  ${res.moneyLines.length}${res.moneyLines.length ? `  (${res.moneyLines.map((m) => `${m.amountType} ${usd(m.amountCents)}`).join("; ")})` : ""}`);
  console.log(`   Σgross ${usd(sum("grossCents"))}   Σnet ${usd(sum("netCents"))}   Σtax ${usd(sum("taxCents"))}   Σrefund ${usd(sum("refundCents"))}`);
  console.log(`   warnings:     ${res.warnings.length}`);
  for (const w of res.warnings) console.log(`     - ${w.row ? `row ${w.row}: ` : ""}${w.message}`);

  if (res.headerRowIndex < 0) fail("header not found");
  if (!res.orders.length) fail("no orders parsed");
  lateBySource.set(parser.sourceId, (lateBySource.get(parser.sourceId) ?? 0) + nextDayUtc);

  const seen = new Set<string>();
  for (const o of res.orders) {
    const where = `row ${o.sourceRow}`;
    const ts = new Date(o.orderTs);
    if (isNaN(ts.getTime()) || !o.orderTs.endsWith("Z")) fail(`${where}: orderTs not ISO UTC (${o.orderTs})`);
    else if (businessDateOf(ts) !== o.businessDate) fail(`${where}: businessDate ${o.businessDate} != ${businessDateOf(ts)}`);
    const net = (o.grossCents ?? 0) + (o.shippingCents ?? 0) - (o.refundCents ?? 0) - (o.feeCents ?? 0);
    if (o.netCents !== net) fail(`${where}: netCents ${o.netCents} != ${net}`);
    if (!o.externalOrderId) fail(`${where}: empty externalOrderId`);
    if (o.status === "refunded" && !(o.refundCents && o.refundCents > 0)) fail(`${where}: refunded without refundCents`);
    const key = dedupeKey(o);
    if (seen.has(key)) fail(`${where}: duplicate dedupeKey within file: ${key}`);
    seen.add(key);
    keyOwners.set(key, [...(keyOwners.get(key) ?? []), `${file}#${o.sourceRow}`]);
  }
  for (const m of res.moneyLines) {
    if (periodOf(m.lineDate) !== m.period) fail(`money line row ${m.sourceRow}: period ${m.period} != ${m.lineDate}`);
  }
}

for (const p of PARSERS) {
  if (!lateBySource.get(p.sourceId)) failures.push(`${p.sourceId}: expected at least one late-evening order whose UTC date is the next day`);
}

const collisions = [...keyOwners].filter(([, owners]) => new Set(owners.map((o) => o.split("#")[0])).size > 1);
console.log(`\n== Cross-file dedupeKey collisions: ${collisions.length}`);
for (const [key, owners] of collisions) console.log(`   ${key}  <-  ${owners.join(", ")}`);
if (!collisions.length) failures.push("expected at least one cross-file dedupeKey collision (Upright vs marketplace)");

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nOK: ${files.length} samples, all checks passed.`);
