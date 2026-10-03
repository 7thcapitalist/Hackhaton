# eBay (Seller Hub)

Researched 2026-10-03. Each claim is tagged **[fact]** (official or reputable source, linked)
or **[guess]**. Links are at the bottom.

## Template answers

- **What it is:** eBay US marketplace; Goodwill Michiana lists there (very likely through
  Upright Lister, which publishes to eBay). **[guess for Upright]**
- **How Goodwill gets the data today (slide 38):** "Listing sales report · Seller Center ·
  change date · generate/download". **[fact, slide 38]** Seller Hub has exactly that: in
  **Performance → Sales**, pick a time period with the drop-downs at the top, then click
  **"Download listings sales report"** (there is also a variant "with Store Category").
  **[fact, [E1][E2]]** So Goodwill most likely downloads the **Listings sales report**, not the
  Orders report our parser expects. **[guess, strong]**
- **Frequency available:** the Sales page offers "Last 31 days, today, this month, last month,
  this quarter, or custom". **[fact, [E1]]** Seller Hub **Reports** (Orders/Listings) can be
  **scheduled hourly, daily, weekly or monthly**, one-time downloads cover 1–90 days.
  **[fact, [E3]]**
- **Live API:** yes. Sell **Fulfillment API** (`getOrders`) and Sell **Finances API**
  (`getTransactions`), OAuth user tokens. Not usable this weekend (needs Goodwill's eBay login to
  grant consent, plus a developer keyset). **[fact, details §2]**
- **File format:** CSV (comma). Orders report layout: **first line is bare commas, header is the
  second line, then a padding row; file ends with `N,record(s) downloaded,…` and
  `Seller ID : …`.** **[fact, [E4] (a parser written against real files)]** Listings sales
  report layout: **unknown**. **[ask]**
- **Columns:** §1.
- **Money fields:** `Sold For` (unit price), `Shipping And Handling`, `eBay Collected Tax`,
  `Total Price` (includes tax and buyer fees when `eBay Collected Tax Included in Total` = Yes).
  **[fact, [E5]]** **No fees, no refunds** in the Orders report; those are in the Payments
  **Transaction report** or the Finances API. **[fact for the column list; consequence: guess]**
- **Buyer id field:** `Buyer Username` (col 3). We hash it. Columns 4–22 are buyer/ship-to
  PII (name, email, address, phone): drop on read. **[fact, [E5]]**
- **Gotchas:** §6.
- **Confidence:** Orders report column list **high** (official 80-column list). Which report
  Goodwill uses: **medium** (strong match with "listing sales report", but unconfirmed). Date
  format: **low**.

## 1. Real exports

### 1a. Orders report (Seller Hub → Orders → Download, or Reports → Downloads → Orders → "All orders")

Official column list, US site, in order **[fact, [E5]]**:

```
1 Sales Record Number, 2 Order Number, 3 Buyer Username, 4 Buyer Name, 5 Buyer Email,
6 Buyer Note, 7 Buyer Address 1, 8 Buyer Address 2, 9 Buyer City, 10 Buyer State,
11 Buyer Zip, 12 Buyer Country, 13 Buyer Tax Identifier Name, 14 Buyer Tax Identifier Value,
15 Ship To Name, 16 Ship To Phone, 17 Ship To Address 1, 18 Ship To Address 2, 19 Ship To City,
20 Ship To State, 21 Ship To Zip, 22 Ship To Country, 23 Item Number, 24 Item Title,
25 Custom Label, 26 Sold Via Promoted Listings, 27 Quantity, 28 Sold For,
29 Shipping And Handling, 30 Item Location, 31 Item Zip Code, 32 Item Country,
33 eBay Collect And Remit Tax Rate, 34 eBay Collect And Remit Tax Type, 35 eBay Reference Name,
36 eBay Reference Value, 37 Tax Status, 38 Seller Collected Tax, 39 eBay Collected Tax,
40 Electronic Waste Recycling Fee, 41 Mattress Recycling Fee, 42 Battery Recycling Fee,
43 White Goods Disposal Tax, 44 Tire Recycling Fee, 45 Additional Fee, 46 eBay Collected Charges,
47 Total Price, 48 eBay Collected Tax Included in Total, 49 Payment Method, 50 Commitment Date,
51 Sale Date, 52 Paid On Date, 53 Ship By Date, 54 Minimum Estimated Delivery Date,
55 Maximum Estimated Delivery Date, 56 Shipped On Date, 57 Feedback Left, 58 Feedback Received,
59 My Item Note, 60 PayPal Transaction ID, 61 Shipping Service, 62 Tracking Number,
63 Transaction ID, 64 Variation Details, 65 Global Shipping Program,
66 Global Shipping Reference ID, 67 Click And Collect, 68 Click And Collect Reference Number,
69 eBay Plus, 70 Authenticity Verification Program, 71 Authenticity Verification Status,
72 Authenticity Verification Outcome Reason, 73 eBay Vault Program, 74 Vault Fulfillment Type,
75 eBay Fulfillment Program, 76 Tax City, 77 Tax State, 78 Tax Zip, 79 Tax Country,
80 eBay International Shipping
```

eBay's own note: column titles were renamed, added and removed over time, so match by name.
**[fact, [E5]]** The AU/UK files say "Postage And Handling", "Post To …", "Postcode". **[fact,
[E6]]** Not relevant for Goodwill (US).

Layout **[fact, [E4]]**: line 1 = bare commas, line 2 = header, line 3 = padding row, then data,
then footer `45,record(s) downloaded,…` and `Seller ID : …`. Multi-item orders: a summary row
(order number, totals, **no item title**) plus one row per item. **[fact, [E4]]**

Formats **[guess]**: money as `$18.00`; dates like `Sep-30-26` (older File Exchange style) or
`Sep 30, 2026`; the file may follow locale. No time zone in the cell. **[guess, [E7] says only
"date fields may follow locale"]**

### 1b. Listings sales report (Performance → Sales → "Download listings sales report")

Per-listing sales performance for the chosen period. **[fact, [E1][E2]]** Before download the
right side of the window shows a summary of the report columns. **[fact, [E2]]** Column names
are **not public**. It is aggregated **per listing**, so it likely has **no order number and no
buyer**: e.g. Item number, Title, Store category, Quantity sold, Total sales. **[guess]**
**Ask Amanda for one real file.**

### 1c. Payments → Reports → Transaction report (money: fees, refunds, payouts)

Columns reported by a seller (33) **[fact, [E8], community-verified]**: `Transaction creation
date, Type, Order number, Buyer username, Buyer name, Ship to city, Ship to province/region/state,
Ship to zip, Ship to country, Net amount, Payout currency, Payout date, Payout ID, Payout method,
Payout status, Reason for hold, Item ID, Transaction ID, Item title, Custom label, Quantity, Item
subtotal, Shipping and handling, Final Value Fee - fixed, Final Value Fee - variable, Very high
"item not as described" fee, Below standard performance fee, International fee, Gross transaction
amount, Transaction currency, Exchange rate, Reference ID, Description`. Columns are
customizable, so headers vary. **[fact, docs/research.md §2]** Up to 90 days per export.
**[fact, [E9]]** Preamble lines above the header exist in recent versions. **[guess]**

## 2. Live API options

Both need an eBay developer account (free), a production keyset, and a **user OAuth token**
from Goodwill's eBay account (authorization-code grant, refresh token valid ~18 months).
**[fact for OAuth scopes below; token lifetime: guess from eBay docs]** Sandbox exists
(`api.sandbox.ebay.com`). **[fact]**

| API | Call | Scope | Same as portal file? | Limits |
|---|---|---|---|---|
| Sell **Fulfillment** v1 | `GET https://api.ebay.com/sell/fulfillment/v1/order?filter=creationdate:[2026-10-01T04:00:00.000Z..2026-10-02T04:00:00.000Z]&limit=200&offset=0` | `sell.fulfillment.readonly` | JSON; same data as the **Orders report** (order number = `orderId`). Not the same file. | limit ≤ 200/page; orders up to 2 years old; default window 90 days; 100,000 calls/day **[fact, [E10][E11]]** |
| Sell **Finances** v1 | `GET https://apiz.ebay.com/sell/finances/v1/transaction?filter=transactionDate:[…]&limit=1000` | `sell.finances` | JSON; same data as the **Transaction report**. | limit ≤ 1000; ≤ 5 years back; range ≤ 36 months; 15,000 calls/day; EU/UK need digital signatures (US does not) **[fact, [E12][E11]]** |
| Sell **Feed** v1 | `createOrderTask` (`LMS_ORDER_REPORT`) | `sell.fulfillment` | Async XML/CSV order file. | **[guess, not researched further]** |

Note: Finances API does **not** support Team Access; the token must belong to the main account.
**[fact, [E12]]**

**Feasibility for Goodwill:** high, technically. Setup ~1 hour once someone with the eBay login
clicks "Agree" on the consent page. No eBay approval needed for these scopes at default limits.
**[guess]** Not this weekend (we do not have Goodwill's login, and we must not ask for it).

## 3. JSON shapes (fields we need)

Field names **[fact, eBay OpenAPI contracts [E10][E12]]**; values **[guess]**.

`getOrders` → `orders[]`:

```json
{
  "orderId": "05-14001-10001",
  "creationDate": "2026-10-01T03:12:44.000Z",
  "lastModifiedDate": "2026-10-01T03:20:10.000Z",
  "orderPaymentStatus": "PAID",
  "salesRecordReference": "5001",
  "buyer": { "username": "test_buyer_amber" },
  "pricingSummary": {
    "priceSubtotal": { "value": "18.00", "currency": "USD" },
    "deliveryCost":  { "value": "9.50",  "currency": "USD" },
    "tax":           { "value": "0.00",  "currency": "USD" },
    "total":         { "value": "27.50", "currency": "USD" }
  },
  "totalFeeBasisAmount": { "value": "29.43", "currency": "USD" },
  "totalMarketplaceFee": { "value": "4.12",  "currency": "USD" },
  "cancelStatus": { "cancelState": "NONE_REQUESTED" },
  "paymentSummary": {
    "totalDueSeller": { "value": "27.50", "currency": "USD" },
    "refunds": [ { "refundId": "R-1", "refundStatus": "REFUNDED", "refundDate": "2026-10-05T15:00:00.000Z",
                   "amount": { "value": "18.00", "currency": "USD" } } ]
  },
  "lineItems": [
    {
      "lineItemId": "10071234567890",
      "legacyItemId": "316000000001",
      "sku": "SKU-4001",
      "title": "Pyrex Mixing Bowl",
      "quantity": 1,
      "lineItemCost": { "value": "18.00", "currency": "USD" },
      "deliveryCost": { "shippingCost": { "value": "9.50", "currency": "USD" } },
      "ebayCollectAndRemitTaxes": [ { "taxType": "STATE_SALES_TAX", "collectionMethod": "NET",
                                      "amount": { "value": "1.93", "currency": "USD" } } ],
      "total": { "value": "27.50", "currency": "USD" },
      "refunds": []
    }
  ]
}
```

- Amounts are **strings** in `value` with `currency`. **[fact, `Amount` schema]**
- eBay-collected tax is in `lineItems[].ebayCollectAndRemitTaxes`, not in `pricingSummary.total`
  for the seller. **[guess]**
- `legacyItemId` = the CSV `Item Number`; `orderId` = the CSV `Order Number`. **[guess, strong]**

`getTransactions` → `transactions[]`:

```json
{
  "transactionId": "1*****1",
  "orderId": "05-14001-10001",
  "salesRecordReference": "5001",
  "buyer": { "username": "test_buyer_amber" },
  "transactionType": "SALE",
  "transactionStatus": "PAYOUT",
  "transactionDate": "2026-10-01T03:12:50.000Z",
  "bookingEntry": "CREDIT",
  "amount": { "value": "23.38", "currency": "USD" },
  "totalFeeBasisAmount": { "value": "29.43", "currency": "USD" },
  "totalFeeAmount": { "value": "4.12", "currency": "USD" },
  "eBayCollectedTaxAmount": { "value": "1.93", "currency": "USD" },
  "payoutId": "6000000001",
  "orderLineItems": [
    { "lineItemId": "10071234567890",
      "feeBasisAmount": { "value": "29.43", "currency": "USD" },
      "marketplaceFees": [ { "feeType": "FINAL_VALUE_FEE", "amount": { "value": "3.82", "currency": "USD" } },
                           { "feeType": "FINAL_VALUE_FEE_FIXED_PER_ORDER", "amount": { "value": "0.30", "currency": "USD" } } ] }
  ]
}
```

- Sign: amounts are **positive**; direction is in `bookingEntry` (`CREDIT` / `DEBIT`). SALE and
  CREDIT are credits; REFUND, DISPUTE, SHIPPING_LABEL, TRANSFER are debits. **[fact, [E12]]**
- `transactionType` values include SALE, REFUND, CREDIT, DISPUTE, NON_SALE_CHARGE,
  SHIPPING_LABEL, TRANSFER, ADJUSTMENT, WITHDRAWAL. **[fact for the first ones; full list:
  guess]**

## 4. Parser gap (src/sources/ebay.ts)

**Status (2026-10-03, parser v1.1.0):** 1 **open** (listings sales report vs Orders report:
ask Amanda) · 2 **fixed** (no status/refund columns in the real file → none invented; fixtures
no longer carry them) · 3 **open by design** (fees come from Upright or the Transaction
report / Finances API) · 4 ok · 5 **fixed** (footer detected on the joined row) · 6 ok ·
7 **fixed** (Seller Collected Tax → tax; buyer-paid fees only in the Total Price check) ·
8–11 ok. Fixtures and sample use the real 80-column framing.

1. **Wrong report (likely).** The parser targets the **Orders report**; slide 38's "listing
   sales report" is most likely the **Listings sales report** (per listing, no order number,
   no buyer). `REQUIRED = salesRecord, orderId, itemNumber, soldFor` would fail →
   `parse_failed`. Ask Amanda; if it is the listings report, either (a) ask Goodwill to switch
   to the scheduled Orders report, or (b) write a second parser that emits listing-level money
   lines (no orders, no customers).
2. **`Order Status` and `Refund Amount` do not exist** in the real Orders report (not in the
   80 columns). Our sample has them. Refunds/cancellations therefore never appear. Refunds need
   the Transaction report or Finances API.
3. **`Final Value Fee` does not exist** in the Orders report. `feeCents` is always 0 from real
   files. Fees need the Transaction report (`Final Value Fee - fixed`, `Final Value Fee -
   variable`, …) or `getTransactions`.
4. **Header is on line 2 after a line of bare commas**, then a padding row. The alias search
   scans 30 rows, so OK; the padding row is blank → skipped. OK.
5. **Footer** `N,record(s) downloaded,…` puts the count in column 1 and the text in column 2.
   `FOOTER` tests only `row[0]` (`"45"`), so the regex misses it. Column 2 is `Order Number`,
   so the row reads as order "record(s) downloaded" with no Item Number → treated as a
   multi-item summary row and silently skipped. Harmless by luck; test the joined row instead
   of `row[0]`. (`Seller ID : …` is caught.)
6. **Summary rows** of multi-item orders have no **Item Title**; the parser detects them by
   empty **Item Number**. Probably equivalent; confirm with a real file.
7. **New money columns ignored:** `Seller Collected Tax` (38), recycling fees (40–44),
   `Additional Fee` (45), `eBay Collected Charges` (46). The Total Price sanity check will warn
   when buyer-paid fees are present. Minor.
8. **Header text:** real name is `eBay Collected Tax Included in Total`; aliases include it. OK.
9. **Date format** unknown; parser handles `Sep-30-26`, `Sep 30, 2026`, `9/30/2026`. No time,
   no zone → Indianapolis midnight. An order at 11:30 PM Eastern lands on the right day only
   if eBay prints the seller's local date. **[guess]**
10. **PII:** Buyer Name/Email/addresses/phone (cols 4–22) are read into the table but never
    emitted. OK; make sure raw rows are not stored.
11. **Upright overlap:** eBay orders also appear in Upright with the same `Channel Order ID` =
    `Order Number`; Upright wins (revenue authority). Parser keeps `externalOrderId` = Order
    Number, so the dedupe key matches. OK.

## 5. Daily acquisition — recommendation

| Option | Manual work | Verdict |
|---|---|---|
| Seller Hub **Reports → Schedule** the Orders report **daily** (and the Transaction report) | none after setup; file must still be downloaded from Seller Hub or email | Good no-code step. Download is still manual. **[fact: scheduling exists [E3]]** |
| Fulfillment `getOrders` + Finances `getTransactions` nightly via Vercel Cron | none after consent | **Recommended.** Free, no approval, gives orders, fees, refunds and payouts. |
| Listings sales report by hand | download each time | Today's process. Fine for month-end totals, not for daily orders/customers. |

Recommendation: since Upright is the source of truth for orders, the eBay file's job is
**fees, refunds and payouts**. The best single source for that is `getTransactions` (or the
Payments Transaction report as a CSV fallback), not the Orders or Listings sales report.

## 6. Gotchas

- Orders vs. money: the Orders report has gross, shipping and tax only; fees and refunds live in
  Payments. Don't double count shipping labels bought on eBay (they are `SHIPPING_LABEL`
  debits in Finances).
- `Total Price` includes eBay-collected tax and buyer fees when column 48 = Yes. Tax is never
  revenue.
- Multi-item orders: summary row + item rows. Don't count the summary row as a line.
- One-time downloads cover at most 90 days.
- API timestamps are UTC (`…Z`); convert to Indianapolis for the business date.

## Links

- [E1] eBay Help, Seller Hub (Sales section, "Download listings sales report", Sales and selling
  costs report): https://www.ebay.com/help/selling/selling-tools/seller-hub?id=4095
- [E2] Search summary of eBay help on listings sales report (incl. "with Store Category"):
  https://export.ebay.com/en/services-tools/seller-hub/monitoring-your-business-in-seller-hub/
- [E3] eBay export guide, "How to use Seller Hub Reports" (scheduling hourly/daily/weekly/monthly; 1–90 days):
  https://export.ebay.com/en/services-tools/seller-hub/seller-hub-reports/
- [E4] Parser written against real eBay "All Orders Report" files (bare-comma first line, padding
  row, footer): https://github.com/ajhollowayvrm/binderbooks/pull/13
- [E5] eBay Help US, orders report column list (80 columns, tax-included note):
  https://www.ebay.com/help/selling/selling-tools/seller-hub?id=4095
- [E6] eBay Help AU (variant names): https://www.ebay.com.au/help/selling/selling-tools/seller-hub?id=4095
- [E7] convertcsvonline eBay CSV guide (dates follow locale): https://convertcsvonline.com/guides/ebay-csv
- [E8] eBay Community, "Transaction Report CSV details":
  https://community.ebay.com/t5/Report-eBay-Technical-Issues/quot-Transaction-Report-quot-CSV-details/td-p/33455429
- [E9] Link My Books, eBay transaction reports: https://linkmybooks.com/blog/ebay-transactions-reports
- [E10] eBay Fulfillment API OpenAPI contract:
  https://developer.ebay.com/api-docs/master/sell/fulfillment/openapi/3/sell_fulfillment_v1_oas3.json
  (method page: https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders)
- [E11] eBay API call limits: https://developer.ebay.com/develop/get-started/api-call-limits
- [E12] eBay Finances API OpenAPI contract:
  https://developer.ebay.com/api-docs/master/sell/finances/openapi/3/sell_finances_v1_oas3.json
  (method page: https://developer.ebay.com/api-docs/sell/finances/resources/transaction/methods/getTransactions)
