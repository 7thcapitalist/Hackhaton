/**
 * Smoke check for the "other" parsers (cashmonkey, jewelry, shipping, fedex,
 * goodwill_books) against src/sources/__samples__/other/*.csv.
 *
 *   npm run check:parsers-other
 *
 * For each sample: exactly one of the 5 parsers must accept it, and it must be
 * the one named by the file prefix. Then parse and print a summary. Also checks
 * that none of the 5 claims an Amazon / eBay / ShopGoodwill / Upright header.
 * Exits non-zero on any failure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawTable, SourceParser } from "../src/sources/types";
import { cashmonkeyParser } from "../src/sources/cashmonkey";
import { jewelryParser } from "../src/sources/jewelry";
import { shippingOsmPbEasypostParser } from "../src/sources/shipping_osm_pb_easypost";
import { fedexParser } from "../src/sources/fedex";
import { goodwillBooksParser } from "../src/sources/goodwill_books";

const PARSERS: SourceParser[] = [
  cashmonkeyParser,
  jewelryParser,
  shippingOsmPbEasypostParser,
  fedexParser,
  goodwillBooksParser,
];

const SAMPLES = join(__dirname, "..", "src", "sources", "__samples__", "other");

/** Quote-aware CSV → RawTable (trimmed cells; keeps blank lines as [""]). */
function readCsv(text: string): RawTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field.trim()); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field.trim()); rows.push(row); }
  return rows;
}

const money = (c: number) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toFixed(2);

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL: ${msg}`); };

const ids = PARSERS.map((p) => p.sourceId).sort((a, b) => b.length - a.length);
const files = readdirSync(SAMPLES).filter((f) => f.endsWith(".csv")).sort();
if (files.length === 0) fail(`no samples in ${SAMPLES}`);

for (const file of files) {
  console.log(`\n== ${file}`);
  const table = readCsv(readFileSync(join(SAMPLES, file), "utf8"));
  const expected = ids.find((id) => file.startsWith(id + "_"));
  const accepted = PARSERS.filter((p) => p.accepts(table, file));
  console.log(`  accepted by: ${accepted.map((p) => p.sourceId).join(", ") || "(none)"}`);
  if (accepted.length !== 1) { fail(`expected exactly one parser to accept, got ${accepted.length}`); continue; }
  const parser = accepted[0];
  if (expected && parser.sourceId !== expected) fail(`expected ${expected}, got ${parser.sourceId}`);

  let res;
  try {
    res = parser.parse(table, { fileName: file, timezone: "America/Indiana/Indianapolis" });
  } catch (e) {
    fail(`parse threw: ${(e as Error).message}`);
    continue;
  }
  console.log(`  parser: ${parser.sourceId}@${parser.version}  header row: ${res.headerRowIndex}  period: ${res.period ?? "-"}`);
  console.log(`  header: ${res.header.join(" | ")}`);
  if (res.headerRowIndex < 0) fail("header not found");

  if (res.orders.length > 0) {
    const sum = (k: "grossCents" | "refundCents" | "feeCents" | "netCents") => res.orders.reduce((a, o) => a + (o[k] ?? 0), 0);
    const byStatus: Record<string, number> = {};
    for (const o of res.orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    console.log(`  orders: ${res.orders.length} ${JSON.stringify(byStatus)}  gross ${money(sum("grossCents"))}  refund ${money(sum("refundCents"))}  fee ${money(sum("feeCents"))}  net ${money(sum("netCents"))}`);
    for (const o of res.orders) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.businessDate)) fail(`row ${o.sourceRow}: bad businessDate ${o.businessDate}`);
      if (isNaN(Date.parse(o.orderTs))) fail(`row ${o.sourceRow}: bad orderTs ${o.orderTs}`);
    }
  } else console.log("  orders: 0");

  if (res.moneyLines.length > 0) {
    const byType = new Map<string, { n: number; cents: number }>();
    for (const l of res.moneyLines) {
      const t = byType.get(l.amountType) ?? { n: 0, cents: 0 };
      t.n++;
      t.cents += l.amountCents;
      byType.set(l.amountType, t);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(l.lineDate)) fail(`row ${l.sourceRow}: bad lineDate ${l.lineDate}`);
      if (!/^\d{4}-\d{2}$/.test(l.period)) fail(`row ${l.sourceRow}: bad period ${l.period}`);
    }
    console.log(`  money lines: ${res.moneyLines.length}`);
    for (const [t, v] of byType) console.log(`    ${t.padEnd(18)} ${String(v.n).padStart(3)}  ${money(v.cents)}`);
    const banked = res.moneyLines.filter((l) => l.bankAccountNo).length;
    if (banked) console.log(`    (bank account set on ${banked} line(s))`);
  } else console.log("  money lines: 0");

  if (res.orders.length + res.moneyLines.length === 0) fail("no rows parsed");
  console.log(`  warnings: ${res.warnings.length}`);
  for (const w of res.warnings) console.log(`    - ${w.row ? `row ${w.row}: ` : ""}${w.message}`);
}

// Headers of the sources owned by the other parsers (docs/research.md §2):
// none of the 5 parsers here may claim them.
const FOREIGN: Record<string, RawTable> = {
  "amazon-date-range.csv": [
    ["Includes Amazon Marketplace, Fulfillment by Amazon (FBA), and Amazon Webstore transactions"],
    ["date/time", "settlement id", "type", "order id", "sku", "description", "quantity", "marketplace", "fulfillment", "product sales", "selling fees", "fba fees", "other", "total"],
    ["Sep 1, 2026 10:00:00 AM PDT", "111", "Order", "111-0000000-0000000", "SKU1", "Book", "1", "amazon.com", "Seller", "10.00", "-1.50", "0", "0", "8.50"],
  ],
  "ebay-orders.csv": [
    ["Sales Record Number", "Order Number", "Buyer Username", "Item Number", "Item Title", "Quantity", "Sold For", "Shipping And Handling", "eBay Collected Tax", "Total Price", "Sale Date", "Paid On Date"],
    ["1", "01-00000-00000", "buyer1", "100000000000", "Lamp", "1", "$20.00", "$5.00", "$1.40", "$26.40", "Sep-01-26", "Sep-01-26"],
  ],
  "ebay-transactions.csv": [
    ["Transaction creation date", "Type", "Order number", "Legacy order ID", "Buyer username", "Net amount", "Item subtotal", "Shipping and handling", "Final Value Fee - fixed", "Payout ID", "Payout date"],
    ["2026-09-01", "Order", "01-00000-00000", "1-1", "buyer1", "20.00", "20.00", "5.00", "-0.40", "P1", "2026-09-03"],
  ],
  "shopgoodwill-period.csv": [
    ["Item ID", "Title", "Category", "End Date", "Winning Bid", "Shipping", "Handling", "Seller Fee", "Net", "Buyer ID", "Status", "Period"],
    ["1", "Vase", "Home", "09/01/2026", "$12.00", "$8.00", "$3.00", "$1.20", "$21.80", "B1", "Paid", "Period 1"],
  ],
  "upright-paid-order-items.csv": [
    ["Channel", "Channel Item ID", "Channel Order ID", "Title", "Upright Product ID", "Quantity", "Category", "Price", "Shipping", "Fees", "Ordered At", "Paid At"],
    ["eBay", "100000000000", "01-00000-00000", "Lamp", "U1", "1", "Home", "20.00", "5.00", "2.60", "2026-09-01 10:00", "2026-09-01 10:05"],
  ],
};
console.log("\n== foreign headers (must not be accepted)");
for (const [name, table] of Object.entries(FOREIGN)) {
  const claimed = PARSERS.filter((p) => p.accepts(table, name)).map((p) => p.sourceId);
  console.log(`  ${name.padEnd(30)} ${claimed.length ? `claimed by ${claimed.join(", ")}` : "ok (none)"}`);
  if (claimed.length) fail(`${name} claimed by ${claimed.join(", ")}`);
}

console.log(failures ? `\n${failures} failure(s)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
