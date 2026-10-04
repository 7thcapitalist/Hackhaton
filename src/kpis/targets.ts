/**
 * Default monthly KPI targets, keyed by KPI id (src/kpis/definitions.ts).
 *
 * PLACEHOLDERS until Goodwill gives real targets. Values are set a little ahead
 * of the recent actuals (Jul-Sep 2026 in the demo data; Aug-Sep where
 * earlier months have no data) so the scorecard shows a
 * realistic mix of on / near / off. Direction follows each KPI's higherIsBetter
 * (a "days" or backlog target is a ceiling, the rest are floors).
 *
 * Single source of truth: scripts/seed/config.ts seeds kpi_targets from this map,
 * and getScorecard falls back to it for any KPI/period without a kpi_targets row.
 *
 * Units match the KPI's unit: cents for money, percent as 0-100, days, counts,
 * ratios as plain numbers. KPIs without an entry (Top 10 totals and the
 * per-category totals, which are breakdowns rather than goals) have no target.
 */
export const DEFAULT_KPI_TARGETS: Readonly<Record<string, number>> = {
  // ---- COO 15 (slide 35) ----
  total_revenue: 14_500_000, // cents = $145k/month
  revenue_growth_pct: 3,
  net_margin_pct: 55, // net of processing labor (labor hours × $18/h)
  listings_created: 5_000,
  revenue_per_labor_hour: 7_000, // cents per hour = $70/h
  listings_per_employee: 400,
  days_donation_to_listing: 12,
  unlisted_backlog: 800,
  unsold_inventory_pct: 20,
  avg_selling_price: 2_700, // cents
  sell_through_rate: 55,
  sales_per_employee: 1_100_000, // cents per employee per month
  repeat_buyer_rate: 30,

  // ---- Rest of slides 33-34 ----
  gross_margin_pct: 75,
  profit_per_labor_hour: 3_800, // cents per hour = $38/h (Aug $39.11, Sep $36.60)
  items_identified: 4_300, // Jul 3,501, Aug 5,096, Sep 4,198 (3-month avg 4,265)
  items_sent_to_ecom: 4_300, // Jul 3,324, Aug 5,164, Sep 4,301 (3-month avg 4,263)
  listings_per_day: 140, // Jul 86.7, Aug 168.1, Sep 138.5 (3-month avg 131)
  avg_time_to_list_days: 5, // ceiling; Aug 5.1, Sep 5.1
  median_sale_price: 1_750, // cents = $17.50 (Aug $16.99, Sep $17.00)
  days_to_sell: 20, // ceiling; Aug 19.5, Sep 19.7
  relisted_inventory_pct: 35, // ceiling; Aug 39.0, Sep 32.8
  number_of_buyers: 2_100, // Aug 2,008, Sep 2,051
  new_buyers: 400, // Aug 462, Sep 311
  csat: 4.6, // of 5; Aug 4.60, Sep 4.62
  nps: 40, // Aug 38.9, Sep 44.1
  marketplace_conversion: 4.2, // percent; Aug 3.96, Sep 4.22
};
