# Shipping: OSM / Pitney Bowes / EasyPost

- **What it is:** Shipping expense, combining three tools under one GL rule — **OSM
  Worldwide** (a parcel consolidator, also available as an EasyPost carrier), **Pitney
  Bowes** (SendPro 360 / PitneyAnalytics), and **EasyPost** (a shipping API/dashboard).
  `kind = shipping` — this feeds `money_lines`, not `orders`.
- **How Goodwill gets the data today:** Slide 38: *"Shipping amounts... 1st Source acct
  0101 · GL 10009."* This phrasing suggests the real month-end input may be a **bank
  statement line** (1st Source account 0101, a South Bend bank) for postage top-ups —
  not a carrier report directly, with the carrier reports only as supporting detail.
  **Confirm with Amanda which one is actually keyed into the workbook.**
- **Frequency available:** EasyPost/Pitney Bowes dashboards support on-demand date
  ranges — daily-capable. The bank statement itself is monthly.
- **Live API:** EasyPost has a public, well-documented API (and lists OSM as a supported
  carrier). Usable as a reference this weekend, but real data would need Goodwill's own
  EasyPost account/API key — fixtures only for the demo.
- **File format:** CSV for EasyPost and Pitney Bowes; no public report format found for
  OSM directly (treated as an EasyPost carrier instead).
- **Columns:**
  - EasyPost Shipment CSV: `created_at, id, tracking_code, status, carrier, service, rate,
    refund_status (submitted/refunded/rejected), batch_id`.
  - Pitney Bowes shipment-details report (configurable columns): `Shipment Create Date,
    Sender Name, Carrier Name, Service, Tracking Number, Total Charges`.
  - OSM (guess, no public format): `Invoice #, Ship Date, Tracking, Service, Weight,
    Charge`.
- **Money fields:** `rate` / `Total Charges` / `Charge` = shipping **expense** (money
  out) — opposite sign convention from the marketplace sources.
- **Buyer id field:** None — this is a pure expense source, no buyer involved.
- **Gotchas:**
  - Three different tools share one GL rule (GL 10009, bank 0101) — needs three small
    parsers but one shared `gl_rules` mapping.
  - The bank-statement-vs-carrier-file question above is unresolved and could change
    which file is actually authoritative for this source.
- **Confidence:** EasyPost = fact ([Shipment CSV](https://support.easypost.com/hc/en-us/articles/8108495510157-Shipment-CSV-Report), [Payment Log](https://support.easypost.com/hc/en-us/articles/4405420574861-Payment-Log-CSV-Report)). Pitney Bowes = partial fact ([data dictionary PDF](https://www.pitneybowes.com/content/dam/support/product-documentation/shipping-360/en/pitneyanalytics-data-dictionary-shipment-details-report.pdf)). OSM format and bank-vs-carrier source of truth = guess.
