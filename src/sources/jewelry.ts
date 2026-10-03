/**
 * Jewelry: "Jewelry Report" (slide 38: "Request report; Co-Pivot populates Supplier").
 * Research: docs/sources/jewelry.md (almost all guess).
 *
 * What it is [guess]
 *   A monthly list of jewelry items sold online, mostly on ShopGoodwill (some
 *   on eBay), that finance requests; a "Co-Pivot" step (likely Copilot in
 *   Excel or a pivot/lookup) fills a Supplier column used for allocation.
 *   Those sales are ALREADY in the ShopGoodwill / eBay / Upright files, so
 *   this report must not add revenue for them.
 *
 * What we emit
 *   One order per item with the MARKETPLACE channel and the marketplace's own
 *   order and item ids, so ingest's dedupe (`channel:order:item`) catches the
 *   rows already loaded from ShopGoodwill / eBay (first file wins; Upright
 *   beats both). Only items no other file has (e.g. sold "Direct" / in store
 *   → channel other) add revenue.
 *   Channel: a Marketplace / Channel / Site column if present; else inferred
 *   from the order id (SGW-… → shopgoodwill, 12-34567-89012 → ebay, 3-7-7
 *   digits → amazon); else other. Category is always "Jewelry".
 *   Supplier has no column in `orders`, so it is not stored (needed schema
 *   field: orders.supplier, or an enrichment table keyed by dedupe_key). Rows
 *   without a Supplier get ONE warning per file ("Co-Pivot not run?"); the raw
 *   report (no Supplier column at all) is accepted, with one warning.
 *
 * Layout [guess]
 *   Optional title lines, then a header: Sale Date, Marketplace, Order ID,
 *   Item ID, Description, Category, Sold Price, Shipping, Fees, Supplier.
 *   Only a date and a price column are required. Pivot footers ("Grand
 *   Total", "Store 12 Total") are skipped; an item described as "Total …" is
 *   kept (only the first cell decides).
 */
import type { ParseContext, ParseResult, ParsedOrder, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import type { ChannelId } from "./_shared/marketplace";
import { cell, choosePeriod, dominantPeriod, findHeaderRowAny, headerSet, isTotalRow, parseDate, preambleMatches, toInt } from "./_other";

const COLS = {
  date: ["Sale Date", "Sold Date", "Date Sold", "Order Date", "Date", "End Date"],
  marketplace: ["Marketplace", "Channel", "Site", "Sales Channel", "Platform"],
  orderId: ["Order ID", "Marketplace Order ID", "Order #", "Order Number", "Order No"],
  itemId: ["Item ID", "Item #", "Item Number", "Listing ID", "SKU", "Tag", "Tag #", "Barcode"],
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
const JEWELRY_WORDS = /jewel|ring|necklace|bracelet|earring|brooch|pendant|chain|watch|cameo|pearl|gold|silver|sterling/i;

function locateHeader(table: RawTable): number {
  return findHeaderRowAny(table, REQUIRED_SETS);
}

export function jewelryChannel(marketplace: string, orderId: string): ChannelId {
  const s = marketplace.toLowerCase().replace(/[^a-z]/g, "");
  if (s) {
    if (s.startsWith("shopgoodwill") || s === "sgw") return "shopgoodwill";
    if (s.startsWith("ebay")) return "ebay";
    if (s.startsWith("amazon")) return "amazon";
    return "other";
  }
  if (/^SGW-/i.test(orderId)) return "shopgoodwill";
  if (/^\d{2}-\d{5}-\d{5}$/.test(orderId)) return "ebay";
  if (/^\d{3}-\d{7}-\d{7}$/.test(orderId)) return "amazon";
  return "other";
}

export const jewelryParser: SourceParser = {
  sourceId: "jewelry",
  version: "0.2.0",

  accepts(table: RawTable, fileName: string): boolean {
    const h = locateHeader(table);
    if (h < 0) return false;
    const cells = headerSet(table[h]);
    if (FOREIGN.some((f) => cells.has(f))) return false;
    // Supplier column is the distinctive mark; else a jewelry hint in the
    // file name / title; else (raw report) mostly jewelry descriptions.
    const hasSupplier = COLS.supplier.some((s) => cells.has(normalizeHeader(s)));
    const named = /jewel/i.test(fileName) || preambleMatches(table.slice(0, h), /jewel/i);
    if (hasSupplier || named) return true;
    const c = columnIndex(table[h], COLS);
    if (c.description < 0 && c.category < 0) return false;
    const sample = table.slice(h + 1, h + 21).filter((r) => !isBlankRow(r));
    const hits = sample.filter((r) => JEWELRY_WORDS.test(`${cell(r, c.description)} ${cell(r, c.category)}`)).length;
    return sample.length >= 3 && hits / sample.length >= 0.6;
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
    if (c.supplier < 0) result.warnings.push({ message: "Jewelry: no Supplier column (raw report). Was the Co-Pivot step run?" });

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
      // A fee on a return row is a fee reversal (money back in).
      const feeCents = status === "cancelled" ? 0 : price < 0 ? -fee : fee;
      const shippingCents = status === "cancelled" ? 0 : shipping;

      dates.push(date.businessDate);
      result.orders.push({
        sourceRow: rowNo,
        channel: jewelryChannel(cell(row, c.marketplace), orderId),
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
