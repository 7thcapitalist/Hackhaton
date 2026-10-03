# Cash Monkey (books and media orders)

Source id: `cashmonkey` · Parser: `src/sources/cashmonkey.ts` (v0.1.0)
Researched 2026-10-03. Tags: **[fact]** = official/public source (linked) or Goodwill's own
slides; **[guess]** = our inference.

- **What it is:** **CashMonkey Solutions**, a recommerce **software** company that "started as
  bulk booksellers" and now sells an AI platform for donated/returned goods
  ([cashmonkeysolutions.com](https://cashmonkeysolutions.com/)) [fact]. Products: **PeriScope**
  (books & media: identification, listing, marketplace management, **order handling**,
  repricing, fulfillment), **SpyGlass** (general merchandise ID/listing), **Compass** (intake
  routing), **AutoLines** (conveyor sorting) ([products](https://cashmonkeysolutions.com/products))
  [fact]. Their customer page cites a **"Goodwill (Multi-region, Midwest US)"** using Compass
  across 40+ stores ([customers](https://cashmonkeysolutions.com/customers)) [fact; which
  Goodwill is not named].
- **Goodwill's use, most plausible reading:** Goodwill Michiana's **book operation runs on
  PeriScope**: books are scanned, listed by Cash Monkey's software on several marketplaces
  (Amazon, eBay, AbeBooks/Biblio/Alibris-type book sites, "20+ marketplaces"
  ([platform](https://cashmonkeysolutions.com/platform))), and the **Orders Report** lists the
  resulting marketplace orders [guess, strong]. Evidence: slides 27-30 put Cash Monkey under
  **"Books"** in the *daily* routine ("Books: open Cash Monkey reports · Orders Report · select
  dates from the drop-down · click the link; the report downloads") [fact: slide captions], and
  CashMonkey is a software vendor, not a buyer [fact: site]. So Goodwill sells **through** Cash
  Monkey, not **to** it.
  - Alternative (less likely): Cash Monkey runs a managed/consignment service and pays Goodwill
    for books it sells or buys in bulk [guess; nothing public supports it].
- **How Goodwill gets the data today:** Cash Monkey web app → Reports → **Orders Report** → pick
  dates in a drop-down → click link → CSV downloads (slides 27-30); at month end "Orders · full
  month · Submit/download CSV; save as Excel" (slide 38) [fact].
- **Frequency available:** **daily** (they already pull it daily for the Daily Summary
  Spreadsheet) [fact: slides 27-30].
- **Live API:** CashMonkey advertises "**APIs for ERP, WMS, and finance systems**" and
  "**Scheduled reports and exports** for finance and leadership" ([platform](https://cashmonkeysolutions.com/platform))
  [fact: marketing text]. No public API docs, auth scheme or sandbox [fact: none found]. This
  weekend: **no** (needs CashMonkey to grant access). Ask CashMonkey for an API key or a scheduled
  email/SFTP export of the Orders Report.
- **File format:** CSV, downloaded via a link (slide 30); finance re-saves it as Excel (slide 38)
  [fact]. Header row position, preamble, columns: **unknown, no public sample** [guess].
- **Confidence:** what CashMonkey is: **fact**. That Goodwill uses PeriScope order handling:
  **guess (strong)**. Columns: **guess**.

## Columns (best guess)
A marketplace order manager typically exports **one row per order line (item)**. Expected
fields, order unknown [guess]:

| Column (guess) | Meaning | Example |
|---|---|---|
| Order Date | date/time of the marketplace order | `09/30/2026 23:41` |
| Marketplace / Channel | Amazon, eBay, AbeBooks, Biblio, Alibris… | `Amazon` |
| Order ID / Marketplace Order ID | the marketplace's order number | `113-1234567-1234567` |
| SKU | Cash Monkey inventory SKU | `CM-B-000123` |
| ISBN / UPC | product id | `9780140449136` |
| Title | book title | `The Odyssey` |
| Condition | Good / Very Good / … | `Good` |
| Qty | units | `1` |
| Price | item price paid by buyer | `8.99` |
| Shipping | shipping charged to buyer | `3.99` |
| Tax | marketplace-collected tax (often excluded) | `0.00` |
| Marketplace Fee / Commission | fee taken by the marketplace | `2.70` |
| Net / Payout | price + shipping − fees | `10.28` |
| Status | Shipped / Pending / Cancelled / Refunded | `Shipped` |
| Buyer / Ship-to name | **PII, do not store raw** | |
| Tracking # | shipment tracking | |

## Money fields and signs [guess]
- Revenue = item price (+ shipping charged); fees = marketplace commission (positive number);
  refunds = rows with status Refunded/Returned or a negative amount.
- Tax collected by the marketplace (marketplace facilitator) is not Goodwill revenue.
- Buyer id: if a buyer/ship-to name or marketplace buyer id exists, **hash it**; otherwise none.

## Gotchas
- **Double counting with the Amazon and eBay sources** [guess, important]: if Cash Monkey lists on
  Amazon/eBay under Goodwill's seller accounts, those same orders are also in the Amazon payments
  summary and the eBay listing sales report. Need the marketplace column and the marketplace order
  id to dedupe, and a rule for which source wins (probably: Amazon/eBay files for money, Cash
  Monkey for book-level detail; Cash Monkey for marketplaces that have no file of their own).
- Overlap with `goodwill_books` (a separate monthly payment statement) is possible [ask].
- Time zone of Order Date unknown (marketplace UTC vs app local). Our parser reads naive dates as
  Indiana time.
- "Customers" for the daily pulse = rows in the Orders Report today, i.e. orders (slide 26
  logic) [fact for Upright; assumed same for Cash Monkey].

## Parser gap (real format vs `src/sources/cashmonkey.ts`)
1. **Rejects likely real headers**: `FOREIGN` contains `channel` and `isbn`. A PeriScope order
   export very likely has a Marketplace/**Channel** column and an **ISBN** column → `accepts()`
   returns false and the file goes unrecognized (or to another parser).
2. **Order vs item grain**: parser assumes one row per order with `Item Count`. Real export is
   probably one row per item; multiple rows share an order id. Dedupe key must include SKU/ISBN,
   and `Item Count` will usually be absent (parser then needs `Item Count + Net + Gross` without
   a file-name hint, so recognition depends on the file name containing "cashmonkey").
3. **No marketplace column read**: everything is emitted as channel `other`. If orders are Amazon
   or eBay orders, they must map to those channels (and dedupe against those files), or be
   flagged as informational.
4. **Shipping and tax not split**: parser sets `shippingCents = 0`, `taxCents = 0`, and the gross
   alias list includes `Total`/`Order Total`, which may include shipping and tax.
5. **Title column vs `isTotalRow`**: `isTotalRow` skips any row where *any* cell starts with
   "Total"/"Totals"/"Subtotal". A book titled e.g. "Total Recall" would be silently dropped.
   Check only the first non-empty cell.
6. Buyer id is always null; if a buyer column exists it should be hashed, not ignored (customers
   count = orders anyway).
7. Fixture header `Order ID, Order Date, Item Count, Order Total, Fees, Net, Status` with a
   2-line preamble is invented; no evidence for the preamble.

## Daily acquisition recommendation
1. Ask CashMonkey (they advertise finance APIs and scheduled exports) for a **daily scheduled
   Orders Report by email or SFTP**, or an API key; ingest by email pickup / cron. Zero clicks.
2. Until then: someone already downloads it daily (slides 27-30) → drop the same CSV on our upload
   page; month-end = upload the full-month file once.

## Accounting notes
- Slide 38 gives no GL for Cash Monkey; the allocation workbook's Cash Monkey tab has the rule
  [fact: absent from slide].
- Ask the accountant:
  1. Is Cash Monkey your listing software (PeriScope) or a buyer that pays you? Do you pay Cash
     Monkey a subscription or a % of sales?
  2. Which marketplaces do Cash Monkey orders come from? Are those orders also in the Amazon /
     eBay files you use for the close? If so, what is the Cash Monkey tab used for (book revenue
     by category? allocation?)
  3. Revenue: price only, or price + shipping? Net of marketplace fees?
  4. Where does the money land (marketplace payouts to 1st Source?), and which GL/department?
  5. Can you share one anonymized Orders Report CSV?

## Sources
- [CashMonkey Solutions home](https://cashmonkeysolutions.com/)
- [CashMonkey products](https://cashmonkeysolutions.com/products)
- [CashMonkey platform](https://cashmonkeysolutions.com/platform)
- [CashMonkey customers](https://cashmonkeysolutions.com/customers)
- [CashMonkey hold page (platform overview)](https://www.cashmonkeysolutions.com/hold.html)
- `docs/goodwill-problem.md` slides 27-30 and 38 (Goodwill's deck)
