# OSM / Pitney Bowes / EasyPost (shipping amounts)

Source id: `shipping_osm_pb_easypost` · Parser: `src/sources/shipping_osm_pb_easypost.ts` (v0.2.0)
Researched 2026-10-03. Every claim is tagged **[fact]** (read in an official doc or a real
sample file, linked) or **[guess]** (our inference, needs confirmation from Goodwill).

- **What it is:** postage for e-commerce parcels bought through three tools: **EasyPost**
  (shipping API / dashboard), **Pitney Bowes** (SendPro / PitneyShip, "PB") and **OSM Worldwide**
  (a parcel consolidator that hands off to USPS for the last mile). Slide 38 row: "OSM / PB /
  EasyPost · Shipping amounts · 1st Source acct 0101 · GL 10009" [fact: slide text].
- **How Goodwill gets the data today:** not stated. The slide names a bank account (1st Source
  0101) and a GL (10009), not a report, so the month-end figure is most likely **looked up as
  debits on the 1st Source bank statement** rather than read from the carrier tools [guess].
- **Frequency available:** EasyPost and PB are daily (any date range) [fact]. OSM bills on scan
  and invoices on its own cycle (likely weekly) [guess].
- **Live API:** EasyPost yes (Reports API + Shipments API, test mode). PB Shipping API exists but
  is for PB's API customers, not SendPro/PitneyShip users [guess]. OSM has no public API docs
  [fact: no public portal found]. Details below.
- **Confidence:** EasyPost layouts **fact**; PB API **fact**, PB portal export columns **guess**;
  OSM layout **guess**; accounting meaning **guess**.

---

## 1. EasyPost

### 1a. Shipment CSV report [fact]
Source: [EasyPost: Shipment CSV Report](https://support.easypost.com/hc/en-us/articles/8108495510157-Shipment-CSV-Report),
[EasyPost Reports API](https://docs.easypost.com/docs/reports).

- File: CSV, header on row 1, no preamble, no footer. Generated in the dashboard or with
  `POST /v2/reports/shipment`. Max range per report: under 31 days [fact].
- Default columns, in order:

| # | Column | Meaning / example |
|---|---|---|
| 1 | `created_at` | shipment created, UTC ISO 8601, e.g. `2026-09-01T14:02:11Z` |
| 2 | `id` | `shp_…` |
| 3 | `tracking_code` | carrier tracking number |
| 4 | `status` | tracker status: `pre_transit`, `in_transit`, `delivered`, … |
| 5-14 | `from_address_id`, `from_name`, `from_company`, `from_street1`, `from_street2`, `from_city`, `from_state`, `from_zip`, `from_country`, `from_residential` | origin |
| 15-24 | `to_address_id`, `to_name`, `to_company`, `to_street1`, `to_street2`, `to_city`, `to_state`, `to_zip`, `to_country`, `to_residential` | **buyer PII**, do not store |
| 25 | `parcel_id` | `prcl_…` |
| 26-29 | `length`, `width`, `height`, `weight` | inches / ounces |
| 30 | `predefined_package` | e.g. `FlatRateEnvelope` |
| 31 | `postage_label_created_at` | when the label was bought (UTC) |
| 32 | `rate_id` | `rate_…` |
| 33 | `service` | e.g. `GroundAdvantage` |
| 34 | `carrier` | e.g. `USPS`, `OSMWorldwide`, `FedEx` |
| 35 | `rate` | "your cost of the specified rate", plain decimal e.g. `5.12` |
| 36 | `insured_value` | |
| 37 | `is_return` | `true`/`false` |
| 38 | `refund_status` | empty, `submitted`, `refunded`, `rejected` |
| 39 | `reference` | your reference (e.g. marketplace order id) |
| 40 | `label_fee` | EasyPost's per-label transaction fee |
| 41 | `postage_fee` | amount EasyPost charged for the postage itself |
| 42 | `insurance_fee` | |
| 43 | `options` | JSON-ish array, quoted, contains commas |

- Optional extra columns: `to_phone`, `to_email` (PII), `usps_zone`, `user_id` [fact]; a
  "Batch ID" column was added in 2023 ([EasyPost blog](https://www.easypost.com/blog/2023-07-31-better-shipment-and-payment-log-reporting-with-new-batch-id-and-tracking-number-columns/)) [fact].
- Money: all amounts positive costs. A refund does not add a row; the same row shows
  `refund_status = refunded` [fact for the column; guess that no separate row is added].
- **Carrier-billed labels** [fact for OSM, guess in general]: for carriers where you bring your own
  account (OSM, FedEx, UPS), EasyPost does not bill the postage; the carrier invoices you. For OSM
  EasyPost "initially displays a one-cent rate" until a custom rate card is loaded
  ([EasyPost OSM guide](https://docs.easypost.com/carriers/osm-guide)). So `rate` for those rows
  is not cash paid to EasyPost, and `postage_fee` should be 0.

### 1b. Payment Log CSV report [fact, real sample downloaded]
Source: [EasyPost: Payment Log CSV Report](https://support.easypost.com/hc/en-us/articles/4405420574861-Payment-Log-CSV-Report)
(the article links a real sample file, `easypost-payment_logs-20251105-20251203.csv`).

Real header and first rows of that sample, verbatim:
```csv
created_at,id,status,source_type,target_type,charge_type,amount,balance,description
2025-11-07T21:24:29Z,paylog_a48ef642c27d4c649df17d0c31223a36,complete,user,easypost_bank,service_fee,$0.00000,$0.00000,
2025-11-07T21:24:30Z,paylog_fd4f9f892d2744c695731382d21b89ce,complete,refund,user,refund,$0.00000,$0.00000,
```
- `amount` and `balance` carry a **`$` and 5 decimals, unsigned** [fact]. Direction comes from
  `source_type` → `target_type`: `user → easypost_bank` = money out of Goodwill's wallet;
  `refund → user`, `bank_account → user`, `credit_card → user` = money in to the wallet [fact for
  the values; direction reading is a guess from the sample].
- `status`: `pending`, `complete`, `failure`, `creditable` (credited even though the bank did not
  complete it) [fact].
- `source_type`: `easypost_bank, user, payment_refund, refund, insurance, manual_debit,
  bank_account, credit_card, subscription, ach_credit_source, post_pay_shipment` [fact].
- `charge_type`: `service_fee, recharge, manual_credit, manual_debit, payment_failure_deduction,
  payment_refund, partial_refund, refund, insurance, subscription` [fact].
- There is no "label" charge type, so **label purchases are logged as `service_fee`** (the
  sample shows a `service_fee` debit followed by a `refund` one second later, typical of a label
  bought and voided) [guess, strong].
- Optional columns via `additional_columns`: `shipment_id, tracker_id, insurance_id, other,
  amount_label_fee, amount_postage_fee, amount_tracker_fee, amount_insurance_fee,
  amount_delta_fee, amount_convenience_fee` [fact]; a "Tracking Number" column was added in 2023
  [fact, blog above]. `other = delta` marks carrier adjustments (APV) [fact].

### 1c. Other EasyPost report types [fact]
`cash_flow`, `insurance`, `payment_log`, `refund`, `shipment`, `shipment_invoice`, `tracker`
([Reports API](https://docs.easypost.com/docs/reports)). `shipment_invoice` lists carrier
adjustments to label cost after the fact (re-weighs, disputes); relevant for a true month cost.
`refund` lists refund requests.

### 1d. EasyPost REST API [fact]
- Base `https://api.easypost.com/v2`, HTTP Basic auth with the API key as user, empty password.
  Separate **test** and **production** keys; test objects carry `"mode": "test"`.
- Reports: `POST /v2/reports/{type}` with `start_date`, `end_date` (YYYY-MM-DD, under 31 days),
  optional `columns`, `additional_columns`, `include_children`, `send_email`. Then
  `GET /v2/reports/{id}` until `status = available`; `url` expires after **1 hour**.
- Shipments: `GET /v2/shipments?start_datetime=…&end_datetime=…&purchased=true&page_size=100`
  (max 100 per page), `include_children` for child accounts.
- Same data as the dashboard file: yes, the dashboard reports are the same Report objects [fact].

Shipment fields we need (small realistic example, fake values):
```json
{
  "id": "shp_7f3c0b2e9a4d4c1f8e2b6a1d0c9e8f7a",
  "object": "Shipment",
  "mode": "production",
  "created_at": "2026-09-30T03:41:12Z",
  "updated_at": "2026-10-01T15:02:44Z",
  "reference": "SGW-1234567",
  "tracking_code": "9400100000000000000123",
  "status": "in_transit",
  "is_return": false,
  "batch_id": null,
  "refund_status": null,
  "selected_rate": {
    "id": "rate_1a2b3c", "object": "Rate",
    "carrier": "USPS", "service": "GroundAdvantage",
    "rate": "5.12", "currency": "USD", "retail_rate": "7.85",
    "carrier_account_id": "ca_abc123", "billing_type": "easypost"
  },
  "fees": [
    { "object": "Fee", "type": "LabelFee",   "amount": "0.00000", "charged": true, "refunded": false },
    { "object": "Fee", "type": "PostageFee", "amount": "5.12000", "charged": true, "refunded": false }
  ],
  "postage_label": { "label_date": "2026-09-30T03:41:13Z", "label_url": "https://…/label.png" }
}
```
`fees[].type` values seen in docs: `LabelFee`, `PostageFee`, `InsuranceFee` (plus tracker fees)
[fact for the Fee object fields; exact list partly guess]. `billing_type` tells whether EasyPost
or the carrier bills the postage [fact: field exists; meaning guess]. Do **not** store
`to_address`, `buyer_address` or emails.

### 1e. Feasibility for Goodwill
High. One read-only production API key and a daily cron that requests yesterday's `shipment` and
`payment_log` reports (or lists purchased shipments). This weekend: **yes in test mode** if a
teammate signs up for a free EasyPost account and buys test labels; no Goodwill access needed for
the demo. Production needs Goodwill's key (read-only use, stored in Vercel env).

---

## 2. Pitney Bowes

Which PB product Goodwill uses is unknown [ask]. Three options:

### 2a. PitneyShip / PitneyShip Pro / Enterprise and SendPro Online history export
- Path: **Shipping & Mailing → Shipping & Postage History**, pick a tab, filter, **Export**;
  re-download from **Job Status → Export History** [fact,
  [PB support 000083225](https://www.pitneybowes.com/us/support/article/000083225/viewing-your-history-in-pitneyship-pro.html)].
- Separate history tabs: shipping labels, stamps, proof of delivery, **postage purchases
  (refills)** [fact]. SendPro Online exports three report types: **Shipments, Postage (refills),
  USPS Refunds** [fact, search summary of
  [PB support 000052928](https://www.pitneybowes.com/ca/en/support/article/000052928/exporting-a-history-report-in-sendpro-online-and-on-the-sendpro.html)].
- Format CSV; max **3,000 transactions per export**, history back **2 years**; the export
  includes Extra Service charge columns and Total Billable Weight
  ([PitneyShip release notes](https://www.pitneybowes.com/us/your-product-update-hub/pitneyship/past-updates.html)) [fact].
- Exact column names: **not published** [guess]. Expect something like `Date, Carrier, Service,
  Tracking Number, Cost Center, Reference, Weight, Postage, Extra Services, Total` [guess].

### 2b. SendPro 360 / Shipping 360 "Shipment Details" report (PitneyAnalytics)
- **Analytics → Reports → Shipment Details Report**, date range, "Columns" menu to choose fields
  [fact, [PB support 000094526](https://www.pitneybowes.com/us/support/article/000094526/running-a-shipment-details-report-in-sendpro-360.html)].
- Columns are configurable; the data dictionary lists `Shipment Create Date, Sender Name, Carrier
  Name, Service, Tracking Number, Total Charges, …` [partial fact, from docs/research.md; the PDF
  link now redirects].

### 2c. PB Shipping API: Transaction Reports [fact]
Source: [Get Transaction Reports](https://docs.shippingapi.pitneybowes.com/api/get-transactions-reports.html).
- `GET /shippingservices/v4/ledger/developers/{developerId}/transactions/reports`
  (sandbox host `shipping-api-sandbox.pitneybowes.com`, prod `shipping-api.pitneybowes.com`),
  OAuth bearer token. Last 6 months; older via `/transactions/archived`.
- Query: `fromDate`, `toDate` (ISO 8601), `transactionType`, `merchantId`, `carrier`,
  `parcelTrackingNumber`, `page`, `size`.
- `transactionType`: `POSTAGE PRINT`, `POSTAGE REFUND`, `POSTAGE FUND`, `FEE`,
  `APV-POSTAGE OVERPAID`, `APV-POSTAGE UNDERPAID`, `APV-DISPUTE ADJUSTMENT`,
  `CREDIT ADJUSTMENT`, `DEBIT ADJUSTMENT`.
- Fields we need, abbreviated from the official sample (amounts are JSON numbers, positive):
```json
{
  "transactionId": "12345678_a7-4bc2-a17a-02a37ad84a5d",
  "transactionDateTime": "2020-08-01T16:08:04.025+0000",
  "transactionType": "POSTAGE PRINT",
  "developerRateAmount": 3.5,
  "shipperPostagePaymentAccountBalance": 1803.41,
  "parcelTrackingNumber": "0400109205168000244595",
  "mailClass": "First-Class Mail",
  "shipmentId": "USPS2200487400865080",
  "postageDepositAmount": null,
  "refundStatus": null,
  "adjustmentReason": null
}
```
  `refundStatus`: `REQUESTED`, `ACCEPTED`, `DENIED`. `postageDepositAmount` is set on `POSTAGE
  FUND` (refill) rows.
- Feasibility: only if Goodwill ships through a PB Shipping API integration (unlikely for a
  SendPro/PitneyShip user) [guess]. PB also has a newer
  [Shipping 360 API](https://docs.shipping360.pitneybowes.com/docs/releases); not checked in depth.

---

## 3. OSM Worldwide
- Parcel consolidator; **bill-on-scan**: charges apply when the parcel is scanned into OSM's
  network, and invoices, adjustments and billing questions are handled by OSM, not the label
  tool [fact per search summaries of OSM integration pages; treat as partial fact].
- No public developer portal or invoice spec; contracted shippers get account docs and **SFTP**
  credentials from OSM (EasyPost asks for "SFTP account details" to set up OSM) [fact,
  [EasyPost OSM guide](https://docs.easypost.com/carriers/osm-guide)]. A manifest is required for
  every label.
- Invoice layout: **unknown** [guess]. Most likely a PDF invoice plus a CSV/XLSX detail with
  `Invoice Number, Invoice Date, Ship Date, Tracking/Package ID, Service, Weight, Zone, Postage,
  Fuel/Surcharges, Total Charge`, credits negative [guess].
- If Goodwill buys OSM labels through EasyPost, the EasyPost shipment report also lists them (with
  `carrier = OSMWorldwide`, rate one cent or the loaded rate card) but EasyPost does not collect
  that money. **Count OSM cost from the OSM invoice or the bank debit, never from EasyPost.**

---

## Columns / money / buyer id (summary)
- Money fields: EasyPost `postage_fee + label_fee + insurance_fee` = cash cost per label;
  `refund_status=refunded` = refund; payment log `recharge` = cash leaving 1st Source;
  PB `Total`/`developerRateAmount`; OSM invoice total.
- Signs: all three tools show costs as **positive** numbers [fact for EasyPost and PB API];
  our parser converts to "+ = money in".
- Buyer id: none needed. EasyPost `to_*` columns and PB `destinationAddress` are buyer PII:
  drop them at parse time.

## Gotchas
- **Double counting**: (1) EasyPost refunds appear in both the shipment report and the payment
  log (parser RULE handles it); (2) EasyPost **label purchases also appear in the payment log as
  `service_fee`** (not handled, see gaps); (3) OSM or FedEx labels bought through EasyPost appear
  in EasyPost reports but are invoiced by OSM/FedEx; (4) the bank debit from 1st Source 0101 is a
  wallet top-up, not a label: summing top-ups AND labels double counts.
- Time zone: EasyPost and PB timestamps are UTC; a label at 9 PM Eastern on Sep 30 is
  `2026-10-01T01:00Z`. Convert to America/Indiana/Indianapolis before choosing the month.
- `created_at` (shipment created, maybe while rate shopping) vs `postage_label_created_at`
  (label bought). The label date is the cost date.
- PB exports cap at 3,000 rows: a month may need several exports.

## Parser gap (real format vs `src/sources/shipping_osm_pb_easypost.ts`)

**Status (2026-10-03, parser v0.3.0):** 1 **fixed** (payment-log `service_fee` tied to a
shipment = label purchase, not emitted; unlinked `service_fee` = real fee → adjustment; the
shipment report stays the authority for labels and refunds) · 2 **fixed** (`payment_refund` →
+ postage_topup, bank 0101) · 3 **fixed** (`creditable` counts) · 4 **fixed** (unsigned
`$x.xxxxx`, direction from source/target; `other = delta` → adjustment) · 5 **fixed**
(carrier-billed OSM/FedEx/UPS labels never use `rate`; flagged, only EasyPost's own fees
count) · 6 **fixed** (`postage_label_created_at`) · 7 **fixed** (43-column fixture; address
columns never read) · 8 n/a · 9 **fixed** (separate Shipments / Postage refills / USPS
Refunds files, kind from type column, file name or header; column names still a **guess**) ·
10 **fixed** (POSTAGE FUND = top-up; APV / credit / debit adjustments signed) · 11 **open**
(OSM layout guess) · 12 **open** (no bank-statement parser).
1. **Payment log `service_fee` is booked as an `adjustment` (negative)**. Label purchases are
   logged as `service_fee`, so uploading the shipment report and the payment log together counts
   every label twice. Treat `service_fee` like refunds (informational) or only keep `recharge`
   and true adjustments from the payment log.
2. Payment log `charge_type = payment_refund` (money returned to the card/bank) is not handled →
   "unknown charge_type" warning.
3. Payment log `status = creditable` is skipped as non-complete; it should probably count.
4. Payment log direction is read from `charge_type` only; real amounts are unsigned
   (`$12.34000`) and direction lives in `source_type`/`target_type`. `manual_credit` /
   `manual_debit` are fine, but `other = delta` (APV adjustment) rows are not recognized.
5. Shipment report: when `postage_fee` is absent the parser falls back to `rate`. For carrier
   billed labels (OSM, FedEx via EasyPost) `rate` is not money paid to EasyPost → overstated cost
   and double count with the OSM/FedEx invoices. Exclude rows whose carrier is billed directly
   (`carrier` in OSM/FedEx/UPS, or `postage_fee = 0` with `rate > 0`).
6. Shipment report uses `created_at`; label cost date should be `postage_label_created_at` when
   present.
7. Real shipment report has ~43 columns including a quoted `options` column with commas and PII
   columns; fixture has 13. Fixture should use the full real header (with fake values).
8. `batch_id` is not a default column (fixture includes it; harmless).
9. PB: parser expects one file with a `Transaction Type` column mixing labels, refunds and
   refills. Real PitneyShip/SendPro Online exports are **separate files** per history type
   (Shipments, Postage refills, USPS Refunds) and column names are unconfirmed. Refill rows will
   only be recognized if a type column says refill/top-up/deposit/add funds.
10. PB API type `POSTAGE FUND` would be read as a label (regex lacks "fund"); `APV-POSTAGE
    OVERPAID` / `CREDIT ADJUSTMENT` would be labels (wrong sign).
11. OSM: whole layout is a guess and only accepted when the file name or a title line says OSM.
12. No source for the slide's actual rule (1st Source acct 0101 debits). If finance uses the bank
    statement, we need a bank CSV parser (BAI2/CSV from 1st Source online banking).

## Daily acquisition recommendation
1. **EasyPost**: Vercel Cron at 11:00 UTC calls `POST /v2/reports/shipment` and
   `/v2/reports/payment_log` for yesterday, polls, downloads the CSV within the 1-hour URL
   window, and ingests. Zero manual work. Best of the three.
2. **Pitney Bowes**: weekly manual export from PitneyShip (Shipments + Postage tabs) dropped into
   the upload page; or skip PB detail and take PB refills from the bank statement.
3. **OSM**: ask OSM to email the invoice CSV or drop it on the SFTP account they already issue;
   ingest by email/SFTP pickup.
4. Long term: a **1st Source bank export** (daily CSV/BAI2) covers all three cash outflows in one
   file, which matches the slide's rule.

## Accounting notes (slide 38: "1st Source acct 0101 · GL 10009")
- **1st Source** is the South Bend bank; "acct 0101" is most likely the last 4 digits of the
  operating account the postage is paid from [guess].
- **GL 10009**: in a typical nonprofit chart, 1xxxx accounts are assets, so 10009 is most likely
  the **cash GL for the 1st Source 0101 account** (or prepaid postage) [guess]. Reading: for each
  shipping debit found on the bank statement, credit 10009 (cash) and debit a shipping/postage
  expense (or contra-revenue) account in the e-commerce department.
- Postage tools are prepaid wallets (EasyPost recharge, PB postage refill) [fact for the
  mechanics]. Booking the top-up as expense is simpler but timing differs from label use.
- Ask the accountant:
  1. Is 10009 the cash account for 1st Source 0101, prepaid postage, or expense?
  2. What is the offset account and department for the shipping amount (same Dept 180 as FedEx?)
  3. Do you book shipping from **bank debits (top-ups)** or from **label usage** in the tools?
  4. Are OSM invoices paid by ACH from 0101? On what cycle?
  5. Do you ship OSM/FedEx through EasyPost, or through their own portals?
  6. Which PB product (PitneyShip, SendPro C/360, meter)? Can you export Shipments and Postage
     history for one month for us?

## Sources
- [EasyPost: Shipment CSV Report](https://support.easypost.com/hc/en-us/articles/8108495510157-Shipment-CSV-Report)
- [EasyPost: Payment Log CSV Report](https://support.easypost.com/hc/en-us/articles/4405420574861-Payment-Log-CSV-Report) and its sample CSV attachment
- [EasyPost Reports API](https://docs.easypost.com/docs/reports)
- [EasyPost Shipments API](https://docs.easypost.com/docs/shipments)
- [EasyPost blog: Batch ID and Tracking Number columns](https://www.easypost.com/blog/2023-07-31-better-shipment-and-payment-log-reporting-with-new-batch-id-and-tracking-number-columns/)
- [EasyPost OSM Worldwide guide](https://docs.easypost.com/carriers/osm-guide), [OSM v2 guide](https://docs.easypost.com/carriers/osm-v2-guide)
- [PB: Viewing and exporting history in PitneyShip](https://www.pitneybowes.com/us/support/article/000083225/viewing-your-history-in-pitneyship-pro.html)
- [PB: Exporting a history report in SendPro Online](https://www.pitneybowes.com/ca/en/support/article/000052928/exporting-a-history-report-in-sendpro-online-and-on-the-sendpro.html)
- [PB: PitneyShip past updates](https://www.pitneybowes.com/us/your-product-update-hub/pitneyship/past-updates.html)
- [PB: Shipment Details report in SendPro 360](https://www.pitneybowes.com/us/support/article/000094526/running-a-shipment-details-report-in-sendpro-360.html)
- [PB Shipping API: Get Transaction Reports](https://docs.shippingapi.pitneybowes.com/api/get-transactions-reports.html)
