/**
 * Amazon Seller Central "Date Range Transaction" report (CSV) parser.
 *
 * Sources:
 *  - Column list: https://feedvisor.com/university/payment-transaction-report/
 *    and https://staxxer.com/how-to-get-transaction-reports-from-amazon-seller-central/
 *    (see docs/research.md §2)
 *  - Report overview: https://linkmybooks.com/blog/amazon-transaction--report
 *  - Settlement flat file (alternative, not parsed here):
 *    https://developer-docs.amazon/sp-api/docs/report-type-values-settlement
 *
 * Assumptions:
 *  - [fact] Columns: date/time, settlement id, type, order id, sku, description,
 *    quantity, marketplace, …, product sales, product sales tax, shipping
 *    credits, shipping credits tax, gift wrap credits, giftwrap credits tax,
 *    promotional rebates, promotional rebates tax, marketplace withheld tax,
 *    selling fees, fba fees, other transaction fees, other, total.
 *  - [fact] type values include Order, Refund, Service Fee, Transfer, Adjustment.
 *  - [guess] Several disclaimer lines ("Includes Amazon Marketplace…", "All
 *    amounts in USD…", "Definitions:" …) sit above the header.
 *  - [guess] date/time looks like "Sep 30, 2026 8:45:12 PM PDT" (zone abbreviation
 *    honored; without one we assume Indianapolis local).
 *  - [fact] fees are negative in the CSV; we store fee_cents as a positive cost.
 *  - [fact] Marketplace-facilitator tax: product/shipping/giftwrap tax columns
 *    are collected and the same amount is withheld in "marketplace withheld
 *    tax". We put it in tax_cents only, never in revenue.
 *  - [guess] One order row per (order id, sku). A Refund row for an order in the
 *    same file is folded into that order (refund_cents, status "refunded");
 *    a Refund whose order is not in the file becomes a money line "refund".
 *  - [guess] Transfer (disbursement to bank) is negative in the CSV; we store
 *    amount_type "payout" with + = money arriving in Goodwill's bank account.
 *    Open question: confirm the sign the close wants (gl_rules.journal_sign).
 *  - [guess] Service Fee → "marketplace_fee"; FBA Inventory Fee → "fulfillment_fee";
 *    Adjustment → "adjustment"; anything else → warning only.
 */
import type { ParsedMoneyLine, ParsedOrder, ParseResult, RawTable, SourceParser } from "./types";
import { businessDateOf, columnIndex, isBlankRow, normalizeHeader, periodOf } from "./_shared/table";
import {
  cell,
  cents,
  findHeaderRowByAliases,
  finishResult,
  headerNotFound,
  netOf,
  parseDateTime,
  refreshNet,
  stamp,
  warnMissingColumns,
} from "./_shared/marketplace";

const ALIASES = {
  date: ["date/time", "date time", "posted date/time", "posted date"],
  settlementId: ["settlement id", "settlement-id", "settlementid"],
  type: ["type", "transaction type"],
  orderId: ["order id", "amazon order id", "order-id"],
  sku: ["sku", "seller sku"],
  description: ["description"],
  quantity: ["quantity", "qty"],
  productSales: ["product sales", "product sales amount", "item price"],
  productSalesTax: ["product sales tax"],
  shippingCredits: ["shipping credits", "shipping credit"],
  shippingCreditsTax: ["shipping credits tax"],
  giftWrap: ["gift wrap credits", "giftwrap credits"],
  giftWrapTax: ["giftwrap credits tax", "gift wrap credits tax"],
  promoRebates: ["promotional rebates", "promotional rebate"],
  promoRebatesTax: ["promotional rebates tax"],
  withheldTax: ["marketplace withheld tax", "marketplace facilitator tax"],
  sellingFees: ["selling fees", "referral fees", "selling fee"],
  fbaFees: ["fba fees", "fulfillment fees"],
  otherFees: ["other transaction fees"],
  other: ["other"],
  total: ["total", "total amount"],
};
type Key = keyof typeof ALIASES;
const REQUIRED: Key[] = ["date", "settlementId", "type", "orderId", "total"];

const MONEY_TYPES: Record<string, string> = {
  "service fee": "marketplace_fee",
  "fba inventory fee": "fulfillment_fee",
  "fba customer return fee": "fulfillment_fee",
  adjustment: "adjustment",
  transfer: "payout",
};

export const amazonParser: SourceParser = {
  sourceId: "amazon",
  version: "1.0.0",

  accepts(table: RawTable): boolean {
    return findHeaderRowByAliases(table, ALIASES, REQUIRED) >= 0;
  },

  parse(table, ctx): ParseResult {
    const h = findHeaderRowByAliases(table, ALIASES, REQUIRED);
    if (h < 0) return headerNotFound("Amazon Date Range Transaction");

    const header = table[h];
    const col = columnIndex(header, ALIASES);
    const result: ParseResult = {
      orders: [],
      moneyLines: [],
      warnings: [],
      headerRowIndex: h,
      header: header.map(normalizeHeader),
    };
    warnMissingColumns(result, col, ["productSales", "sellingFees", "withheldTax"]);

    const byKey = new Map<string, ParsedOrder>();
    const refunds: { row: string[]; sourceRow: number }[] = [];

    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      const sourceRow = i + 1;
      if (isBlankRow(row)) continue;

      const type = cell(row, col.type).toLowerCase();
      const when = parseDateTime(cell(row, col.date));
      if (!when) {
        result.warnings.push({ row: sourceRow, message: `Unreadable date/time "${cell(row, col.date)}"; row skipped.` });
        continue;
      }

      if (type === "order") {
        const orderId = cell(row, col.orderId);
        if (!orderId) {
          result.warnings.push({ row: sourceRow, message: "Order row without order id; skipped." });
          continue;
        }
        const sku = cell(row, col.sku) || null;
        const tax =
          cents(row, col.productSalesTax) + cents(row, col.shippingCreditsTax) +
          cents(row, col.giftWrapTax) + cents(row, col.promoRebatesTax);
        const amounts = {
          grossCents: cents(row, col.productSales) + cents(row, col.giftWrap) + cents(row, col.promoRebates),
          shippingCents: cents(row, col.shippingCredits),
          refundCents: 0,
          feeCents: -(cents(row, col.sellingFees) + cents(row, col.fbaFees) + cents(row, col.otherFees)),
          taxCents: tax !== 0 ? tax : -cents(row, col.withheldTax),
        };
        const key = `${orderId}:${sku ?? ""}`;
        const existing = byKey.get(key);
        if (existing) {
          // Same order+sku twice (e.g. split shipment): add up into one line.
          existing.grossCents = (existing.grossCents ?? 0) + amounts.grossCents;
          existing.shippingCents = (existing.shippingCents ?? 0) + amounts.shippingCents;
          existing.feeCents = (existing.feeCents ?? 0) + amounts.feeCents;
          existing.taxCents = (existing.taxCents ?? 0) + amounts.taxCents;
          existing.quantity = (existing.quantity ?? 1) + (parseInt(cell(row, col.quantity), 10) || 1);
          refreshNet(existing);
          continue;
        }
        const o: ParsedOrder = {
          sourceRow,
          channel: "amazon",
          externalOrderId: orderId,
          externalItemId: sku,
          ...stamp(when),
          buyerId: null, // the transaction report has no buyer id
          quantity: parseInt(cell(row, col.quantity), 10) || 1,
          currency: "USD",
          ...amounts,
          netCents: netOf(amounts),
          status: "paid",
        };
        byKey.set(key, o);
        result.orders.push(o);
        continue;
      }

      if (type === "refund") {
        refunds.push({ row, sourceRow });
        continue;
      }

      const amountType = MONEY_TYPES[type];
      if (amountType) {
        const total = cents(row, col.total);
        const lineDate = businessDateOf(when);
        const line: ParsedMoneyLine = {
          sourceRow,
          channel: "amazon",
          lineDate,
          period: periodOf(lineDate),
          amountType,
          // Transfer leaves Amazon (negative) and lands in the bank: flip to + = money in.
          amountCents: amountType === "payout" ? -total : total,
          settlementId: cell(row, col.settlementId) || null,
          payoutId: amountType === "payout" ? cell(row, col.settlementId) || null : null,
          reference: cell(row, col.orderId) || null,
          memo: cell(row, col.description) || null,
        };
        result.moneyLines.push(line);
        continue;
      }

      result.warnings.push({ row: sourceRow, message: `Unknown transaction type "${cell(row, col.type)}"; row skipped.` });
    }

    // Fold refunds into their orders (after all orders are known, so a refund
    // listed above its order still matches).
    for (const { row, sourceRow } of refunds) {
      const orderId = cell(row, col.orderId);
      const sku = cell(row, col.sku) || null;
      const refunded = -(
        cents(row, col.productSales) + cents(row, col.shippingCredits) +
        cents(row, col.giftWrap) + cents(row, col.promoRebates)
      );
      const feeBack = cents(row, col.sellingFees) + cents(row, col.fbaFees) + cents(row, col.otherFees);
      const taxBack = -(
        cents(row, col.productSalesTax) + cents(row, col.shippingCreditsTax) +
        cents(row, col.giftWrapTax) + cents(row, col.promoRebatesTax)
      );
      const o = byKey.get(`${orderId}:${sku ?? ""}`) ?? result.orders.find((x) => x.externalOrderId === orderId);
      if (o) {
        o.refundCents = (o.refundCents ?? 0) + refunded;
        o.feeCents = (o.feeCents ?? 0) - feeBack;
        o.taxCents = (o.taxCents ?? 0) - taxBack;
        o.status = "refunded";
        refreshNet(o);
      } else {
        const lineDate = businessDateOf(parseDateTime(cell(row, col.date))!);
        result.moneyLines.push({
          sourceRow,
          channel: "amazon",
          lineDate,
          period: periodOf(lineDate),
          amountType: "refund",
          amountCents: cents(row, col.total),
          settlementId: cell(row, col.settlementId) || null,
          reference: orderId || null,
          memo: "Refund for an order not in this file",
        });
        result.warnings.push({
          row: sourceRow,
          message: `Refund for order ${orderId} not found in this file; recorded as a refund money line.`,
        });
      }
    }

    return finishResult(result, ctx.fileName, ctx.period);
  },
};
