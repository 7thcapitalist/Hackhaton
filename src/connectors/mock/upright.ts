/**
 * Mock Upright Lister Public API `/reports/order_items` responses: a JSON
 * array, one object per sold item, with the 34 Paid Order Items CSV columns
 * as snake_case keys (our documented guess, see src/sources/upright_api.ts).
 *
 * Built FROM the orders the CSV parser reads in data/fixtures/upright/ for the
 * day, so the API mock and the CSV fixture describe the SAME sales (same
 * dedupe keys, same totals per order). Order-level money is repeated on every
 * item of the order, like the real report. All values are fake.
 */
import type { ParsedOrder } from "@/sources/types";
import { dec, seedOf } from "../util";

const CHANNEL_NAME: Record<string, string> = {
  shopgoodwill: "ShopGoodwill",
  ebay: "eBay",
  amazon: "Amazon",
  goodwill_books: "GoodwillBooks",
  other: "Facebook Marketplace",
};

/** ISO-8601 with the Indianapolis UTC offset, e.g. 2026-10-01T14:14:00-04:00. */
function indyIso(utc: Date): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Indiana/Indianapolis",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(utc);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const local = Date.UTC(+g("year"), +g("month") - 1, +g("day"), +g("hour"), +g("minute"), +g("second"));
  const off = Math.round((local - Math.floor(utc.getTime() / 1000) * 1000) / 60000);
  const sign = off < 0 ? "-" : "+";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}${sign}${hh}:${mm}`;
}

export function orderItemsFromParsed(orders: ParsedOrder[]): Record<string, unknown>[] {
  const groups = new Map<string, ParsedOrder[]>();
  for (const o of orders) {
    const k = `${o.channel}:${o.externalOrderId}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const out: Record<string, unknown>[] = [];
  for (const [k, items] of groups) {
    const sum = (f: (o: ParsedOrder) => number) => items.reduce((t, o) => t + f(o), 0);
    const subtotal = sum((o) => o.grossCents ?? 0);
    const shipping = sum((o) => o.shippingCents ?? 0);
    const fees = sum((o) => o.feeCents ?? 0);
    const refund = sum((o) => o.refundCents ?? 0);
    const tax = sum((o) => o.taxCents ?? 0);
    const first = items[0];
    const ts = indyIso(new Date(first.orderTs));
    const uprightOrderId = 900000 + (seedOf(k) % 100000);
    const cancelled = items.some((o) => o.status === "cancelled");
    for (const o of items) {
      const qty = o.quantity ?? 1;
      const gross = o.grossCents ?? 0;
      out.push({
        channel: CHANNEL_NAME[o.channel ?? "other"] ?? "Facebook Marketplace",
        channel_item_id: o.externalItemId,
        channel_order_id: o.externalOrderId,
        upright_order_id: uprightOrderId,
        upright_product_id: 800000 + (seedOf(`${k}:${o.externalItemId}`) % 100000),
        quantity: qty,
        inventory_location: null,
        product_sku: null,
        product_title: null,
        product_category: o.category ?? null,
        supplier: "Michiana E-Com (test)",
        product_carrier: null,
        order_shipping_method: shipping > 0 ? "USPS Ground Advantage" : "Pickup",
        order_item_price: dec(Math.round(gross / qty)),
        order_item_subtotal: dec(gross),
        order_ordered_at: ts,
        order_paid_at: ts,
        order_shipped_at: null,
        order_cancelled_at: cancelled ? ts : null,
        order_payment_id: null,
        order_payment_type: o.channel === "ebay" ? "eBay Managed Payments" : "Stripe",
        order_total: dec(subtotal + shipping + tax),
        order_subtotal: dec(subtotal),
        order_shipping_total: dec(shipping),
        order_handling_total: "0.00",
        order_final_value_fee: dec(fees),
        order_payment_processing_fee: "0.00",
        refund_amount: dec(refund),
        poster: null,
        product_weight: null,
        channel_buyer_id: o.buyerId ?? null,
        secondary_channel_order_id: null,
        currency_code: o.currency ?? "USD",
        order_channel_fee_or_credit_amount: "0.00",
      });
    }
  }
  return out;
}
