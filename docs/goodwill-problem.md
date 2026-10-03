# Goodwill Michiana: the problem we are solving

Our track at SprintHack@ND 2026: **Pod B · Goodwill Michiana · room 154**.
Source: Goodwill's reverse pitch, Saturday Oct 3, 11:30 (slides photographed by Joao).
Slide numbers refer to the 95-slide pitch deck. Slides 37, 40, 41 were not captured.

## In one paragraph

Goodwill Michiana sells donated goods online across many marketplaces (ShopGoodwill,
Amazon, eBay and others). Their reporting and accounting run on manual work: staff
download reports from about nine portals and inboxes, paste numbers into an Excel
"allocation workbook", and copy-paste the result into Microsoft Dynamics 365
**Business Central** (BC). Management lacks a daily and monthly view of the business,
and the month-end close costs staff days of manual work every month. They want to go
"from manual reporting to management visibility" and "from manual month-end close to
Business Central integration".

## The three asks (we are doing all three, on one shared data layer)

1. **Nightly report, the "daily pulse"** (slide 31). Revenue and customer count per
   marketplace, then e-commerce totals. New marketplaces get added as new rows.
2. **Monthly COO scorecard** (slides 33 to 36). One page, 15 KPIs, monthly, with
   trend and target context; three KPIs anchor the 2027 plan.
3. **Month-end close into Business Central** (slides 38, 39, 42). Nine source
   workflows feed an allocation workbook that produces a BC general journal and an
   AR invoice. Automate source by source, validate against the workbook, then cut over.

## Demo story: "A month at Goodwill, without the spreadsheets"

1. **Every night:** the pulse lands (revenue and customers by marketplace, totals).
2. **Every month:** the COO opens one page: 15 KPIs, the three 2027 KPIs on top, and a
   plain-language note on what is driving the numbers.
3. **Month-end:** the nine sources go in; BC general journal lines and the AR invoice
   come out, reconciled against the workbook, exceptions routed to named owners.
4. **Close:** "From days of copy-paste to one click, with the workbook kept as the
   check until finance trusts it" (their own wave plan, slide 42).

All three views run off the same ingested data: the files that feed the close also
feed the nightly pulse, and the nightly numbers roll up into the monthly scorecard.

## Depth and cut lines

| Layer | Target depth | Cut if behind on Sunday 11:00 |
|---|---|---|
| Data layer: source parsers + synthetic data | Solid. Everything depends on it. Lands first. | Nothing; this is the critical path |
| Nightly pulse | Full, end to end, delivered (email) | Show in app instead of email |
| Month-end close to BC | Deep: journal + AR invoice + reconciliation + exceptions | 4 to 5 key sources of the 9, disclosed |
| COO scorecard | 15 KPIs with trends and targets | KPIs we have data for; rest shown "awaiting data" |
| AI "what is driving it" note | Polish | Cut first |

---

## Goodwill's own words, slide by slide

### Slide 19: the problem, in Goodwill's words
> "From manual reporting to management visibility. A monthly E-Commerce dashboard
> should balance growth, profitability, productivity, inventory management and
> customer engagement."
>
> "A nightly report creates a daily pulse. Each nightly report should show both
> revenue and customer count by marketplace, followed by enterprise totals."
>
> "From manual month-end close to Business Central integration. The current close
> combines portal downloads, emailed reports, bank activity, spreadsheet rules and
> manual Business Central entri[es]…" (rest hidden by the speaker)

### Slide 31: nightly channel breakdown, "A nightly report creates a daily pulse"
Each nightly report should show both revenue and customer count by marketplace,
followed by enterprise totals.

| Revenue source | Daily revenue | Daily customers |
|---|---|---|
| ShopGoodwill | Revenue for the day | Customers for the day |
| Amazon | Revenue for the day | Customers for the day |
| eBay | Revenue for the day | Customers for the day |
| Other e-commerce channels | Revenue for the day | Customers for the day |
| **Total e-commerce** | **Total revenue for the day** | **Total customers for the day** |

> Other marketplaces can be added as separate rows as the channel mix evolves.

### Slide 33: KPI framework, "Profitability + productivity lead"
The operating model begins with economic performance and the throughput required to
sustain it.

- **Financial metrics:** Total E-Commerce Revenue · Revenue Growth % (YoY) · Gross
  Margin % · Net Margin % · Revenue per Labor Hour · Profit per Labor Hour
- **Listing & production metrics:** Items Identified for E-Commerce · Items Sent to
  E-Commerce · Listings Created per Day · Listings per Employee · Average Time to List
  an Item · Unlisted Inventory Backlog

### Slide 34: KPI framework, "Commercial KPIs complete the view"
Sales effectiveness, category economics and customer behavior explain what is driving
the headline results.

- **Sales effectiveness:** Average Selling Price (ASP) · Median Sale Price ·
  Sell-Through Rate · Days to Sell · Unsold Inventory % · Relisted Inventory %
- **Category performance:** Sales by Category · Margin by Category · Units Sold by
  Category · Sell-Through Rate by Category · Average Selling Price by Category · Top 10
  Categories by Revenue · Top 10 Categories by Margin
- **Customer & marketplace:** Number of Buyers · Repeat Buyer Rate · New Buyers ·
  Customer Satisfaction Rating · Net Promoter Score (if available) · Marketplace
  Conversion Metrics

### Slide 35: COO scorecard, "15 KPIs create one COO operating view"
A monthly scorecard should combine outcomes, operating drivers and early warning
indicators.

| Pillar | KPI 1 | KPI 2 | KPI 3 |
|---|---|---|---|
| Financial | Total E-Commerce Revenue | Revenue Growth % | Net Margin % |
| Productivity | Listings Created | Revenue per Labor Hour | Listings per Employee |
| Inventory | Days from Donation to Listing | Unlisted Inventory Backlog | Unsold Inventory % |
| Sales | Average Selling Price | Sell-Through Rate | Sales per Employee |
| Category + customer | Top 10 Categories by Revenue | Top 10 Categories by Margin | Repeat Buyer Rate |

> Monthly cadence · One page · Trend and target context should be added as data
> becomes available.

### Slide 36: 2027 plan, "Three KPIs anchor the 2027 plan"
The strategic plan should focus leadership attention on profitable growth, labor
leverage and inventory velocity.

1. Increase e-commerce net margin (annually)
2. Increase revenue per labor hour (annually)
3. Increase sell-through rate (annually)

> These three measures connect profitability, workforce productivity and the speed at
> which inventory converts to cash.

### Slide 38: source workflows, "Nine source workflows feed one month-end close"
The close depends on different portals, report timings, emails and finance lookups
before the allocation workbook can be completed.

| Source | Month-end input | Acquisition / rule |
|---|---|---|
| Cash Monkey | Orders · full month | Submit/download CSV; save as Excel |
| Upright | Paid order items · full month | Generate; email delivery; save as Excel |
| Jewelry | Jewelry Report | Request report; Co-Pivot populates Supplier |
| OSM / PB / EasyPost | Shipping amounts | 1st Source acct 0101 · GL 10009 |
| FedEx | Shipping charges + refunds | BC GL 40356 · Dept 180 · V00122 · net BNKDEPOSIT refunds |
| ShopGoodwill | Periodic marketplace reports | Filter year/month; Period 1 periodic only; Period 3 all reports |
| Goodwill Books | Prior-month payment statement | Monthly email attachment |
| eBay | Listing sales report | Seller Center · change date · generate/download |
| Amazon | Payments summary | Seller Central · request/refresh/download |

> Current state · Each source has its [own path], timing and business rule.

(PB is likely Pitney Bowes; 1st Source is the South Bend bank; "Co-Pivot" is unknown,
ask Amanda.)

### Slide 39: allocation workbook, "The allocation workbook is the manual control layer"
After the source data is gathered, a prior-month workbook is copied forward and
becomes the bridge into Business Central.

1. **Archive inputs:** save all files under Accounting / Month End / year / month /
   Journal Entries / E-Commerce JEs.
2. **Roll workbook:** open the prior-month E-Commerce Allocation file and save a
   current-month copy.
3. **Populate tabs:** enter report data into the orange-highlighted fields on the
   matching source tabs.
4. **Generate entries:** workbook logic flows data into the Journal Entry tabs for
   each report.
5. **Post general journal:** copy and paste the journal-entry output into a Business
   Central General Journal.
6. **Create AR invoice:** use the final Invoices tab to create the Business Central AR
   invoice entry.

> The dependency is broader than a single upload: month-end rules, source-specific
> t[…], […] invoice creation all sit inside the manu[al workbook…] (partly hidden)

### Slide 42: implementation, "Implement in waves that protect the month-end close"
Automation should be introduced source by source, then proven against the existing
allocation workbook before manual posting is retired.

1. **Baseline the close:** inventory files, owners, timing, workbook tabs, formulas,
   journal output and invoice output.
2. **Automate acquisition:** prioritize stable portal/email feeds; add shipping lookups
   and enrichment after core reports.
3. **Reproduce + validate:** generate BC-ready outputs and compare every source, total,
   journal line and invoice to the workbook.
4. **Cut over + operate:** approve production posting, monitor each close and route
   exceptions to named owners.

> **Definition of done:** Every required source is captured · Period and shipping
> rules are reproduced · Journal lines reconcile · AR invoice output reconciles ·
> Posting status and exceptions are retained.

---

## How we are judged (innovationsprintlab.com/sprinthack/rubric)

| Criterion | Pts | Top level (4) |
|---|---|---|
| Working Evidence | 26 | Full workflow runs in one take on more than one example, incl. a messy/edge input |
| Partner Problem Fit | 22 | Fully solves it, fewest steps for the user |
| Fits Their Constraints | 19 | Works within all their key limits (time, budget, staff skills, systems); usable tomorrow |
| Technical Substance | 15 | Hard part is our own work; we can explain its limits and next steps |
| Demo Clarity | 11 | Clear in the first 30 seconds, on time |
| X-Factor | 7 | Judges would back us; partner would pilot it |

- Demo = Google Slides with an **embedded recorded demo video**, then questions. Slot
  is 12 min (7 demo, 3 questions, 2 buffer); the demo is hard-cut at time.
- **Open with the partner's problem in the partner's own words** (slide 19 quotes).
- Submit by **Sunday 4:00 PM** at innovationsprintlab.com/go/submit: Slides link
  (anyone with link), GitHub repo, "what we built vs what we used", sources cited.
- Zero-point flags: build made before the weekend (repo history is checked);
  overclaiming (moves Working Evidence to 1). Plus "would you spend 30 minutes with
  this team next week?"
- One winner per partner, picked by the partner; $750. Ties break on Partner Problem
  Fit, then Working Evidence.

Pod B judges: Amanda Baumer (Goodwill, in person), Reece Atkinson and Dustin Goodman
(ClickUp, remote), Tim Connors (PivotNorth, remote), Horacio Lopez (Replit, remote),
Shreya Kumar and Michael Wicks (Notre Dame, in person).

## Partner access

- **Amanda Baumer (Goodwill's judge): office hours Saturday 3:00 to 4:45 PM, in
  person, Huddle Room.** Book a 15-minute slot on the organizer sheet (OFFICE HOURS tab).
- Other Saturday mentors useful to us: Horacio Lopez (Replit), Michael Wicks (Notre
  Dame, 109A), Reece Atkinson / Dustin Goodman (ClickUp, remote).

## Open questions for Amanda (priority order)

1. Of the three asks, which would she use first?
2. Can she share one anonymized source file (any marketplace) and the layout of the
   workbook's Journal Entry and Invoices tabs?
3. Rules: what are ShopGoodwill "Period 1" and "Period 3"? What is "Co-Pivot"? How do
   FedEx refunds net against BNKDEPOSIT?
4. Nightly pulse: is "customers" unique buyers or orders? Is total customers a sum
   across channels or de-duplicated people? Revenue gross or net of refunds and fees?
   Which time zone / cutoff defines "the day"? Delivery by email or Teams?
5. Scorecard: where do labor hours and the item pipeline (donation, identified, sent,
   listed timestamps) live today? How is gross margin computed on donated goods? Who
   sets the targets?
6. BC: Business Central online (SaaS) or on-premises? Do they import journals via the
   Excel "Edit in Excel" / configuration packages, or only manual entry?

## Constraints we must design for

- Their system of record is **Business Central**; output must be BC-importable, not a
  new ledger.
- The **allocation workbook stays** as the validation baseline until cut-over (wave 3).
- Staff skills: Excel-centric finance team; the tool must not need a developer to run.
- Nonprofit budget: low running cost, no heavy enterprise licences.
- Each source has its own path, timing and rule: sources are configuration, not code.

## Ethics notes for the pitch

- **Human approval before posting:** nothing is posted to the books automatically;
  finance approves each close. Exceptions are routed to named owners, never silently
  "fixed".
- **Traceability:** every number on the pulse, scorecard and journal links back to its
  source file and row. The AI note only narrates numbers computed by code; it never
  invents figures.
- **Buyer privacy:** marketplace exports contain buyer names and addresses. We store a
  hashed buyer key for counting customers, not personal details. De-duplicating
  buyers across marketplaces is a privacy decision for Goodwill, not a default.
- **Employee metrics:** "listings per employee" and "sales per employee" can turn into
  surveillance. Present them at team level by default; frame them as capacity
  planning, not individual ranking.
- **Demo data is synthetic.** No real Goodwill, customer or employee data in the repo.
