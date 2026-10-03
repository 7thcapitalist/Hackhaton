# ShopGoodwill (seller portal)

Researched 2026-10-03. Each claim is tagged **[fact]** (official or reputable source, linked)
or **[guess]**. Links are at the bottom.

**Bottom line: there is no public documentation of ShopGoodwill's seller reports.** The seller
portal is for Goodwill members only. Everything about the "periodic marketplace report" layout
is a guess until Amanda shares one real file. The Upright Paid Order Items report covers
ShopGoodwill orders and is the source of truth for orders anyway.

## Template answers

- **What it is:** ShopGoodwill.com, the national Goodwill auction marketplace. Goodwill
  Michiana sells there (seller page `shopgoodwill.com/southbend`). **[fact, docs/research.md
  §3]** Seller tools ("Administration Panel") are "restricted to the members of Goodwill only".
  **[fact, [S1]]** Portal: `sellerportal.shopgoodwill.com`. **[fact, [S2]]** ShopGoodwill
  collects the buyer's payment and "is responsible for remitting the funds to the Seller".
  **[fact, [S3]]**
- **How Goodwill gets the data today (slide 38):** "Periodic marketplace reports · Filter
  year/month; Period 1 periodic only; Period 3 all reports". **[fact, slide 38]** Our reading:
  the portal lists reports by year/month and by **period** (a remittance/settlement period
  inside the month); for Period 1 Goodwill downloads only the "periodic" report, for Period 3
  (last period of the month?) it downloads all reports. **[guess]**
- **Frequency available:** by period (several per month). Daily: unknown. **[guess]**
- **Live API:** **no official seller API.** The site's own backend `buyerapi.shopgoodwill.com`
  is undocumented and buyer-side (search, item detail, login); people reverse-engineer it.
  **[fact, [S4][S5]]** Not for us: undocumented, would need Goodwill's credentials, likely
  against terms. Upright Lister integrates with ShopGoodwill (it lists and pulls orders), so
  **Upright's API is the practical API for ShopGoodwill data.** **[fact for the integration,
  [S6]]**
- **File format:** unknown. CSV or XLSX most likely. **[guess]**
- **Columns:** unknown (§1).
- **Money fields:** what we know from other sources: ShopGoodwill buyers pay winning bid +
  shipping + a per-item **handling fee** (often $1–$15); ShopGoodwill does not add a percentage
  buyer's premium. **[fact-ish, third-party buyer guides [S7]]** ShopGoodwill charges sellers a
  **credit-card processing fee** (Upright's "Order Payment Processing Fee matches up with the
  credit card fee from Shopgoodwill"). **[fact, [S6b]]** Any ShopGoodwill commission/seller fee:
  unknown. **[ask]** Sales tax: ShopGoodwill likely collects as marketplace facilitator. **[guess]**
- **Buyer id field:** unknown; the site shows bidder usernames. **[guess]**
- **Gotchas:** §6. Time zone: ShopGoodwill shows auction end times in **Pacific Time**. **[fact
  (third-party, consistent), [S8]]** Upright tells users to pick America/Los_Angeles "for a
  closer match to Shopgoodwill's reports" → **ShopGoodwill reports are in Pacific time.**
  **[fact, [S6b]]**
- **Confidence:** low for layout; medium for the fee/time-zone facts.

## 1. The real export: "periodic marketplace report"

Nothing public. What we can say:

- Upright's **ShopGoodwill Listings report** (Upright's view, not ShopGoodwill's) has: A
  `Product SKU`, B `Channel ID` (ShopGoodwill item number), C `Title`, D `State` (Pending,
  Listed, Listing Failed, Relisting Failed, Delisted, Expired, Sold, Unpaid, Purged), plus
  auction names, listing dates, bids, start/current price. **[fact, [S6]]** This tells us
  ShopGoodwill's ids are numeric **item numbers** (e.g. `210000104`).
- A ShopGoodwill order can contain several items from the same seller (combined shipping);
  ShopGoodwill order ids exist. **[guess]**
- A periodic remittance report would plausibly list, per sold item: item id, title, end date,
  winning bid, shipping, handling, card fee, any seller fee, refund, net; plus a total. This is
  what our sample and parser assume. **[guess]**

**Ask Amanda (one screenshot or file solves this):**
1. The real header row and any lines above/below it.
2. What Period 1 / Period 3 mean (dates covered, and why Period 2 is not used).
3. Time zone of dates (we expect Pacific).
4. Which fees ShopGoodwill deducts (card fee? commission? shipping labels?) and whether
   handling stays with Goodwill.
5. Does it include refunds/returns, and as negative rows or a column?

## 2. Live API options

| Option | Status | Feasible? |
|---|---|---|
| Official ShopGoodwill seller API | none published **[fact: none found]** | no |
| `buyerapi.shopgoodwill.com` (reverse-engineered) | buyer-side, undocumented **[fact, [S4][S5]]** | no (terms, credentials) |
| **Upright Lister Public API** `/reports/order_items` filtered to channel ShopGoodwill, and `/reports/listings/shopgoodwill` | documented, token-based **[fact, see upright.md]** | **yes**, if Goodwill creates a token |

## 3. JSON shape

N/A for ShopGoodwill itself. Use Upright's (see `docs/sources/upright.md` §3); ShopGoodwill rows
have `channel = "ShopGoodwill"`, `channel_item_id` = ShopGoodwill item number,
`order_handling_total` and `order_payment_processing_fee` filled. **[guess for field names]**

## 4. Parser gap (src/sources/shopgoodwill.ts)

Every column alias is a guess, so the real file will almost certainly fail header detection
(`REQUIRED = itemId, endDate, winningBid`). Specific risks:

1. **Header names**: real names unknown. If the real file says e.g. `Item #`, `Ended`,
   `Sale Price`, `Total`, only some aliases match. Add aliases once we see a file.
2. **Time zone**: parser reads End Date as **Indianapolis local**. Evidence says ShopGoodwill is
   **Pacific**. An auction ending 9:30 PM PT lands on the next day in Indianapolis; our parser
   would book it on the PT date. Change the default zone for this source to
   `America/Los_Angeles` unless the file has a zone suffix.
3. **Buyer Premium**: parser expects and ignores it; ShopGoodwill reportedly has no percentage
   buyer premium but a **handling fee**. Parser already adds `Handling` to shipping. OK if the
   column exists.
4. **Card processing fee**: no alias (`processing fee`, `credit card fee`, `cc fee`); would be
   missed, so fees are understated. Add aliases.
5. **Period label**: parser looks for "Period N" in the preamble or file name. If the portal
   does not print it in the file, the user must name the file `..._period3...`. Make it an
   upload form field instead.
6. **Total row**: skipped only if the first cell starts with "Total". Unknown.
7. **Overlap with Upright**: ShopGoodwill items appear in Upright with `Channel Order ID`. Our
   parser uses `Order ID`, falling back to `Item ID`. If the ShopGoodwill file has only item
   ids and Upright's `Channel Order ID` is the ShopGoodwill order id, the dedupe key will not
   match → **double counted revenue**. Must confirm which id Upright puts in
   `Channel Order ID` vs `Channel Item ID` for ShopGoodwill.

## 5. Daily acquisition — recommendation

- **Daily:** get ShopGoodwill orders from **Upright** (API nightly). This is consistent with
  "Upright is the source of truth for orders".
- **Month-end:** keep the ShopGoodwill periodic report for what Upright may not have: the
  remittance (cash actually paid by ShopGoodwill), ShopGoodwill-side fees, and adjustments.
  Manual download per period, as today.
- No scraping of the seller portal.

## 6. Gotchas

- Pacific time on ShopGoodwill vs Eastern for Goodwill Michiana's books.
- Auctions end at night PT → many sales cross the Indianapolis midnight.
- Period boundaries do not equal calendar months (guess), so a "September" periodic report may
  include late-August auctions.
- Buyers pay handling to the seller; ShopGoodwill deducts a card fee. Net remittance ≠ gross.
- Unpaid auctions ("Unpaid" state) are not sales.

## Links

- [S1] ShopGoodwill help, "Can I become a seller on ShopGoodwill.com?":
  https://shopgoodwill.com/help/faqdetail/can-i-become-a-seller-on-shopgoodwillcom
- [S2] ShopGoodwill seller portal login: https://sellerportal.shopgoodwill.com/
- [S3] ShopGoodwill Terms of Use (remittance to seller): https://shopgoodwill.com/about/terms-of-use
- [S4] "Reverse Engineering ShopGoodwill for Fun and Profit": https://conway.scot/shopgoodwill-reversing/
- [S5] shopgoodwill-scripts (unofficial): https://github.com/scottmconway/shopgoodwill-scripts
- [S6] Upright help, ShopGoodwill Listings Report: https://help.uprightlabs.com/en-us/lister/shopgoodwill-listings-report
- [S6b] Upright help, Paid Order Items Report (Pacific-time tip, processing fee note):
  https://help.uprightlabs.com/en-us/lister/paid-order-items-report
- [S7] ConsumerSearch, ShopGoodwill auction buying guide (handling fees, no buyer premium):
  https://www.consumersearch.com/technology/shopgoodwill-auction-buying-guide-process-fees-resale
- [S8] BidPulse, "How ShopGoodwill Auctions Work" (end times in PT):
  https://bidpulse.app/blog/how-shopgoodwill-works-complete-guide
