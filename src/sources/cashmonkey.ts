/**
 * Cash Monkey: "Orders · full month" (slide 38: "Submit/download CSV; save as Excel").
 *
 * What it is
 *   Probably CashMonkey Solutions (https://cashmonkeysolutions.com/), an "AI
 *   platform for recommerce" that started as a bulk bookseller. [guess]
 *   It is unclear whether Cash Monkey is a SALES CHANNEL (Goodwill lists items
 *   and Cash Monkey sells them) or a BULK BUYER (Goodwill sells lots to Cash
 *   Monkey). Either way the money is e-commerce revenue for the close, so we
 *   emit one order per row with channel "other" and NO buyer id. [decision]
 *
 * Assumed layout [guess, no public sample; docs/research.md §2]
 *   Optional preamble lines, then a header row:
 *     Order ID, Order Date, Item Count, Gross, Fees, Net, Status
 *   Accepted aliases are listed in COLS below, so a renamed column still
 *   resolves. Footer "Total" rows and blank lines are skipped.
 *
 * Money [guess]
 *   Gross = what Cash Monkey paid / sold for, Fees = their commission (shown
 *   positive or negative; we store the magnitude), Net = Gross - Fees.
 *   A negative Gross, or Status "Refunded"/"Returned", is a refund/credit.
 *   Status "Cancelled"/"Rejected" → status cancelled with zero amounts.
 *   Dates without a zone are read as America/Indiana/Indianapolis wall time.
 *
 * Open questions for Goodwill
 *   1. Is Cash Monkey a marketplace we list on, or a buyer of bulk lots?
 *   2. Real column names? Is there one row per order or per item (ISBN/SKU)?
 *   3. Are fees deducted before payment (Net = deposit), and how is it paid
 *      (ACH to 1st Source 0101? check?)
 *   4. Which GL accounts / department does the allocation workbook use for it?
 */
import type { ParseContext, ParseResult, ParsedOrder, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import { cell, choosePeriod, dominantPeriod, findHeaderRowAny, headerSet, isTotalRow, parseDate, preambleMatches, toInt } from "./_other";

const COLS = {
  orderId: ["Order ID", "Order Id", "Order #", "Order Number", "Order No", "PO Number", "Quote ID"],
  date: ["Order Date", "Date", "Created", "Created At", "Order Created", "Paid Date", "Completed Date"],
  itemCount: ["Item Count", "Items", "Qty", "Quantity", "Units", "# Items"],
  gross: ["Gross", "Gross Amount", "Order Total", "Total", "Subtotal", "Amount", "Offer Amount"],
  fees: ["Fees", "Fee", "Commission", "Service Fee", "Processing Fee"],
  net: ["Net", "Net Amount", "Payout", "Net Payout", "Amount Paid"],
  status: ["Status", "Order Status", "State"],
};

const REQUIRED_SETS = COLS.orderId.flatMap((o) => COLS.date.slice(0, 3).map((d) => [o, d]));

/** Columns that mean another source's file (Amazon/eBay/ShopGoodwill/Upright/jewelry/books). */
const FOREIGN = ["settlement id", "sales record number", "channel", "channel order id", "supplier", "isbn", "winning bid", "buyer username", "tracking id"];

function locateHeader(table: RawTable): number {
  return findHeaderRowAny(table, REQUIRED_SETS);
}

export const cashmonkeyParser: SourceParser = {
  sourceId: "cashmonkey",
  version: "0.1.0",

  accepts(table: RawTable, fileName: string): boolean {
    const h = locateHeader(table);
    if (h < 0) return false;
    const cells = headerSet(table[h]);
    if (FOREIGN.some((f) => cells.has(f))) return false;
    if (preambleMatches(table.slice(0, h), /goodwill\s*books|jewel/i)) return false;
    if (/cash[\s_-]*monkey/i.test(fileName)) return true;
    // Without a file-name hint, require the distinctive Item Count + Net pair.
    const idx = columnIndex(table[h], COLS);
    return idx.itemCount >= 0 && idx.net >= 0 && idx.gross >= 0;
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const headerRowIndex = locateHeader(table);
    const result: ParseResult = { orders: [], moneyLines: [], warnings: [], headerRowIndex, header: [] };
    if (headerRowIndex < 0) {
      result.warnings.push({ message: "Cash Monkey: header row not found (need Order ID + Order Date)." });
      return result;
    }
    const header = table[headerRowIndex];
    result.header = header.map(normalizeHeader);
    const c = columnIndex(header, COLS);
    for (const k of ["gross", "net"] as const) {
      if (c[k] < 0) result.warnings.push({ message: `Cash Monkey: column "${COLS[k][0]}" not found; amounts may be incomplete.` });
    }
    result.warnings.push({
      message: "Cash Monkey: layout is a guess and it is unclear whether Cash Monkey is a sales channel or a bulk buyer; orders emitted with channel \"other\".",
    });

    const dates: string[] = [];
    for (let i = headerRowIndex + 1; i < table.length; i++) {
      const row = table[i];
      const rowNo = i + 1;
      if (isBlankRow(row) || isTotalRow(row)) continue;
      const orderId = cell(row, c.orderId);
      const date = parseDate(cell(row, c.date));
      if (!orderId || !date) {
        result.warnings.push({ row: rowNo, message: `Skipped row: ${!orderId ? "no order id" : `bad date "${cell(row, c.date)}"`}.` });
        continue;
      }
      let gross = toCents(cell(row, c.gross));
      const feeRaw = toCents(cell(row, c.fees));
      const netRaw = toCents(cell(row, c.net));
      if (gross == null && netRaw != null) gross = netRaw + Math.abs(feeRaw ?? 0);
      if (gross == null) {
        result.warnings.push({ row: rowNo, message: `Order ${orderId}: no amount; skipped.` });
        continue;
      }
      const fee = Math.abs(feeRaw ?? 0);
      const statusText = cell(row, c.status).toLowerCase();

      let status: ParsedOrder["status"] = "paid";
      let grossCents = gross;
      let refundCents = 0;
      let feeCents = fee;
      if (/cancel|reject|void|declin/.test(statusText)) {
        status = "cancelled";
        grossCents = 0;
        feeCents = 0;
      } else if (gross < 0) {
        // Credit/refund line: money going back out.
        status = "refunded";
        grossCents = 0;
        refundCents = -gross;
        feeCents = -fee; // a fee on a credit line is a fee reversal (money back in)
      } else if (/refund|return/.test(statusText)) {
        status = "refunded";
        refundCents = gross;
      } else if (statusText && !/complete|paid|ship|deliver|accept|closed|processed|success/.test(statusText)) {
        result.warnings.push({ row: rowNo, message: `Order ${orderId}: unknown status "${cell(row, c.status)}"; treated as paid.` });
      }
      const netCents = grossCents - refundCents - feeCents;
      if (status === "paid" && netRaw != null && netRaw !== netCents) {
        result.warnings.push({ row: rowNo, message: `Order ${orderId}: Net ${netRaw / 100} differs from Gross - Fees ${netCents / 100}.` });
      }

      dates.push(date.businessDate);
      result.orders.push({
        sourceRow: rowNo,
        channel: "other",
        externalOrderId: orderId,
        externalItemId: null,
        orderTs: date.ts,
        businessDate: date.businessDate,
        buyerId: null,
        category: null,
        quantity: toInt(cell(row, c.itemCount), 1),
        currency: "USD",
        grossCents,
        refundCents,
        feeCents,
        shippingCents: 0,
        taxCents: 0,
        netCents,
        status,
      });
    }
    result.period = choosePeriod(result, dominantPeriod(dates), ctx.period);
    return result;
  },
};
