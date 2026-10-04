/**
 * Inputs to the KPI formulas: per-period aggregates that the scorecard view
 * queries from the database. Formulas are pure functions over these.
 * Money in integer cents. A null block means "no data for this period".
 */
export interface OrderFacts {
  /** Σ net_cents, all statuses (cancelled orders net to 0). = total revenue. */
  netCents: number;
  /** Non-cancelled order lines. */
  orderCount: number;
  /** Σ gross_cents over status = 'paid'. */
  paidGrossCents: number;
  /** Σ quantity over status = 'paid'. */
  paidQuantity: number;
  /** Per-unit sale price (gross_cents / quantity) of each paid line, ascending. */
  paidUnitPricesCents: number[];
  /** Customers = distinct non-cancelled transactions (channel + external_order_id). Pulse definition. */
  transactions: number;
  /** Latest business_date with orders in the period (to flag partial months). */
  lastBusinessDate: string | null;
}

/**
 * Buyer facts from orders.buyer_key (salted hash per channel). Only
 * non-cancelled transactions with a buyer_key count; transactions without one
 * (e.g. Amazon's report has no buyer id) are excluded and counted separately.
 */
export interface BuyerFacts {
  /** Distinct buyer_key with ≥1 transaction in the period. */
  buyers: number;
  /** Of those, buyers with 2+ distinct transactions in the period. */
  repeatBuyers: number;
  /** Distinct buyer_key whose first-ever transaction (all history in the DB) is in the period. */
  newBuyers: number;
  /** Non-cancelled transactions in the period with no buyer_key. */
  transactionsWithoutBuyer: number;
}

export interface ShippingFacts {
  /** Σ money_lines.amount_cents for shipping_label / shipping_refund (negative = cost). postage_topup is excluded: it is cash moved into the postage wallet, and the labels bought with it are already counted. */
  netShippingCents: number;
  lines: number;
}

/**
 * Other charges: money_lines marketplace_fee / fulfillment_fee / adjustment NOT
 * tied to an order (ads, subscriptions, service fees, carrier adjustments).
 * Per-order fees are already in orders.fee_cents and are not counted here.
 */
export interface OtherChargesFacts {
  /** Σ amount_cents (negative = cost, positive = credit). */
  netCents: number;
  lines: number;
}

export interface LaborFacts {
  hours: number;
  employees: number;
  /** Loaded hourly rate used for processing labor cost (env LABOR_RATE_CENTS_PER_HOUR, default 1800). */
  rateCentsPerHour: number;
  /** hours × rateCentsPerHour, rounded to whole cents. */
  costCents: number;
}

export interface ItemFacts {
  /** Items with identified_at in the period. */
  identified: number;
  /** Items with sent_to_ecom_at in the period. */
  sentToEcom: number;
  /** Items with listed_at in the period. */
  listed: number;
  /** Calendar days from period start to the business date of the last listing in the period (≥1), 0 if none. */
  listingDays: number;
  /** Mean days from donated_at to listed_at for items listed in the period. */
  avgDaysDonationToListing: number | null;
  /** Mean days from sent_to_ecom_at to listed_at for items listed in the period. */
  avgDaysSentToListing: number | null;
  /** Items sent to e-commerce by period end and not yet listed at period end. */
  backlogAtEnd: number;
  /** Items with sold_at in the period. */
  sold: number;
  /** Mean days from listed_at to sold_at for items sold in the period. */
  avgDaysToSell: number | null;
  /** Items listed before period end and not sold before period start. */
  available: number;
  /** Of available, items with relist_count > 0. */
  relistedAvailable: number;
  /** Items listed and unsold at period end. */
  activeAtEnd: number;
  /** Of activeAtEnd, those listed more than AGED_LISTING_DAYS before period end. */
  agedAtEnd: number;
}

export interface CategoryFacts {
  category: string;
  /** Σ orders.net_cents. */
  revenueCents: number;
  /** Σ net_cents minus shipping charged on paid orders (product contribution). */
  marginCents: number;
  /** Σ quantity over paid orders. */
  units: number;
  /** Σ gross_cents over paid orders. */
  paidGrossCents: number;
  /** Items (synthetic) of this category sold in the period; null when no item data. */
  itemsSold: number | null;
  /** Items (synthetic) of this category available in the period; null when no item data. */
  itemsAvailable: number | null;
}

export type MarketplaceMetricName = "csat" | "nps" | "conversion_rate" | "seller_rating";

export interface MarketplaceMetricFact {
  channel: string;
  metric: MarketplaceMetricName;
  value: number;
  sampleSize: number | null;
}

export interface PeriodFacts {
  period: string;
  periodEnd: string;
  orders: OrderFacts | null;
  buyers: BuyerFacts | null;
  shipping: ShippingFacts | null;
  /** Optional for callers that predate it; treated as 0 when absent. */
  otherCharges?: OtherChargesFacts | null;
  labor: LaborFacts | null;
  items: ItemFacts | null;
  categories: CategoryFacts[];
  /** Revenue (Σ net_cents) of the same month one year earlier; null when that month has no orders. */
  priorYear: { period: string; netCents: number } | null;
  marketplace: MarketplaceMetricFact[];
}

/** A listing older than this at period end counts as "unsold inventory". */
export const AGED_LISTING_DAYS = 60;

/** Default loaded processing labor rate: $18.00/h (assumption until Goodwill confirms). */
export const DEFAULT_LABOR_RATE_CENTS_PER_HOUR = 1800;
