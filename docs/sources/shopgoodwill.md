# ShopGoodwill

- **What it is:** Marketplace. The Goodwill-only auction site (sellerportal.shopgoodwill.com)
  — Michiana's primary online marketplace channel.
- **How Goodwill gets the data today:** Seller portal, filtered by year/month. Slide 38:
  *"Filter year/month; Period 1 periodic only; Period 3 all reports."* Meaning of "Period 1"
  vs "Period 3" is unconfirmed — open question for Amanda.
- **Frequency available:** Periodic/monthly, filtered by year-month. Not confirmed whether a
  single-day export is possible (needed for the nightly pulse) — see Gotchas.
- **Live API:** None public. The seller portal is restricted to Goodwill member organizations
  with an active seller account; no documented API. Not usable this weekend without real
  Goodwill credentials — fixtures only.
- **File format:** Guess — no public sample exists (seller-portal-only). Likely CSV, one
  header row, no documented preamble/footer.
- **Columns (guess):** `Item ID, Title, Category, End Date, Winning Bid, Shipping, Handling,
  Seller Fee, Net, Buyer ID, Status, Period`.
- **Money fields:** `Winning Bid` = revenue; `Shipping`/`Handling` = shipping revenue;
  `Seller Fee` = fee (negative); `Net` = bid + shipping − fee (guess, unconfirmed formula).
- **Buyer id field:** `Buyer ID` (guess) — hash it, never store raw.
- **Gotchas:**
  - The "Report Steps" sequence on slides 32–37 (*Open Reports → Click **Paid orders** →
    Set date range → Generate report → Download → "Customer count = rows minus the title
    row"*) reads more like **Upright's "Paid Order Items" report** than a ShopGoodwill-native
    report — "Paid orders" is close to Upright's exact report name. It may describe this
    source, Upright, or both if Goodwill uses Upright as the front-end for ShopGoodwill.
    Ask Amanda which tool those screenshots are actually from.
  - Upright Lister spans ShopGoodwill sales too (see `upright.md`) — the same sale can appear
    in both exports. Dedupe on `channel + external_order_id + external_item_id`.
  - "Period 1 / Period 3" rule is unconfirmed; don't assume it maps cleanly to calendar weeks.
- **Confidence:** Guess, end to end. Links: [Upright ShopGoodwill Listings Report](https://help.uprightlabs.com/en-us/lister/shopgoodwill-listings-report), [ShopGoodwill seller FAQ](https://shopgoodwill.com/help/faqdetail/can-i-become-a-seller-on-shopgoodwillcom).
