/**
 * Amazon SP-API Finances API v2024-06-19 `listTransactions` (JSON) parser: the
 * API twin of ./amazon.ts (Seller Central Date Range Transaction CSV).
 * sourceId "amazon", same as the CSV parser.
 *
 *   GET /finances/2024-06-19/transactions?postedAfter=…&postedBefore=…&marketplaceId=…[&nextToken=…]
 *   https://developer-docs.amazon.com/sp-api/docs/finances-api-v2024-06-19-reference
 *   Model: https://github.com/amzn/selling-partner-api-models/blob/main/models/finances-api-model/finances_2024-06-19.json
 *
 * Shape [fact, model]: ListTransactionsResponse { payload: { nextToken?, transactions: Transaction[] } }
 *   Transaction { sellingPartnerMetadata, relatedIdentifiers[{relatedIdentifierName, relatedIdentifierValue}],
 *     transactionType, transactionId, transactionStatus (DEFERRED|RELEASED|DEFERRED_RELEASED),
 *     description ("Order Payment", "Refund Order"), postedDate (ISO), totalAmount {currencyCode, currencyAmount},
 *     marketplaceDetails, items[], contexts[], breakdowns[] }
 *   Item { description, relatedIdentifiers[{itemRelatedIdentifierName, …Value}], totalAmount, breakdowns[], contexts[] }
 *   Breakdown { breakdownType, breakdownAmount {currencyCode, currencyAmount}, breakdowns[] (nested) }
 *   ProductContext { contextType: "ProductContext", asin, sku, quantityShipped, fulfillmentNetwork }
 *   relatedIdentifierName ∈ ORDER_ID, SHIPMENT_ID, FINANCIAL_EVENT_GROUP_ID, REFUND_ID, INVOICE_ID,
 *     DISBURSEMENT_ID, TRANSFER_ID, DEFERRED_TRANSACTION_ID, RELEASE_TRANSACTION_ID, SETTLEMENT_ID.
 * [guess] The model lists only "Shipment" as a transactionType and does not
 * enumerate breakdownType values (its example: "Sales" > "Product Charges").
 * We classify by normalized name (lowercase, no spaces/punctuation) and walk
 * nested breakdowns down to the leaves.
 *
 * Mapping (same rules as amazon.ts):
 *  - Shipment / Order → one ParsedOrder per (ORDER_ID, sku). Leaf breakdowns:
 *      product charges / principal / gift wrap / promotions → gross
 *      shipping charges                                     → shipping
 *      *tax (collected)                                     → tax (never revenue)
 *      marketplace facilitator / withheld tax               → withheld (tax fallback, like the CSV)
 *      Amazon fees / commission / referral / closing / FBA  → fee (stored positive)
 *    Item-level breakdowns are used when present; otherwise a single-item
 *    transaction uses the transaction-level breakdowns.
 *  - Refund (type or description) → folded into the same order (refund, fee
 *    back, tax back, status refunded); when the order is not in the document,
 *    a "refund" money line + warning (same as the CSV).
 *  - ServiceFee → marketplace_fee; FBA inventory/return fees → fulfillment_fee;
 *    Adjustment → adjustment; Transfer / Disbursement → payout (+ = money
 *    arriving at the bank: the API amount is negative for the seller balance,
 *    so it is flipped, same as the CSV). Unknown types → warning, skipped.
 *  - Buyer: the API has none (buyerId null), same as the CSV.
 */
import type { ParsedMoneyLine, ParsedOrder, ParseResult, ParseWarning } from "./types";
import { businessDateOf, periodOf } from "./_shared/table";
import { finishResult, netOf, refreshNet, stamp } from "./_shared/marketplace";
import { arr, decimalCents, isObj, jsonSourceParser, str, topKeys, type Obj } from "./_shared/json";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** SP-API Currency { currencyCode, currencyAmount } → cents (0 when absent). */
export function currencyCents(v: unknown): number {
  return isObj(v) ? decimalCents(v.currencyAmount) ?? 0 : 0;
}

function transactionsOf(json: unknown): unknown[] | null {
  if (!isObj(json)) return null;
  const payload = isObj(json.payload) ? json.payload : null;
  if (payload && Array.isArray(payload.transactions)) return payload.transactions;
  return null;
}

function isTransaction(v: unknown): boolean {
  return isObj(v) && typeof v.transactionType === "string" && (isObj(v.totalAmount) || typeof v.postedDate === "string");
}

function relatedId(tx: Obj, name: string): string {
  for (const r of arr(tx.relatedIdentifiers)) {
    if (isObj(r) && str(r.relatedIdentifierName) === name) return str(r.relatedIdentifierValue);
  }
  return "";
}

function productContext(node: Obj): Obj | null {
  for (const c of arr(node.contexts)) if (isObj(c) && (str(c.contextType) === "ProductContext" || c.sku !== undefined)) return c;
  return null;
}

interface Components {
  gross: number;
  shipping: number;
  tax: number;
  withheld: number;
  fee: number;
  other: number;
  /** Any leaf seen at all. */
  seen: boolean;
}

const empty = (): Components => ({ gross: 0, shipping: 0, tax: 0, withheld: 0, fee: 0, other: 0, seen: false });

function classify(type: string): keyof Omit<Components, "seen"> {
  const t = norm(type);
  if (/withheld|facilitator/.test(t)) return "withheld";
  if (/tax/.test(t)) return "tax";
  if (/^shipping(charge|charges|credit|credits)?$|^shippingcharges?$/.test(t)) return "shipping";
  if (/product|principal|giftwrap|promotion|rebate|^sales$|itemprice/.test(t)) return "gross";
  if (/fee|commission|referral|closing|amazonfees|fba|expense/.test(t)) return "fee";
  return "other";
}

/** Sum leaf breakdowns into components (nested breakdowns: leaves only). */
function components(breakdowns: unknown): Components {
  const c = empty();
  const walk = (list: unknown) => {
    for (const b of arr(list)) {
      if (!isObj(b)) continue;
      const kids = arr(b.breakdowns);
      if (kids.length) {
        walk(kids);
        continue;
      }
      c[classify(str(b.breakdownType))] += currencyCents(b.breakdownAmount);
      c.seen = true;
    }
  };
  walk(breakdowns);
  return c;
}

type TxKind = "order" | "refund" | "money";

function kindOf(tx: Obj): { kind: TxKind; amountType?: string } {
  const t = norm(str(tx.transactionType));
  const d = norm(str(tx.description));
  if (/refund|chargeback|guarantee/.test(t) || (/^shipment$/.test(t) && /refund/.test(d))) return { kind: "refund" };
  if (t === "shipment" || t === "order" || t === "orderpayment") return { kind: "order" };
  if (/transfer|disbursement/.test(t)) return { kind: "money", amountType: "payout" };
  if (/fbainventory|fbacustomerreturn|fbafee|fulfillment/.test(t)) return { kind: "money", amountType: "fulfillment_fee" };
  if (/servicefee|subscription|deal|advertis/.test(t)) return { kind: "money", amountType: "marketplace_fee" };
  if (/adjustment|retrocharge|reimbursement|debt/.test(t)) return { kind: "money", amountType: "adjustment" };
  return { kind: "money" };
}

interface Line {
  sku: string | null;
  quantity: number;
  c: Components;
}

/** Item lines of a transaction (one per item; falls back to the transaction itself). */
function linesOf(tx: Obj, warn: (m: string) => void): Line[] {
  const items = arr(tx.items).filter(isObj);
  const txC = components(tx.breakdowns);
  const lines: Line[] = items.map((it) => {
    const ctx = productContext(it);
    const q = Number(ctx?.quantityShipped);
    return { sku: str(ctx?.sku) || null, quantity: q > 0 ? Math.round(q) : 1, c: components(it.breakdowns) };
  });
  if (!lines.length) {
    const ctx = productContext(tx);
    const q = Number(ctx?.quantityShipped);
    return [{ sku: str(ctx?.sku) || null, quantity: q > 0 ? Math.round(q) : 1, c: txC }];
  }
  if (lines.every((l) => !l.c.seen)) {
    if (lines.length > 1) warn(`${lines.length} items without item-level breakdowns; all money put on the first item.`);
    lines[0].c = txC;
  }
  return lines;
}

export const amazonApiParser = jsonSourceParser({
  sourceId: "amazon",
  version: "api-1.0.0",

  acceptsJson(json: unknown): boolean {
    const list = transactionsOf(json);
    return list !== null && list.every(isTransaction);
  },

  parseJson(json, ctx): ParseResult {
    const result: ParseResult = {
      orders: [],
      moneyLines: [],
      warnings: [] as ParseWarning[],
      headerRowIndex: 0,
      header: topKeys(json),
    };
    const list = transactionsOf(json);
    if (!list) {
      result.warnings.push({ message: "Not an SP-API Finances listTransactions response." });
      return result;
    }

    const byKey = new Map<string, ParsedOrder>();
    const refunds: { tx: Obj; row: number; when: Date }[] = [];
    let row = 0;
    for (const raw of list) {
      row++;
      if (!isObj(raw)) continue;
      const tx = raw;
      const id = str(tx.transactionId);
      const warn = (message: string) => result.warnings.push({ row, message: `transaction ${id}: ${message}` });
      const posted = str(tx.postedDate);
      const when = posted ? new Date(posted) : null;
      if (!when || isNaN(when.getTime())) {
        warn(`unreadable postedDate "${posted}"; skipped.`);
        continue;
      }
      const { kind, amountType } = kindOf(tx);

      if (kind === "order") {
        const orderId = relatedId(tx, "ORDER_ID");
        if (!orderId) {
          warn("order transaction without ORDER_ID; skipped.");
          continue;
        }
        for (const l of linesOf(tx, warn)) {
          const amounts = {
            grossCents: l.c.gross,
            shippingCents: l.c.shipping,
            refundCents: 0,
            feeCents: -l.c.fee,
            taxCents: l.c.tax !== 0 ? l.c.tax : -l.c.withheld,
          };
          const key = `${orderId}:${l.sku ?? ""}`;
          const existing = byKey.get(key);
          if (existing) {
            existing.grossCents = (existing.grossCents ?? 0) + amounts.grossCents;
            existing.shippingCents = (existing.shippingCents ?? 0) + amounts.shippingCents;
            existing.feeCents = (existing.feeCents ?? 0) + amounts.feeCents;
            existing.taxCents = (existing.taxCents ?? 0) + amounts.taxCents;
            existing.quantity = (existing.quantity ?? 1) + l.quantity;
            refreshNet(existing);
            continue;
          }
          const o: ParsedOrder = {
            sourceRow: row,
            channel: "amazon",
            externalOrderId: orderId,
            externalItemId: l.sku,
            ...stamp(when),
            buyerId: null, // the Finances API has no buyer id
            quantity: l.quantity,
            currency: (isObj(tx.totalAmount) && str(tx.totalAmount.currencyCode)) || "USD",
            ...amounts,
            netCents: netOf(amounts),
            status: "paid",
          };
          byKey.set(key, o);
          result.orders.push(o);
        }
        continue;
      }

      if (kind === "refund") {
        refunds.push({ tx, row, when });
        continue;
      }

      if (!amountType) {
        warn(`unknown transactionType "${str(tx.transactionType)}"; skipped.`);
        continue;
      }
      const total = currencyCents(tx.totalAmount);
      const lineDate = businessDateOf(when);
      const settlement = relatedId(tx, "SETTLEMENT_ID") || relatedId(tx, "FINANCIAL_EVENT_GROUP_ID");
      const line: ParsedMoneyLine = {
        sourceRow: row,
        channel: "amazon",
        lineDate,
        period: periodOf(lineDate),
        amountType,
        amountCents: amountType === "payout" ? -total : total,
        settlementId: settlement || null,
        payoutId: amountType === "payout" ? relatedId(tx, "DISBURSEMENT_ID") || relatedId(tx, "TRANSFER_ID") || settlement || null : null,
        reference: relatedId(tx, "ORDER_ID") || null,
        memo: str(tx.description) || null,
      };
      result.moneyLines.push(line);
    }

    // Fold refunds into their orders (after all orders are known).
    for (const { tx, row, when } of refunds) {
      const orderId = relatedId(tx, "ORDER_ID");
      const warn = (message: string) => result.warnings.push({ row, message });
      const lines = linesOf(tx, (m) => warn(`transaction ${str(tx.transactionId)}: ${m}`));
      let unmatched = false;
      for (const l of lines) {
        const o = byKey.get(`${orderId}:${l.sku ?? ""}`) ?? result.orders.find((x) => x.externalOrderId === orderId);
        if (!o) {
          unmatched = true;
          continue;
        }
        o.refundCents = (o.refundCents ?? 0) - (l.c.gross + l.c.shipping);
        o.feeCents = (o.feeCents ?? 0) - l.c.fee;
        o.taxCents = (o.taxCents ?? 0) + l.c.tax;
        o.status = "refunded";
        refreshNet(o);
      }
      if (unmatched) {
        const lineDate = businessDateOf(when);
        result.moneyLines.push({
          sourceRow: row,
          channel: "amazon",
          lineDate,
          period: periodOf(lineDate),
          amountType: "refund",
          amountCents: currencyCents(tx.totalAmount),
          settlementId: relatedId(tx, "SETTLEMENT_ID") || null,
          reference: orderId || null,
          memo: "Refund for an order not in this file",
        });
        // No warning: a refund of an earlier day's order is normal with daily pulls.
      }
    }

    // nextToken is normal: the connector saves each page as its own file.
    return finishResult(result, ctx.fileName, ctx.period);
  },
});
