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
  customers: number | null;      // distinct buyer_key
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
  status: "received" | "warnings" | "missing";
  lastIngestAt: string | null;
  rowCount: number;
  openExceptions: number;
}
export interface SourceStatusView { period: string; sources: SourceStatus[] }

export interface OrdersView {
  rows: { id: string; channel: ChannelId; sourceId: string; externalOrderId: string;
          businessDate: string; category: string | null; grossCents: number;
          netCents: number; status: string; ingestRunId: string; sourceRow: number }[];
  total: number;
}
```

## 3. Denis: outputs that leave the app

Denis builds on the same view functions. Nothing reads the database directly outside
`src/lib/views/` and `src/kpis/`.

- Export: `GET /api/export/pulse?date=…&format=csv|xlsx`, `GET /api/export/scorecard?period=…&format=…`
- Monthly report: a print-friendly page (Gabriel's route, Denis's report component), or a
  generated file. Decide together.
- Email: daily pulse (cron `0 11 * * *` UTC) with the export attached and a link to the
  dashboard; monthly scorecard on close. Resend; `CRON_SECRET` guards the cron route.
