/**
 * Goodwill Books: "Prior-month payment statement" (slide 38: "Monthly email attachment").
 *
 * What it is
 *   GoodwillBooks.com is a network marketplace for books/media from many
 *   Goodwills (free shipping to buyers); Michiana is a seller
 *   (https://www.goodwillbooks.com/south-bend-indiana). [fact]
 *   Each month Goodwill gets an emailed payment statement for the prior
 *   month. [fact, slide 38] Its layout is not public. [guess below]
 *
 * Assumed layout [guess, docs/research.md §2]
 *   Preamble lines with "GoodwillBooks", "Statement Period: 09/01/2026 - 09/30/2026"
 *   (or "Period: September 2026"), "Payment Date: …". Then a header row:
 *     Order #, Order Date, SKU, ISBN, Title, Qty, Sale Price, Commission, Net
 *   Then footer lines: "Total Sales", "Total Commission", "Adjustments",
 *   "Net Payment" (label in any cell, amount in the last numeric cell).
 *   Aliases in COLS (e.g. "Fee", "Marketplace Fee", "Item Price").
 *
 * What we emit (money_lines, channel "goodwill_books")
 *   - per order line: "sale" (+ Sale Price) and "marketplace_fee" (- Commission);
 *     a negative Sale Price (return/credit) → "refund" (negative).
 *   - footer "Adjustment(s)" → "adjustment".
 *   - footer "Net Payment" / "Payment Amount" → one "statement_payment"
 *     (+, cash received). It is a CONTROL TOTAL equal to Σ lines, not an extra
 *     amount: the close engine must not add it to revenue. If it does not
 *     match Σ lines we warn. If missing, we derive it from the lines.
 *   No orders are emitted: the statement is the monthly money record. [decision]
 *   result.period = the statement month (from the preamble, else the dates).
 *
 * Open questions for Goodwill
 *   1. File type of the attachment (CSV? XLSX? PDF only?) and real columns.
 *   2. Is the commission one fee, or several (commission + payment processing
 *      + shipping subsidy)? Does Goodwill pay shipping (free shipping to buyer)?
 *   3. How is it paid (ACH into 1st Source 0101?) and on which date, so the
 *      payment can be matched to the bank deposit.
 *   4. GL accounts / department for sales and fees; is this the "AR invoice"
 *      customer on the workbook Invoices tab?
 */
import type { ParseContext, ParseResult, ParsedMoneyLine, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import { cell, choosePeriod, dominantPeriod, findHeaderRowAny, headerSet, parseDate, preambleMatches } from "./_other";

const COLS = {
  orderId: ["Order #", "Order ID", "Order Number", "Order No", "Order"],
  date: ["Order Date", "Date", "Sale Date", "Sold Date", "Ship Date"],
  sku: ["SKU", "Seller SKU", "Listing ID"],
  isbn: ["ISBN", "ISBN/UPC", "UPC", "EAN"],
  title: ["Title", "Item Title", "Description"],
  quantity: ["Qty", "Quantity"],
  price: ["Sale Price", "Item Price", "Price", "Sold Price", "Gross", "Amount"],
  fee: ["Commission", "Commission/Fee", "Fee", "Fees", "Marketplace Fee", "Commission Fee"],
  net: ["Net", "Net Amount", "Net Proceeds"],
};

const REQUIRED_SETS = COLS.orderId.flatMap((o) => COLS.price.slice(0, 4).map((p) => [o, p]));
const FOREIGN = ["settlement id", "sales record number", "channel order id", "winning bid", "supplier", "item count", "tracking id", "marketplace"];

function locateHeader(table: RawTable): number {
  return findHeaderRowAny(table, REQUIRED_SETS);
}

/** "Statement Period: 09/01/2026 - 09/30/2026" or "Period: September 2026" → "2026-09". */
function periodFromPreamble(rows: RawTable): string | undefined {
  for (const row of rows) {
    const line = row.join(" ");
    if (!/period|statement for|month/i.test(line)) continue;
    const range = line.match(/(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/);
    if (range) {
      const d = parseDate(range[1]);
      if (d) return d.businessDate.slice(0, 7);
    }
    const named = line.match(/([A-Za-z]{3,9})\.?\s+(\d{4})/);
    if (named) {
      const d = parseDate(`${named[1]} 1, ${named[2]}`);
      if (d) return d.businessDate.slice(0, 7);
    }
  }
  return undefined;
}

/** A footer line: label in some cell, amount = last cell that parses as money. */
function footerAmount(row: string[]): number | null {
  for (let j = row.length - 1; j >= 0; j--) {
    const v = toCents(row[j]);
    if (v != null) return v;
  }
  return null;
}

export const goodwillBooksParser: SourceParser = {
  sourceId: "goodwill_books",
  version: "0.2.0",

  accepts(table: RawTable, fileName: string): boolean {
    const h = locateHeader(table);
    if (h < 0) return false;
    const cells = headerSet(table[h]);
    if (FOREIGN.some((f) => cells.has(f))) return false;
    // Robust to a generic attachment name ("Statement_092026.xlsx"): any of
    // a Goodwill Books name / title, a "payment statement" preamble with book
    // columns, ISBN + a fee column, or GWB- order numbers is enough.
    const preamble = table.slice(0, h);
    const named =
      /goodwill[\s_-]*books|(^|[^a-z])gwb([^a-z]|$)/i.test(fileName) || preambleMatches(preamble, /goodwill\s*books/i);
    const idx = columnIndex(table[h], COLS);
    const hasIsbn = idx.isbn >= 0;
    const hasFee = idx.fee >= 0;
    const statementPreamble = preambleMatches(preamble, /payment statement|statement period|seller statement/i);
    const gwbIds = table
      .slice(h + 1, h + 11)
      .some((r) => /^GWB-/i.test(cell(r, idx.orderId)));
    return named || (hasIsbn && hasFee) || (statementPreamble && (hasIsbn || hasFee)) || gwbIds;
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const headerRowIndex = locateHeader(table);
    const result: ParseResult = { orders: [], moneyLines: [], warnings: [], headerRowIndex, header: [] };
    if (headerRowIndex < 0) {
      result.warnings.push({ message: "Goodwill Books: header row not found (need Order # + Sale Price)." });
      return result;
    }
    const header = table[headerRowIndex];
    result.header = header.map(normalizeHeader);
    const c = columnIndex(header, COLS);
    // Developer note (not a parse warning): the statement layout is a guess
    // until we see a real attachment (docs/sources/goodwill_books.md).

    const preamblePeriod = periodFromPreamble(table.slice(0, headerRowIndex));
    const lines: ParsedMoneyLine[] = [];
    const dates: string[] = [];
    let sumLines = 0;
    let statedPayment: { cents: number; row: number } | null = null;
    let inFooter = false;

    for (let i = headerRowIndex + 1; i < table.length; i++) {
      const row = table[i];
      const rowNo = i + 1;
      if (row.every((x) => x.trim() === "")) continue;
      const label = row.find((x) => x.trim() !== "")?.trim() ?? "";

      // Footer section: total / adjustment / payment lines.
      if (/^(total|grand total|subtotal|net payment|payment amount|amount paid|total payment|adjustments?)\b/i.test(label)) {
        inFooter = true;
        const amount = footerAmount(row);
        if (amount == null) continue;
        if (/^adjustments?/i.test(label)) {
          if (amount !== 0) {
            lines.push({ sourceRow: rowNo, channel: "goodwill_books", lineDate: "", period: "", amountType: "adjustment", amountCents: amount, reference: null, memo: label });
            sumLines += amount;
          }
        } else if (/net payment|payment amount|amount paid|total payment/i.test(label)) {
          statedPayment = { cents: amount, row: rowNo };
        }
        // "Total Sales" / "Total Commission" are checks only; ignore.
        continue;
      }
      if (inFooter || isBlankRow(row)) {
        if (!isBlankRow(row)) result.warnings.push({ row: rowNo, message: `Unrecognized footer line "${label}"; ignored.` });
        continue;
      }

      const orderId = cell(row, c.orderId);
      const date = parseDate(cell(row, c.date));
      const price = toCents(cell(row, c.price));
      if (!orderId || price == null) {
        result.warnings.push({ row: rowNo, message: `Skipped row: ${!orderId ? "no order number" : "no sale price"}.` });
        continue;
      }
      if (!date) result.warnings.push({ row: rowNo, message: `Order ${orderId}: bad date "${cell(row, c.date)}"; using statement month end.` });
      if (date) dates.push(date.businessDate);
      const fee = toCents(cell(row, c.fee));
      const ref = [orderId, cell(row, c.isbn) || cell(row, c.sku)].filter(Boolean).join(" / ");
      const memo = cell(row, c.title) || null;
      const lineDate = date?.businessDate ?? "";

      lines.push({ sourceRow: rowNo, channel: "goodwill_books", lineDate, period: "", amountType: price < 0 ? "refund" : "sale", amountCents: price, reference: ref, memo });
      sumLines += price;
      if (fee != null && fee !== 0) {
        // Commission reduces the payment; on a return it comes back (+).
        const feeCents = price < 0 ? Math.abs(fee) : -Math.abs(fee);
        lines.push({ sourceRow: rowNo, channel: "goodwill_books", lineDate, period: "", amountType: "marketplace_fee", amountCents: feeCents, reference: ref, memo });
        sumLines += feeCents;
      }
      const net = toCents(cell(row, c.net));
      const expected = price + (fee == null ? 0 : price < 0 ? Math.abs(fee) : -Math.abs(fee));
      if (net != null && net !== expected) {
        result.warnings.push({ row: rowNo, message: `Order ${orderId}: Net ${net / 100} differs from Sale Price - Commission ${expected / 100}.` });
      }
    }

    const period = choosePeriod(result, preamblePeriod ?? dominantPeriod(dates), ctx.period);
    result.period = period;
    if (!period) result.warnings.push({ message: "Goodwill Books: could not tell the statement month." });
    const monthEnd = period ? lastDayOf(period) : "";

    for (const l of lines) {
      l.lineDate = l.lineDate || monthEnd;
      l.period = period ?? l.lineDate.slice(0, 7);
    }
    let payment = statedPayment?.cents ?? null;
    if (payment == null) {
      result.warnings.push({ message: "Goodwill Books: no Net Payment line; payment derived from the lines." });
      payment = sumLines;
    } else if (payment !== sumLines) {
      result.warnings.push({ row: statedPayment?.row, message: `Net Payment ${payment / 100} differs from Σ lines ${sumLines / 100}.` });
    }
    if (lines.length > 0 || statedPayment) {
      lines.push({
        sourceRow: statedPayment?.row ?? table.length,
        channel: "goodwill_books",
        lineDate: monthEnd,
        period: period ?? "",
        amountType: "statement_payment",
        amountCents: payment,
        reference: period ? `GWB-${period}` : null,
        memo: "Statement net payment (control total; equals sum of lines)",
      });
    }
    result.moneyLines = lines.filter((l) => l.lineDate !== "" && l.period !== "");
    if (result.moneyLines.length < lines.length) {
      result.warnings.push({ message: `${lines.length - result.moneyLines.length} line(s) dropped: no date and no statement month.` });
    }
    return result;
  },
};

function lastDayOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(d).padStart(2, "0")}`;
}
