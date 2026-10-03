/**
 * eBay Seller Hub "Orders" report (CSV) parser. Slide 38 calls it the
 * "listing sales report"; we assume it is this one (open question).
 *
 * Sources:
 *  - Seller Hub help (orders report download, eBay Collected Tax, "eBay
 *    Collected Tax and Fees Included in Total"):
 *    https://www.ebay.com/help/selling/selling-tools/seller-hub?id=4095
 *  - Community thread on the CSV layout:
 *    https://community.ebay.com/t5/Report-eBay-Technical-Issues/quot-Transaction-Report-quot-CSV-details/td-p/33455429
 *  - docs/research.md §2
 *
 * Assumptions:
 *  - [fact] Column names: Sales Record Number, Order Number, Buyer Username,
 *    Item Number, Item Title, Quantity, Sold For, Shipping And Handling,
 *    eBay Collected Tax, Total Price, eBay Collected Tax and Fees Included in
 *    Total, Sale Date, Paid On Date.
 *  - [fact] Line 1 is bare commas, line 2 the header (80 columns, US), line 3
 *    a padding row; the file ends with "45,record(s) downloaded,from … to …"
 *    (count in column 1) and "Seller ID : …". All skipped.
 *  - [fact] The real report has NO order status, refund or fee columns: those
 *    stay 0 / "paid" (no invented values). The optional aliases below only
 *    serve older/hand-made files. Refunds and fees come from Upright or the
 *    eBay Transaction report / Finances API.
 *  - Seller Collected Tax is added to tax; buyer-paid recycling fees,
 *    Additional Fee and eBay Collected Charges are pass-through (only used in
 *    the Total Price check), never revenue.
 *  - [guess] Dates look like "Sep-30-26" (no time → Indianapolis midnight);
 *    "Sep-30-26 23:45:00" and zone-suffixed variants also parse.
 *  - [fact] "Sold For" is the unit price; gross = Sold For × Quantity.
 *  - [guess] Multi-item orders: one summary row (Order Number, shipping, tax,
 *    total, no Item Number) followed by one row per item. The summary's
 *    shipping and tax go on the order's first item row.
 *  - [guess] The orders report has no fees (fees are in the Payments
 *    Transaction report). fee_cents = 0 unless a "Final Value Fee" column exists.
 *  - [guess] Refunds: optional "Order Status" (Refunded/Cancelled) and
 *    "Refund Amount" columns. Status Refunded without an amount = full refund.
 *  - Buyer Username → buyerId (ingest hashes it). Buyer name/email/address
 *    columns are ignored and never leave this function.
 */
import type { ParsedOrder, ParseResult, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import {
  cell,
  cents,
  findHeaderRowByAliases,
  finishResult,
  headerNotFound,
  netOf,
  parseDateTime,
  stamp,
  warnMissingColumns,
} from "./_shared/marketplace";

const ALIASES = {
  salesRecord: ["sales record number", "sales record no.", "record number"],
  orderId: ["order number", "order id", "order no."],
  buyer: ["buyer username", "buyer user id", "user id"],
  itemNumber: ["item number", "item id", "listing id"],
  title: ["item title", "title"],
  quantity: ["quantity", "qty"],
  soldFor: ["sold for", "item price", "sale price"],
  shipping: ["shipping and handling", "shipping & handling", "shipping"],
  tax: ["ebay collected tax", "ebay collected sales tax"],
  sellerTax: ["seller collected tax"],
  total: ["total price", "total"],
  taxIncluded: ["ebay collected tax and fees included in total", "ebay collected tax included in total"],
  saleDate: ["sale date", "order date", "order creation date"],
  paidDate: ["paid on date", "paid date"],
  status: ["order status", "status"],
  refund: ["refund amount", "refunded amount", "refunds"],
  fee: ["final value fee", "final value fee - total"],
};
type Key = keyof typeof ALIASES;
const REQUIRED: Key[] = ["salesRecord", "orderId", "itemNumber", "soldFor"];

const FOOTER = /record\(s\) downloaded|^seller id\b/i;
const BUYER_CHARGES = new Set([
  "electronic waste recycling fee", "mattress recycling fee", "battery recycling fee", "white goods disposal tax",
  "tire recycling fee", "additional fee", "ebay collected charges",
]);
/** Footer lines: "45,record(s) downloaded,from …" (count in col 1) and "Seller ID : …". */
const isFooter = (row: string[]) => FOOTER.test(row.slice(0, 3).join(" ").trim());

export const ebayParser: SourceParser = {
  sourceId: "ebay",
  version: "1.1.0",

  accepts(table: RawTable): boolean {
    return findHeaderRowByAliases(table, ALIASES, REQUIRED) >= 0;
  },

  parse(table, ctx): ParseResult {
    const h = findHeaderRowByAliases(table, ALIASES, REQUIRED);
    if (h < 0) return headerNotFound("eBay Seller Hub orders");

    const header = table[h];
    const col = columnIndex(header, ALIASES);
    const result: ParseResult = {
      orders: [],
      moneyLines: [],
      warnings: [],
      headerRowIndex: h,
      header: header.map(normalizeHeader),
    };
    warnMissingColumns(result, col, ["buyer", "tax", "saleDate"]);
    // Buyer-paid pass-through charges (recycling fees, Additional Fee, eBay
    // Collected Charges): part of Total Price, never revenue.
    const chargeCols = result.header.map((x, i) => (BUYER_CHARGES.has(x) ? i : -1)).filter((i) => i >= 0);

    // Pass 1: summary rows of multi-item orders (order number, no item number).
    const summaries = new Map<string, { shipping: number; tax: number; used: boolean }>();
    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      if (isBlankRow(row) || isFooter(row)) continue;
      const orderId = cell(row, col.orderId);
      if (orderId && !cell(row, col.itemNumber)) {
        summaries.set(orderId, { shipping: cents(row, col.shipping), tax: cents(row, col.tax), used: false });
      }
    }

    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      const sourceRow = i + 1;
      if (isBlankRow(row) || isFooter(row)) continue;

      const orderId = cell(row, col.orderId);
      const itemNumber = cell(row, col.itemNumber);
      if (!orderId) {
        result.warnings.push({ row: sourceRow, message: "Row without an order number; skipped." });
        continue;
      }
      if (!itemNumber) continue; // summary row, folded in pass 1

      const rawDate = cell(row, col.saleDate) || cell(row, col.paidDate);
      const when = parseDateTime(rawDate);
      if (!when) {
        result.warnings.push({ row: sourceRow, message: `Unreadable sale date "${rawDate}"; row skipped.` });
        continue;
      }

      const quantity = parseInt(cell(row, col.quantity), 10) || 1;
      const unit = toCents(cell(row, col.soldFor));
      if (unit == null) {
        result.warnings.push({ row: sourceRow, message: `Unreadable "Sold For" value "${cell(row, col.soldFor)}"; row skipped.` });
        continue;
      }
      const gross = unit * quantity;
      let shipping = cents(row, col.shipping);
      let tax = cents(row, col.tax) + cents(row, col.sellerTax);
      const summary = summaries.get(orderId);
      if (summary && !summary.used) {
        shipping += summary.shipping;
        tax += summary.tax;
        summary.used = true;
      }

      const statusText = cell(row, col.status).toLowerCase();
      let refund = Math.abs(cents(row, col.refund));
      let status: ParsedOrder["status"] = "paid";
      if (/cancel/.test(statusText)) status = "cancelled";
      else if (/refund|return/.test(statusText) || refund > 0) {
        status = "refunded";
        if (refund === 0) refund = gross + shipping;
      }

      // Sanity check against Total Price (single-item rows only).
      const totalRaw = toCents(cell(row, col.total));
      if (totalRaw != null && !summary) {
        const included = /^y/i.test(cell(row, col.taxIncluded));
        const charges = chargeCols.reduce((s, i) => s + cents(row, i), 0);
        const expected = gross + shipping + (included ? tax + charges : 0);
        if (Math.abs(totalRaw - expected) > 1) {
          result.warnings.push({
            row: sourceRow,
            message: `Total Price ${totalRaw / 100} does not match Sold For × Qty + shipping${included ? " + tax" : ""} (${expected / 100}).`,
          });
        }
      }

      const amounts = {
        grossCents: gross,
        shippingCents: shipping,
        refundCents: refund,
        feeCents: Math.abs(cents(row, col.fee)),
        taxCents: tax,
      };
      result.orders.push({
        sourceRow,
        channel: "ebay",
        externalOrderId: orderId,
        externalItemId: itemNumber,
        ...stamp(when),
        buyerId: cell(row, col.buyer) || null,
        quantity,
        currency: "USD",
        ...amounts,
        netCents: netOf(amounts),
        status,
      });
    }

    return finishResult(result, ctx.fileName, ctx.period);
  },
};
