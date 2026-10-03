/**
 * Upright Labs (Upright Lister) "Paid Order Items" report parser. One row per
 * sold item, across marketplaces (ShopGoodwill, eBay, Facebook Marketplace, …).
 * Upright is the source of truth for orders (revenue_authority = 1).
 *
 * Layout: docs/sources/upright.md §1 (34 columns, A–AH). The old guessed
 * layout (Title, Price, Shipping, Fees, Ordered At, …) is still accepted.
 *
 * Assumptions:
 *  - [fact] Order-level money (V–AB, AH: Order Total, Order Subtotal, Order
 *    Shipping Total, Order Handling Total, Order Final Value Fee, Order Payment
 *    Processing Fee, Refund Amount, Order Channel Fee Or Credit Amount) repeats
 *    on every item row of a multi-item order. We book it ONCE per order, on the
 *    order's first item row in the file; the other item rows carry only their
 *    item money (Order Item Subtotal).
 *  - [fact] gross = `Order Item Subtotal` (Quantity × Order Item Price); fallback
 *    Order Item Price × Quantity.
 *  - shipping = Order Shipping Total + Order Handling Total. Handling is what
 *    the buyer pays ShopGoodwill sellers on top of shipping: money Goodwill
 *    receives, but not item revenue, so it goes with shipping, never gross.
 *  - fee = Order Final Value Fee + Order Payment Processing Fee + Order Channel
 *    Fee Or Credit Amount (a negative channel amount is a credit and lowers fees).
 *  - [fact] cancelled = `Order Cancelled At` filled. refunded = Refund Amount > 0.
 *    The status applies to every item row of the order.
 *  - [guess] tax = Order Total − Order Subtotal − Shipping − Handling (the report
 *    has no tax column; Order Total also contains donations, so this is an upper
 *    bound). Informational only: tax is never revenue.
 *  - [fact] Timestamps (P–S) have no zone: they are in the zone picked when the
 *    report was generated. Default America/Los_Angeles (Upright's own tip "for
 *    a closer match to Shopgoodwill's reports"). Override per upload with a
 *    file-name hint (`_et` / `_eastern` / `_indy`, `_ct` / `_central`, `_pt` /
 *    `_pacific`, or `_tz-America-Indiana-Indianapolis`) or ctx.reportTimezone.
 *  - [fact] Channel Order ID is the MARKETPLACE order id, so the dedupe key
 *    `${channel}:${channelOrderId}:${channelItemId}` collides with the same item
 *    in the eBay / ShopGoodwill files. Upright Order ID is a last-resort fallback.
 *  - `Channel Buyer ID` → buyerId (hashed by ingest). `Product Category` →
 *    category. `Poster` (employee) and `Supplier` are never emitted.
 *  - Channel map: ShopGoodwill, eBay, Amazon, GoodwillBooks → their channel;
 *    Upright's other integrations (Facebook Marketplace, Mercari, OfferUp,
 *    Shopify, GoodwillFinds) → `other` silently; anything else → `other` with
 *    one warning.
 */
import type { ParseContext, ParsedOrder, ParseResult, RawTable, SourceParser } from "./types";
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
  quantity: ["quantity", "qty"],
  category: ["product category", "category"],
  uprightOrderId: ["upright order id", "order id"],
  itemSubtotal: ["order item subtotal", "item subtotal"],
  price: ["order item price", "price", "sale price", "sold price"],
  // Order-level (repeated on every item row of an order in the real layout).
  orderTotal: ["order total"],
  orderSubtotal: ["order subtotal"],
  shipping: ["order shipping total", "shipping", "shipping paid", "shipping charged"],
  handling: ["order handling total", "handling"],
  finalValueFee: ["order final value fee", "fees", "marketplace fees", "channel fees"],
  processingFee: ["order payment processing fee", "payment processing fee"],
  channelFeeOrCredit: ["order channel fee or credit amount"],
  refund: ["refund amount", "refunded amount", "refund"],
  orderedAt: ["order ordered at", "ordered at", "order date", "ordered"],
  paidAt: ["order paid at", "paid at", "paid date", "paid"],
  cancelledAt: ["order cancelled at", "order canceled at", "cancelled at"],
  buyer: ["channel buyer id", "buyer username", "buyer", "buyer id"],
  tax: ["sales tax", "tax", "marketplace collected tax"],
  status: ["status", "order status"],
  currency: ["currency code", "currency"],
};
type Key = keyof typeof ALIASES;
const REQUIRED: Key[] = ["channel", "channelItemId", "channelOrderId"];

/** Upright's documented integrations that roll up into "other" without a warning. */
const KNOWN_OTHER = new Set(["facebookmarketplace", "facebook", "mercari", "offerup", "shopify", "goodwillfinds", "poshmark"]);

export const DEFAULT_UPRIGHT_TIMEZONE = "America/Los_Angeles";

export function channelOf(raw: string): ChannelId {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (s.startsWith("shopgoodwill") || s === "sgw") return "shopgoodwill";
  if (s.startsWith("ebay")) return "ebay";
  if (s.startsWith("amazon")) return "amazon";
  if (s.startsWith("goodwillbooks")) return "goodwill_books";
  return "other";
}

/**
 * Zone the report was generated in: ctx.reportTimezone (not yet in the
 * ParseContext type), else a file-name hint, else America/Los_Angeles.
 */
export function uprightTimezone(ctx: Pick<ParseContext, "fileName"> & { reportTimezone?: string }): string {
  if (ctx.reportTimezone) return ctx.reportTimezone;
  const name = ctx.fileName.toLowerCase();
  const tz = name.match(/tz[-_=]([a-z]+(?:-[a-z_]+)+)/i);
  if (tz) {
    const iana = tz[1].split("-").map((p) => p.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_")).join("/");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: iana });
      return iana;
    } catch {
      /* fall through */
    }
  }
  const tag = (re: RegExp) => new RegExp(`(^|[_\\-. ])(${re.source})([_\\-. ]|$)`).test(name);
  if (tag(/et|eastern|indy|indianapolis/)) return "America/Indiana/Indianapolis";
  if (tag(/ct|central|chicago/)) return "America/Chicago";
  if (tag(/pt|pacific|la/)) return "America/Los_Angeles";
  return DEFAULT_UPRIGHT_TIMEZONE;
}

export const uprightParser: SourceParser = {
  sourceId: "upright",
  version: "2.0.0",

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
    if (col.itemSubtotal < 0 && col.price < 0) warnMissingColumns(result, col, ["itemSubtotal"]);
    warnMissingColumns(result, col, ["orderedAt"]);
    const tz = uprightTimezone(ctx as ParseContext & { reportTimezone?: string });
    const unknownChannels = new Set<string>();

    // Pass 1: rows → items; order-level money taken from the first row of each order.
    interface Pending {
      order: ParsedOrder;
      key: string;
    }
    const pending: Pending[] = [];
    const firstOfOrder = new Map<string, ParsedOrder>();
    const orderStatus = new Map<string, "paid" | "refunded" | "cancelled">();

    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      const sourceRow = i + 1;
      if (isBlankRow(row)) continue;

      const rawChannel = cell(row, col.channel);
      const channel = channelOf(rawChannel);
      if (channel === "other" && rawChannel && !KNOWN_OTHER.has(rawChannel.toLowerCase().replace(/[^a-z]/g, ""))) {
        unknownChannels.add(rawChannel);
      }

      const itemId = cell(row, col.channelItemId) || null;
      let orderId = cell(row, col.channelOrderId);
      if (!orderId) {
        orderId = cell(row, col.uprightOrderId);
        if (!orderId) {
          result.warnings.push({ row: sourceRow, message: "Row without Channel Order ID or Upright Order ID; skipped." });
          continue;
        }
        result.warnings.push({
          row: sourceRow,
          message: `No Channel Order ID; used Upright Order ID ${orderId}, which will not dedupe against the ${channel} file.`,
        });
      }

      const rawDate = cell(row, col.orderedAt) || cell(row, col.paidAt);
      const when = parseDateTime(rawDate, tz);
      if (!when) {
        result.warnings.push({ row: sourceRow, message: `Unreadable Order Ordered At "${rawDate}"; row skipped.` });
        continue;
      }

      const quantity = parseInt(cell(row, col.quantity), 10) || 1;
      let gross = toCents(cell(row, col.itemSubtotal));
      if (gross == null) {
        const unit = toCents(cell(row, col.price));
        gross = unit == null ? null : unit * quantity;
      }
      if (gross == null) {
        result.warnings.push({
          row: sourceRow,
          message: `Unreadable Order Item Subtotal / Price "${cell(row, col.itemSubtotal) || cell(row, col.price)}"; row skipped.`,
        });
        continue;
      }

      const key = `${channel}:${orderId}`;
      const first = !firstOfOrder.has(key);
      const order: ParsedOrder = {
        sourceRow,
        channel,
        externalOrderId: orderId,
        externalItemId: itemId,
        ...stamp(when),
        buyerId: cell(row, col.buyer) || null,
        category: cell(row, col.category) || null,
        quantity,
        currency: cell(row, col.currency) || "USD",
        grossCents: gross,
        shippingCents: 0,
        refundCents: 0,
        feeCents: 0,
        taxCents: 0,
        netCents: 0,
        status: "paid",
      };

      if (first) {
        firstOfOrder.set(key, order);
        const shipping = cents(row, col.shipping);
        const handling = cents(row, col.handling);
        order.shippingCents = shipping + handling;
        order.feeCents =
          Math.abs(cents(row, col.finalValueFee)) + Math.abs(cents(row, col.processingFee)) + cents(row, col.channelFeeOrCredit);
        order.refundCents = Math.abs(cents(row, col.refund));
        const total = toCents(cell(row, col.orderTotal));
        const subtotal = toCents(cell(row, col.orderSubtotal));
        order.taxCents =
          total != null && subtotal != null ? Math.max(0, total - subtotal - shipping - handling) : cents(row, col.tax);

        const statusText = cell(row, col.status).toLowerCase();
        const cancelled = cell(row, col.cancelledAt) !== "" || /cancel/.test(statusText);
        orderStatus.set(
          key,
          cancelled ? "cancelled" : order.refundCents > 0 || /refund/.test(statusText) ? "refunded" : "paid",
        );
      }
      pending.push({ order, key });
    }

    // Pass 2: the order's status applies to all its item rows (the refund
    // money itself is booked on the first row only).
    for (const { order, key } of pending) {
      order.status = orderStatus.get(key) ?? "paid";
      order.netCents = netOf(order);
      result.orders.push(order);
    }

    if (unknownChannels.size) {
      result.warnings.push({ message: `Unknown channels mapped to "other": ${[...unknownChannels].join(", ")}.` });
    }
    return finishResult(result, ctx.fileName, ctx.period);
  },
};
