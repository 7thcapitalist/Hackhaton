/**
 * Upright Labs (Upright Lister) "Paid Order Items" report parser. One row per
 * sold item, across marketplaces (ShopGoodwill, eBay, Amazon, …).
 *
 * Sources:
 *  - Paid Order Items report: https://help.uprightlabs.com/en-us/lister/paid-order-items-report
 *  - Related reports: https://help.uprightlabs.com/en-us/lister/sales-by-category-report,
 *    https://help.uprightlabs.com/en-us/lister/shipments-report
 *  - docs/research.md §2 and §6.1/§6.2 (channel vs source, dedupe key).
 *
 * Assumptions:
 *  - [fact] Col A "Channel", B "Channel Item ID", C "Channel Order ID",
 *    E "Upright Product ID", F "Quantity"; timestamps in cols P–S, in the time
 *    zone picked when the report was generated (so no zone in the cell).
 *  - [guess] The other columns: D Title, G SKU, H Category, I Store, J Lister,
 *    K Upright Order ID, L Price (unit), M Shipping, N Fees, O Refund Amount,
 *    P Ordered At, Q Paid At, R Shipped At, S Listed At, T Buyer Username,
 *    U Sales Tax.
 *  - [guess] Timestamps without a zone are Indianapolis local (Goodwill should
 *    pick that zone when generating the report).
 *  - [fact] Channel Order ID is the MARKETPLACE order id, so the dedupe key
 *    `${channel}:${channelOrderId}:${channelItemId}` collides with the same
 *    order in the eBay / ShopGoodwill files. Upright's own order id is never
 *    used as externalOrderId (only as a last-resort fallback, with a warning).
 *  - Channel map: ShopGoodwill→shopgoodwill, eBay→ebay, Amazon→amazon,
 *    GoodwillBooks→goodwill_books, anything else→other.
 *  - The Lister column (an employee name) is not emitted (privacy).
 */
import type { ParseResult, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import {
  cell,
  cents,
  type ChannelId,
  findHeaderRowByAliases,
  finishResult,
  headerNotFound,
  netOf,
  parseDateTime,
  stamp,
  warnMissingColumns,
} from "./_shared/marketplace";

const ALIASES = {
  channel: ["channel", "marketplace", "sales channel"],
  channelItemId: ["channel item id", "marketplace item id", "channel listing id"],
  channelOrderId: ["channel order id", "marketplace order id", "external order id"],
  title: ["title", "item title"],
  productId: ["upright product id", "product id"],
  quantity: ["quantity", "qty"],
  category: ["category"],
  uprightOrderId: ["upright order id", "order id"],
  price: ["price", "sale price", "sold price"],
  shipping: ["shipping", "shipping paid", "shipping charged"],
  fees: ["fees", "marketplace fees", "channel fees"],
  refund: ["refund amount", "refunded amount", "refund"],
  orderedAt: ["ordered at", "order date", "ordered"],
  paidAt: ["paid at", "paid date", "paid"],
  buyer: ["buyer username", "buyer", "buyer id"],
  tax: ["sales tax", "tax", "marketplace collected tax"],
  status: ["status", "order status"],
};
type Key = keyof typeof ALIASES;
const REQUIRED: Key[] = ["channel", "channelItemId", "channelOrderId"];

export function channelOf(raw: string): ChannelId {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (s.startsWith("shopgoodwill") || s === "sgw") return "shopgoodwill";
  if (s.startsWith("ebay")) return "ebay";
  if (s.startsWith("amazon")) return "amazon";
  if (s.startsWith("goodwillbooks")) return "goodwill_books";
  return "other";
}

export const uprightParser: SourceParser = {
  sourceId: "upright",
  version: "1.0.0",

  accepts(table: RawTable): boolean {
    return findHeaderRowByAliases(table, ALIASES, REQUIRED) >= 0;
  },

  parse(table, ctx): ParseResult {
    const h = findHeaderRowByAliases(table, ALIASES, REQUIRED);
    if (h < 0) return headerNotFound("Upright Paid Order Items");

    const header = table[h];
    const col = columnIndex(header, ALIASES);
    const result: ParseResult = {
      orders: [],
      moneyLines: [],
      warnings: [],
      headerRowIndex: h,
      header: header.map(normalizeHeader),
    };
    warnMissingColumns(result, col, ["price", "orderedAt"]);
    const otherChannels = new Set<string>();

    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      const sourceRow = i + 1;
      if (isBlankRow(row)) continue;

      const rawChannel = cell(row, col.channel);
      const channel = channelOf(rawChannel);
      if (channel === "other" && rawChannel) otherChannels.add(rawChannel);

      const itemId = cell(row, col.channelItemId) || null;
      let orderId = cell(row, col.channelOrderId);
      if (!orderId) {
        orderId = cell(row, col.uprightOrderId);
        if (!orderId) {
          result.warnings.push({ row: sourceRow, message: "Row without Channel Order ID or Upright order id; skipped." });
          continue;
        }
        result.warnings.push({
          row: sourceRow,
          message: `No Channel Order ID; used Upright order id ${orderId}, which will not dedupe against the ${channel} file.`,
        });
      }

      const rawDate = cell(row, col.orderedAt) || cell(row, col.paidAt);
      const when = parseDateTime(rawDate);
      if (!when) {
        result.warnings.push({ row: sourceRow, message: `Unreadable Ordered At "${rawDate}"; row skipped.` });
        continue;
      }

      const quantity = parseInt(cell(row, col.quantity), 10) || 1;
      const unit = toCents(cell(row, col.price));
      if (unit == null) {
        result.warnings.push({ row: sourceRow, message: `Unreadable Price "${cell(row, col.price)}"; row skipped.` });
        continue;
      }
      const amounts = {
        grossCents: unit * quantity,
        shippingCents: cents(row, col.shipping),
        refundCents: Math.abs(cents(row, col.refund)),
        feeCents: Math.abs(cents(row, col.fees)),
        taxCents: cents(row, col.tax),
      };
      const statusText = cell(row, col.status).toLowerCase();
      const status = /cancel/.test(statusText) ? "cancelled" : amounts.refundCents > 0 || /refund/.test(statusText) ? "refunded" : "paid";

      result.orders.push({
        sourceRow,
        channel,
        externalOrderId: orderId,
        externalItemId: itemId,
        ...stamp(when),
        buyerId: cell(row, col.buyer) || null,
        category: cell(row, col.category) || null,
        quantity,
        currency: "USD",
        ...amounts,
        netCents: netOf(amounts),
        status,
      });
    }

    if (otherChannels.size) {
      result.warnings.push({ message: `Channels mapped to "other": ${[...otherChannels].join(", ")}.` });
    }
    return finishResult(result, ctx.fileName, ctx.period);
  },
};
