# Interfaces between lanes

How the four lanes hand work to each other. Agree on these shapes first, then build in
parallel. If you need to change a shape, say so in your PR and tell the people downstream.

```
Ryan (sources)  ──fixtures + source docs──▶  Joao (DB, parsers, cleaning, KPIs)
                                                   │
                                     view functions (src/lib/views)
                                                   │
                              ┌────────────────────┴────────────────────┐
                              ▼                                         ▼
                   Gabriel (in-app UI)                     Denis (exports, reports, email)
```

Until the parsers land, `npm run seed` fills the database with synthetic, already-clean
data, so Gabriel and Denis can build against real view functions from the first hour.
When parsers land, the same functions return parsed data. Nothing downstream changes.

## 1. Ryan → Joao: one doc and one fixture folder per source

Source ids (match `sources.id` in `src/db/schema.ts`): `shopgoodwill`, `amazon`, `ebay`,
`cashmonkey`, `upright`, `jewelry`, `shipping_osm_pb_easypost`, `fedex`, `goodwill_books`.

**`docs/sources/<source_id>.md`**, using this template:

```markdown
# <Source name>

- What it is: (marketplace / shipping / statement; what Goodwill uses it for)
- How Goodwill gets the data today: (portal download, emailed attachment, …) — slide 38
- Frequency available: (daily? monthly only?)
- Live API: (name, link, auth needed, can we use it this weekend? yes/no and why)
- File format: (CSV / XLSX / PDF; header row position; preamble/footer lines)
- Columns: (real column names, in order, with meaning and example value)
- Money fields: (which are revenue, fees, refunds, tax, shipping; sign conventions)
- Buyer id field: (if any; we hash it, never store it raw)
- Gotchas: (duplicates with other sources, time zone, period rules, …)
- Confidence: fact / guess, with links
```

**`data/fixtures/<source_id>/`**: synthetic files in the platform's real export layout.

- At least one month (`2026-09`) and, for daily-capable sources, a few daily files
  (`2026-10-01` … `2026-10-03`).
- File names: `<source_id>_<YYYY-MM>.csv` or `<source_id>_<YYYY-MM-DD>.csv` (xlsx if the
  real export is xlsx).
- Fake data only. No real names, emails, addresses or card numbers.
- Include the messy cases on purpose: preamble lines before the header, a refund, an
  order near midnight Eastern, a renamed column, and for Upright an order that also
  appears in the eBay or ShopGoodwill file.

## 2. Joao → Gabriel and Denis: view functions

All in `src/lib/views/`, types in `src/lib/views/types.ts`. Server code (pages, route
handlers, cron) imports and calls them directly. Client components use the JSON routes.

| Function | JSON route | Returns |
|---|---|---|
| `getPulse(businessDate)` | `GET /api/views/pulse?date=YYYY-MM-DD` | `PulseView` |
| `getPulseSeries(from, to)` | `GET /api/views/pulse-series?from=…&to=…` | `PulseSeriesView` |
| `getScorecard(period)` | `GET /api/views/scorecard?period=YYYY-MM` | `ScorecardView` |
| `getSourceStatus(period)` | `GET /api/views/sources?period=YYYY-MM` | `SourceStatusView` |
| `getOrders(filter)` | `GET /api/views/orders?channel=…&date=…&limit=…` | `OrdersView` (drill-down) |

Conventions: money is integer cents (`…Cents`); format only at the edge. Dates are
`YYYY-MM-DD` in America/Indiana/Indianapolis; periods are `YYYY-MM`. `null` means "no data",
never zero. Show it as "missing" or "awaiting data".

```ts
export type ChannelId = "shopgoodwill" | "amazon" | "ebay" | "goodwill_books" | "other";

export interface PulseRow {
  channelId: ChannelId;
  label: string;                 // ShopGoodwill | Amazon | eBay | Other e-commerce
  status: "ok" | "missing";      // missing = no file ingested for that day
  revenueCents: number | null;   // Σ net_cents
  customers: number | null;      // distinct transactions (each one is a customer)
  orders: number | null;
}
export interface PulseView {
  businessDate: string;
  timezone: "America/Indiana/Indianapolis";
  rows: PulseRow[];
  totals: { revenueCents: number; customers: number; orders: number };
  missingChannels: ChannelId[];
  isSynthetic: boolean;          // true while running on seed data
}

export interface PulseSeriesView {
  from: string; to: string;
  dates: string[];
  series: { channelId: ChannelId; label: string;
            revenueCents: (number | null)[]; customers: (number | null)[] }[];
  totals: { revenueCents: number[]; customers: number[] };
}

export type KpiUnit = "cents" | "percent" | "count" | "days" | "ratio" | "cents_per_hour";
export interface Kpi {
  id: string;                    // e.g. total_revenue, sell_through_rate
  label: string;
  pillar: "financial" | "productivity" | "inventory" | "sales" | "category_customer";
  unit: KpiUnit;
  value: number | null;
  previous: number | null;       // prior month
  target: number | null;         // from kpi_targets
  status: "ok" | "simulated" | "awaiting_data";
  anchor2027: boolean;           // one of the 3 KPIs on slide 36
  note?: string;
}
export interface ScorecardView {
  period: string;
  kpis: Kpi[];                   // 15 KPIs of slide 35 (anchors included)
  topCategoriesByRevenue: { category: string; revenueCents: number }[];
  topCategoriesByMargin: { category: string; marginCents: number }[];
}

export interface SourceStatus {
  sourceId: string; name: string;
  cadence: "daily" | "weekly" | "monthly";   // sources.config_json.cadence
  // not_due = no file yet and none expected yet: a weekly/monthly file of the
  // running month (e.g. Goodwill Books in October), or a daily source with no
  // finished day in the period. missing = a due file is absent; for a daily
  // source, a finished day (before `asOf`) without a file (see missingDates).
  status: "received" | "warnings" | "missing" | "not_due";
  lastIngestAt: string | null;
  rowCount: number;
  openExceptions: number;
  missingDates?: string[];                   // daily sources: finished days without a file
}
// asOf = latest business day with an ingested file (the data's clock); days before it are due.
export interface SourceStatusView { period: string; asOf: string; sources: SourceStatus[] }

export interface OrdersView {
  rows: { id: string; channel: ChannelId; sourceId: string; externalOrderId: string;
          businessDate: string; category: string | null; grossCents: number;
          netCents: number; status: string; ingestRunId: string; sourceRow: number }[];
  total: number;
}
```

### Data health: exceptions, upload history, demo reset

| Function | Route | Returns |
|---|---|---|
| `getExceptions({ status?, sourceId?, kind?, period?, limit?, offset? })` | `GET /api/views/exceptions?status=&sourceId=&kind=&period=YYYY-MM&limit=1..1000&offset=` | `ExceptionsView` |
| `setExceptionStatus(id, { status, note? })` | `PATCH /api/exceptions/:id` body `{ status: "resolved"\|"waived"\|"open", note? }` | `ExceptionRow` (404 unknown id, 400 bad status) |
| `getIngestRuns({ sourceId?, period?, limit?, offset? })` | `GET /api/views/ingest-runs?sourceId=&period=YYYY-MM&limit=1..500&offset=` | `IngestRunsView` |
| `runSeed(db)` (`scripts/seed/run.ts`) | `POST /api/demo/reset` header `x-demo-secret: $DEMO_RESET_SECRET` | `{ ok, counts, ms }` (401 wrong/missing secret, 503 env unset) |

- Newest first. Default limits: exceptions 100, ingest runs 50.
- Period rule (same as `getSourceStatus`): via the ingest run (`period` or `business_date`
  in the month), the close, or for a bare exception its `created_at` month.
- `countsByKind` applies every filter except `kind`, so tabs can show counts per kind.
- Resolving sets `resolvedAt` = now (`open` clears it). A `note` is appended to `message`
  as `[YYYY-MM-DD resolved] note` (there is no notes column).
- `parse_failed`: a file that could not be read, recognized or parsed. If a parser was
  picked there is also a `failed` ingest run; if not (corrupt file, unknown layout) the
  exception has `ingestRunId: null` and `sourceId` = the requested source or `null`.
- Demo reset wipes facts (ingest runs, orders, money lines, items, labor hours, exceptions
  without a close) and reloads the synthetic seed. Close tables are untouched.

```ts
export type ExceptionKind = "missing_source" | "parse_warning" | "parse_failed"
  | "reconcile_mismatch" | "unmapped_amount" | "duplicate_file" | "duplicate_order"
  | "unbalanced_document";
export type ExceptionStatus = "open" | "resolved" | "waived";
export interface ExceptionRow {
  id: string; kind: ExceptionKind; sourceId: string | null; sourceName: string | null;
  message: string; owner: string | null; status: ExceptionStatus;
  expectedCents: number | null; actualCents: number | null;
  ingestRunId: string | null; createdAt: string; resolvedAt: string | null;
}
export interface ExceptionsView { rows: ExceptionRow[]; total: number;
                                  countsByKind: Record<string, number> }

export interface IngestRunRow {
  id: string; sourceId: string; sourceName: string; fileName: string;
  period: string | null; businessDate: string | null; periodLabel: string | null;
  status: "parsed" | "parsed_with_warnings" | "failed"; rowCount: number;
  warnings: string[];            // first 20, "row N: message"; failed run → the error
  isSynthetic: boolean; uploadedAt: string;
}
export interface IngestRunsView { rows: IngestRunRow[]; total: number }
```

Money-line amount types that never count as revenue or cost: `statement_payment`
(Goodwill Books control total) and `wallet_refund` (EasyPost payment-log refund; the
shipment report carries the same refund, see `src/sources/shipping_osm_pb_easypost.ts`).

### Scorecard: extended KPIs (additive, 2026-10-03)

`ScorecardView.kpis` now holds the 15 KPIs of slide 35 first (ids unchanged, `group:
"coo15"`), then every other KPI of slides 33-34 (`group: "extended"`). Show the 15 as the
one-page scorecard and the rest as an extended list. Formulas: `docs/kpi-definitions.md`.
Net Margin % now subtracts processing labor too, so its status is `simulated`.

```ts
export interface Kpi {
  // ...existing fields...
  group: "coo15" | "extended";   // NEW
}
export interface CategoryKpiRow {
  category: string;
  revenueCents: number;          // Σ net_cents
  marginCents: number;           // Σ net_cents − shipping charged on paid orders
  units: number;                 // Σ quantity, paid lines
  sellThroughPct: number | null; // synthetic items; null without item data
  aspCents: number | null;       // paid gross / paid units
}
export interface MarketplaceMetricsRow {
  channel: string;
  csat: number | null;           // marketplace's own scale (e.g. 4.8 of 5)
  nps: number | null;            // −100..100
  conversionRate: number | null; // percent (2.4 = 2.4%)
  sellerRating: number | null;
}
export interface ScorecardView {
  // ...existing fields...
  categories: CategoryKpiRow[];               // NEW: every category, sorted by revenue
  marketplaceMetrics: MarketplaceMetricsRow[]; // NEW: empty = awaiting data
}
```

New table `marketplace_metrics` (id, ingest_run_id → ingest_runs cascade, channel →
channels, period `YYYY-MM`, metric `csat | nps | conversion_rate | seller_rating`, value
real, sample_size int null). Units as in `MarketplaceMetricsRow`. A source that loads CSAT/NPS/
conversion writes one row per channel, period and metric.

New optional env var `LABOR_RATE_CENTS_PER_HOUR` (default 1800 = $18.00/h): the loaded
processing labor rate used by Gross Margin %, Net Margin % and Profit per Labor Hour.

## 3. Denis: outputs that leave the app

Denis builds on the same view functions. Nothing reads the database directly outside
`src/lib/views/` and `src/kpis/`.

- Export: `GET /api/export/pulse?date=…&format=csv|xlsx`, `GET /api/export/scorecard?period=…&format=…`
- Monthly report: a print-friendly page (Gabriel's route, Denis's report component), or a
  generated file. Decide together.
- Email: daily pulse (cron `0 11 * * *` UTC) with the export attached and a link to the
  dashboard; monthly scorecard on close. Resend; `CRON_SECRET` guards the cron route.
