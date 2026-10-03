# Amazon (Seller Central)

Researched 2026-10-03. Each claim is tagged **[fact]** (stated by an official or reputable
source, linked) or **[guess]** (inference, not confirmed). Links are at the bottom.

## Template answers

- **What it is:** Amazon US marketplace. Goodwill Michiana sells used goods (probably mostly
  books/media) as a merchant-fulfilled (MFN) seller. **[guess]** that it is MFN, not FBA.
- **How Goodwill gets the data today (slide 38):** "Payments summary · Seller Central ·
  request/refresh/download". **[fact, slide 38]** That request → refresh → download flow is the
  flow of **Payments → Reports Repository (Date Range Reports)**: pick report type and date
  range, click "Request report", wait, refresh, download. **[fact, [A1]]** Two report types live
  there: the **Summary** report (PDF: income, expenses, tax, transfers) and the **Transaction**
  report (CSV: one line per transaction). **[fact, [A1]]** "Payments summary" most likely means
  the Summary PDF, with the Transaction CSV as the detail behind it. **[guess]**
- **Frequency available:** any date range up to 365 days, back to 2012; generation "typically
  within three hours". **[fact, [A1]]** So daily is possible (request yesterday's range each
  morning), but it is manual and slow. Settlement reports are produced by Amazon on its own
  schedule, roughly every 14 days. **[fact, [A2]]** (14 days: **[guess]** from common practice.)
- **Live API:** yes, SP-API. Details below. Not usable this weekend (needs Goodwill's Seller
  Central login plus developer registration). **[fact/guess, see §2]**
- **File format:** Transaction report = CSV, comma-delimited, quoted, UTF-8. **[fact, CSV:
  [A1]; encoding: guess]** About 7 disclaimer lines above the header (our sample reproduces
  them). **[guess, widely reported, not seen in an official spec]** The settlement V2 flat file
  (API alternative) is **tab-delimited .txt**, kebab-case headers, no preamble. **[fact, [A2]]**
- **Columns:** see §1.
- **Money fields:** see §1. Fees and refunds are **negative** in the CSV; `total` is the net
  effect on the seller balance. **[fact for fees, [A3]; refunds negative: guess, consistent with
  every public example]**
- **Buyer id field:** **none.** Neither the Transaction CSV nor the settlement file carries a
  buyer id; Amazon hides buyer identity. **[fact for the column lists]** Fine with our decision
  "every transaction is a different customer": customers = distinct `order id`.
- **Gotchas:** see §6.
- **Confidence:** column names high (two independent sources plus our sample); preamble text
  medium; date format medium; "payments summary" = Summary PDF medium.

## 1. The real export: Date Range **Transaction** report (CSV)

Path: Seller Central → Payments → Reports Repository → report type "Transaction" → date range
→ Request report → (wait) Refresh → Download. **[fact, [A1]]**

**Preamble [guess]** (seven lines, each a single quoted cell):

```
"Includes Amazon Marketplace, Fulfillment by Amazon (FBA), and Amazon Webstore transactions"
"All amounts in USD, unless specified"
"Definitions:"
"Sales tax collected: Includes sales tax collected from buyers for product sales, shipping, and gift wrap."
"Selling fees: Includes variable closing fees and referral fees."
"Other transaction fees: Includes sales tax collection fees."
"Other: Includes non-order transaction amounts. For more details, see the ""Type"" and ""Description"" columns for each order ID."
```

The first line is confirmed as real report text by a document titled from a real custom
transaction export. **[fact, [A4] title]** The others are **[guess]**.

**Header, in order** (US marketplace) **[fact for names, [A3][A5]; order: guess but consistent]**:

| # | Column | Meaning / example |
|---|---|---|
| 1 | `date/time` | posting time, e.g. `Sep 30, 2026 8:45:12 PM PDT` **[guess format]** |
| 2 | `settlement id` | settlement period id, e.g. `21839471023` |
| 3 | `type` | `Order`, `Refund`, `Service Fee`, `Transfer`, `Adjustment`, … |
| 4 | `order id` | `113-1234567-1234567` (3-7-7 digits) **[fact, Amazon order id format]** |
| 5 | `sku` | seller SKU |
| 6 | `description` | item title, or fee description for non-order rows |
| 7 | `quantity` | units |
| 8 | `marketplace` | `amazon.com` (one source lists it as `store`) |
| 9 | `fulfillment` | `Seller` (MFN) or `Amazon` (FBA) **[guess values]** |
| 10 | `order city` | buyer city (PII-light; we drop it) |
| 11 | `order state` | buyer state |
| 12 | `order postal` | buyer ZIP |
| 13 | `tax collection model` | `MarketplaceFacilitator` |
| 14 | `product sales` | item revenue (+) |
| 15 | `product sales tax` | tax collected on the item (+) |
| 16 | `shipping credits` | shipping charged to buyer (+) |
| 17 | `shipping credits tax` | |
| 18 | `gift wrap credits` | |
| 19 | `giftwrap credits tax` | (note: no space, spelled differently from col 18) |
| 20 | `Regulatory Fee` | (capitalized in some exports) |
| 21 | `promotional rebates` | seller-funded discounts (−) |
| 22 | `promotional rebates tax` | |
| 23 | `marketplace withheld tax` | equal and opposite of the tax collected (−) |
| 24 | `selling fees` | referral + closing fees (−) |
| 25 | `fba fees` | (−), zero for MFN |
| 26 | `other transaction fees` | (−) |
| 27 | `other` | non-order amounts |
| 28 | `total` | net of the row |
| 29 | `Transaction Status` | **new in 2026**: `Deferred` / `Released` **[fact, [A6]]** |
| 30 | `Transaction Release Date` | **new in 2026** **[fact, [A6]]** |

**2026 change [fact, [A6]]:** since early 2026 the Date Range reports list transactions by
**posting date** ("a few hours after shipment"), not by release/payout date, applied
retroactively from 2025-01-01, and two columns were added: Transaction Status and Transaction
Release Date. Exact header capitalization of those two is **[guess]**.

**Number format [guess]:** plain decimals, minus sign for negatives, thousands separators
possible inside quotes (`"1,234.56"`). Our `toCents` handles `$`, commas, parentheses.

**`type` values seen in the wild [guess, from memory of public examples]:** `Order`, `Refund`,
`Service Fee`, `Transfer`, `Adjustment`, `FBA Inventory Fee`, `Shipping Services` (Amazon
"Buy Shipping" labels), `Chargeback Refund`, `A-to-z Guarantee Claim`, `Order_Retrocharge`,
`Fee Adjustment`, `Debt`, `Liquidations`, `Deal Fee`.

### Summary report (PDF) — "payments summary"

A PDF with sections Income / Expenses / Tax / Transfers for the range. **[fact, [A1]]**
We should not parse it. It is a control total: Σ of the Transaction CSV for the same range
should match it. **[guess]**

## 2. Live API options (SP-API)

All need: a Seller Central account (Goodwill's), registration as an SP-API developer, and the
**Finance and Accounting** role. A private app can be **self-authorized in draft state**, no
publishing needed. **[fact, [A7]]** Auth is Login with Amazon (LWA) OAuth: client id/secret +
refresh token → access token sent as `x-amz-access-token`. **[fact, general SP-API docs]**
Role approval time is not stated; one developer reported no response after 30 days in Aug–Sep
2026. **[fact, [A8]]** Sandbox: SP-API has a static sandbox
(`sandbox.sellingpartnerapi-na.amazon.com`) returning canned examples. **[fact, model files
contain `x-amzn-api-sandbox` examples, [A9]]**

| Option | Endpoint | Same as portal file? | Limits |
|---|---|---|---|
| **Date Range Transaction report** `GET_DATE_RANGE_FINANCIAL_TRANSACTION_DATA` | Reports API `createReport` | Would be, but it is **deprecated in SP-API**: cannot be requested; listing it returns 403. **[fact, [A10][A11]]** | — |
| **Settlement report V2** `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2` | `GET /reports/2021-06-30/reports?reportTypes=…` → `GET /reports/2021-06-30/documents/{id}` → download pre-signed URL (may be GZIP) | **Different file** from the Transaction CSV: tab-delimited, kebab-case, one row per amount component. Same money, per settlement period. Cannot be requested, Amazon generates it; only ~90 days back via API. **[fact, [A2][A10]]** | getReports 0.0222 rps / burst 10; getReport 2 / 15; getReportDocument 0.0167 / 15 **[fact, [A9]]** |
| **Finances API v2024-06-19** `listTransactions` | `GET /finances/2024-06-19/transactions?postedAfter=…&postedBefore=…&marketplaceId=ATVPDKIKX0DER` | **JSON**, the programmatic "Transaction view". Same transactions as the CSV, different shape. **[fact, [A12]]** | 0.5 rps / burst 10; `postedAfter` ≥ 2 min in the past **[fact, [A12]]** |
| Finances API v0 `listFinancialEvents` | `GET /finances/v0/financialEvents?PostedAfter=…` | JSON, older event model. **[fact]** | 0.5 rps / burst 30 **[guess]** |

Settlement V2 columns **[fact, [A2]]**: `settlement-id, settlement-start-date,
settlement-end-date, deposit-date, total-amount, currency, transaction-type, order-id,
merchant-order-id, adjustment-id, shipment-id, marketplace-name, amount-type,
amount-description, amount, fulfillment-id, posted-date, posted-date-time, order-item-code,
merchant-order-item-id, merchant-adjustment-item-id, sku, quantity-purchased, promotion-id`.
The first data row is a summary row (settlement-id, dates, total-amount only). **[guess, common
knowledge]**

**Feasibility for Goodwill:** medium. One-time setup by whoever owns the Seller Central account
(register as private developer, request Finance role, self-authorize). After that, a nightly
`listTransactions` call is cheap. Not possible this weekend.

## 3. JSON shape: `listTransactions` (fields we need)

Field names **[fact, [A9] model `finances_2024-06-19.json`]**. Values and `breakdownType`
names **[guess]** (the model only says "the type of charge").

```json
{
  "payload": {
    "nextToken": "eyJ…",
    "transactions": [
      {
        "transactionId": "Tx-0001",
        "transactionType": "Shipment",
        "transactionStatus": "RELEASED",
        "description": "Order Payment",
        "postedDate": "2026-10-01T02:45:12Z",
        "marketplaceDetails": { "marketplaceId": "ATVPDKIKX0DER", "marketplaceName": "Amazon.com" },
        "relatedIdentifiers": [
          { "relatedIdentifierName": "ORDER_ID", "relatedIdentifierValue": "113-0000000-0000001" },
          { "relatedIdentifierName": "SETTLEMENT_ID", "relatedIdentifierValue": "21839471023" },
          { "relatedIdentifierName": "FINANCIAL_EVENT_GROUP_ID", "relatedIdentifierValue": "FEG-abc" }
        ],
        "totalAmount": { "currencyCode": "USD", "currencyAmount": 11.42 },
        "breakdowns": [
          { "breakdownType": "ProductCharges", "breakdownAmount": { "currencyCode": "USD", "currencyAmount": 9.99 } },
          { "breakdownType": "ShippingCharges", "breakdownAmount": { "currencyCode": "USD", "currencyAmount": 3.99 } },
          { "breakdownType": "Tax", "breakdownAmount": { "currencyCode": "USD", "currencyAmount": 0.0 } },
          { "breakdownType": "AmazonFees", "breakdownAmount": { "currencyCode": "USD", "currencyAmount": -2.56 },
            "breakdowns": [ { "breakdownType": "Commission", "breakdownAmount": { "currencyCode": "USD", "currencyAmount": -1.50 } },
                            { "breakdownType": "VariableClosingFee", "breakdownAmount": { "currencyCode": "USD", "currencyAmount": -1.06 } } ] }
        ],
        "items": [
          { "description": "Paperback: Mystery Novel",
            "totalAmount": { "currencyCode": "USD", "currencyAmount": 11.42 },
            "relatedIdentifiers": [ { "itemRelatedIdentifierName": "ORDER_ADJUSTMENT_ITEM_ID", "itemRelatedIdentifierValue": "123" } ],
            "contexts": [ { "contextType": "ProductContext", "asin": "B000000000", "sku": "SKU-4001", "quantityShipped": 1, "fulfillmentNetwork": "MFN" } ] }
        ]
      }
    ]
  }
}
```

- Order id → `relatedIdentifiers[ORDER_ID]`; line → `items[].contexts[ProductContext].sku`.
- Buyer → **not available** (same as the CSV).
- Amounts are decimals with `currencyCode`; sign = effect on the seller (fees negative). **[fact
  for decimal + currency; sign: guess]**
- Refund → `transactionType`/`description` "Refund…" with negative product charges. **[guess]**
- Tax: with marketplace-facilitator tax the Tax breakdown nets to 0 (collected then withheld).
  **[guess]**
- Only `Shipment` is listed as a possible `transactionType` in the model. **[fact, [A9]]**

## 4. Parser gap (src/sources/amazon.ts vs the real formats)

1. **Report choice.** Slide 38 says "Payments summary"; if Amanda sends the **Summary PDF**,
   nothing parses (reader accepts .csv/.tsv/.txt/.xlsx only). Ask for the **Transaction CSV**
   for the same range. (Highest risk.)
2. **New 2026 columns** `Transaction Status` / `Transaction Release Date` are ignored. Harmless
   for parsing (aliases match by name), but `Deferred` rows are money not yet paid out: the
   close may need them separated. Our sample lacks these two columns; fixtures should add them.
3. **Date basis changed** to posting date (2026). Parser treats `date/time` as the business
   date: OK, but a September file downloaded before vs after the change differs. Note in UI.
4. **`marketplace` vs `store`**: not aliased, but the parser does not use it. OK.
5. **Unknown `type` values** (`Shipping Services`, `Chargeback Refund`, `A-to-z Guarantee
   Claim`, `Order_Retrocharge`, `Fee Adjustment`, `Debt`, `Deal Fee`, `Liquidations`) become
   "Unknown transaction type… skipped" warnings, so their money is **dropped**. `Shipping
   Services` (Amazon-bought labels) is a real shipping cost for an MFN seller. Add to
   `MONEY_TYPES` (shipping → `shipping_label` or similar, claims/chargebacks → `refund`).
6. **`Regulatory Fee`** column exists (col 20) but is not read; small but should go to fees.
7. **Tax fallback.** `taxCents: tax !== 0 ? tax : -withheldTax`. Fine.
8. **Settlement V2 flat file is not accepted** (kebab-case headers, tab-delimited .txt, one row
   per amount-type). If Goodwill ends up on the API, that file needs its own parser or an
   adapter. `.txt` auto-detects the tab, so reading works; header matching does not.
9. **Date format**: `parseDateTime` handles `Sep 30, 2026 8:45:12 PM PDT` and also
   settlement-style `2026-09-30 08:45:12 UTC` (zone `UTC` is in `ZONE_OFFSETS`). OK. If the
   real CSV uses a zone outside US+UTC, or no zone, rows are read as Indianapolis local.
10. **Zone abbreviations** only cover US + UTC; fine for amazon.com.
11. **Customers**: the parser sets `buyerId: null` (correct, no buyer column exists). Customers
    must come from distinct order ids, per the "every transaction is a different customer"
    decision.

## 5. Daily acquisition — recommendation

| Option | Manual work | Same file? | Verdict |
|---|---|---|---|
| Reports Repository, request yesterday's Transaction CSV each morning | ~3 clicks + wait up to 3 h | yes | **Today / demo**: works with zero setup. |
| SP-API `listTransactions` nightly (Vercel Cron) | none after setup | JSON, same data | **Recommended target.** Needs private developer registration + Finance role (weeks). |
| Settlement V2 via `getReports` | none after setup | different file, per settlement (~14 d) | Good for month-end reconciliation to the bank deposit, not daily. |

Recommendation: keep the Transaction CSV upload as the path for the demo and month-end; propose
`listTransactions` (mapping JSON to the same `ParsedOrder` shape) as phase 2. Remember Upright
is the source of truth for orders: if Upright lists Amazon orders, the Amazon file mostly adds
fees, refunds and transfers. Customers = distinct `order id` (no buyer id exists anyway).

## 6. Gotchas

- Amazon times are often shown in **Pacific** (`PDT`/`PST` suffix); convert to Indianapolis
  before taking the business date. **[guess for suffix]**
- Marketplace-facilitator tax: collected and withheld in the same row; never revenue.
- `Transfer` rows are payouts to the bank (negative in the CSV). Not revenue.
- One order can produce several `Order` rows (one per item/shipment) and refunds can land in a
  later month than the sale.
- The report is in a different month boundary than settlements; month-end should use
  posting date (the report) and reconcile cash with the settlement/transfer rows.

## Links

- [A1] Amazon Seller Forums, "Understanding Payment Date Range Reports: Your Complete Guide":
  https://sellercentral.amazon.com/seller-forums/discussions/t/aa3b10ff-52b8-47ff-bbf8-8a07ff753647
- [A2] SP-API Settlement report types: https://developer-docs.amazon/sp-api/docs/report-type-values-settlement
- [A3] Feedvisor (column list cited in docs/research.md): https://feedvisor.com/university/payment-transaction-report/
  and Staxxer: https://staxxer.com/how-to-get-transaction-reports-from-amazon-seller-central/
- [A4] Document titled from a real export, "2022Jan1-2022May3CustomTransaction" (first line text):
  https://www.collegesidekick.com/study-docs/17117573
- [A5] Search summary listing `date/time, settlement-id, type, order-id, sku, description, quantity, store, fulfillment, …`
  (see Finaloop guide): https://www.finaloop.com/blog/your-amazon-transactions-report-guide
- [A6] Amazon Seller Forums, "2026 Summary and Transaction Report Changes: How to Reconcile?":
  https://sellercentral.amazon.com/seller-forums/discussions/t/cdf01f3a-a727-4f77-a008-f79af704777a
- [A7] Register as a private SP-API developer: https://developer-docs.amazon/sp-api/docs/register-as-a-private-developer
  and roles: https://developer-docs.amazon.com/sp-api/docs/finance-and-accounting-role
- [A8] GitHub issue, role request with no answer after 30 days:
  https://github.com/amzn/selling-partner-api-models/issues/5381
- [A9] SP-API models (rate limits, schemas, sandbox examples):
  https://github.com/amzn/selling-partner-api-models/blob/main/models/reports-api-model/reports_2021-06-30.json,
  https://github.com/amzn/selling-partner-api-models/blob/main/models/finances-api-model/finances_2024-06-19.json
- [A10] GitHub issue "Need a replacement for Get_Date_Range_Financial_Transaction_Data":
  https://github.com/amzn/selling-partner-api-docs/issues/967
- [A11] GitHub issue, report type not supported: https://github.com/jlevers/selling-partner-api/issues/804
- [A12] Finances API v2024-06-19 reference: https://developer-docs.amazon/sp-api/docs/finances-api-v2024-06-19-reference
