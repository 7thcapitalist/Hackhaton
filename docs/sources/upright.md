# Upright Labs (Upright Lister) — Paid Order Items report

Researched 2026-10-03. Each claim is tagged **[fact]** (official or reputable source, linked)
or **[guess]**. Links are at the bottom. The Upright help center now requires a login, so most
facts below come from search-engine snippets of the official help pages (quoted text, not
paraphrase), cited to the page URL.

**Decision (Joao): Upright is the source of truth for orders.** Its rows carry the marketplace's
own order id, so they dedupe against the eBay / ShopGoodwill / Amazon files, and Upright wins.

## Template answers

- **What it is:** Upright Lister, the listing tool many Goodwills use to publish items to
  ShopGoodwill, eBay, Shopify and others, and to manage the resulting orders. **[fact,
  docs/research.md §3]** The **Paid Order Items** report is "a downloadable .csv history of
  every sold item on your marketplaces". **[fact, [U1]]**
- **How Goodwill gets the data today (slide 38):** "Paid order items · full month · Generate;
  email delivery; save as Excel". **[fact, slide 38]** In Lister: Reports → Paid Order Items →
  pick date range, **time zone**, marketplace (all or one), and status (**Paid**, **Refunded &
  Partially Refunded**, or **All**) → "Generate report", optionally enter an email to get a
  copy → download from **Past Reports** or the email. **[fact, [U1]]**
- **Frequency available:** any date range, so daily is possible. Upright also has a **public
  REST API** returning the same report data (§2). **[fact, [U2]]**
- **Live API:** **yes, and it is the easiest of all our sources.** `GET
  https://app.uprightlabs.com/api/reports/order_items?time_start=…&time_end=…` with header
  `X-Authorization: <token>`. Tokens are self-service in Lister → Admin → Settings → Developer.
  **[fact, [U2][U3]]** Feasible this weekend only if Goodwill generates a token for us (their
  account). **[guess]**
- **File format:** CSV, one row per sold item. **[fact, [U1]]** Goodwill saves it as Excel
  (slide 38), so we may get .xlsx. No preamble/footer mentioned. **[guess]**
- **Columns:** §1 (A–AH, 34 columns).
- **Money fields:** item-level `Order Item Price` and `Order Item Subtotal` (= qty × price; "use
  for ALL revenue calculations"); order-level `Order Total`, `Order Subtotal`, `Order Shipping
  Total`, `Order Handling Total`, `Order Final Value Fee`, `Order Payment Processing Fee`,
  `Refund Amount`. **Order-level columns V–AB are repeated on every item row of a multi-item
  order.** **[fact, [U1]]**
- **Buyer id field:** `Channel Buyer ID` (col AE), "an identifier for the customer who
  purchased". **[fact, [U1]]** We hash it. Per the decision, customers = distinct transactions,
  so it is informational only.
- **Gotchas:** §6. Biggest: order-level money repeated per item.
- **Confidence:** column letters/meanings **high** (official help text); exact header spelling
  **medium** (help pages give the column title, but the CSV header may differ slightly);
  value formats **low**.

## 1. Real export: Paid Order Items report

Columns in order, as named in the official help page **[fact, [U1] via search snippets]**:

| Col | Header (as documented) | Meaning (official wording, shortened) | Level |
|---|---|---|---|
| A | `Channel` | marketplace (ShopGoodwill, eBay, …) | item |
| B | `Channel Item ID` | "ID associated with the item in the channel" | item |
| C | `Channel Order ID` | "ID associated with the order in the channel" | item |
| D | `Upright Order ID` | order id in Lister | item |
| E | `Upright Product ID` | Lister product id ("different than Product SKU") | item |
| F | `Quantity` | units | item |
| G | `Inventory Location` | current bin/location | item |
| H | `Product SKU` | SKU | item |
| I | `Product Title` | title | item |
| J | `Product Category` | category "includes parent and subcategories" | item |
| K | `Supplier` | "Supplier/store who provided the item" | item |
| L | `Product Carrier` | carrier picked at listing | item |
| M | `Order Shipping Method` | carrier used, or `Pickup` | order |
| N | `Order Item Price` | "Final price of the individual item" | item |
| O | `Order Item Subtotal` | Quantity × Order Item Price; **use for all revenue** | item |
| P | `Order Ordered At` | when the order was placed | order |
| Q | `Order Paid At` | when paid | order |
| R | `Order Shipped At` | when shipped | order |
| S | `Order Cancelled At` | when cancelled, if any | order |
| T | `Order Payment Id` | payment id (eBay only) | order |
| U | `Order Payment Type` | e.g. Stripe, PayPal | order |
| V | `Order Total` | Subtotal + Shipping + Handling + Tax + Donation | order, **repeated** |
| W | `Order Subtotal` | items total | order, **repeated** |
| X | `Order Shipping Total` | shipping the customer paid | order, **repeated** |
| Y | `Order Handling Total` | handling fee paid (ShopGoodwill only) | order, **repeated** |
| Z | `Order Final Value Fee` | channel fees (eBay only) | order, **repeated** |
| AA | `Order Payment Processing Fee` | matches ShopGoodwill's credit-card fee | order, **repeated** |
| AB | `Refund Amount` | refunded amount | order, **repeated** |
| AC | `Poster` | user who listed the item (employee) | item |
| AD | `Product Weight` | weight at listing | item |
| AE | `Channel Buyer ID` | customer identifier | order |
| AF | `Secondary Channel Order ID` | e.g. eBay's secondary order id | order |
| AG | `Currency Code` | usually USD | order |
| AH | `Order Channel Fee Or Credit Amount` | listing/checkout fee or credit, mostly eBay | order |

Notes:
- "All timestamps in columns P, Q, R and S will reflect the time zone selected when generating
  the report." **[fact, [U1]]** "For a closer match to Shopgoodwill's reports, select
  America/Los Angeles." **[fact, [U1]]** → we should ask Goodwill to pick
  **America/Indiana/Indianapolis** (or tell us which zone they pick).
- Tax and donation totals feed `Order Total` but have **no column of their own** in this
  report (they do in the Paid Orders report: N Tax Total, O Donation Total). **[fact, [U4]]**
  So tax = V − W − X − Y − donation is not recoverable here. **[guess]**
- Timestamp format, e.g. `9/10/2026 2:14:00 PM`, and money without `$`. **[guess]**
- Header text exactness **[guess]**: the help page lists columns as "Column P - Order Ordered
  At"; the CSV header is probably exactly that title.

Related Lister reports **[fact, [U4][U5][U6]]**: **Paid Orders** (one row per order, includes
Tax Total, Donation Total, shipping address), **Refunds** report, **Shipments** report, Sales by
Category, Products, ShopGoodwill/eBay Listings reports.

## 2. Live API: Lister Public API

**[fact, [U2][U3] via search snippets]**

- Base URL: `https://app.uprightlabs.com/api/<resource>`
- Auth: header `X-Authorization: <API token>`. Tokens: Lister → Settings → **Developer** →
  "Generate API Access Token" (name it, Submit). Refreshing a token kills the old one.
- Endpoints (all `GET`, params `time_start`, `time_end` as strings):
  - `/reports/order_items` — "all ordered items paid within a timeframe" (= Paid Order Items)
  - `/reports/paid_orders` — "all paid orders within the timeframe"
  - `/reports/shipments` — "all shipments created within the timeframe"
  - `/reports/listings/shopgoodwill`, `/reports/listings/ebay`, `/reports/listings/shopify`,
    `/reports/productivity/user`
- Limits: up to **365 days** per call; calls "may time out or return an error if results exceed
  10 thousand records". JSON responses.
- No approval process, no OAuth, no sandbox mentioned. **[guess for "no sandbox"]**
- **Same data as the CSV?** Same report, JSON instead of CSV. **[fact that it is the same
  report; field names: guess]**. Date string format for `time_start` (ISO? `YYYY-MM-DD`?) and
  the time zone of returned timestamps are **unknown**; the docs page is login-gated.

**Feasibility for Goodwill: high.** An admin creates a token in 1 minute; a nightly Vercel Cron
calls `/reports/order_items` for yesterday. Goodwill Michiana's order volume is far below
10,000 items per day. This also gives productivity data (`/reports/productivity/user`) for the
"simulated" ops KPIs.

## 3. JSON shape (`/reports/order_items`)

Field names are **[guess]**: Upright's API docs are not public. The most likely shape is one
object per CSV row with snake_case keys mirroring the columns. Confirm with one real call.

```json
[
  {
    "channel": "eBay",
    "channel_item_id": "316000000005",
    "channel_order_id": "05-12345-67890",
    "upright_order_id": 900001,
    "upright_product_id": 800001,
    "quantity": 1,
    "product_sku": "SKU-4001",
    "product_title": "Brass Candlesticks Pair",
    "product_category": "Home > Decor",
    "supplier": "Michiana E-Com (test)",
    "order_item_price": "26.00",
    "order_item_subtotal": "26.00",
    "order_ordered_at": "2026-09-10T14:14:00-04:00",
    "order_paid_at": "2026-09-10T14:14:00-04:00",
    "order_shipped_at": null,
    "order_cancelled_at": null,
    "order_total": "36.38",
    "order_subtotal": "26.00",
    "order_shipping_total": "8.00",
    "order_handling_total": "0.00",
    "order_final_value_fee": "3.45",
    "order_payment_processing_fee": "0.00",
    "refund_amount": "0.00",
    "channel_buyer_id": "test_buyer_elm",
    "currency_code": "USD"
  }
]
```

## 4. Parser gap (src/sources/upright.ts)

Header matching is **exact** after normalization (`columnIndex` uses `indexOf`), so every
renamed column below is simply not found.

| Parser alias key | Parser expects | Real header | Effect today |
|---|---|---|---|
| `price` | `price`, `sale price`, `sold price` | `Order Item Price` (N) / **`Order Item Subtotal` (O)** | **Not found → `toCents` null → every row skipped.** Critical. Use O (already × quantity). |
| `orderedAt` / `paidAt` | `ordered at`, `paid at`, … | `Order Ordered At` (P), `Order Paid At` (Q) | **Not found → "Unreadable Ordered At" → every row skipped.** Critical. |
| `category` | `category` | `Product Category` (J) | category null → top-categories KPI empty. |
| `title` | `title`, `item title` | `Product Title` (I) | unused, OK. |
| `buyer` | `buyer username`, `buyer`, `buyer id` | `Channel Buyer ID` (AE) | buyer null (OK given the customer decision, but add alias). |
| `shipping` | `shipping`, … | `Order Shipping Total` (X), **order-level, repeated** | 0 today; if aliased naively → **double count** on multi-item orders. Allocate once per order (first item) or pro-rata. |
| `fees` | `fees`, … | `Order Final Value Fee` (Z) + `Order Payment Processing Fee` (AA) + `Order Channel Fee Or Credit Amount` (AH), all order-level | 0 today; needs sum of three, once per order. |
| `refund` | `refund amount` | `Refund Amount` (AB), **order-level, repeated** | **Matches today → refund counted once per item row** on multi-item refunded orders. Bug. |
| `tax` | `sales tax`, … | none in this report | 0. Fine (tax is never revenue). |
| `status` | `status`, `order status` | none; use `Order Cancelled At` (S) non-empty → cancelled | cancellations missed. |
| — | — | `Order Handling Total` (Y, ShopGoodwill) | ignored; handling is revenue the buyer paid. Add to shipping. |
| — | — | `Supplier` (K) | ignored; this is the field the Jewelry "Co-Pivot" fills. Useful. |
| `REQUIRED` | channel, channel item id, channel order id | same names | header detection works. |

Other gaps:
- Our sample's column order (D = Title, K = Upright Order ID, L = Price, …) does not match
  the real order; fixtures should be regenerated with the 34 real columns.
- `Lister` column in our sample does not exist; the real one is `Poster` (AC, employee).
  Privacy rule stands: never emit it except as a hashed id for productivity KPIs.
- Report filter: Goodwill must generate with status **All** (or "Paid" plus a separate
  "Refunded & Partially Refunded" run); otherwise refunds are missing. **[fact for the filter
  options, [U1]]**
- Time zone: no zone in cells; the parser assumes Indianapolis. If Goodwill picks
  America/Los_Angeles (Upright's tip for matching ShopGoodwill), every timestamp is 3 h off.
  Add a "zone" setting per upload or read it from the file name.

## 5. Daily acquisition — recommendation

| Option | Manual work | Verdict |
|---|---|---|
| **Public API** `/reports/order_items` nightly (Vercel Cron, token in env var `UPRIGHT_API_TOKEN`) | none after creating a token | **Recommended.** Cheapest daily feed we have, covers ShopGoodwill + eBay (+ others) in one call. |
| Generate report with email delivery, forward the email to an ingest inbox | 1 click/day | Fallback. |
| Today's process (monthly, save as Excel) | monthly | Keep for month-end. |

## 6. Gotchas

- **Order-level money repeated per item (V–AB).** Sum per order, not per row.
- Revenue: use `Order Item Subtotal`, not `Order Item Price` (quantity). **[fact, [U1]]**
- Time zone is whatever the person picked when generating.
- `Channel Order ID` is the marketplace id (dedupe key with eBay/ShopGoodwill files);
  `Upright Order ID` is Lister's own and never matches. **[fact]**
- Fees are per channel: `Order Final Value Fee` is eBay-only; `Order Payment Processing Fee`
  matches ShopGoodwill's card fee; ShopGoodwill's own commission (if any) is not documented
  here. **[fact for the first two]**
- Does Upright list Amazon and Goodwill Books orders? Unknown. Upright's integrations are
  ShopGoodwill, eBay, Shopify, OfferUp, FB Marketplace, GoodwillFinds. **[fact, docs/research.md
  §3]** Amazon/GoodwillBooks: **[ask]**.

## Links

- [U1] Upright help, Paid Order Items Report (login-gated now; content from search snippets):
  https://help.uprightlabs.com/en-us/lister/paid-order-items-report
  (older mirror: https://intercom.help/upright-labs/en/articles/5215692-paid-order-items-report)
- [U2] Upright help, Lister Public API Documentation:
  https://help.uprightlabs.com/en-us/lister/lister-public-api-documentation
- [U3] Upright help, Guide to Settings: Developer:
  https://help.uprightlabs.com/en-us/lister/guide-to-settings-developer
- [U4] Upright help, Paid Orders Report: https://help.uprightlabs.com/en-us/lister/paid-orders-report
- [U5] Upright help, Refunds Report: https://help.uprightlabs.com/en-us/lister/refunds-report
- [U6] Upright help, Shipments Report: https://help.uprightlabs.com/en-us/lister/shipments-report
