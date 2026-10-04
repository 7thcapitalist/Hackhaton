# KPI definitions

Every KPI on the scorecard (`getScorecard(period)`, `src/lib/views/scorecard.ts`), with
its formula (`src/kpis/formulas.ts`, one function each) and the data it uses. Slides refer
to Goodwill's deck (`docs/goodwill-problem.md`).

- **Group:** `coo15` = the one-page COO scorecard of slide 35 (★ = 2027 anchor, slide 36);
  `extended` = every other KPI of slides 33-34.
- **Status today** (seed data, 2026-09): `ok` = computed from orders or marketplace
  metrics; (the former `simulated` status was retired: items and labor hours now arrive through the production-tracking, Upright inventory and timekeeping sources like every other fact); `awaiting_data` = value
  null, never a made-up number.
- **Data basis:** *real export* = marketplace/shipping files Goodwill already downloads
  (seeded synthetically today, replaced by parsed exports); *synthetic* = items and labor
  hours, which Goodwill has not shared (research §6.11); *mock* = marketplace metrics
  (CSAT, NPS, conversion) from a mock source still to come.

## Shared definitions

- **Period:** `YYYY-MM`, business dates in America/Indiana/Indianapolis. Item and labor
  timestamps are UTC and converted to the business-day window.
- **Net revenue** = Σ `orders.net_cents` = gross + shipping charged − refunds −
  marketplace fees (tax excluded). Fees and refunds are already out of net, so no formula
  subtracts them again.
- **Net shipping cost** = −Σ `money_lines.amount_cents` where `amount_type` in
  (`shipping_label`, `shipping_refund`) for the period (labels negative, carrier refunds
  positive; `postage_topup` excluded).
- **Processing labor cost** = Σ `labor_hours.hours` × loaded rate. Rate =
  `LABOR_RATE_CENTS_PER_HOUR`, default **1800 ($18.00/h). Assumption**, to be replaced by
  Goodwill's real loaded rate.
- **Other charges** = −Σ `money_lines.amount_cents` where `amount_type` in
  (`marketplace_fee`, `fulfillment_fee`, `adjustment`) and the line is NOT tied to an order
  (the first ` / ` token of `reference` is not an `orders.external_order_id`): ads, seller
  subscriptions, service fees, carrier/account adjustments. Per-order fees are already in
  `orders.fee_cents` (e.g. the Goodwill Books statement repeats each commission) and are
  not counted again. SQL shared by the scorecard and the cost views:
  `src/lib/views/cost-sql.ts`.
- **Contribution (fully costed)** = net revenue − net shipping cost − other charges −
  processing labor cost. Net margin % = contribution / net revenue.

## Costs (`getCostBreakdown`, `getCostedMargin`; chat tools `get_costs`, `get_costed_margin`)

- **Breakdown** (`src/lib/views/costs.ts`): gross sales + shipping charged − refunds −
  per-order marketplace fees = net revenue; then shipping labels by carrier, other charges,
  labor, contribution and contribution %. The all-channel contribution % equals
  `net_margin_pct` (checked by `npm run check:costs`).
- **Excluded, with the reason:** tax collected (never revenue); cash movements
  (`postage_topup` wallet top-ups, `wallet_refund`, `payout`, `statement_payment`, every
  `bank_*` line); statement copies of order lines (`sale`, `refund`, order-linked fees).
- **Costed margin by category / channel:** net revenue per group − shipping (a label whose
  reference's first token equals an order id is linked to that order's group; the rest is
  allocated by share of paid order lines) − labor (allocated by share of items listed in the
  period: `items.category`, or `items.channel_source_id` for channels; listings through
  Upright are spread pro rata) − other charges (by channel when the line has one, else by
  paid order lines). Channels whose reports carry no category (Amazon, eBay) sit in
  "Uncategorized" with their listings' labor; it is not a real category. Group totals equal
  the breakdown exactly (largest-remainder allocation). In the mock data no label
  reference carries an order id (references are tracking/invoice numbers), so all
  shipping is allocated.
- **Not in the data:** cost of goods (donated goods have none), overhead (rent, utilities,
  management), packaging supplies.

- **Transaction** = distinct `channel + external_order_id`, non-cancelled. **Customer
  count on the pulse = transactions** (unchanged).
- **Buyer** = distinct `orders.buyer_key` (salted SHA-256 of the marketplace buyer id,
  per channel, so one person buying on two channels counts twice). Transactions with no
  `buyer_key` (e.g. Amazon's report has no buyer id) are excluded from buyer KPIs only;
  the KPI note says how many.
- **Item available in period** = listed before period end and not sold before period
  start.
- Rounding: percent and ratios 1 decimal, money whole cents, marketplace averages 2
  decimals.

## The 15 COO KPIs (slide 35)

| id | Label | Slide | Formula | Tables / columns | Data basis | Status today |
|---|---|---|---|---|---|---|
| total_revenue | Total E-Commerce Revenue | 33, 35 | Σ net_cents | orders.net_cents, business_date | real export | ok |
| revenue_growth_pct | Revenue Growth % | 33, 35 | YoY when the same month last year has orders: (rev − rev same month last year) / that × 100; else MoM vs prior month, note "MoM: no prior-year data" | orders.net_cents, business_date | real export | ok (MoM until 2025 data lands) |
| net_margin_pct ★ | Net Margin % | 33, 35, 36 | contribution / net revenue × 100, contribution = net revenue − net shipping cost − other charges − processing labor cost (see Costs). Overhead not included. Equals `getCostBreakdown().contributionPct` | orders.net_cents; money_lines (shipping_label, shipping_refund; non-order marketplace_fee, fulfillment_fee, adjustment); labor_hours.hours | mock export + timekeeping (mock) | ok (awaiting_data for a month without shipping files, e.g. 2026-10) |
| listings_created | Listings Created | 35 | count(items listed_at in period) | items.listed_at | operations sources (mock) | ok |
| revenue_per_labor_hour ★ | Revenue per Labor Hour | 33, 35, 36 | net revenue / Σ labor hours (cents/h) | orders.net_cents; labor_hours.hours | mock export + timekeeping (mock) | ok |
| listings_per_employee | Listings per Employee | 33, 35 | listings created / distinct employees with labor hours | items.listed_at; labor_hours.employee | operations sources (mock) | ok |
| days_donation_to_listing | Days from Donation to Listing | 35 | mean(listed_at − donated_at), items listed in period | items.donated_at, listed_at | operations sources (mock) | ok |
| unlisted_backlog | Unlisted Inventory Backlog | 33, 35 | items sent to e-com by period end and not listed at period end | items.sent_to_ecom_at, listed_at | operations sources (mock) | ok |
| unsold_inventory_pct | Unsold Inventory % | 34, 35 | listings unsold at period end and older than 60 days / listings unsold at period end × 100 | items.listed_at, sold_at | operations sources (mock) | ok |
| avg_selling_price | Average Selling Price | 34, 35 | Σ gross_cents / Σ quantity, paid lines | orders.gross_cents, quantity, status | real export | ok |
| sell_through_rate ★ | Sell-Through Rate | 34, 35, 36 | items sold in period / items available in period × 100 | items.listed_at, sold_at | operations sources (mock) | ok |
| sales_per_employee | Sales per Employee | 35 | net revenue / distinct employees with labor hours | orders.net_cents; labor_hours.employee | mock export + timekeeping (mock) | ok |
| top10_categories_revenue | Top 10 Categories by Revenue | 34, 35 | Σ net revenue of the 10 highest-revenue categories (list in `topCategoriesByRevenue`) | orders.category, net_cents | real export | ok |
| top10_categories_margin | Top 10 Categories by Margin | 34, 35 | Σ margin of the 10 highest-margin categories; category margin = Σ net_cents − shipping charged on paid lines (list in `topCategoriesByMargin`) | orders.category, net_cents, shipping_cents, status | real export | ok |
| repeat_buyer_rate | Repeat Buyer Rate | 34, 35 | buyers with 2+ transactions in period / buyers with ≥1 transaction in period × 100 | orders.buyer_key, channel, external_order_id, status | real export | ok |

## Extended KPIs (slides 33-34)

| id | Label | Slide | Formula | Tables / columns | Data basis | Status today |
|---|---|---|---|---|---|---|
| gross_margin_pct | Gross Margin % | 33 | (net revenue − processing labor cost) / net revenue × 100 | orders.net_cents; labor_hours.hours | mock export + timekeeping (mock) | ok |
| profit_per_labor_hour | Profit per Labor Hour | 33 | contribution (see Costs) / Σ labor hours (cents/h) | orders.net_cents; money_lines shipping; labor_hours.hours | mock export + timekeeping (mock) | ok (awaiting_data without shipping files) |
| items_identified | Items Identified for E-Commerce | 33 | count(items identified_at in period) | items.identified_at | operations sources (mock) | ok |
| items_sent_to_ecom | Items Sent to E-Commerce | 33 | count(items sent_to_ecom_at in period) | items.sent_to_ecom_at | operations sources (mock) | ok |
| listings_per_day | Listings Created per Day | 33 | listings created / calendar days from period start to the last listing date in the period | items.listed_at | operations sources (mock) | ok |
| avg_time_to_list_days | Average Time to List an Item | 33 | mean(listed_at − sent_to_ecom_at), items listed in period (handling time inside e-commerce; donation→listing is `days_donation_to_listing`) | items.sent_to_ecom_at, listed_at | operations sources (mock) | ok |
| median_sale_price | Median Sale Price | 34 | median of gross_cents / quantity over paid lines | orders.gross_cents, quantity, status | real export | ok |
| days_to_sell | Days to Sell | 34 | mean(sold_at − listed_at), items sold in period | items.listed_at, sold_at | operations sources (mock) | ok |
| relisted_inventory_pct | Relisted Inventory % | 34 | available items with relist_count > 0 / items available × 100 | items.relist_count, listed_at, sold_at | operations sources (mock) | ok |
| sales_by_category | Sales by Category | 34 | per category Σ net_cents (`categories[].revenueCents`); value = total over categorized orders | orders.category, net_cents | real export | ok |
| margin_by_category | Margin by Category | 34 | per category Σ net_cents − shipping charged on paid lines (`categories[].marginCents`); value = total | orders.category, net_cents, shipping_cents | real export | ok |
| units_by_category | Units Sold by Category | 34 | per category Σ quantity of paid lines (`categories[].units`); value = total | orders.category, quantity, status | real export | ok |
| sell_through_by_category | Sell-Through Rate by Category | 34 | per category items sold / items available × 100 (`categories[].sellThroughPct`); value = rate over all categorized items | items.category, listed_at, sold_at | operations sources (mock) | ok |
| asp_by_category | Average Selling Price by Category | 34 | per category paid gross / paid units (`categories[].aspCents`); value = ASP over categorized orders | orders.category, gross_cents, quantity | real export | ok |
| number_of_buyers | Number of Buyers | 34 | distinct buyer_key with ≥1 transaction in period | orders.buyer_key | real export | ok |
| new_buyers | New Buyers | 34 | distinct buyer_key whose first-ever transaction (all history in the DB) is in the period | orders.buyer_key, business_date | real export | ok (the first month in the DB counts every buyer as new) |
| csat | Customer Satisfaction Rating | 34 | mean of `csat` across channels, weighted by sample_size when every row has one (per channel in `marketplaceMetrics[]`) | marketplace_metrics | mock | awaiting_data |
| nps | Net Promoter Score | 34 | same average for `nps` (−100..100) | marketplace_metrics | mock | awaiting_data |
| marketplace_conversion | Marketplace Conversion | 34 | same average for `conversion_rate` (percent), per channel in `marketplaceMetrics[]` | marketplace_metrics | mock | awaiting_data |
| total_orders | Total Orders | — (team addition; key card on the Monthly report) | count(orders where status ≠ cancelled) | orders.status, business_date | real export | ok |

## Assumptions to confirm with Goodwill

1. Loaded processing labor rate ($18.00/h placeholder).
2. Net margin excludes overhead (rent, utilities, management). Add when Goodwill shares it.
3. "Customers" on the pulse = transactions; buyers on the scorecard = hashed buyer ids per
   channel. Cross-channel identity is not attempted (privacy by design).
4. Revenue growth is MoM until a full prior year is in the database.
