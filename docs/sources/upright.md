# Upright (Upright Labs' Lister)

- **What it is:** Not a marketplace itself — it's **Upright Labs' "Lister"**, a
  multichannel listing tool many Goodwills use to list and sell across ShopGoodwill, eBay,
  Shopify, OfferUp and Facebook Marketplace from one place. Its export spans channels,
  which is the main reason it's the trickiest of the 9 sources.
- **How Goodwill gets the data today:** Slide 38: *"Paid order items · full month;
  Generate; email delivery; save as Excel."* This is very likely the exact process shown
  in the "Report Steps" slides (32–37): *Open Reports → Click **Paid orders** → Set date
  range → Generate report → Download* — "Paid orders" matches Upright's report name
  ("Paid Order Items") almost exactly, closer than any ShopGoodwill-native report name.
- **Frequency available:** Generated on demand for any date range in the tool —
  daily-capable, though the month-end workflow runs it once for the full month.
- **Live API:** Upright has partner integrations (e.g. GoodwillFinds) but nothing public
  or self-serve found. Not usable this weekend without Goodwill's real Upright account —
  fixtures only.
- **File format:** XLSX (slide 38: "save as Excel"), generated then delivered by email.
- **Columns:** `Channel` (ShopGoodwill, eBay, …) [fact], `Channel Item ID` [fact],
  `Channel Order ID` [fact], `Upright Product ID` [fact], `Quantity` [fact] — then, guess:
  `Title, Category, Store, Lister, Price, Shipping, Fees, Ordered At, Paid At, Shipped At,
  Listed At` (timestamp columns reported around columns P–S, in whatever timezone was
  selected at generation time — fact, per Upright help).
- **Money fields:** `Price` = revenue; `Shipping` = shipping revenue; `Fees` = Upright/
  marketplace fee (guess).
- **Buyer id field:** None documented — this looks like a seller-side order/item tracker,
  not a buyer-identity export. Customer counting for Upright rows likely has to fall back
  to distinct order count, same caveat as Amazon.
- **Gotchas — the important one:** Because Upright spans channels, **the same sale can
  appear both here (e.g. `Channel = eBay`) and in that channel's own native export** (the
  eBay Orders report, or the ShopGoodwill periodic report). This is the required
  Upright↔eBay/ShopGoodwill overlap messy case in the fixtures: dedupe on
  `channel + ':' + channel_order_id + ':' + channel_item_id`, and decide which source
  "wins" via `sources.revenue_authority` — ask Amanda which source she trusts more when
  both report the same sale.
  - `Lister` (the employee who listed the item) is a candidate real data source for
    "Listings per Employee" / "Average Time to List an Item" KPIs, which otherwise have no
    confirmed source at all.
- **Confidence:** Columns A/B/C/E/F = fact; rest = guess. Links: [Upright Paid Order Items report](https://help.uprightlabs.com/en-us/lister/paid-order-items-report), [Upright × GoodwillFinds](https://www.uprightlabs.com/2024/05/07/goodwillfinds-integration/).
