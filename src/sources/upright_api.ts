/**
 * Upright Labs Lister Public API (JSON) parser: the API twin of ./upright.ts
 * (Paid Order Items CSV). sourceId "upright", same as the CSV parser, so dedupe
 * and views treat both as one source.
 *
 * Endpoint (docs/sources/upright.md §2):
 *   GET https://app.uprightlabs.com/api/reports/order_items?time_start=…&time_end=…
 *   header X-Authorization: <token>   (≤ 365 days per call, ≤ ~10k records)
 *
 * [guess] SHAPE. Upright's API docs are login-gated, so the field names are not
 * public. We assume one object per Paid Order Items CSV row, with the 34 CSV
 * columns (A–AH) as snake_case keys (docs/sources/upright.md §1 and §3):
 *   channel, channel_item_id, channel_order_id, upright_order_id,
 *   upright_product_id, quantity, inventory_location, product_sku,
 *   product_title, product_category, supplier, product_carrier,
 *   order_shipping_method, order_item_price, order_item_subtotal,
 *   order_ordered_at, order_paid_at, order_shipped_at, order_cancelled_at,
 *   order_payment_id, order_payment_type, order_total, order_subtotal,
 *   order_shipping_total, order_handling_total, order_final_value_fee,
 *   order_payment_processing_fee, refund_amount, poster, product_weight,
 *   channel_buyer_id, secondary_channel_order_id, currency_code,
 *   order_channel_fee_or_credit_amount
 * Because that is a guess, every lookup is alias-tolerant: keys are compared
 * after lowercasing and dropping non-alphanumerics, so `channel_order_id`,
 * `channelOrderId` and `Channel Order ID` all match, and each field has a few
 * alternative names. The document may be a bare array, or an object wrapping
 * the array in `order_items` / `data` / `results` / `items` / `records`.
 * Confirm with one real call and tighten.
 *
 * Mapping (same rules as the CSV parser):
 *  - externalOrderId = channel_order_id (the MARKETPLACE id, so the dedupe key
 *    `${channel}:${orderId}:${itemId}` matches the eBay / ShopGoodwill / Amazon
 *    rows). upright_order_id only as a fallback, with a warning.
 *  - externalItemId = channel_item_id.
 *  - orderTs = order_ordered_at (fallback order_paid_at). A value with a zone or
 *    offset is honored; without one it is read as Indianapolis local time.
 *  - grossCents = order_item_subtotal (qty × price; Upright: "use for all
 *    revenue"), fallback order_item_price × quantity.
 *  - ORDER-LEVEL money is repeated on every item of a multi-item order, so it is
 *    counted ONCE, on the first item of each order in the document:
 *      shipping = order_shipping_total + order_handling_total
 *      fee      = order_final_value_fee + order_payment_processing_fee
 *                 + order_channel_fee_or_credit_amount  [guess: + = a fee]
 *      refund   = refund_amount
 *      tax      = order_total − subtotal − shipping − handling, when positive
 *                 [guess: that remainder is tax + donation; never revenue]
 *  - status: order_cancelled_at set → cancelled; refund > 0 → refunded (every
 *    item of the order); else paid.
 *  - buyerId = channel_buyer_id (ingest hashes it; never stored).
 *  - channel: ShopGoodwill / eBay / Amazon / GoodwillBooks map to their ids;
 *    known other Upright channels (Shopify, OfferUp, Facebook Marketplace,
 *    GoodwillFinds, Mercari, Poshmark, Etsy, Walmart, in-store/pickup) map to
 *    "other" silently; unknown names map to "other" with one warning.
 *  - poster (an employee) and inventory location are never emitted (privacy).
 */
import type { ParsedOrder, ParseResult, ParseWarning } from "./types";
import { toCents } from "./_shared/table";
import { finishResult, netOf, parseDateTime, stamp, type ChannelId } from "./_shared/marketplace";
import { arr, isObj, jsonSourceParser, str, type Obj } from "./_shared/json";

const FIELDS = {
  channel: ["channel", "marketplace", "sales_channel", "channel_name"],
  channelItemId: ["channel_item_id", "marketplace_item_id", "channel_listing_id", "listing_id"],
  channelOrderId: ["channel_order_id", "marketplace_order_id", "external_order_id"],
  uprightOrderId: ["upright_order_id", "order_id"],
  quantity: ["quantity", "qty"],
  category: ["product_category", "category"],
  itemPrice: ["order_item_price", "item_price", "price"],
  itemSubtotal: ["order_item_subtotal", "item_subtotal", "subtotal"],
  orderedAt: ["order_ordered_at", "ordered_at", "order_date"],
  paidAt: ["order_paid_at", "paid_at"],
  cancelledAt: ["order_cancelled_at", "cancelled_at", "order_canceled_at", "canceled_at"],
  orderTotal: ["order_total", "total"],
  orderSubtotal: ["order_subtotal"],
  shippingTotal: ["order_shipping_total", "shipping_total", "shipping"],
  handlingTotal: ["order_handling_total", "handling_total", "handling"],
  finalValueFee: ["order_final_value_fee", "final_value_fee"],
  processingFee: ["order_payment_processing_fee", "payment_processing_fee"],
  channelFee: ["order_channel_fee_or_credit_amount", "channel_fee_or_credit_amount", "channel_fee"],
  refund: ["refund_amount", "order_refund_amount", "refunded_amount"],
  buyer: ["channel_buyer_id", "buyer_id", "buyer_username"],
  currency: ["currency_code", "currency"],
} as const;
type Field = keyof typeof FIELDS;

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Alias-tolerant reader over one record (keys normalized once). */
function reader(rec: Obj) {
  const byNorm = new Map<string, unknown>();
  for (const [k, v] of Object.entries(rec)) byNorm.set(norm(k), v);
  const raw = (f: Field): unknown => {
    for (const a of FIELDS[f]) {
      const v = byNorm.get(norm(a));
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  return {
    has: (f: Field) => raw(f) !== undefined,
    s: (f: Field) => str(raw(f)),
    /** Money as cents (number or decimal string, "$" / "," tolerated); null if absent/bad. */
    c: (f: Field): number | null => {
      const v = raw(f);
      if (v === undefined) return null;
      return typeof v === "number" ? Math.round(v * 100) : toCents(str(v));
    },
  };
}

const LIST_KEYS = ["order_items", "orderitems", "data", "results", "items", "records"];

function itemsOf(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (!isObj(json)) return null;
  for (const [k, v] of Object.entries(json)) if (LIST_KEYS.includes(norm(k)) && Array.isArray(v)) return v;
  return null;
}

function isOrderItem(v: unknown): boolean {
  if (!isObj(v)) return false;
  const r = reader(v);
  return r.has("channel") && r.has("channelItemId") && (r.has("channelOrderId") || r.has("uprightOrderId"));
}

const KNOWN_OTHER = /^(shopify|offerup|facebook|fbmarketplace|goodwillfinds|mercari|poshmark|etsy|walmart|instore|store|pickup|local|whatnot|depop)/;

export function uprightChannelOf(raw: string): { channel: ChannelId; known: boolean } {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (s.startsWith("shopgoodwill") || s === "sgw") return { channel: "shopgoodwill", known: true };
  if (s.startsWith("ebay")) return { channel: "ebay", known: true };
  if (s.startsWith("amazon")) return { channel: "amazon", known: true };
  if (s.startsWith("goodwillbooks")) return { channel: "goodwill_books", known: true };
  return { channel: "other", known: KNOWN_OTHER.test(s) };
}

function instant(v: string): Date | null {
  if (!v) return null;
  return parseDateTime(v);
}

export const uprightApiParser = jsonSourceParser({
  sourceId: "upright",
  version: "api-1.0.0",

  acceptsJson(json: unknown, fileName: string): boolean {
    const list = itemsOf(json);
    if (!list) return false;
    // An empty page has nothing to recognize it by but its file name.
    if (list.length === 0) return /upright/i.test(fileName);
    return list.every(isOrderItem);
  },

  parseJson(json, ctx): ParseResult {
    const list = itemsOf(json) ?? [];
    const result: ParseResult = {
      orders: [],
      moneyLines: [],
      warnings: [] as ParseWarning[],
      headerRowIndex: 0,
      header: isObj(list[0]) ? Object.keys(list[0] as Obj).map((k) => k.toLowerCase()) : [],
    };
    const unknownChannels = new Set<string>();
    const seenOrders = new Set<string>();
    /** order key → its emitted lines, to apply order-level status to every item. */
    const byOrder = new Map<string, ParsedOrder[]>();

    let row = 0;
    for (const item of arr(list)) {
      row++;
      if (!isObj(item)) continue;
      const r = reader(item);
      const warn = (message: string) => result.warnings.push({ row, message });

      const rawChannel = r.s("channel");
      const { channel, known } = uprightChannelOf(rawChannel);
      if (!known && rawChannel) unknownChannels.add(rawChannel);

      let orderId = r.s("channelOrderId");
      if (!orderId) {
        orderId = r.s("uprightOrderId");
        if (!orderId) {
          warn("Item without channel_order_id or upright_order_id; skipped.");
          continue;
        }
        warn(`No channel_order_id; used upright_order_id ${orderId}, which will not dedupe against the ${channel} file.`);
      }
      const itemId = r.s("channelItemId") || null;

      const rawDate = r.s("orderedAt") || r.s("paidAt");
      const when = instant(rawDate);
      if (!when) {
        warn(`order ${orderId}: unreadable order_ordered_at "${rawDate}"; skipped.`);
        continue;
      }

      const quantity = parseInt(r.s("quantity"), 10) > 0 ? parseInt(r.s("quantity"), 10) : 1;
      let gross = r.c("itemSubtotal");
      if (gross == null) {
        const unit = r.c("itemPrice");
        if (unit == null) {
          warn(`order ${orderId}: no order_item_subtotal or order_item_price; skipped.`);
          continue;
        }
        gross = unit * quantity;
      }

      // Order-level money: once per order (first item seen), never per item.
      const orderKey = `${channel}:${orderId}`;
      const first = !seenOrders.has(orderKey);
      seenOrders.add(orderKey);
      let shipping = 0, fee = 0, refund = 0, tax = 0;
      if (first) {
        const ship = r.c("shippingTotal") ?? 0;
        const handling = r.c("handlingTotal") ?? 0;
        shipping = ship + handling;
        fee = (r.c("finalValueFee") ?? 0) + (r.c("processingFee") ?? 0) + (r.c("channelFee") ?? 0);
        refund = Math.abs(r.c("refund") ?? 0);
        const total = r.c("orderTotal");
        const subtotal = r.c("orderSubtotal");
        if (total != null && subtotal != null) tax = Math.max(0, total - subtotal - ship - handling);
      }

      const cancelled = r.has("cancelledAt");
      const amounts = { grossCents: gross, shippingCents: shipping, refundCents: refund, feeCents: fee, taxCents: tax };
      const order: ParsedOrder = {
        sourceRow: row,
        channel,
        externalOrderId: orderId,
        externalItemId: itemId,
        ...stamp(when),
        buyerId: r.s("buyer") || null,
        category: r.s("category") || null,
        quantity,
        currency: r.s("currency") || "USD",
        ...amounts,
        netCents: netOf(amounts),
        status: cancelled ? "cancelled" : refund > 0 ? "refunded" : "paid",
      };
      result.orders.push(order);
      const lines = byOrder.get(orderKey) ?? [];
      lines.push(order);
      byOrder.set(orderKey, lines);
    }

    // A refund is order-level: every item of a refunded order is "refunded".
    for (const lines of byOrder.values()) {
      if (lines.some((o) => o.status === "refunded")) for (const o of lines) if (o.status === "paid") o.status = "refunded";
    }

    if (unknownChannels.size) {
      result.warnings.push({ message: `Channels mapped to "other": ${[...unknownChannels].join(", ")}.` });
    }
    return finishResult(result, ctx.fileName, ctx.period);
  },
});
