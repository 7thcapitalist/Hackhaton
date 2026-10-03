/**
 * eBay REST API (JSON) parser: the API twin of ./ebay.ts (Seller Hub Orders CSV).
 * sourceId is "ebay", same as the CSV parser, so dedupe and views treat both
 * as one source. A JSON order and a CSV row for the same sale get the SAME
 * dedupe key: `ebay:<orderId>:<legacyItemId>` (CSV "Order Number" is the
 * REST orderId, CSV "Item Number" is lineItems[].legacyItemId).
 *
 * Accepted documents (one API response per file, saved verbatim):
 *  1. Sell Fulfillment API getOrders → OrderSearchPagedCollection
 *     { href, total, limit, offset, next?, orders: Order[] }  (or one Order from getOrder)
 *     https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders
 *     https://developer.ebay.com/api-docs/sell/fulfillment/types/sel:Order
 *     https://developer.ebay.com/api-docs/sell/fulfillment/types/sel:LineItem
 *     https://developer.ebay.com/api-docs/sell/fulfillment/types/sel:PricingSummary
 *     https://developer.ebay.com/api-docs/sell/fulfillment/types/sel:PaymentSummary
 *     https://developer.ebay.com/api-docs/sell/fulfillment/types/sel:EbayCollectAndRemitTax
 *  2. Finances API getTransactions → { transactions: Transaction[], total, next? }
 *     https://developer.ebay.com/api-docs/sell/finances/resources/transaction/methods/getTransactions
 *  3. Finances API getPayouts → { payouts: Payout[], total, next? }
 *     https://developer.ebay.com/api-docs/sell/finances/resources/payout/methods/getPayouts
 *
 * Mapping (one ParsedOrder per Order.lineItems[] entry, like the CSV):
 *  - externalOrderId = orderId; externalItemId = legacyItemId (fallback lineItemId + warning)
 *  - orderTs = creationDate (ISO UTC); businessDate = its America/Indiana/Indianapolis date
 *  - buyerId = buyer.username (ingest hashes it; never stored)
 *  - grossCents = lineItemCost.value  [fact: unit price × quantity, before discounts]
 *  - shippingCents = deliveryCost.shippingCost + deliveryCost.handlingCost
 *  - taxCents = Σ ebayCollectAndRemitTaxes[].amount + Σ taxes[].amount (never in net)
 *  - refundCents = Σ lineItems[].refunds[].amount; order-level paymentSummary.refunds
 *    (status REFUNDED) not covered by line refunds go on the first line item.
 *  - feeCents = totalMarketplaceFee on the first line item [the CSV has no fee
 *    column, so net can differ from the CSV twin by exactly this fee]
 *  - status: cancelStatus.cancelState CANCELED → cancelled; orderPaymentStatus
 *    FULLY_REFUNDED/PARTIALLY_REFUNDED or any refund → refunded (FULLY_REFUNDED
 *    without amounts → refund = gross + shipping, same rule as the CSV parser).
 *  - Sanity check: lineItems[].total should equal gross + shipping (+ Collect and
 *    Remit tax, which eBay includes in total) − discounts; warning otherwise.
 *
 * Finances (money lines, channel "ebay"):
 *  - SALE and REFUND transactions are skipped: the orders feed already has them.
 *  - NON_SALE_CHARGE → "marketplace_fee"; SHIPPING_LABEL → "shipping_label";
 *    DISPUTE / ADJUSTMENT / CREDIT / TRANSFER / other → "adjustment".
 *    Sign from bookingEntry (DEBIT = money out). FAILED transactions skipped.
 *  - Payouts with payoutStatus SUCCEEDED → "payout" (+, money arriving at the
 *    bank), payoutId set, bankAccountNo = payoutInstrument.accountLastFourDigits.
 *
 * Buyer addresses, names and emails in the payload are ignored and never leave
 * this function.
 */
import type { ParsedMoneyLine, ParsedOrder, ParseResult, ParseWarning } from "./types";
import { businessDateOf, periodOf } from "./_shared/table";
import { finishResult, netOf, stamp } from "./_shared/marketplace";
import { amountCents, arr, isObj, jsonSourceParser, str, topKeys, type Obj } from "./_shared/json";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function isOrder(v: unknown): boolean {
  return isObj(v) && typeof v.orderId === "string" && Array.isArray(v.lineItems);
}

type DocKind = "orders" | "transactions" | "payouts";

function kindOf(json: unknown): DocKind | null {
  if (!isObj(json)) return null;
  if (Array.isArray(json.orders) && json.orders.every(isOrder)) return "orders";
  if (isOrder(json)) return "orders";
  if (Array.isArray(json.transactions)) return "transactions";
  if (Array.isArray(json.payouts)) return "payouts";
  return null;
}

function instant(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseOrders(json: Obj, result: ParseResult): void {
  const list: unknown[] = Array.isArray(json.orders) ? json.orders : [json];
  let row = 0;
  for (const item of list) {
    row++;
    if (!isOrder(item)) continue;
    const order = item as Obj;
    const warn = (message: string) => result.warnings.push({ row, message: `order ${order.orderId}: ${message}` });
    const when = instant(order.creationDate);
    if (!when) {
      warn(`unreadable creationDate "${str(order.creationDate)}"; skipped.`);
      continue;
    }
    const buyer = isObj(order.buyer) ? str(order.buyer.username) || null : null;
    const cancelled = isObj(order.cancelStatus) && str(order.cancelStatus.cancelState) === "CANCELED";
    const payStatus = str(order.orderPaymentStatus);
    const lineItems = arr(order.lineItems).filter(isObj);

    const lineRefunds = lineItems.map((li) => sum(arr(li.refunds).map((r) => (isObj(r) ? amountCents(r.amount) : 0))));
    const orderRefunds = isObj(order.paymentSummary)
      ? sum(
          arr(order.paymentSummary.refunds)
            .filter((r) => isObj(r) && (!r.refundStatus || r.refundStatus === "REFUNDED"))
            .map((r) => amountCents((r as Obj).amount)),
        )
      : 0;
    const unallocated = Math.max(0, orderRefunds - sum(lineRefunds));
    const fee = Math.abs(amountCents(order.totalMarketplaceFee));

    lineItems.forEach((li, idx) => {
      const legacy = str(li.legacyItemId);
      const itemId = legacy || str(li.lineItemId);
      if (!legacy) warn(`line item ${str(li.lineItemId)} has no legacyItemId; used lineItemId (will not dedupe against the CSV).`);
      const quantity = Number(li.quantity) > 0 ? Math.round(Number(li.quantity)) : 1;
      const gross = amountCents(li.lineItemCost);
      const delivery = isObj(li.deliveryCost) ? li.deliveryCost : {};
      const shipping = amountCents(delivery.shippingCost) + amountCents(delivery.handlingCost);
      const remit = sum(arr(li.ebayCollectAndRemitTaxes).map((t) => (isObj(t) ? amountCents(t.amount) : 0)));
      const sellerTax = sum(arr(li.taxes).map((t) => (isObj(t) ? amountCents(t.amount) : 0)));
      const discounts = sum(arr(li.appliedPromotions).map((p) => (isObj(p) ? Math.abs(amountCents(p.discountAmount)) : 0)));
      let refund = Math.abs(lineRefunds[idx] + (idx === 0 ? unallocated : 0));

      let status: ParsedOrder["status"] = "paid";
      if (cancelled) status = "cancelled";
      else if (refund > 0 || payStatus === "FULLY_REFUNDED" || payStatus === "PARTIALLY_REFUNDED") {
        status = "refunded";
        if (refund === 0) refund = gross + shipping;
      }

      if (isObj(li.total)) {
        const total = amountCents(li.total);
        const base = gross + shipping - discounts;
        if (total !== base + remit + sellerTax && total !== base && total !== base + remit) {
          warn(`line item ${itemId}: total ${total / 100} does not match cost + shipping (+ tax) (${(base + remit + sellerTax) / 100}).`);
        }
      }

      const amounts = {
        grossCents: gross,
        shippingCents: shipping,
        refundCents: refund,
        feeCents: idx === 0 ? fee : 0,
        taxCents: remit + sellerTax,
      };
      result.orders.push({
        sourceRow: row,
        channel: "ebay",
        externalOrderId: str(order.orderId),
        externalItemId: itemId || null,
        ...stamp(when),
        buyerId: buyer,
        quantity,
        currency: (isObj(li.lineItemCost) && str(li.lineItemCost.currency)) || "USD",
        ...amounts,
        netCents: netOf(amounts),
        status,
      });
    });
  }
}

const TX_TYPES: Record<string, string> = {
  NON_SALE_CHARGE: "marketplace_fee",
  SHIPPING_LABEL: "shipping_label",
};

function moneyLine(row: number, when: Date, amountType: string, cents: number, extra: Partial<ParsedMoneyLine>): ParsedMoneyLine {
  const lineDate = businessDateOf(when);
  return {
    sourceRow: row,
    channel: "ebay",
    lineDate,
    period: periodOf(lineDate),
    amountType,
    amountCents: cents,
    reference: null,
    memo: null,
    ...extra,
  };
}

function parseTransactions(json: Obj, result: ParseResult): void {
  let row = 0;
  for (const tx of arr(json.transactions)) {
    row++;
    if (!isObj(tx)) continue;
    const type = str(tx.transactionType);
    if (type === "SALE" || type === "REFUND") continue; // covered by the orders feed
    if (str(tx.transactionStatus) === "FAILED") continue;
    const when = instant(tx.transactionDate);
    if (!when) {
      result.warnings.push({ row, message: `transaction ${str(tx.transactionId)}: unreadable transactionDate; skipped.` });
      continue;
    }
    const abs = Math.abs(amountCents(tx.amount));
    const sign = str(tx.bookingEntry) === "DEBIT" ? -1 : 1;
    const memo = ["eBay", type, str(tx.feeType), str(tx.transactionMemo)].filter(Boolean).join(" ");
    result.moneyLines.push(
      moneyLine(row, when, TX_TYPES[type] ?? "adjustment", sign * abs, {
        reference: str(tx.orderId) || str(tx.transactionId) || null,
        payoutId: str(tx.payoutId) || null,
        memo,
      }),
    );
  }
}

function parsePayouts(json: Obj, result: ParseResult): void {
  let row = 0;
  for (const p of arr(json.payouts)) {
    row++;
    if (!isObj(p)) continue;
    const status = str(p.payoutStatus);
    if (status !== "SUCCEEDED") {
      if (status && status !== "INITIATED") result.warnings.push({ row, message: `payout ${str(p.payoutId)}: status ${status}; not counted.` });
      continue;
    }
    const when = instant(p.payoutDate);
    if (!when) {
      result.warnings.push({ row, message: `payout ${str(p.payoutId)}: unreadable payoutDate; skipped.` });
      continue;
    }
    const instrument = isObj(p.payoutInstrument) ? p.payoutInstrument : {};
    result.moneyLines.push(
      moneyLine(row, when, "payout", Math.abs(amountCents(p.amount)), {
        payoutId: str(p.payoutId) || null,
        bankAccountNo: str(instrument.accountLastFourDigits) || null,
        reference: str(p.payoutId) || null,
        memo: `eBay payout${str(instrument.nickname) ? ` to ${str(instrument.nickname)}` : ""}`,
      }),
    );
  }
}

export const ebayApiParser = jsonSourceParser({
  sourceId: "ebay",
  version: "api-1.0.0",

  acceptsJson(json: unknown): boolean {
    return kindOf(json) !== null;
  },

  parseJson(json, ctx): ParseResult {
    const result: ParseResult = {
      orders: [],
      moneyLines: [],
      warnings: [] as ParseWarning[],
      headerRowIndex: 0,
      header: topKeys(json),
    };
    const kind = kindOf(json);
    if (!kind || !isObj(json)) {
      result.warnings.push({ message: "Not an eBay getOrders / getTransactions / getPayouts response." });
      return result;
    }
    if (kind === "orders") parseOrders(json, result);
    else if (kind === "transactions") parseTransactions(json, result);
    else parsePayouts(json, result);
    // A `next` link is normal: the connector saves each page as its own file.
    return finishResult(result, ctx.fileName, ctx.period);
  },
});
