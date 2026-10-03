/**
 * Cash Monkey: "Orders Report" (slides 27-30 daily; slide 38: "Orders · full
 * month · Submit/download CSV; save as Excel"). Research: docs/sources/cashmonkey.md.
 *
 * What it is
 *   CashMonkey Solutions is recommerce software (PeriScope for books & media)
 *   that lists Goodwill's books on many marketplaces and handles the orders
 *   [fact: their site; that Goodwill uses it this way: guess, strong]. So
 *   Goodwill sells THROUGH Cash Monkey; each row is a marketplace order line.
 *
 * Layouts accepted [guess, no public sample]
 *   1. Per-item Orders Report (most likely real): Order Date, Marketplace,
 *      Order ID, SKU, ISBN, Title, Condition, Qty, Price, Shipping, Tax,
 *      Marketplace Fee, Net, Status. Rows that share an Order ID are one
 *      order (customers = distinct orders); each item row is emitted with its
 *      SKU (else ISBN) as externalItemId, so dedupe works per item.
 *   2. Older lot-level layout: Order ID, Order Date, Item Count, Order Total,
 *      Fees, Net, Status (one row per bulk lot, no item id).
 *   Aliases in COLS. Only true footer rows are skipped (first cell "Total" /
 *   "Grand Total"), so a book titled "Total Recall" is kept.
 *
 * Channel
 *   The Marketplace column maps to our channel: Amazon → amazon, eBay → ebay,
 *   ShopGoodwill → shopgoodwill, anything else (AbeBooks, Biblio, Alibris…)
 *   or no column → other. An Amazon/eBay row carries the marketplace's order id
 *   and SKU, so it dedupes against the Amazon/eBay file (first file wins,
 *   Upright beats both).
 *
 * Money [guess]
 *   gross = Price × Qty (or the Gross/Order Total column), shipping = Shipping,
 *   tax = Tax (never revenue), fee = |Marketplace Fee|. A negative amount, or
 *   Status "Refunded"/"Returned", is a refund; "Cancelled"/"Rejected" → zero
 *   amounts. Dates without a zone are Indianapolis wall time. A Buyer ID
 *   column (marketplace id, not a name) is passed on to be hashed.
 */
import type { ParseContext, ParseResult, ParsedOrder, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import type { ChannelId } from "./_shared/marketplace";
import { cell, choosePeriod, dominantPeriod, findHeaderRowAny, headerSet, isTotalRow, parseDate, preambleMatches, toInt } from "./_other";

const COLS = {
  orderId: ["Order ID", "Order Id", "Order #", "Order Number", "Order No", "Marketplace Order ID", "PO Number", "Quote ID"],
  date: ["Order Date", "Date", "Created", "Created At", "Order Created", "Paid Date", "Completed Date"],
  marketplace: ["Marketplace", "Channel", "Sales Channel", "Venue", "Market"],
  sku: ["SKU", "Inventory SKU", "Listing SKU"],
  isbn: ["ISBN", "ISBN/UPC", "UPC", "EAN", "ISBN13"],
  title: ["Title", "Item Title"],
  itemCount: ["Item Count", "Items", "Qty", "Quantity", "Units", "# Items"],
  price: ["Price", "Item Price", "Sale Price", "Unit Price"],
  gross: ["Gross", "Gross Amount", "Order Total", "Total", "Subtotal", "Amount", "Offer Amount"],
  shipping: ["Shipping", "Shipping Charged", "Shipping Paid"],
  tax: ["Tax", "Sales Tax", "Marketplace Tax"],
  fees: ["Marketplace Fee", "Fees", "Fee", "Commission", "Service Fee", "Processing Fee"],
  net: ["Net", "Net Amount", "Payout", "Net Payout", "Amount Paid"],
  status: ["Status", "Order Status", "State"],
  buyer: ["Buyer ID", "Marketplace Buyer ID"],
};

const REQUIRED_SETS = COLS.orderId.slice(0, 6).flatMap((o) => COLS.date.slice(0, 3).map((d) => [o, d]));

/** Columns that mean another source's file (Amazon/eBay/ShopGoodwill/Upright/jewelry/books). */
const FOREIGN = ["settlement id", "sales record number", "channel order id", "channel item id", "upright product id", "supplier", "winning bid", "buyer username", "tracking id"];

function locateHeader(table: RawTable): number {
  return findHeaderRowAny(table, REQUIRED_SETS);
}

function channelOf(raw: string): ChannelId {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (s.startsWith("amazon")) return "amazon";
  if (s.startsWith("ebay")) return "ebay";
  if (s.startsWith("shopgoodwill")) return "shopgoodwill";
  return "other";
}

export const cashmonkeyParser: SourceParser = {
  sourceId: "cashmonkey",
  version: "0.2.0",

  accepts(table: RawTable, fileName: string): boolean {
    const h = locateHeader(table);
    if (h < 0) return false;
    const cells = headerSet(table[h]);
    if (FOREIGN.some((f) => cells.has(f))) return false;
    if (preambleMatches(table.slice(0, h), /goodwill\s*books|jewel/i)) return false;
    if (/cash[\s_-]*monkey/i.test(fileName)) return true;
    const idx = columnIndex(table[h], COLS);
    // Without a file-name hint: the lot layout's Item Count + Net + Gross, or
    // the per-item layout's Marketplace + ISBN + Price.
    return (idx.itemCount >= 0 && idx.net >= 0 && idx.gross >= 0) || (idx.marketplace >= 0 && idx.isbn >= 0 && idx.price >= 0);
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
    const perItem = c.price >= 0 || c.sku >= 0 || c.isbn >= 0;
    if (c.price < 0 && c.gross < 0 && c.net < 0) {
      result.warnings.push({ message: "Cash Monkey: no Price / Order Total / Net column; amounts may be incomplete." });
    }

    const dates: string[] = [];
    const unknownMarkets = new Set<string>();
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
      const qty = toInt(cell(row, c.itemCount), 1);
      const unit = toCents(cell(row, c.price));
      let gross: number | null = toCents(cell(row, c.gross));
      if (unit != null) {
        // Per item: Price × Qty; a negative Qty with a positive Price is a return.
        gross = Math.abs(unit) * (Math.abs(qty) || 1) * (unit < 0 || qty < 0 ? -1 : 1);
      }
      const feeRaw = toCents(cell(row, c.fees));
      const netRaw = toCents(cell(row, c.net));
      const shipping = toCents(cell(row, c.shipping)) ?? 0;
      if (gross == null && netRaw != null) gross = netRaw + Math.abs(feeRaw ?? 0) - shipping;
      if (gross == null) {
        result.warnings.push({ row: rowNo, message: `Order ${orderId}: no amount; skipped.` });
        continue;
      }
      const fee = Math.abs(feeRaw ?? 0);
      const statusText = cell(row, c.status).toLowerCase();

      let status: ParsedOrder["status"] = "paid";
      let grossCents = gross;
      let shippingCents = shipping;
      let refundCents = 0;
      let feeCents = fee;
      if (/cancel|reject|void|declin/.test(statusText)) {
        status = "cancelled";
        grossCents = 0;
        shippingCents = 0;
        feeCents = 0;
      } else if (gross < 0) {
        // Credit/refund line: money going back out.
        status = "refunded";
        grossCents = 0;
        refundCents = -gross + Math.max(0, -shipping);
        shippingCents = Math.max(0, shipping);
        feeCents = -fee; // a fee on a credit line is a fee reversal (money back in)
      } else if (/refund|return/.test(statusText)) {
        status = "refunded";
        refundCents = gross + shipping;
      } else if (statusText && !/complete|paid|ship|deliver|accept|closed|processed|success|pending|new|open/.test(statusText)) {
        result.warnings.push({ row: rowNo, message: `Order ${orderId}: unknown status "${cell(row, c.status)}"; treated as paid.` });
      }
      const netCents = grossCents + shippingCents - refundCents - feeCents;
      if (status === "paid" && netRaw != null && netRaw !== netCents) {
        result.warnings.push({ row: rowNo, message: `Order ${orderId}: Net ${netRaw / 100} differs from Gross + Shipping - Fees ${netCents / 100}.` });
      }
      const rawMarket = cell(row, c.marketplace);
      const channel = channelOf(rawMarket);
      if (channel === "other" && rawMarket && !/abe|biblio|alibris|books|thrift|walmart|direct|mercari/i.test(rawMarket)) unknownMarkets.add(rawMarket);

      // A return row reuses the sold item's SKU: give it its own key so it is
      // not dropped as a duplicate of the sale.
      const itemKey = perItem ? cell(row, c.sku) || cell(row, c.isbn) || null : null;
      dates.push(date.businessDate);
      result.orders.push({
        sourceRow: rowNo,
        channel,
        externalOrderId: orderId,
        externalItemId: itemKey && gross < 0 ? `${itemKey}:return` : itemKey,
        orderTs: date.ts,
        businessDate: date.businessDate,
        buyerId: cell(row, c.buyer) || null,
        category: perItem ? "Books" : null,
        quantity: Math.abs(qty) || 1,
        currency: "USD",
        grossCents,
        refundCents,
        feeCents,
        shippingCents,
        taxCents: toCents(cell(row, c.tax)) ?? 0,
        netCents,
        status,
      });
    }
    if (unknownMarkets.size) result.warnings.push({ message: `Cash Monkey: marketplaces mapped to "other": ${[...unknownMarkets].join(", ")}.` });
    result.period = choosePeriod(result, dominantPeriod(dates), ctx.period);
    return result;
  },
};
