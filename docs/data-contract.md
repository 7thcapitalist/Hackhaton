# Data contract (draft v0)

The shared data layer that the nightly pulse, the COO scorecard and the month-end close
all build on. Agree on this before parallel work starts; change it only by PR, and tell
everyone when you do. Problem context: [goodwill-problem.md](goodwill-problem.md).

Status: **draft**, to be refined after the research pass and Amanda's office hours.
Fields marked *(TBC)* depend on answers from Goodwill.

## Stack assumptions

- Next.js (App Router, TypeScript) on Vercel.
- Database: **Turso** (libSQL, SQLite dialect) via `@libsql/client` and Drizzle ORM.
  Schema lives in one file, `src/db/schema.ts`, owned by the data-layer task.
- Env vars (names only; values live in Vercel and `.env.local`, never in git):
  `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`. More are added to `.env.example` as needed.
- Local dev can point `TURSO_DATABASE_URL` at `file:local.db`.

## Conventions

- **Money:** integer cents (`*_cents`), never floats. Sign: positive = money in.
- **Time:** timestamps stored as ISO-8601 UTC text. `business_date` (`YYYY-MM-DD`) is
  derived in Goodwill's time zone, `America/Indiana/Indianapolis` (Eastern), with a
  configurable day cutoff *(TBC)*.
- **Period:** month-end period as `YYYY-MM`.
- **IDs:** text IDs; source rows keep their external ID for traceability.
- **Traceability:** every fact row carries `ingest_run_id` and `source_row` (row number
  in the original file) so any number can be traced back to its file and line.
- **Privacy:** no buyer names, emails or addresses are stored. Buyers are a
  `buyer_key` = salted SHA-256 of the marketplace buyer ID, per source.
- **Synthetic data only** in the repo.

## Tables

### Configuration

**`sources`**: one row per source workflow (slide 38). Adding a marketplace = adding a row
plus a parser, no other code change.

| column | type | notes |
|---|---|---|
| id | text pk | `shopgoodwill`, `amazon`, `ebay`, `cashmonkey`, `upright`, `jewelry`, `shipping_osm_pb_easypost`, `fedex`, `goodwill_books` |
| name | text | display name |
| kind | text | `marketplace` \| `shipping` \| `statement` |
| channel_group | text | row label on the nightly pulse (`ShopGoodwill`, `Amazon`, `eBay`, `Other e-commerce`) or null if not a sales channel |
| acquisition | text | how the file is obtained today (portal download, email, …) |
| owner | text | named person/role who handles exceptions for this source |
| active | int | 0/1 |
| config_json | text | parser options, period rules (e.g. ShopGoodwill Period 1 vs 3) |

**`gl_rules`**: maps source amounts to Business Central lines (the workbook's "logic").

| column | type | notes |
|---|---|---|
| id | text pk | |
| source_id | text fk | |
| amount_type | text | `gross_sales`, `refunds`, `fees`, `shipping_charge`, `shipping_refund`, `payout`, … |
| account_type | text | BC account type: `G/L Account`, `Vendor`, `Customer`, `Bank Account` |
| account_no | text | e.g. `40356`, `10009` |
| dept_code | text | BC dimension, e.g. `180` |
| vendor_no | text | e.g. `V00122` |
| bal_account_no | text | balancing account, e.g. bank `0101` *(TBC)* |
| sign | int | +1 / -1 applied to the amount |
| description_template | text | e.g. `FedEx shipping {period}` |

Seed `gl_rules` with the real codes from slide 38 (GL 40356, Dept 180, V00122,
GL 10009, 1st Source acct 0101). Everything else is placeholder until Amanda confirms.

**`kpi_targets`**: `kpi_key`, `period`, `target_value` (for the scorecard's target context).

### Ingestion

**`ingest_runs`**: one row per uploaded file.

| column | type | notes |
|---|---|---|
| id | text pk | |
| source_id | text fk | |
| period | text | `YYYY-MM` (null for nightly feeds) |
| file_name | text | |
| file_sha256 | text | detect duplicate uploads |
| row_count | int | |
| status | text | `parsed` \| `parsed_with_warnings` \| `failed` |
| warnings_json | text | parser warnings (unknown columns, bad dates, …) |
| uploaded_at | text | |

### Facts

**`orders`**: one row per order line from marketplace sources. Feeds the pulse, the
scorecard and the close.

| column | type | notes |
|---|---|---|
| id | text pk | |
| source_id | text fk | |
| ingest_run_id | text fk | |
| source_row | int | |
| external_order_id | text | |
| order_ts | text | UTC |
| business_date | text | derived |
| buyer_key | text | hashed |
| item_id | text fk null | link to `items` when known |
| category | text | |
| quantity | int | |
| gross_cents | int | |
| refund_cents | int | |
| fee_cents | int | marketplace fees |
| shipping_cents | int | shipping charged to buyer |
| net_cents | int | gross − refund − fee *(definition TBC)* |
| status | text | `paid` \| `refunded` \| `cancelled` |

**`money_lines`**: non-order amounts: shipping charges/refunds, payment statements,
payouts, bank deposits (FedEx, OSM/PB/EasyPost, Goodwill Books, Amazon payments summary).

| column | type | notes |
|---|---|---|
| id | text pk | |
| source_id, ingest_run_id, source_row | | traceability |
| line_date | text | |
| period | text | |
| amount_type | text | matches `gl_rules.amount_type` |
| amount_cents | int | |
| reference | text | invoice/tracking/statement ref |
| memo | text | |

**`items`**: item lifecycle, for productivity, inventory and sales KPIs.

| column | type | notes |
|---|---|---|
| id | text pk | |
| category | text | |
| donated_at, identified_at, sent_to_ecom_at, listed_at, sold_at | text null | lifecycle timestamps |
| listed_by | text | employee pseudonym |
| channel_source_id | text fk null | where it is listed |
| list_price_cents, sale_price_cents | int null | |
| relist_count | int | |

**`labor_hours`**: `employee` (pseudonym), `team`, `work_date`, `hours`.

### Month-end close

**`closes`**: one per period.

| column | type | notes |
|---|---|---|
| id | text pk | |
| period | text | `YYYY-MM` |
| status | text | `collecting` → `generated` → `reconciled` → `approved` → `exported` |
| approved_by, approved_at | text null | human approval required before export |

**`journal_lines`**: generated BC General Journal lines.

| column | type | notes |
|---|---|---|
| id | text pk | |
| close_id | text fk | |
| line_no | int | |
| posting_date | text | |
| document_no | text | |
| account_type, account_no, dept_code | text | from `gl_rules` |
| bal_account_type, bal_account_no | text | |
| description | text | |
| amount_cents | int | BC single-amount convention: + debit, − credit *(confirm)* |
| source_id | text | |
| trace_json | text | the fact row IDs this line was computed from |

**`ar_invoices`** / **`ar_invoice_lines`**: the AR invoice from the workbook's Invoices
tab. Fields *(TBC)* once we see the tab: customer no., posting date, lines with
G/L account, description, quantity, unit price.

**`workbook_baseline`**: the existing workbook's outputs for a period, used to
reconcile (wave 3): `period`, `source_id`, `account_no`, `dept_code`, `amount_cents`.

**`exceptions`**

| column | type | notes |
|---|---|---|
| id | text pk | |
| close_id | text fk null | |
| source_id | text fk null | |
| kind | text | `missing_source`, `parse_warning`, `reconcile_mismatch`, `unmapped_amount`, `duplicate_file` |
| message | text | |
| expected_cents, actual_cents | int null | |
| owner | text | from `sources.owner` |
| status | text | `open` \| `resolved` \| `waived` |
| created_at, resolved_at | text | |

## Parser interface

Each source has one parser module in `src/sources/<source_id>.ts`:

```ts
export interface ParseResult {
  orders: NewOrder[];          // marketplace sources
  moneyLines: NewMoneyLine[];  // shipping, statements, payouts
  items?: NewItem[];
  warnings: { row?: number; message: string }[];
}

export interface SourceParser {
  sourceId: string;
  accepts(fileName: string, header: string[]): boolean; // auto-detect
  parse(file: Buffer, ctx: { period?: string; timezone: string }): Promise<ParseResult>;
}
```

Parsers are pure (no DB access); an ingest service writes the results and the
`ingest_runs` row. This lets parsers be built and tested in parallel.

## Derived views (computed in code, not stored)

- **Nightly pulse(business_date):** per `channel_group`: revenue = Σ `net_cents`
  *(gross vs net TBC)*, customers = count distinct `buyer_key`; then totals.
  Total customers = sum of channel counts *(TBC: vs de-duplicated)*. A channel with
  no ingest for the day shows **missing**, not $0.
- **Scorecard(period):** the 15 KPIs of slide 35 plus the 3 anchor KPIs of slide 36,
  each with month-over-month trend and target from `kpi_targets`. KPIs without data
  render "awaiting data", never a fake number.
- **Close(period):** `gl_rules` × facts → `journal_lines` + AR invoice → compare with
  `workbook_baseline` → `exceptions`.

## Business Central export

- General Journal export as CSV/XLSX with BC column names: Posting Date, Document
  Type, Document No., Account Type, Account No., Description, Department Code,
  Amount, Bal. Account Type, Bal. Account No. *(confirm against their BC setup)*.
- Optional later: BC API v2.0 (`journals`/`journalLines`, `salesInvoices`) against a
  BC sandbox. Not required for the demo.

## Synthetic data

- Fixtures under `data/fixtures/<source_id>/`, one file per period or day, in each
  platform's real export column layout as closely as public docs allow.
- A seeded generator script produces one realistic month (e.g. 2026-09) plus daily
  files, with **deliberate messy cases**: a missing source, a duplicate upload, an
  order on a time-zone boundary, refunds, a renamed column, an unmapped fee type, a
  reconcile mismatch vs the workbook baseline.
- Fake names only; no real customer, employee or Goodwill data.
