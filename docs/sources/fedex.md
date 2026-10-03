# FedEx (shipping charges and refunds)

Source id: `fedex` · Parser: `src/sources/fedex.ts` (v0.1.0)
Researched 2026-10-03. Tags: **[fact]** = read in an official FedEx document (linked);
**[guess]** = our inference.

- **What it is:** FedEx Express / Ground / Ground Economy invoices for e-commerce parcels. Slide 38:
  "FedEx · Shipping charges + refunds · BC GL 40356 · Dept 180 · V00122 · net BNKDEPOSIT refunds"
  [fact: slide text].
- **How Goodwill gets the data today:** not stated; almost certainly **FedEx Billing Online (FBO)**
  invoice download, and the refunds from the bank (see accounting notes) [guess].
- **Frequency available:** FedEx invoices on a **daily or weekly billing cycle** ("FedEx will
  transmit your invoice files either daily or weekly on your preferred billing day") [fact, EDI
  guide]. So a "daily" FedEx figure is really "invoices issued so far".
- **Live API:** **no public invoice/billing API** on the FedEx Developer Portal (catalog covers
  ship, rate, track, trade, etc.; FBO page mentions EDI, not an API) [fact as far as we could
  find; absence is hard to prove]. Machine feed = **EDI invoice files** (CSV / 250-byte / X12 210)
  over sFTP, AS2 or a secure website, set up with a FedEx ERS analyst [fact]. Not usable this
  weekend (needs FedEx onboarding and testing).
- **Confidence:** column list **fact** (FedEx data dictionary); sign of credits and refund
  handling **guess**.

## 1. FBO invoice download ("All Columns", CSV) [fact]
Path: log in → **Reporting** tab → **Create Report** → Filter Set **Invoice** → account(s), date
range, Status **All** → Report Columns **All Columns** → **Prepare Download** → file type
**CSV** → **Download Center**, wait for "Completed", click the file
([Reveel help article](https://help.reveelgroup.com/knowledge/how-to-download-data-from-fedex-billing-online-user)).

Layout per FedEx's own data dictionary
([downloadref_ExpressGround.pdf](https://www.fedex.com/content/dam/fedex/us-united-states/services/downloadref_ExpressGround.pdf)):
- CSV, **one row per tracking id per invoice**, header row first [fact for row grain; header
  position: guess, the dictionary lists field names as headers].
- **Dates are `yyyymmdd`** (Invoice Date, Shipment Date, POD Delivery Date, Tendered Date…)
  [fact]. Times `hhmm`.
- **Amounts: "Variable length, two decimal positions"**, no currency symbol [fact]. Credits
  negative [guess].

Columns in order (exact names) [fact]:

| # | Column | Notes |
|---|---|---|
| 1 | Bill to Account Number | 9 digits, invoiced account (**do not store**) |
| 2 | Invoice Date | yyyymmdd |
| 3 | Invoice Number | 9 chars |
| 4 | Store ID | |
| 5 | Original Amount Due | **invoice-level**, repeated on every row |
| 6 | Current Balance | invoice-level, repeated |
| 7 | Payor | |
| 8 | Ground Tracking ID Prefix | |
| 9 | Express or Ground Tracking ID | 12+ digits |
| 10 | Transportation Charge Amount | before surcharges/discounts |
| 11 | Net Charge Amount | **the amount to use** per tracking id |
| 12 | Service Type | e.g. "FedEx Ground" |
| 13 | Ground Service | e.g. "Ground Economy", "Home Delivery" |
| 14 | Shipment Date | yyyymmdd |
| 15-18 | POD Delivery Date, POD Delivery Time, POD Service Area Code, POD Signature Description | |
| 19-22 | Actual Weight Amount, Actual Weight Units, Rated Weight Amount, Rated Weight Units | |
| 23-26 | Number of Pieces, Bundle Number, Meter Number, TDMasterTrackingID | |
| 27-32 | Service Packaging, Dim Length, Dim Width, Dim Height, Dim Divisor, Dim Unit | |
| 33-40 | Recipient Name, Recipient Company, Recipient Address Line 1, Recipient Address Line 2, Recipient City, Recipient State, Recipient Zip Code, Recipient Country/Territory | **buyer PII, drop** |
| 41-47 | Shipper Company, Shipper Name, Shipper Address Line 1, Shipper Address Line 2, Shipper City, Shipper State, Shipper Zip Code, Shipper Country/Territory | |
| next | Original Customer Reference, Original Ref#2, Original Ref#3/PO Number, Original Department Reference Description, Updated Customer Reference, Updated Ref#2, Updated Ref#3/PO Number, Updated Department Reference Description, RMA# | reference = good join key to marketplace order |
| next | Original Recipient Address Line 1/2, City, State, Zip Code, Country/Territory | address corrections |
| next | Zone Code, Cost Allocation, Alternate Address Line 1/2, Alternate City, Alternate State Province, Alternate Zip Code, Alternate Country/Territory Code | |
| next | CrossRefTrackingID Prefix, CrossRefTrackingID, Entry Date, Entry Number, Customs Value, Customs Value Currency Code, Declared Value, Declared Value Currency Code | |
| next | 4 × (Commodity Description, Commodity Country/Territory Code) | |
| next | Currency Conversion Date, Currency Conversion Rate, Multiweight Number, Multiweight Total Multiweight Units, Multiweight Total Multiweight Weight, Multiweight Total Shipment Charge Amount, Multiweight Total Shipment Weight | |
| next | Ground Tracking ID Address Correction Discount Charge Amount, Ground Tracking ID Address Correction Gross Charge Amount, Rated Method, Sort Hub, Estimated Weight, Estimated Weight Unit, Postal Class, Process Category, Package Size, Delivery Confirmation, Tendered Date | |
| last 51 | **25 × (Tracking ID Charge Description, Tracking ID Charge Amount)**, then Shipment Notes | **same header name repeated 25 times**; one pair per charge (freight, fuel surcharge, residential, discount…) |

Example (fake, columns trimmed to the ones we use):
```csv
Bill to Account Number,Invoice Date,Invoice Number,…,Express or Ground Tracking ID,Transportation Charge Amount,Net Charge Amount,Service Type,Ground Service,Shipment Date,…,Tracking ID Charge Description,Tracking ID Charge Amount,Tracking ID Charge Description,Tracking ID Charge Amount,…
000000000,20260908,812345678,…,700000000001,10.95,12.48,FedEx Ground,Home Delivery,20260901,…,Fuel Surcharge,1.53,Residential,0.00,…
```

### EDI CSV invoice (if Goodwill is on electronic invoicing) [fact]
Different headings for the same data
([CSV selectable invoice guide](https://www.fedex.com/content/dam/fedex/us-united-states/services/csv_selectable_invoice_and_fixed-length_remittance_records.pdf)):
`Invoice Number`, `Invoice Date` (YYYYMMDD), `Type` (invoice type: Balance Due, Original, Past
Due, Resend…), `Inv Charge`, `Tracking Number`, `Ship Date`, `Net Chrg`, `Freight Amt`,
`Fuel Amt`, `Resi Amt`, `DAS Amt`, `Vol Disc`, `Earned Disc`, … Amounts 13.2. One record per
tracking number. Invoice adjustment resolution files return per tracking number a resolution of
**Credit, Denial, Refund or Reject** [fact]. Late fees come as separate late-fee invoices with
extra `LF …` columns [fact].

## Money fields and signs
- Cost per shipment = **Net Charge Amount** (after discounts, incl. surcharges) [fact: column
  meaning]. Do not sum `Original Amount Due` / `Current Balance` (invoice level, repeated).
- Credits: re-bills, GSR (money-back guarantee) credits and adjustment credits show up as negative
  Net Charge Amount lines or separate credit invoices [guess]. **Refunds paid out as money**
  (e.g. an overpayment returned) never appear in the invoice download; they land in the bank
  [guess, matches the slide's "net BNKDEPOSIT refunds"].
- Buyer id: none. Recipient name/address are PII: drop at parse.

## Gotchas
- Invoice date vs ship date: a Sep 30 shipment can be on an Oct 6 invoice. Which date decides the
  month is a finance rule [ask]. Parser uses Shipment Date first.
- Non-transportation rows (late fees, retail packaging, EEI) have no tracking id / service.
- Duplicate headers (25 charge pairs) break a naive "header name → index" map.
- Shipments may be non-e-commerce (store transfers, admin) → Dept 180 only for e-commerce [ask].
- FedEx labels bought through EasyPost/ShipStation also appear in those tools (double count
  risk with `shipping_osm_pb_easypost`).

## Parser gap (real format vs `src/sources/fedex.ts`)
1. **Description column**: the alias `Tracking ID Charge Description` matches the first of 25
   identical headers, which is usually a surcharge name (e.g. "Fuel Surcharge"), not a credit
   flag. Credit detection by description is unreliable; use the sign of Net Charge Amount, and
   optionally scan all 25 descriptions for "credit/adjustment".
2. **Duplicate header names**: `columnIndex` uses `indexOf`, so the first of the 25 duplicate
   pairs wins and the other 24 are ignored. Fine for totals (Net Charge Amount already includes
   them) but no surcharge/discount breakdown is kept.
3. **Fixture differs from real**: fixture uses `09/08/2026` dates, `$12.48` amounts and invoice
   `9-000-00001`; real file uses `20260908`, `12.48` and a 9-digit invoice number, ~150 columns.
   `parseDate` already handles `yyyymmdd` and `toCents` handles plain decimals, so the parser
   should cope; the fixture should be regenerated in the real layout.
4. **EDI CSV headings not accepted**: `Net Chrg` and `Ship Date`/`Tracking Number` variants:
   `Net Chrg` is not in the amount aliases, so an EDI file would not be recognized.
5. **Refunds via bank deposit** ("BNKDEPOSIT") are not in any FedEx file; the parser cannot
   produce them. Needs a bank-statement source or a manual adjustment line.
6. Invoice-level columns (`Original Amount Due`, `Current Balance`) are not used (good); make sure
   no alias ever maps to them (`Amount Due` is in the amount alias list: it would only bite if
   `Net Charge Amount` were missing).
7. Bill-to account is not stored (good); recipient PII is ignored (good).
8. Rows with amount 0 are skipped (fine); invoice `Type` (Original vs Past Due vs Resend) is not
   read, so a **re-sent or past-due invoice re-downloaded** would duplicate charges unless dedupe
   is on invoice+tracking.

## Daily acquisition recommendation
- Now: **weekly manual FBO download** (All Columns, CSV, date range = last 7 days) dropped on the
  upload page; dedupe on `Invoice Number + Tracking ID`. FedEx bills weekly, so daily pulls add
  nothing.
- Better: ask FedEx (ERS analyst, 888-450-1774) for **EDI CSV invoice files over sFTP**; a cron
  picks them up. Zero clicks, but takes FedEx onboarding (weeks).
- Refunds: from the bank statement (1st Source export), filtered on FedEx deposits.

## Accounting notes (slide 38: "BC GL 40356 · Dept 180 · V00122 · net BNKDEPOSIT refunds")
- **V00122** = the FedEx **vendor number** in Business Central (BC vendor nos. look like
  `V00010`) [guess, strong]. So FedEx is entered as a **purchase invoice / vendor ledger** item, or
  a journal line with the vendor as balancing account.
- **GL 40356**: in a 5-digit chart where 4xxxx is revenue, 40356 is likely an **e-commerce
  shipping revenue / contra-revenue** account (shipping charged to buyers, net of FedEx cost) [guess].
  It could also be an expense account if their chart differs [ask].
- **Dept 180** = BC global dimension "Department" code for **E-commerce** [guess].
- **"net BNKDEPOSIT refunds"**: refunds/credits from FedEx come in as **bank deposits** (a
  bank-rec or cash-receipt entry, probably with a document/source code `BNKDEPOSIT`) and are
  **netted against the month's FedEx charges** so 40356 shows net shipping cost [guess].
- Ask the accountant:
  1. Which date defines the month: invoice date or ship date?
  2. Is FedEx posted as a purchase invoice to V00122 or a general journal line? Paid by ACH,
     card, or check?
  3. What is `BNKDEPOSIT` exactly (a BC source code, a bank statement description, a journal
     template)? Where do we read those deposits from?
  4. Is GL 40356 revenue, contra-revenue or expense? Are all FedEx accounts e-commerce (Dept 180)?
  5. Do you use the FBO download or the PDF invoice today? Can you share one invoice CSV
     (anonymized)?

## Sources
- [FedEx Billing Online download data dictionary (Express/Ground)](https://www.fedex.com/content/dam/fedex/us-united-states/services/downloadref_ExpressGround.pdf)
- [FedEx CSV selectable invoice and remittance guide](https://www.fedex.com/content/dam/fedex/us-united-states/services/csv_selectable_invoice_and_fixed-length_remittance_records.pdf)
- [FedEx CSV invoice and remittance implementation guide](https://www.fedex.com/content/dam/fedex/us-united-states/shipping/images/CSV_Format_Express-Ground_Invoice_and_Remittance_Implementation_Guide.pdf) (not read in full)
- [FedEx Billing Solutions](https://www.fedex.com/en-us/billing-online.html)
- [FedEx Developer Portal](https://developer.fedex.com/api/en-us/home.html)
- [Reveel: how to download data from FedEx Billing Online](https://help.reveelgroup.com/knowledge/how-to-download-data-from-fedex-billing-online-user)
