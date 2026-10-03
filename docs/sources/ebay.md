# eBay

- **What it is:** Marketplace. One of the core e-commerce channels on the nightly pulse.
- **How Goodwill gets the data today:** Seller Hub / Seller Center → change date range →
  generate/download. Slide 38: *"Listing sales report... Seller Center · change date ·
  generate/download."* It's ambiguous whether "listing sales report" means the **Orders**
  report below or the separate **Transaction** report (fees/payouts) — ask Amanda.
- **Frequency available:** On-demand, any date range — daily-capable.
- **Live API:** eBay Sell APIs (Fulfillment, Finances) exist and are documented, but need
  an OAuth app registration against Goodwill's real eBay account. **Not usable this
  weekend** — fixtures only.
- **File format:** CSV. Columns are customizable per seller account, so headers can vary
  between exports (guess: a blank line after the header and footer lines, as reported for
  similar eBay exports).
- **Columns (Orders report):** `Sales Record Number, Order Number, Buyer Username, Buyer
  Name, Item Number, Item Title, Quantity, Sold For, Shipping And Handling, eBay Collected
  Tax, Total Price, Sale Date, Paid On Date`.
- **Money fields:** `Sold For` = revenue. `Shipping And Handling` = shipping revenue.
  `eBay Collected Tax` = tax — **it's bundled into `Total Price`** when "eBay Collected
  Tax Included in Total" = Yes, so it must be subtracted back out, not just excluded.
  `Total Price` = Sold For + Shipping + Tax.
- **Buyer id field:** `Buyer Username` — hash it, never store raw.
- **Gotchas:**
  - Tax-in-total is the opposite pattern from Amazon (tax is its own column there) — good
    demo contrast, but means the two parsers can't share tax-exclusion logic verbatim.
  - **Upright Lister spans eBay sales too** — the same sale can appear in both this export
    and Upright's Paid Order Items export. This is the required Upright↔eBay duplicate
    messy case in the fixtures (see `upright.md`); dedupe on
    `channel + external_order_id + external_item_id`.
- **Confidence:** Column names = partial fact ([eBay Seller Hub help](https://www.ebay.com/help/selling/selling-tools/seller-hub?id=4095), [LinkMyBooks](https://linkmybooks.com/blog/ebay-transactions-reports), [eBay UK help](https://www.ebay.co.uk/help/selling/fees-credits-invoices/reconciling-ebay-sales-transactions?id=4847)). Full export shape (blank/footer lines): guess.
