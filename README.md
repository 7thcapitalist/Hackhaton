# Mission Control · SprintHack@ND 2026

**A month at Goodwill, without the spreadsheets.** One data layer for Goodwill Michiana's
online sales that powers three things: a nightly sales pulse, a monthly COO scorecard
and a month-end close export for Business Central.

## Tech stack

| Layer | Choice |
|-------|--------|
| App | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 (`src/app/globals.css`) |
| Hosting | Vercel. `main` = production (the demo URL), every PR gets a preview |
| Database | Turso (libSQL / SQLite) via Drizzle ORM |
| Email | Resend (nightly pulse) |
| File parsing | papaparse (CSV) and exceljs (XLSX) |
| Report workbooks | ExcelJS (typed cells and separate KPI/category sheets) |
| Scheduling | Vercel Cron, once a day (`0 11 * * *` UTC ≈ 7 AM Eastern) |

## Run it locally

Requires Node 20+ (tested on Node 24).

```bash
npm install

# Env vars: either pull them from Vercel (needs access to the project) ...
npx vercel link
npx vercel env pull .env.local
# ... or work fully offline against a local SQLite file:
cp .env.example .env.local   # TURSO_DATABASE_URL=file:local.db

npm run db:push   # create/update tables (drizzle-kit push; run from a laptop, never in the Vercel build)
npm run seed      # wipe facts, pull every mock export through the mock connectors into ingest, save the golden snapshot
npm run demo:reset  # any time later: back to the seeded state in ~1-2 s (restores the golden snapshot)
npm run dev       # http://localhost:3000
```

Check the database connection at <http://localhost:3000/api/health>, which returns
`{"ok":true,"db":"ok"}`.

| Script | What it does |
|--------|--------------|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:exports` | Tests for report exports, without a database or email delivery |
| `npm run db:push` | Push `src/db/schema.ts` to the database in `TURSO_DATABASE_URL` |
| `npm run db:studio` | Drizzle Studio (browse the database) |
| `npm run seed [-- --direct\|--staged] [--no-golden]` | Wipe facts, upsert config + KPI targets, then pull every file in `data/fixtures/` through the mock connectors (`pullAndIngest({ mock: true })`, month by month) into `ingestFile()`, like real pulls. Every fact (orders, money lines, items, labor hours, marketplace metrics) comes from an ingest run; only config + KPI targets are inserted directly. Local DB: ~20 s; remote Turso: stages in a scratch SQLite file and copies in one transaction. Ends by saving the golden snapshot (below); `--no-golden` skips that |
| `npm run demo:reset` | Restore the golden snapshot into the live tables (one write batch, no rows over the network). ~1.3-2.5 s on a local file. Fails if `npm run seed` never ran against this database |
| `npm run mock:generate [-- --check]` | Render the deterministic mock truth (`scripts/mock/model.ts`: 2026-08-01..2026-10-03 nightly + 2025-08..10 monthly) into each platform's real export layout under `data/fixtures/<source_id>/` (~308 files, ~6.5 MB). `--check` fails if the committed files differ |
| `npm run ingest -- <file...> [--source id] [--period YYYY-MM]` | Parse export files and write clean rows to the database (same pipeline as `POST /api/ingest`) |
| `npm run ingest -- --check <YYYY-MM or YYYY-MM-DD>` | List sources with no file for that period/day and record `missing_source` exceptions |
| `npm run close -- YYYY-MM [--approve <name> [--force]] [--export file.xlsx]` | Month-end close: generate + reconcile the Business Central journal and AR invoice, approve, export. Same as `GET/POST /api/close/YYYY-MM` and `GET /api/close/YYYY-MM/export?format=xlsx (or csv)` |
| `npm run pull -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--mock] [--source id]` | Pull from the connectors (`src/connectors`) and ingest: Amazon SP-API Reports, eBay REST JSON, EasyPost JSON + Reports, drop folders `data/inbox/<source_id>/` for email/manual sources. `--mock` = deterministic responses in the real API shapes, no credentials. Same as `POST /api/connectors/pull` (Bearer `CRON_SECRET`). Status: `npm run pull -- --status` or `GET /api/connectors` |
| `npm run check:parsers` / `check:parsers-other` / `check:parsers-api` / `check:parsers-ops` | Parser smoke checks on `src/sources/__samples__` (`-api`: JSON API parsers, JSON vs CSV twins, connector mocks; `-ops`: production tracking, Upright inventory, timekeeping, marketplace ratings, 1st Source bank) |

### Env vars

Names only. Values live in Vercel project settings and `.env.local`, never in git.
See `.env.example`.

| Name | Used for |
|------|----------|
| `TURSO_DATABASE_URL` | `libsql://…` in Vercel; `file:local.db` for local dev (the default when unset) |
| `TURSO_AUTH_TOKEN` | Turso token (empty for `file:` URLs) |
| `CRON_SECRET` | Protects the daily cron route |
| `RESEND_API_KEY`, `PULSE_TO_EMAIL` | Nightly pulse email |
| `BUYER_KEY_SALT` | Salt for hashed buyer keys (privacy) |
| `DEMO_RESET_SECRET` | Guards the "Reset demo data" route |
| `ANTHROPIC_API_KEY` | Optional AI note on the scorecard |
| `OPENAI_API_KEY` (optional `OPENAI_MODEL`, default `gpt-6-astra`) | Data chat, `POST /api/chat` (503 without the key) |
| `CHAT_DATABASE_URL`, `CHAT_DATABASE_AUTH_TOKEN` | Optional read-only Turso credentials for the chat's `run_sql` tool (falls back to the main DB client) |
| `CONNECTORS_MOCK` | `1` = `/api/connectors/pull` uses mock connector data unless the request says otherwise |
| `AMAZON_SP_CLIENT_ID`, `AMAZON_SP_CLIENT_SECRET`, `AMAZON_SP_REFRESH_TOKEN` (optional `AMAZON_SP_MARKETPLACE_ID`, `AMAZON_SP_ENDPOINT`, `AMAZON_SP_FEED` = `finances` (default) or `reports`, `AMAZON_SP_REPORT_TYPE`) | Real Amazon SP-API pulls |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN` (optional `EBAY_ENV=sandbox`, `EBAY_MARKETPLACE_ID`) | Real eBay API pulls |
| `UPRIGHT_API_TOKEN` (optional `UPRIGHT_API_BASE`, `UPRIGHT_API_TIME_FORMAT=date`) | Real Upright Lister API pulls (without it: the email drop folder) |
| `EASYPOST_API_KEY` | Real EasyPost pulls (a free test key works) |
| `PAYROLL_API_CLIENT_ID`, `PAYROLL_API_CLIENT_SECRET` | Future timekeeping API (not wired; leave empty: the drop folder is used) |
| `MARKETPLACE_RATINGS_API_KEY` | Future marketplace ratings API (not wired; leave empty) |
| `CONNECTOR_DATA_DIR` | Optional folder holding `inbox/` and `fixtures/` (default `./data`) |

Prefixed names from the Vercel Turso integration (e.g. `STORAGE_TURSO_DATABASE_URL`)
are also accepted. Database code: `src/db/schema.ts` (schema), `src/db/client.ts`
(`getDb()`), `drizzle.config.ts`.

## Daily pulse email

`GET /api/cron/pulse` fetches `GET /api/export/pulse?date=YYYY-MM-DD&format=csv`,
attaches that CSV unchanged, and links to `/pulse?date=YYYY-MM-DD`. No database reads,
KPI formulas, mock data or recalculation are added here. The CSV comes from the
export routes in `src/export/` (see [src/export/README.md](src/export/README.md)).
This route returns `503` while the daily CSV is unavailable instead of reporting a
successful send.

The dashboard link follows `/pulse`, added to main in `3b1a62d`. That page currently
reads `src/app/_lib/demo-data`, while the attached CSV comes from the shared backend
views. Before enabling emails, confirm that the UI uses the same business date and
data as the export, so recipients see matching figures when they open the dashboard.

Sending is **disabled by default**. Joao must set these names in Vercel (see `.env.example`):

| Name | Purpose |
|------|---------|
| `CRON_SECRET` | Required `Authorization: Bearer <CRON_SECRET>`; missing config fails closed |
| `PULSE_EMAIL_ENABLED` | Only the literal `true` enables sending |
| `PULSE_FROM_EMAIL` | Sender supported by the Resend account/domain (plain address or `Name <address>`) |
| `PULSE_TO_EMAIL` | One configured recipient; request parameters cannot override it |
| `RESEND_API_KEY` | Server-only Resend API key |
| `REPORTS_VIEW_ORIGIN` | Trusted HTTPS app origin used for exports and dashboard links; never derived from request headers |

On Vercel the origin falls back to `https://<VERCEL_PROJECT_PRODUCTION_URL>`, then
`https://<VERCEL_URL>`. The per-deployment `VERCEL_URL` sits behind Deployment
Protection, so a dry run on a preview needs `REPORTS_VIEW_ORIGIN` set. Local
development can use `http://localhost:3000`; production requires HTTPS. Credentials are not forwarded to the export endpoint.

`vercel.json` schedules `0 11 * * *` UTC: 7 AM during Eastern daylight time and 6 AM
during standard time. The default date is the **previous calendar day** in
`America/Indiana/Indianapolis`, with calendar subtraction across DST changes. Goodwill's
business-day cutoff remains TBC. An authenticated `?date=YYYY-MM-DD` overrides it.

An authenticated `?date=YYYY-MM-DD&dryRun=true` downloads and validates the CSV but
**never contacts Resend**. It works while sending is disabled and does not require
provider credentials. It returns attachment size, dashboard link, date and metadata,
without recipient addresses, credentials or attachment content. This is a dry run of
the email dependency, not a sample-data fallback.

Email labels use `X-Report-Synthetic: true|false` and `X-Report-Status: partial|complete`
from the export response. Missing/invalid metadata stays **unknown**; a partial report
does not present missing channels as zero. The CSV attachment is limited to 1 MiB,
requires a CSV content type and UTF-8, and neither fetch follows redirects. Each network
request has a 10-second timeout. HTML error pages, empty exports, oversized attachments
and provider errors fail explicitly without exposing provider responses or secrets.

This module uses the [Resend REST send API](https://resend.com/docs/api-reference/emails/send-email)
without a new dependency. Success returns HTTP `202`, `status: "accepted"` and the provider
message ID; this **does not guarantee inbox delivery**. An
[idempotency key](https://resend.com/docs/dashboard/emails/idempotency-keys) hashes the complete
payload, keeping retries of the same report/configuration stable for Resend's 24-hour
window. A changed CSV/configuration produces a new key and can send a revised report;
deduplication after 24 hours is not guaranteed.

Run `npm run test:emails` for isolated tests with injected fetch mocks (no real emails),
then `npm run typecheck` and `npm run build`. Sending a real email is an explicit manual
operation after configuring and enabling the provider, not part of these tests.

Monthly email after a close remains a future integration with Joao's close workflow;
this route only sends the daily pulse. Shared-file changes in this lane are limited to
the email test script, README, env-name placeholders and the Vercel cron configuration.

## View functions

Pages, exports and the pulse email read data only through these server-only functions
(`src/lib/views`, types in `src/lib/views/types.ts`). Money is integer cents; dates are
business dates in America/Indiana/Indianapolis. KPI formulas live in `src/kpis/`.

| Function | JSON route | Notes |
|----------|-----------|-------|
| `getPulse(date)` | `/api/views/pulse?date=YYYY-MM-DD` (default yesterday) | Rows per pulse group; a channel with no file that day is `"missing"` with nulls, excluded from totals |
| `getPulseSeries(from, to)` | `/api/views/pulse-series?from=…&to=…` (≤ 366 days) | Same rules, one value per day |
| `getScorecard(period)` | `/api/views/scorecard?period=YYYY-MM` (default last full month) | 34 KPIs: 15 core and 19 extended; `status` is `ok`, `simulated` (synthetic items/labor) or `awaiting_data` (value null) |
| `getSourceStatus(period)` | `/api/views/sources?period=YYYY-MM` (default this month) | `received` / `warnings` / `missing` per source, open exceptions |
| `getOrders({channel,date,period,limit,offset})` | `/api/views/orders?…` | Drill-down rows with `ingestRunId` + `sourceRow` |
| `getExceptions({status,sourceId,kind,period,limit,offset})` | `/api/views/exceptions?…` | Exceptions inbox + `countsByKind`; resolve with `PATCH /api/exceptions/:id` `{ status, note? }` |
| `getIngestRuns({sourceId,period,limit,offset})` | `/api/views/ingest-runs?…` | Upload history with the first 20 warnings per file |

**Reset demo data: seed once, reset from golden.** The full seed is slow (~1000 mock
files through ingest, then ~75k rows copied to Turso), so it runs once from a laptop:
`npm run seed` against the production `TURSO_DATABASE_URL`. It ends by snapshotting the
demo state INSIDE the same database (`src/lib/demo/golden.ts`): every fact table,
`kpi_targets` and the close tables are copied server-side to `golden_<table>` twins
(`CREATE TABLE … AS SELECT *`), with `golden_meta` holding the time and row counts.
A reset then rewrites the live tables from those twins in one write batch (children
deleted first, parents inserted first): only SQL text crosses the wire, never rows.
Config (sources, channels, GL rules) is not touched. Re-run `npm run seed` whenever the
demo data itself changes (new fixtures, parser changes); that refreshes the snapshot.

- `npm run demo:reset` from a laptop, or
- `curl -X POST -H "x-demo-secret: $DEMO_RESET_SECRET" <url>/api/demo/reset` →
  `{ ok, mode: "golden", createdAt, counts, ms }`. 409 if the database has no snapshot yet
  (run `npm run seed` once). `?mode=full` re-runs the whole seed through the parsers and
  saves a new snapshot (local dev only, refused on Vercel; ~40 s).
  Returns 503 until `DEMO_RESET_SECRET` is set in Vercel.

The `golden_*` tables are not in the Drizzle schema; `drizzle.config.ts` excludes them
with `tablesFilter: ["!golden_*"]` so `npm run db:push` never offers to drop them.

Bad dates or periods return 400. The seeded baseline is clean: every source is pulled at its
highest cadence (daily except OSM invoices weekly and Goodwill Books monthly; see
[docs/sources/README.md](docs/sources/README.md)), every due file is there, zero warnings and
zero open exceptions (the seed fails otherwise). Normal cases it keeps: Upright re-reports some
eBay/ShopGoodwill orders every day (`duplicate_order`, Upright kept, auto-resolved); an Amazon
refund for an earlier file's order (2026-09-29); 11:45 PM Eastern orders; Goodwill Books has
no October statement yet (status `not_due`); 2025-08..10 exist (monthly files) for
year-over-year. The messy cases (duplicate upload, unknown Amazon type, Upright overlap,
renamed columns, missing Supplier) are live-demo files in
[data/demo-uploads/](data/demo-uploads/README.md).

## Data chat ("ask anything about the data")

`POST /api/chat` answers questions with the OpenAI Responses API (model `OPENAI_MODEL`,
default `gpt-6-astra`) and a function-calling loop over the same view functions the
dashboard uses (`get_pulse`, `get_pulse_series`, `get_scorecard`, `get_source_status`,
`get_exceptions`, `get_orders`) plus `run_sql`, a guarded read-only SQL tool. Code:
`src/ai/chat/` (agent loop, tools, system prompt, SQL guard).

- Body: `{ messages: { role: "user" | "assistant", content: string }[] }` (plain-text
  history, last one is the user's question, max 20).
- Response: `text/event-stream`, one `data: <json>\n\n` per event: `{type:"text",delta}`,
  `{type:"tool",name,label}`, `{type:"trace",items:[{tool,input,sql?,rowCount?}]}` (once,
  before done), `{type:"error",message}`, `{type:"done"}`.
- 503 without `OPENAI_API_KEY`; 429 above 20 requests/min per IP (in memory); max 8 tool rounds.
- `run_sql` safety: read-only client from `CHAT_DATABASE_URL`/`CHAT_DATABASE_AUTH_TOKEN`
  when set (create a read-only Turso token), one statement, SELECT/WITH only, no
  write/PRAGMA/ATTACH keywords, no `golden_*` tables, wrapped in `LIMIT 500`, 10 s timeout.

```bash
npm run chat -- "Which day of the week do we sell most?"   # streamed answer + trace + cost
npm run chat -- --tools                                     # run every tool directly, no API key
npm run check:chat-sql                                      # SQL guard unit check
```

## Where to read next

- [src/export/README.md](src/export/README.md): CSV/XLSX and monthly report downloads using the shared views

- [AGENTS.md](AGENTS.md): team rules, branches, PRs, who owns what
- [CONTEXT.md](CONTEXT.md): event, schedule, judging criteria
- [docs/goodwill-problem.md](docs/goodwill-problem.md): the problem and definition of done
- [docs/data-contract.md](docs/data-contract.md): database schema and data shapes
- [docs/weekend-plan.md](docs/weekend-plan.md): timeline, milestones, tasks
- [docs/research.md](docs/research.md): source file formats and platform notes
