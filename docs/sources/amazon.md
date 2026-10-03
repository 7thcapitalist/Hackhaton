# Amazon

- **What it is:** Marketplace. Amazon Seller Central — one of the core e-commerce channels
  on the nightly pulse.
- **How Goodwill gets the data today:** Seller Central → Reports → Payments → Date Range
  Reports. Slide 38: *"Payments summary... Seller Central · request/refresh/download."*
- **Frequency available:** On-demand, any date range — daily-capable. Month-end workflow
  currently pulls it once for the full month.
- **Live API:** Amazon SP-API (Settlement Report v2 / Finances API) exists and is well
  documented, but needs an app registration (LWA + AWS SigV4) against Goodwill's real
  seller account. **Not usable this weekend** — fixtures only; note it as "next step" in
  the pitch.
- **File format:** CSV. **Several disclaimer lines sit above the real header row** — the
  parser must locate the header, not assume row 1. (Columns: fact. Exact preamble line
  count: guess.)
- **Columns:** `date/time, settlement id, type, order id, sku, description, quantity,
  marketplace, fulfillment, order city, order state, order postal, tax collection model,
  product sales, product sales tax, shipping credits, shipping credits tax, gift wrap
  credits, giftwrap credits tax, regulatory fee, promotional rebates, promotional rebates
  tax, marketplace withheld tax, selling fees, fba fees, other transaction fees, other,
  total`. `type` ∈ `Order, Refund, Transfer, Service Fee, Adjustment`.
- **Money fields:** `product sales` = revenue. `product sales tax` + `marketplace withheld
  tax` = tax — **exclude from revenue**, it is not Goodwill's money. `shipping credits` =
  shipping revenue. `selling fees` / `fba fees` / `other transaction fees` = fees
  (negative). `total` = net settlement amount for the row.
- **Buyer id field:** **None in this report.** Amazon's transaction export does not expose
  buyer identity. Customer counting for Amazon rows has to use distinct `order id`, not a
  hashed buyer key — flag this difference from the other marketplaces.
- **Gotchas:**
  - Header offset (preamble lines) — this is our designated "messy file" case for the demo.
  - A `Refund` row is its own line with negative `product sales`, not an edit to the
    original `Order` row.
  - Tax is already broken out into its own columns here (unlike eBay, where it's bundled
    into the total) — easier case, good contrast to show both patterns in the demo.
- **Confidence:** Columns = fact ([Feedvisor](https://feedvisor.com/university/payment-transaction-report/), [Staxxer](https://staxxer.com/how-to-get-transaction-reports-from-amazon-seller-central/)). Preamble line count = guess.
