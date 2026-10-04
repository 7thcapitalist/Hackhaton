/**
 * Shared SQL for cost classification of money_lines, used by both the scorecard
 * (net_margin_pct) and the cost views (getCostBreakdown / getCostedMargin) so
 * they always agree. Server-only.
 *
 * Classification of money_lines.amount_type (docs/kpi-definitions.md, "Costs"):
 * - shipping_label, shipping_refund        -> shipping label cost (net of carrier refunds)
 * - marketplace_fee, fulfillment_fee,
 *   adjustment, NOT tied to an order       -> "other charges" (ads, subscriptions, service
 *                                              fees, carrier/account adjustments)
 * - the same types tied to an order        -> excluded: already in orders.fee_cents
 *   (reference's first token = an orders.external_order_id; e.g. the Goodwill Books
 *    statement repeats each order's commission)
 * - sale, refund                           -> excluded: statement copy of order lines
 * - tax_withheld                           -> excluded: tax, never revenue or cost
 * - postage_topup, wallet_refund, payout,
 *   statement_payment, bank_*              -> excluded: cash movements, not P&L
 */
import { sql, type SQL } from "drizzle-orm";

export const SHIPPING_COST_TYPES = ["shipping_label", "shipping_refund"] as const;
export const OTHER_CHARGE_TYPES = ["marketplace_fee", "fulfillment_fee", "adjustment"] as const;
export const CASH_MOVEMENT_TYPES = ["postage_topup", "wallet_refund", "payout", "statement_payment"] as const;

/** First " / "-separated token of money_lines.reference (alias m), trimmed. */
const refHead = sql.raw(
  "trim(case when instr(m.reference, ' / ') > 0 then substr(m.reference, 1, instr(m.reference, ' / ') - 1) else m.reference end)",
);

/** True when the money line (alias m) references an order that exists in orders. */
export const orderLinkedSql: SQL = sql`(m.reference is not null and ${refHead} in (select external_order_id from orders where external_order_id is not null))`;

/** WHERE fragment: money line (alias m) counts as an "other charge". */
export const otherChargeSql: SQL = sql`(m.amount_type in ('marketplace_fee', 'fulfillment_fee', 'adjustment') and not ${orderLinkedSql})`;

/** Other charges for a period: count and Σ amount_cents (negative = cost). */
export function otherChargesTotalSql(period: string): SQL {
  return sql`select count(*) as lines, coalesce(sum(m.amount_cents), 0) as net
    from money_lines m where m.period = ${period} and ${otherChargeSql}`;
}
