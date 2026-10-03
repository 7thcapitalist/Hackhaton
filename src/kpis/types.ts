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
  /** Distinct buyer_key with a non-cancelled order. */
  buyers: number;
  /** Of those, buyers with 2+ non-cancelled order lines in the period. */
  repeatBuyers: number;
  /** Latest business_date with orders in the period (to flag partial months). */
  lastBusinessDate: string | null;
}

export interface ShippingFacts {
  /** Σ money_lines.amount_cents for shipping_label / shipping_refund (negative = cost). postage_topup is excluded: it is cash moved into the postage wallet, and the labels bought with it are already counted. */
  netShippingCents: number;
  lines: number;
}

export interface LaborFacts {
  hours: number;
  employees: number;
}

export interface ItemFacts {
  /** Items with listed_at in the period. */
  listed: number;
  /** Mean days from donated_at to listed_at for items listed in the period. */
  avgDaysDonationToListing: number | null;
  /** Items sent to e-commerce by period end and not yet listed at period end. */
  backlogAtEnd: number;
  /** Items with sold_at in the period. */
  sold: number;
  /** Items listed before period end and not sold before period start. */
  available: number;
  /** Items listed and unsold at period end. */
  activeAtEnd: number;
  /** Of activeAtEnd, those listed more than AGED_LISTING_DAYS before period end. */
  agedAtEnd: number;
}

export interface CategoryFacts {
  category: string;
  /** Σ net_cents. */
  revenueCents: number;
  /** Σ net_cents minus shipping charged on paid orders (product contribution). */
  marginCents: number;
}

export interface PeriodFacts {
  period: string;
  periodEnd: string;
  orders: OrderFacts | null;
  shipping: ShippingFacts | null;
  labor: LaborFacts | null;
  items: ItemFacts | null;
  categories: CategoryFacts[];
}

/** A listing older than this at period end counts as "unsold inventory". */
export const AGED_LISTING_DAYS = 60;
