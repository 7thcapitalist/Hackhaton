# The database, explained

A guide to `src/db/schema.ts` for whoever owns the data lane. Read it top to bottom once
and you'll know where every number on the dashboard comes from.

## The big picture

There are four layers. Data only flows downward.

```
CONFIG       sources (9) · channels (5) · gl_rules · kpi_targets
               │  what exists and how to treat it
INGESTION    ingest_runs  ── one row per uploaded file
               │  every fact row points back to the file + row it came from
FACTS        orders · money_lines · items · labor_hours
               │  the clean, unified data
CHECKS       exceptions  ── anything wrong, with an owner
               │
(VIEWS)      computed in code, never stored: pulse, scorecard, source status
CLOSE        closes · journal_lines · ar_invoices · ar_invoice_lines · workbook_baseline
             (deferred: month-end export to Business Central)
```

**Conventions that apply everywhere**

- **Money is integer cents** (`*_cents`). `1999` means $19.99, so there are no floating-point
  errors. Positive means money coming in to Goodwill; negative means money going out.
- **Timestamps** (`order_ts`, `uploaded_at`) are ISO-8601 UTC strings.
- **`business_date`** is `YYYY-MM-DD` in **America/Indiana/Indianapolis**. This is "the
  day" on the pulse, so an order at 11:45 PM Eastern counts on that day even though it's
  already tomorrow in UTC.
- **`period`** is `YYYY-MM`.
- **ids** are text (UUIDs).
- **Privacy:** no buyer names, emails or addresses are stored anywhere. A buyer is a
  `buyer_key`, a salted SHA-256 hash of the marketplace buyer id. It's enough to count
  unique and repeat buyers, and nothing more.

## Config tables

### `sources`: the nine places data comes from
One row per workflow on slide 38: `shopgoodwill`, `amazon`, `ebay`, `cashmonkey`,
`upright`, `jewelry`, `shipping_osm_pb_easypost`, `fedex`, `goodwill_books`.

| column | meaning |
|---|---|
| `kind` | `marketplace` (sales) · `shipping` (costs) · `statement` (payout statements) |
| `acquisition` | how Goodwill gets the file today, e.g. "Seller Central · request/download" |
| `owner` | who fixes it when it's missing; copied onto exceptions |
| `revenue_authority` | 1 = when two sources report the same order, this one wins |
| `config_json` | per-source parser options (e.g. ShopGoodwill Period 1/3 rules) |

Adding a new marketplace = one row here + one parser file.

### `channels`: where the sale happened
`shopgoodwill`, `amazon`, `ebay`, `goodwill_books`, `other`. `pulse_group` is the row label on
the nightly pulse (ShopGoodwill / Amazon / eBay / Other e-commerce).

**Why is channel separate from source?** Upright is one *source* whose file contains sales
from *several channels*. A sale on eBay is channel `ebay` whether it came from the eBay
file or the Upright file. That's also how duplicates are caught.

### `gl_rules` and `kpi_targets`
- `gl_rules`: for the month-end close. Maps (source, amount type) to a Business Central
  account, department and sign. `is_placeholder = 1` until Goodwill confirms the codes.
- `kpi_targets`: the target per KPI per month, shown next to the actual value.

## Ingestion

### `ingest_runs`: one row per uploaded file
This is the audit trail. Every fact row has an `ingest_run_id`, so any number can be
traced back to the file it came from.

| column | why it exists |
|---|---|
| `file_sha256` | the same file uploaded twice is detected and ignored |
| `header_row_index` | where the real header was (exports often have lines above it) |
| `header_signature` | hash of the header; changes if the platform renames a column |
| `parser_version` | which version of the parser read it |
| `status` | `parsed` · `parsed_with_warnings` · `failed` |
| `period` / `business_date` / `period_label` | what the file covers |
| `is_synthetic` | 1 = demo/synthetic data; the UI shows a "simulated" badge |

The **"missing" logic**: if a channel has no `ingest_run` for a day, the pulse shows
*missing*, not $0.

## Facts (the unified data)

### `orders`: one row per order line, from any marketplace
| column | meaning |
|---|---|
| `source_id`, `channel` | which file it came from, and where it was sold |
| `external_order_id`, `external_item_id` | the marketplace's own ids |
| `dedupe_key` | `channel:order_id:item_id`, **unique**. The same order can't be stored twice |
| `order_ts` / `business_date` | when it was ordered (UTC), and which Indiana day that is |
| `buyer_key` | hashed buyer, for unique and repeat customers |
| `category`, `quantity`, `item_id` | for category KPIs and the item lifecycle |
| `gross_cents` | sale price |
| `shipping_cents` | shipping charged to the buyer |
| `refund_cents`, `fee_cents` | refunds and marketplace fees |
| `tax_cents` | tax the marketplace collected. **Never revenue** |
| `net_cents` | `gross + shipping − refund − fee` (tax excluded). **This is "revenue"** |
| `status` | `paid` · `refunded` · `cancelled` |
| `ingest_run_id`, `source_row` | traceability |

### `money_lines`: money that isn't an order
Shipping label costs, carrier refunds, payouts, statement payments, fees reported
separately. `amount_type` says what it is: `sale`, `refund`, `marketplace_fee`,
`fulfillment_fee`, `shipping_label`, `shipping_refund`, `postage_topup`, `payout`,
`tax_withheld`, `adjustment`, `statement_payment`. Used for net margin and for the close.

### `items` and `labor_hours`: the operations side (synthetic for now)
No marketplace export contains these, so they're **synthetic** until Goodwill tells us
where the data lives:
- `items`: each donated item's timeline (donated → identified → sent to e-commerce →
  listed → sold), plus list and sale price and relist count. This feeds days to list,
  unlisted backlog, sell-through and listings per employee.
- `labor_hours`: hours per employee (pseudonym) per day. This feeds revenue per labor
  hour and sales per employee.

## Checks

### `exceptions`: nothing goes wrong silently
| kind | when |
|---|---|
| `missing_source` | a source/channel has no file for the day or period |
| `duplicate_file` | the same file uploaded again |
| `duplicate_order` | the same order arrived from two sources (e.g. Upright + eBay) |
| `parse_warning` | rows the parser couldn't read, unknown row types |
| `reconcile_mismatch`, `unmapped_amount`, `unbalanced_document` | month-end close checks |

Each has `owner`, `status` (`open` / `resolved` / `waived`) and optional expected vs actual
amounts.

## How the dashboard numbers are computed (views, not tables)

| View | Formula |
|---|---|
| Pulse revenue per channel per day | Σ `orders.net_cents` where `business_date` = day, grouped by channel |
| Pulse customers | count distinct `buyer_key` (total = sum of the channels; still to be confirmed with Goodwill) |
| Missing | no `ingest_run` for that channel and day → `null`, shown as "missing" |
| Scorecard KPIs | functions in `src/kpis/`, one per KPI, each with its formula in a comment |

## Month-end close tables (deferred)
`closes` (one per month: collecting → generated → reconciled → approved → exported),
`journal_lines` (Business Central General Journal lines; + = debit), `ar_invoices` and
`ar_invoice_lines` (the workbook's Invoices tab), and `workbook_baseline` (the old
workbook's numbers, to prove ours match). These are ready in the schema but nothing uses
them yet.
