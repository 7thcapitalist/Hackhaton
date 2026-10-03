# Research: findings that change what we build

Research pass, Sat Oct 3 2026, ~12:30 to 1:05 PM. Time-boxed, so public docs only.
Each finding is tagged **[fact]** (source cited) or **[guess]** (our inference; confirm
with Amanda or by testing). Read with [goodwill-problem.md](goodwill-problem.md) and
[data-contract.md](data-contract.md).

## TL;DR: what changes

1. **BC export = an Excel/CSV laid out as General Journal columns, signed Amount
   (+ debit / − credit), pasted or "Edit in Excel"-published into a journal batch.**
   No BC API, no sandbox in the demo (trial needs a work/school email and setup time).
   Disclose the BC step as "file ready for import, not posted live".
2. **"Upright" is Upright Labs' *Lister*, a multichannel listing tool built for
   Goodwills.** Its *Paid Order Items* CSV covers sales on ShopGoodwill, eBay and others.
   That means **the same order can appear in Upright and in the eBay / ShopGoodwill
   report.** We need a `channel` column separate from `source_id` and a de-dup key, or
   the pulse double counts. Ask Amanda which source is the revenue source of truth.
3. **"Goodwill Books" is GoodwillBooks.com**, a shared marketplace run by a network of
   Goodwills; Goodwill Industries of Michiana is a listed seller. Its monthly payment
   statement is a payout statement → `money_lines`, and a candidate for the AR invoice.
4. **"Cash Monkey" is most likely CashMonkey Solutions** (recommerce / bulk-book
   platform). [guess] Unconfirmed: ask Amanda whether it is a buyer of Goodwill's books
   and media (revenue) or a sales/listing platform.
5. **Marketplace exports are messy by design**: Amazon's transaction CSV has disclaimer
   lines before the header [guess, widely reported]; eBay CSVs have a blank line after
   the header and footer lines [guess]. Parsers must find the header row, not assume
   row 1. This is our "messy input" for the demo.
6. **Marketplace-collected sales tax** (Amazon "marketplace withheld tax", eBay
   "eBay collected tax") is in the totals but is **not Goodwill's revenue**. Add
   `tax_cents` to orders and exclude it from revenue.
7. **Nobody sells this off the shelf**: A2X, Link My Books and Webgility target
   QuickBooks / Xero / NetSuite / Sage, not Business Central, and none read ShopGoodwill,
   Upright or GoodwillBooks. Good business-viability story.
8. **Vercel Hobby cron = once a day, fuzzed within the hour, UTC.** Fine for a nightly
   pulse; for the demo, also expose a "Send pulse now" button. Resend free = 100/day.
9. **Turso on Vercel: use `@libsql/client/web` (HTTP), never `file:` DBs in production**;
   the Marketplace integration may prefix env var names.

---

## 1. Microsoft Dynamics 365 Business Central (BC)

### General Journal import options

| Option | How it works | Demo fit |
|---|---|---|
| Copy/paste from Excel | Columns in Excel in the same order as the journal page (after **Show More Columns**), paste into the General Journal. Exactly what Goodwill does today (slide 39 step 5). | **Best**: zero change to their workflow |
| **Edit in Excel** | From a journal batch, Share → Edit in Excel opens an Excel add-in bound to the batch; add rows, click **Publish**; lines land in the batch, still unposted. Needs one line in the batch first; each row needs a unique Line No. [dynamicspowerplay.com](https://dynamicspowerplay.com/import-journal-entries-business-central-excel/) | Good, same file layout |
| Configuration package (RapidStart) | Import an Excel file mapped to table 81 *Gen. Journal Line*. Admin setup. | Overkill |
| Import apps (e.g. Excel journal import on AppSource) | Template-based import, supports dimensions. [365extensions](https://docs.365extensions.com/docs/EI/docs/Imports/GeneralJournal/), [Marketplace](https://marketplace.microsoft.com/en-us/product/dynamics-365-business-central/pubid.chasesoftware1583153119945%7Caid.excel-journal-import%7Cpappid.ee3871f6-b8ab-4a26-9e80-04945a36b42e) | Mention only |
| API v2.0 `journals` / `journalLines` | REST; needs an Entra app registration + BC environment | Roadmap ("next step") |

### Columns and conventions **[fact]**
- Journal page columns (with Show More Columns): **Posting Date, Document Type,
  Document No., Account Type, Account No., Description, Amount (or Debit Amount /
  Credit Amount), Bal. Account Type, Bal. Account No.**, plus the global dimensions
  shown as shortcut columns. Edit in Excel also carries **Journal Template Name,
  Journal Batch Name, Line No.** [MS Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-work-general-journals), [dynamicspowerplay](https://dynamicspowerplay.com/import-journal-entries-business-central-excel/)
- **Sign:** "A positive amount in the Amount field is debited to the main account and
  credited to the balancing account. A negative amount is credited to the main account
  and debited to the balancing account." [MS Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-work-general-journals)
- **Balancing:** lines sharing a Document No. must net to zero, unless each line has its
  own Bal. Account No. Batch option *Suggest Balancing Amount* helps. If the batch has a
  No. Series, document numbers must be sequential (*Renumber Document Numbers*). [MS Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-work-general-journals)
- **Dimensions:** Global Dimension 1 and 2 show on journal lines as *Shortcut Dimension
  1 Code / 2 Code*; the column caption is the dimension name (e.g. "Department Code")
  **only if** Department is set up as global dimension 1 or 2. [stoneridge](https://stoneridgesoftware.com/how-to-build-a-general-journal-import-in-business-central/), [thedynamicsexplorer](https://thedynamicsexplorer.com/2024/09/18/dynamics-365-business-central-shortcut-dimensions-and-why-your-dimensions-arent-visible-in-the-general-journal-page/)
- API `journalLine` fields: `accountNumber`, `postingDate`, `documentNumber` (max 20),
  `amount`, `description` (max 50). [MS Learn API](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_journalline)
  → keep Description ≤ 50 chars, Document No. ≤ 20 chars in our export.
- AR invoice via API v2.0 `salesInvoices` (customerNumber, invoiceDate/postingDate,
  externalDocumentNumber) with `salesInvoiceLines` (lineType `Account` + lineObjectNumber
  = G/L account, description, quantity, unitPrice). [guess from MS API reference
  structure; not re-verified today]. For the demo: export an "Invoices" sheet with the
  same fields the user keys into a BC Sales Invoice.

### Sandbox / trial **[fact]**
- Free 30-day trial requires a **work or school email**; gmail/outlook rejected. Sandbox
  environments come from the admin center (up to 3). [MS Learn trial](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/deployment/customer-signup), [Trial FAQ](https://learn.microsoft.com/en-gb/dynamics365/business-central/trial-faq)
- **Recommendation:** do not depend on BC in the build. Optional stretch (Joao only):
  try a trial with a `@nd.edu` address Saturday night; if it works, record 20 seconds of
  pasting our file into a real General Journal. If not, disclose.

### Recommended export (demo)
`bc-general-journal-<period>.xlsx` (and `.csv`), one sheet "General Journal", columns
in this order:

`Journal Template Name | Journal Batch Name | Line No. | Posting Date | Document Type |
Document No. | External Document No. | Account Type | Account No. | Description |
Department Code | Amount | Bal. Account Type | Bal. Account No.`

- Amount: decimal with 2 places, signed per BC rule (+ debit). Template `GENERAL`, batch
  `ECOM-<YYYYMM>` (placeholders, TBC). Document No. `ECOM-<YYYYMM>-<SRC>`.
- Second sheet "Sales Invoice" for the AR invoice; third sheet "Trace" mapping each line
  to source file + rows (for the auditor/ethics story).

## 2. Source export formats (for synthetic fixtures)

Use these headers verbatim in fixtures. Unknowns are marked; the generator should make
them easy to swap once Amanda shares a real header row.

| Source | What it is | File & key columns | Confidence |
|---|---|---|---|
| **Amazon: Date Range Transaction report** (Seller Central → Reports → Payments → Date Range Reports) | Per-transaction ledger incl. fees, refunds, transfers | CSV with several disclaimer lines above the header. Columns: `date/time, settlement id, type, order id, sku, description, quantity, marketplace, fulfillment, order city, order state, order postal, tax collection model, product sales, product sales tax, shipping credits, shipping credits tax, gift wrap credits, giftwrap credits tax, regulatory fee, promotional rebates, promotional rebates tax, marketplace withheld tax, selling fees, fba fees, other transaction fees, other, total`. `type` values: Order, Refund, Transfer, Service Fee, Adjustment… [feedvisor](https://feedvisor.com/university/payment-transaction-report/), [staxxer](https://staxxer.com/how-to-get-transaction-reports-from-amazon-seller-central/) | columns: fact; preamble lines: guess |
| Amazon: "Payments summary" (slide 38) | Probably the **Summary** Date Range report (PDF/CSV: income, expenses, tax, transfers) [guess]. The transaction CSV reconciles to it. [seller forum](https://sellercentral.amazon.com/seller-forums/discussions/t/67005fdc-f915-4d17-8d9e-205afa150d6b) | Use transaction CSV as the parsed input; summary totals as the check | guess |
| Amazon settlement flat file V2 (alt.) | Per settlement period | `settlement-id, settlement-start-date, settlement-end-date, deposit-date, total-amount, currency, transaction-type, order-id, merchant-order-id, adjustment-id, shipment-id, marketplace-name, amount-type, amount-description, amount, fulfillment-id, posted-date, posted-date-time, order-item-code, merchant-order-item-id, merchant-adjustment-item-id, sku, quantity-purchased, promotion-id` [Amazon SP-API](https://developer-docs.amazon/sp-api/docs/report-type-values-settlement) | fact |
| **eBay: Orders report** (Seller Hub → Orders → Download) | One row per order line | `Sales Record Number, Order Number, Buyer Username, Buyer Name, …, Item Number, Item Title, Quantity, Sold For, Shipping And Handling, eBay Collected Tax, Total Price, Sale Date, Paid On Date, …`. Total Price includes eBay-collected tax when "eBay Collected Tax Included in Total" = Yes. [eBay Seller Hub help](https://www.ebay.com/help/selling/selling-tools/seller-hub?id=4095), [eBay community](https://community.ebay.com/t5/Report-eBay-Technical-Issues/quot-Transaction-Report-quot-CSV-details/td-p/33455429) | names: fact; full order: guess |
| **eBay: Transaction report** (Payments → Reports) | Money: sales, fees, refunds, payouts | `Transaction creation date, Type, Order number, Legacy order ID, Buyer username, …, Net amount, Item subtotal, Shipping and handling, Final Value Fee - fixed, Final Value Fee - variable, …, Payout ID, Payout date`. Columns customizable, so headers vary. [linkmybooks](https://linkmybooks.com/blog/ebay-transactions-reports), [eBay UK help](https://www.ebay.co.uk/help/selling/fees-credits-invoices/reconciling-ebay-sales-transactions?id=4847) | partial fact |
| eBay "listing sales report" (slide 38) | Unclear which eBay report Goodwill means [guess: orders report]. Ask. | | ask |
| **ShopGoodwill** seller portal (sellerportal.shopgoodwill.com) | Goodwill-only admin panel. Has a Listings report (CSV: auction names, listing dates, bids, start/current price, status) and, per slide 38, "periodic marketplace reports" filtered by year/month, "Period 1 / Period 3". [ShopGoodwill help](https://shopgoodwill.com/help/faqdetail/can-i-become-a-seller-on-shopgoodwillcom), [Upright help](https://help.uprightlabs.com/en-us/lister/shopgoodwill-listings-report) | No public column list. **Synthesize**: `Item ID, Title, Category, End Date, Winning Bid, Shipping, Handling, Buyer Premium?, Seller Fee, Net, Buyer ID, Status, Period`. [guess] "Period" is probably ShopGoodwill's settlement period within the month [guess] | guess |
| **Upright Labs: Paid Order Items report** | Lister report: CSV history of every sold item across marketplaces; generated, emailed. Col A `Channel` (ShopGoodwill, eBay…), B `Channel Item ID`, C `Channel Order ID`, E `Upright Product ID`, F `Quantity`; timestamps in cols P–S in the time zone picked at generation. [Upright help (search snippet)](https://help.uprightlabs.com/en-us/lister/paid-order-items-report); also Sales by Category and Shipments reports exist [Upright](https://help.uprightlabs.com/en-us/lister/sales-by-category-report), [Shipments report](https://help.uprightlabs.com/en-us/lister/shipments-report) | A,B,C,E,F: fact; rest guess (`Title, Category, Store, Lister, Price, Shipping, Fees, Ordered At, Paid At, Shipped At, Listed At`) |
| **Cash Monkey** | Likely CashMonkey Solutions: "AI platform for recommerce", started as bulk booksellers. [cashmonkeysolutions.com](https://cashmonkeysolutions.com/) Slide 38: "Orders · full month; submit/download CSV". | Synthesize `Order ID, Order Date, Item Count, Gross, Fees, Net, Status` [guess] | guess |
| **Goodwill Books** (GoodwillBooks.com) | Network marketplace for books/media from many Goodwills, 1.5M+ items, free shipping; Michiana is a seller ([seller page](https://www.goodwillbooks.com/south-bend-indiana), [about](https://www.goodwillbooks.com/about-us)). Monthly payment statement arrives by email. | Synthesize statement: header (seller, period, payment date) + lines `Order #, Date, SKU/ISBN, Title, Sale Price, Commission/Fee, Net`; payment total [guess] | guess |
| **FedEx Billing Online** | Invoice download: Reporting → Create Report → Filter Set Invoice → All Columns → CSV. Columns incl. `Invoice Number, Invoice Date, Tracking ID, Shipment Date, Service Type, Net Charge Amount, …`; refunds/credits appear as negative or adjustment lines. [Reveel](https://help.reveelgroup.com/knowledge/how-to-download-data-from-fedex-billing-online-user), [FedEx CSV guide (PDF)](https://www.fedex.com/content/dam/fedex/us-united-states/services/csv_selectable_invoice_and_fixed-length_remittance_records.pdf) | partial fact |
| **EasyPost** Shipment CSV report | Dashboard/API reports. `created_at, id, tracking_code, status, … carrier, service, rate, refund_status (submitted/refunded/rejected), batch_id …`; Payment Log report for wallet top-ups/charges. [EasyPost Shipment CSV](https://support.easypost.com/hc/en-us/articles/8108495510157-Shipment-CSV-Report), [Payment Log](https://support.easypost.com/hc/en-us/articles/4405420574861-Payment-Log-CSV-Report) | fact |
| **Pitney Bowes** (SendPro 360 / PitneyAnalytics) | Shipment details report, configurable columns: `Shipment Create Date, Sender Name, Carrier Name, Service, Tracking Number, Total Charges…` [PB data dictionary (PDF)](https://www.pitneybowes.com/content/dam/support/product-documentation/shipping-360/en/pitneyanalytics-data-dictionary-shipment-details-report.pdf), [PB support](https://www.pitneybowes.com/us/support/article/000094526/running-a-shipment-details-report-in-sendpro-360.html) | partial fact |
| **OSM Worldwide** | Parcel consolidator (also an EasyPost carrier [EasyPost OSM guide](https://docs.easypost.com/carriers/osm-guide)); no public report format found. | Synthesize invoice CSV `Invoice #, Ship Date, Tracking, Service, Weight, Charge` [guess] | guess |
| Shipping rule (slide 38) | "OSM / PB / EasyPost: 1st Source acct 0101 · GL 10009" → these are **bank debits** (postage top-ups) from 1st Source account 0101 posted to GL 10009 [guess: 10009 is a cash/prepaid postage account]. Source of truth may be the **bank statement**, not the carrier report. Ask. | | guess |
| **Jewelry report / "Co-Pivot"** | Nothing public. Guess: an internal Excel pivot ("Co-Pivot" = copy of a pivot / Copilot?) that fills Supplier. **Ask Amanda.** Treat as a manual-upload source with a Supplier column. | | ask |

## 3. Goodwill e-commerce context

- Goodwill Michiana sells on **ShopGoodwill** (seller page [shopgoodwill.com/southbend](https://shopgoodwill.com/southbend); e-com pickup at 2721 Kenwood Ave, South Bend) and **GoodwillBooks.com**. [fact]
- ShopGoodwill seller services are only for Goodwill nonprofit members. [fact, ShopGoodwill help](https://shopgoodwill.com/help/faqdetail/can-i-become-a-seller-on-shopgoodwillcom)
- Upright Lister is the common Goodwill listing tool (ShopGoodwill, eBay, Shopify, OfferUp,
  FB Marketplace; claims −90% listing time); Upright has case studies with Goodwill
  Delaware and Greater Washington and integrates with GoodwillFinds. [Upright](https://www.uprightlabs.com/2024/05/07/goodwillfinds-integration/), [Upright Delaware](https://www.uprightlabs.com/portfolio/goodwill-delaware-productivity-boost/)
  → Upright likely holds the **item pipeline timestamps** (listed at, lister) needed for
  productivity KPIs ("Listings per Employee", "Days from Donation to Listing"). Ask.
- Donated goods have ~zero acquisition cost, so "gross margin" is really revenue minus
  processing labor, fees and shipping. [guess] Ask how they compute it; make the formula
  a config value, shown on the scorecard.

## 4. Landscape and business viability

| Tool | What | Price | BC? | Goodwill sources? |
|---|---|---|---|---|
| A2X | Amazon/Shopify/eBay payouts → summarized journals | ~$29–$119/mo single channel; Multi $89–$169+/mo [thepricegeek](https://www.thepricegeek.com/profit-analytics/a2x-review/), [linkmybooks](https://linkmybooks.com/blog/a2x-ebay-integration) | No (QBO, Xero, Sage, NetSuite) | No |
| Link My Books | Same, Xero/QuickBooks | per plan [Capterra](https://www.capterra.com/p/184768/Link-My-Books/) | No | No |
| Webgility | Order/fee sync to QuickBooks/Xero | $199–$599/mo annual [webgility](https://www.webgility.com/pricing), [erpresearch](https://www.erpresearch.com/erp-add-ons/connectors/webgility) | No | No |
| BC AppSource connectors / partners | Custom per-customer | Partner project | Yes | No |

Pitch angle:
- **Gap:** no tool reads ShopGoodwill + Upright + GoodwillBooks + carriers and writes a
  BC journal. Goodwill's own consultant-style wave plan (slide 42) implies a project,
  not a product.
- **Who else:** Goodwill has ~150 independent local member organizations in the US
  [guess, commonly cited; verify before quoting], many on ShopGoodwill and Upright; many
  on BC or other Dynamics. A shared tool could be offered via Goodwill Industries
  International or ShopGoodwill as a shared service.
- **Model:** nonprofit-friendly flat subscription (e.g. $99–$299/mo per Goodwill org,
  [guess]) on Vercel + Turso free/cheap tiers (running cost of a few $/mo); or open
  source + paid setup. Value: staff days per month on the close (slide 39) × wage.
- **Why not A2X:** no BC support, no Goodwill marketplaces, no scorecard.

## 5. Turso + Drizzle + Next.js on Vercel; email; cron

| Topic | Finding |
|---|---|
| Env vars | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` [Turso docs](https://docs.turso.tech/integrations/vercel). Vercel Marketplace integration can add a **custom prefix** (e.g. `STORAGE_TURSO_DATABASE_URL`) [example PRs](https://github.com/biluses/advanceERP/pull/3). → When Joao connects it, choose **no prefix**, or read both in `src/db/client.ts`. |
| Client | Use `@libsql/client/web` (HTTP, fetch-only) on Vercel [Turso docs](https://docs.turso.tech/integrations/vercel); `drizzle-orm/libsql`. Local dev: `@libsql/client` with `file:local.db`. **Never `file:` in Vercel** (read-only FS). Never prefix DB vars with `NEXT_PUBLIC_`. |
| Runtime | Use Node runtime (`export const runtime = 'nodejs'`) for upload/parse routes: XLSX parsing (`xlsx`/SheetJS or `exceljs`) and file buffers. Body limit on Vercel functions ~4.5 MB [guess, verify]; fixtures are small. |
| Migrations | `drizzle.config.ts` with `dialect: 'turso'`, `dbCredentials: { url, authToken }`. Run `drizzle-kit push` (hackathon) or `generate` + `migrate` **from a laptop**, not in the Vercel build. One person (Claude/data layer) owns migrations. |
| Seeding | `npm run seed` script (tsx) loads fixtures into Turso; plus an in-app "Reset demo data" route guarded by a secret, so the demo always starts clean. |
| Cron | Vercel Hobby: cron runs **once per day max**, may fire anywhere within the hour, UTC [Vercel docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [steadycron](https://steadycron.com/guides/vercel-cron-limits/). Use `"0 11 * * *"` (≈ 7 AM Eastern). Protect route with `CRON_SECRET` (Vercel sends `Authorization: Bearer <CRON_SECRET>`) [guess from Vercel docs pattern; verify]. |
| Email | **Resend**: free 3,000/mo, 100/day [Resend](https://resend.com/docs/knowledge-base/what-is-resend-pricing); React Email templates in repo. Without a verified domain, sends from `onboarding@resend.dev` only to the account owner's address [guess, verify] → fine for the demo (send to Joao's inbox). Env: `RESEND_API_KEY`, `PULSE_TO_EMAIL`. Fallback: render the email HTML in-app. |

## 6. Proposed changes to data-contract.md (not applied; for Joao's PR)

1. **Add `channel` to `orders`** (ShopGoodwill, Amazon, eBay, GoodwillBooks, Other) separate
   from `source_id`. Upright's Paid Order Items spans channels. Pulse groups by
   `orders.channel` mapped to a pulse row via a `channels` config table (or
   `sources.config_json`), not by `sources.channel_group`.
2. **Add `dedupe_key` to `orders`** = `channel + ':' + channel_order_id + ':' + channel_item_id`,
   unique index. Add a `sources.revenue_authority` flag (which source wins when Upright
   and eBay both report an order). Duplicates → `exceptions.kind = 'duplicate_order'`.
3. **Add `tax_cents` (marketplace-collected tax) and `currency` to `orders`.** Define
   `net_cents = gross_cents + shipping_cents − refund_cents − fee_cents` and **revenue
   (pulse) = gross_cents + shipping_cents − refund_cents** excluding tax; make the choice
   a config flag (TBC with Amanda).
4. **Two sign conventions, written down:** facts use + = money in; `journal_lines.amount_cents`
   uses BC's rule + = debit to Account No., − = credit. `gl_rules.sign` renamed
   `journal_sign` and documented as "multiplier from fact sign to BC debit sign".
5. **BC export columns** (replace the list in "Business Central export"):
   Journal Template Name, Journal Batch Name, Line No., Posting Date, Document Type,
   Document No. (≤20), External Document No., Account Type, Account No., Description
   (≤50), Department Code (= Shortcut Dimension 1 Code, TBC), Amount (decimal),
   Bal. Account Type, Bal. Account No. Add `journal_lines.external_document_no`,
   `journal_template`, `journal_batch`.
6. **Balance check:** per `document_no`, Σ amount must be 0 unless every line has a
   `bal_account_no`. Engine raises `exceptions.kind = 'unbalanced_document'`.
7. **`money_lines`:** add `channel`, `payout_id` / `settlement_id`, `bank_account_no`
   (for "1st Source 0101"); extend `amount_type` enum: `sale`, `refund`,
   `marketplace_fee`, `fulfillment_fee`, `shipping_label`, `shipping_refund`,
   `postage_topup`, `payout`, `tax_withheld`, `adjustment`, `statement_payment`.
8. **`ingest_runs`:** add `header_row_index`, `header_signature` (hash of normalized
   header, to detect renamed columns), `parser_version`, `business_date` (nightly feeds),
   `period_label` (ShopGoodwill "Period 1/3").
9. **`ar_invoices`:** fields `customer_no`, `invoice_date`, `posting_date`,
   `external_document_no`, `currency`; lines `line_type` ('Account'|'Item'),
   `account_no`, `description`, `quantity`, `unit_price_cents`, `dept_code` (mirrors BC
   salesInvoiceLines). Customer is TBC (guess: GoodwillBooks network or ShopGoodwill).
10. **Parser interface:** `accepts()` should receive the first ~20 raw rows, not just
    a header, so parsers can locate the header row after disclaimer lines.
    Add `detectHeaderRow(rows, requiredColumns)` shared helper.
11. **Item pipeline + labor hours are synthetic only** and flagged `is_synthetic=1` at the
    `ingest_runs` level; the scorecard shows a "simulated" badge on KPIs that use them.
12. **Env vars to add to `.env.example`:** `RESEND_API_KEY`, `PULSE_TO_EMAIL`,
    `CRON_SECRET`, `BUYER_KEY_SALT`, `ANTHROPIC_API_KEY` (AI note; optional),
    `DEMO_RESET_SECRET`.
