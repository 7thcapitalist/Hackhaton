/**
 * GoodwillBooks.com seller payment statement (monthly email attachment), one
 * file per closed month: data/fixtures/goodwill_books/goodwill_books_YYYY-MM.csv
 *
 * Layout = src/sources/__samples__/other/goodwill_books_2026-09.csv: title,
 * seller, "Statement Period: MM/DD/YYYY - MM/DD/YYYY", "Payment Date", an
 * empty line, the header, one row per order line (a return is a second row
 * with a negative price and the commission given back), then the footer
 * "Total Sales", "Total Commission", "Adjustments", "Net Payment".
 *
 * The lines are the same Goodwill Books orders Upright lists (same order
 * numbers), so the statement and the Upright file agree to the cent.
 */
import { addDays } from "../../../src/lib/views/dates";
import { csvRow, lines, usDay, usd } from "../format";
import type { MockModel } from "../model";
import { MONTHLY_PERIODS, lastDayOf, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = ["Order #", "Order Date", "SKU", "ISBN", "Title", "Qty", "Item Price", "Commission"];
const W = HEADER.length;
const pad = (cells: string[]) => [...cells, ...Array(W - cells.length).fill("")];

export function writeGoodwillBooks(model: MockModel): FixtureFile[] {
  return MONTHLY_PERIODS.map((period) => {
    const orders = model.orders
      .filter((o) => o.stream === "goodwill_books" && o.businessDate.startsWith(period))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime() || a.seq - b.seq);
    const rows: { date: string; seq: number; cells: string[] }[] = [];
    let sales = 0;
    let commission = 0;
    for (const o of orders) {
      const isbn = o.itemId.replace(/^GB-/, "");
      const date = o.businessDate;
      rows.push({ date, seq: o.seq, cells: [o.orderId, usDay(date), o.sku, isbn, o.title, String(o.quantity), usd(o.grossCents), usd(o.origFeeCents)] });
      sales += o.grossCents;
      commission += o.origFeeCents;
      if (o.status === "refunded") {
        // Return: price back to the buyer, commission back to Goodwill.
        rows.push({ date, seq: o.seq, cells: [o.orderId, usDay(date), o.sku, isbn, `${o.title} (return)`, String(o.quantity), usd(-o.grossCents), usd(o.origFeeCents)] });
        sales -= o.grossCents;
        commission -= o.origFeeCents;
      }
    }
    const adjustment = model.gbAdjustments[period] ?? 0;
    const body = [
      csvRow(pad(["GoodwillBooks.com Seller Payment Statement"])),
      csvRow(pad(["Seller: GOODWILL-MICHIANA-TEST"])),
      csvRow(pad([`Statement Period: ${usDay(`${period}-01`)} - ${usDay(lastDayOf(period))}`])),
      csvRow(pad([`Payment Date: ${usDay(addDays(lastDayOf(period), 2))}`])),
      csvRow(pad([])),
      csvRow(HEADER),
      ...rows.map((r) => csvRow(r.cells)),
      csvRow(pad([])),
      csvRow(pad(["Total Sales", "", "", "", "", "", usd(sales)])),
      csvRow(pad(["Total Commission", "", "", "", "", "", "", usd(commission)])),
      csvRow(pad(["Adjustments", "", "", "", "", "", "", usd(adjustment)])),
      csvRow(pad(["Net Payment", "", "", "", "", "", "", usd(sales - commission + adjustment)])),
    ];
    return {
      sourceId: "goodwill_books",
      path: `goodwill_books/goodwill_books_${period}.csv`,
      content: lines(body, "\n"),
      uploadedAt: monthlyUpload(period, 10),
    };
  });
}
