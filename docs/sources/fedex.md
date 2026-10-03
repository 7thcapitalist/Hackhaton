# FedEx

- **What it is:** Shipping carrier invoice, kept separate from the OSM/PB/EasyPost group
  (its own GL treatment). `kind = shipping` — feeds `money_lines`.
- **How Goodwill gets the data today:** FedEx Billing Online → Reporting → Create Report
  → Filter Set Invoice → All Columns → CSV. Slide 38: *"Shipping charges + refunds... BC
  GL 40356 · Dept 180 · V00122 · net BNKDEPOSIT refunds."*
- **Frequency available:** On-demand in the portal — daily-capable. Month-end workflow
  pulls the full month.
- **Live API:** FedEx has developer APIs (Ship/Rate), but the Billing Online CSV export is
  the documented workflow Goodwill actually uses — no indication they'd switch to the API.
- **File format:** CSV.
- **Columns:** `Invoice Number, Invoice Date, Tracking ID, Shipment Date, Service Type,
  Net Charge Amount`. Refunds/credits appear as **their own negative or adjustment line**,
  never an edit to the original charge.
- **Money fields:** `Net Charge Amount` = shipping expense (money out). Refund lines =
  money back in, netted against a `BNKDEPOSIT` line per slide 38 — exact mechanic
  unconfirmed.
- **Buyer id field:** None.
- **Gotchas:**
  - **"Net BNKDEPOSIT refunds"** — how exactly FedEx refunds net against a bank deposit
    line is one of the three open mechanics questions in `goodwill-problem.md` (with
    ShopGoodwill Period 1/3 and "Co-Pivot"). Ask Amanda.
  - `V00122` is FedEx's **Vendor No.** in Business Central, not a GL account — confirms
    this posts as an AP vendor bill, not a straight GL hit. The parser/journal logic needs
    to know the difference.
- **Confidence:** Columns = partial fact ([Reveel](https://help.reveelgroup.com/knowledge/how-to-download-data-from-fedex-billing-online-user), [FedEx CSV guide (PDF)](https://www.fedex.com/content/dam/fedex/us-united-states/services/csv_selectable_invoice_and_fixed-length_remittance_records.pdf)). Refund-netting mechanic = guess.
