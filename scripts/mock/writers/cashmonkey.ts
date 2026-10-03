/**
 * Cash Monkey (PeriScope) "Orders Report", one file per closed month:
 * data/fixtures/cashmonkey/cashmonkey_YYYY-MM.csv
 *
 * Layout (guess, see docs/sources/cashmonkey.md): header on row 1, ONE ROW
 * PER ITEM (book) with the marketplace it sold on and its ISBN, rows of the
 * same order share the Order ID, a "Total" footer. LF line endings, plain
 * money "8.99", dates "09/01/2026" (a late order carries a time).
 * Each model "lot" is one order whose items are its rows; credits are item
 * rows with Qty -1; statuses Completed / Paid / Shipped / Cancelled /
 * Refunded / Credit. Marketplaces are book sites (AbeBooks, Biblio, Alibris,
 * ThriftBooks) so they roll into "other".
 *
 * Messy case: the first item of each month is titled "Total Recall …"; it is
 * a book, not a footer, and must be kept.
 */
import { csvRow, dec, lines, usDay, usDayTime } from "../format";
import type { CashMonkeyOrder, MockModel } from "../model";
import { MONTHLY_PERIODS, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = [
  "Order Date", "Marketplace", "Order ID", "SKU", "ISBN", "Title", "Condition", "Qty", "Price", "Shipping", "Tax",
  "Marketplace Fee", "Net", "Status",
];
const MARKETS = ["AbeBooks", "Biblio", "Alibris", "ThriftBooks"];
const TITLES = [
  "The Odyssey", "Field Guide to Birds", "Joy of Cooking", "Atlas of the World", "Collected Poems", "A Brief History of Time",
  "Pride and Prejudice", "The Great Gatsby", "Moby-Dick", "Organic Chemistry 8e", "Gardening Basics", "Lonely Planet USA",
];
const CONDITIONS = ["Good", "Very Good", "Acceptable", "Like New"];

const num = (id: string) => Number(id.replace(/\D/g, "")) || 0;

function itemRows(o: CashMonkeyOrder, firstOfMonth: boolean): string[] {
  const n = Math.abs(o.itemCount);
  const sign = o.itemCount < 0 ? -1 : 1;
  const unit = Math.round(Math.abs(o.grossCents) / n);
  const feeAbs = Math.abs(o.feeCents);
  const base = num(o.orderId);
  const market = MARKETS[base % MARKETS.length]!;
  const date = o.withTime ? usDayTime(o.ts) : usDay(o.date);
  const rows: string[] = [];
  for (let k = 0; k < n; k++) {
    const fee = Math.floor(feeAbs / n) + (k < feeAbs % n ? 1 : 0);
    const isbn = `978${String((base * 131 + k * 7919) % 10_000_000_000).padStart(10, "0")}`;
    const title = firstOfMonth && k === 0 ? "Total Recall (paperback)" : TITLES[(base + k) % TITLES.length]!;
    const net = sign * (unit - fee);
    rows.push(
      csvRow([
        date, market, o.orderId, `CM-B-${base}-${String(k + 1).padStart(3, "0")}`, isbn, title, CONDITIONS[(base + k) % 4],
        String(sign), dec(unit), "0.00", "0.00", dec(sign * fee), dec(net), o.status,
      ]),
    );
  }
  return rows;
}

export function writeCashmonkey(model: MockModel): FixtureFile[] {
  return MONTHLY_PERIODS.map((period) => {
    const orders = model.cashMonkey.filter((c) => c.date.startsWith(period));
    const gross = orders.reduce((t, c) => t + c.grossCents, 0);
    const fees = orders.reduce((t, c) => t + c.feeCents, 0);
    const body = [
      csvRow(HEADER),
      ...orders.flatMap((c, i) => itemRows(c, i === 0)),
      csvRow(["Total", "", "", "", "", "", "", String(orders.reduce((t, c) => t + c.itemCount, 0)), dec(gross), "0.00", "0.00", dec(fees), dec(gross - fees), ""]),
    ];
    return {
      sourceId: "cashmonkey",
      path: `cashmonkey/cashmonkey_${period}.csv`,
      content: lines(body, "\n"),
      uploadedAt: monthlyUpload(period, 0),
      ...(period === "2026-09" ? { note: "per-item rows; a book titled \"Total Recall\" must not be read as the footer" } : {}),
    };
  });
}
