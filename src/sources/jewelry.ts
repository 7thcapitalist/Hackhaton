/**
 * Jewelry: "Jewelry Report" (slide 38: "Request report; Co-Pivot populates Supplier").
 *
 * What it is
 *   Nothing public. Goodwill requests a jewelry report each month and a
 *   "Co-Pivot" step (an Excel pivot? Copilot?) fills in a Supplier column.
 *   We assume it is a SALES report of jewelry items sold online, one row per
 *   item, with the supplier (consignor / store / vendor that sourced the item)
 *   used to allocate revenue. [guess]
 *
 * Assumed layout [guess, all of it]
 *   Optional title lines, then a header row:
 *     Sale Date, Order ID, Item ID, Description, Category, Sale Price,
 *     Shipping, Fees, Supplier, Status
 *   Only a date and a price column are required. Aliases in COLS. A "Total" /
 *   "Grand Total" footer row (typical of a pivot) is skipped.
 *
 * What we emit
 *   One order per item, channel "other", category "Jewelry" (the row's own
 *   category, if any, is ignored on purpose so KPIs group it as Jewelry).
 *   No buyer id. Supplier has no column in `orders` yet, so it is NOT stored;
 *   rows without a Supplier get a warning ("Co-Pivot not run?").
 *   [contract gap: if allocation needs Supplier, add orders.supplier or put it in items]
 *
 * Open questions for Goodwill
 *   1. What is "Co-Pivot", and what does Supplier mean (store, donor program,
 *      vendor, consignor)? Is it needed for the GL allocation?
 *   2. Which marketplace sells the jewelry? If it is ShopGoodwill or eBay,
 *      these items may already be in those files → double counting. Need the
 *      marketplace order id to dedupe (dedupe_key = channel:order:item).
 *   3. Is it a sales report or an inventory/cost report (cost of goods)?
 *   4. Real column names and file type (XLSX with a pivot sheet?).
 */
import type { ParseContext, ParseResult, ParsedOrder, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import { cell, choosePeriod, dominantPeriod, findHeaderRowAny, headerSet, isTotalRow, parseDate, preambleMatches, toInt } from "./_other";

const COLS = {
  date: ["Sale Date", "Sold Date", "Date Sold", "Order Date", "Date", "End Date"],
  orderId: ["Order ID", "Order #", "Order Number", "Order No"],
  itemId: ["Item ID", "Item #", "Item Number", "SKU", "Tag", "Tag #", "Barcode"],
  description: ["Description", "Item Description", "Title", "Item"],
  category: ["Category", "Department"],
  price: ["Sale Price", "Sold Price", "Price", "Sold For", "Amount", "Gross", "Selling Price"],
  quantity: ["Quantity", "Qty"],
  shipping: ["Shipping", "Shipping Charged", "Shipping Amount"],
  fees: ["Fees", "Fee", "Seller Fee", "Commission"],
  supplier: ["Supplier", "Supplier Name", "Vendor", "Consignor", "Source"],
  status: ["Status"],
};

const REQUIRED_SETS = COLS.date.flatMap((d) => COLS.price.slice(0, 4).map((p) => [d, p]));
const FOREIGN = ["settlement id", "sales record number", "channel order id", "winning bid", "buyer username", "item count", "isbn", "tracking id"];

function locateHeader(table: RawTable): number {
  return findHeaderRowAny(table, REQUIRED_SETS);
}

export const jewelryParser: SourceParser = {
  sourceId: "jewelry",
  version: "0.1.0",

  accepts(table: RawTable, fileName: string): boolean {
    const h = locateHeader(table);
    if (h < 0) return false;
    const cells = headerSet(table[h]);
    if (FOREIGN.some((f) => cells.has(f))) return false;
    // Supplier column is the distinctive mark; otherwise need a jewelry hint.
    const hasSupplier = COLS.supplier.some((s) => cells.has(normalizeHeader(s)));
    const named = /jewel/i.test(fileName) || preambleMatches(table.slice(0, h), /jewel/i);
    return hasSupplier || named;
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const headerRowIndex = locateHeader(table);
    const result: ParseResult = { orders: [], moneyLines: [], warnings: [], headerRowIndex, header: [] };
    if (headerRowIndex < 0) {
      result.warnings.push({ message: "Jewelry: header row not found (need a sale date and a price column)." });
      return result;
    }
    const header = table[headerRowIndex];
    result.header = header.map(normalizeHeader);
    const c = columnIndex(header, COLS);
    result.warnings.push({ message: "Jewelry: layout is a guess; Supplier is read but not stored (no column in orders)." });
    if (c.supplier < 0) result.warnings.push({ message: "Jewelry: no Supplier column. Was the Co-Pivot step run?" });

    const dates: string[] = [];
    let missingSupplier = 0;
    for (let i = headerRowIndex + 1; i < table.length; i++) {
      const row = table[i];
      const rowNo = i + 1;
      if (isBlankRow(row) || isTotalRow(row)) continue;
      const date = parseDate(cell(row, c.date));
      const price = toCents(cell(row, c.price));
      if (!date || price == null) {
        result.warnings.push({ row: rowNo, message: `Skipped row: ${!date ? `bad date "${cell(row, c.date)}"` : "no price"}.` });
        continue;
      }
      const itemId = cell(row, c.itemId) || null;
      const orderId = cell(row, c.orderId) || itemId || `row-${rowNo}`;
      if (!cell(row, c.orderId) && !itemId) {
        result.warnings.push({ row: rowNo, message: "No order or item id; using the row number as id (dedupe will not work across files)." });
      }
      if (c.supplier >= 0 && !cell(row, c.supplier)) missingSupplier++;

      const shipping = toCents(cell(row, c.shipping)) ?? 0;
      const fee = Math.abs(toCents(cell(row, c.fees)) ?? 0);
      const statusText = cell(row, c.status).toLowerCase();
      let status: ParsedOrder["status"] = "paid";
      let grossCents = price;
      let refundCents = 0;
      if (price < 0 || /refund|return/.test(statusText)) {
        status = "refunded";
        grossCents = price < 0 ? 0 : price;
        refundCents = Math.abs(price);
      } else if (/cancel|void/.test(statusText)) {
        status = "cancelled";
        grossCents = 0;
      }
      const feeCents = status === "cancelled" ? 0 : fee;
      const shippingCents = status === "cancelled" ? 0 : shipping;

      dates.push(date.businessDate);
      result.orders.push({
        sourceRow: rowNo,
        channel: "other",
        externalOrderId: orderId,
        externalItemId: itemId,
        orderTs: date.ts,
        businessDate: date.businessDate,
        buyerId: null,
        category: "Jewelry",
        quantity: toInt(cell(row, c.quantity), 1),
        currency: "USD",
        grossCents,
        refundCents,
        feeCents,
        shippingCents,
        taxCents: 0,
        netCents: grossCents + shippingCents - refundCents - feeCents,
        status,
      });
    }
    if (missingSupplier > 0) {
      result.warnings.push({ message: `Jewelry: ${missingSupplier} row(s) have no Supplier. Was the Co-Pivot step run?` });
    }
    result.period = choosePeriod(result, dominantPeriod(dates), ctx.period);
    return result;
  },
};
