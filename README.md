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
npm run seed      # wipe facts, ingest every mock export in data/fixtures through the parsers
npm run dev       # http://localhost:3000
```

Check the database connection at <http://localhost:3000/api/health>, which returns
`{"ok":true,"db":"ok"}`.

| Script | What it does |
|--------|--------------|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Push `src/db/schema.ts` to the database in `TURSO_DATABASE_URL` |
| `npm run db:studio` | Drizzle Studio (browse the database) |
| `npm run seed [-- --direct\|--staged]` | Wipe facts, upsert config + KPI targets, then ingest every file in `data/fixtures/` (manifest order = upload order) through `ingestFile()`, like real uploads. Only items and labor hours (no source file yet) are inserted directly. Local DB: ingests directly (~13 s); remote Turso: stages in a scratch SQLite file and copies in one transaction |
| `npm run mock:generate [-- --check]` | Render the deterministic mock truth (`scripts/mock/model.ts`: 2026-08-01..2026-10-03 nightly + 2025-08..10 monthly) into each platform's real export layout under `data/fixtures/<source_id>/` (~308 files, ~6.5 MB). `--check` fails if the committed files differ |
| `npm run ingest -- <file...> [--source id] [--period YYYY-MM]` | Parse export files and write clean rows to the database (same pipeline as `POST /api/ingest`) |
| `npm run ingest -- --check <YYYY-MM or YYYY-MM-DD>` | List sources with no file for that period/day and record `missing_source` exceptions |
| `npm run close -- YYYY-MM [--approve <name> [--force]] [--export file.xlsx]` | Month-end close: generate + reconcile the Business Central journal and AR invoice, approve, export. Same as `GET/POST /api/close/YYYY-MM` and `GET /api/close/YYYY-MM/export?format=xlsx (or csv)` |
| `npm run pull -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--mock] [--source id]` | Pull from the connectors (`src/connectors`) and ingest: Amazon SP-API Reports, eBay REST JSON, EasyPost JSON + Reports, drop folders `data/inbox/<source_id>/` for email/manual sources. `--mock` = deterministic responses in the real API shapes, no credentials. Same as `POST /api/connectors/pull` (Bearer `CRON_SECRET`). Status: `npm run pull -- --status` or `GET /api/connectors` |
| `npm run check:parsers` / `check:parsers-other` / `check:parsers-api` | Parser smoke checks on `src/sources/__samples__` (`-api`: JSON API parsers, JSON vs CSV twins, connector mocks) |

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
| `CONNECTORS_MOCK` | `1` = `/api/connectors/pull` uses mock connector data unless the request says otherwise |
| `AMAZON_SP_CLIENT_ID`, `AMAZON_SP_CLIENT_SECRET`, `AMAZON_SP_REFRESH_TOKEN` (optional `AMAZON_SP_MARKETPLACE_ID`, `AMAZON_SP_ENDPOINT`, `AMAZON_SP_REPORT_TYPE`) | Real Amazon SP-API pulls |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN` (optional `EBAY_ENV=sandbox`, `EBAY_MARKETPLACE_ID`) | Real eBay API pulls |
| `EASYPOST_API_KEY` | Real EasyPost pulls (a free test key works) |
| `CONNECTOR_DATA_DIR` | Optional folder holding `inbox/` and `fixtures/` (default `./data`) |

Prefixed names from the Vercel Turso integration (e.g. `STORAGE_TURSO_DATABASE_URL`)
are also accepted. Database code: `src/db/schema.ts` (schema), `src/db/client.ts`
(`getDb()`), `drizzle.config.ts`.

## Daily pulse email

`GET /api/cron/pulse` fetches `GET /api/export/pulse?date=YYYY-MM-DD&format=csv`,
attaches that CSV unchanged, and links to `/pulse?date=YYYY-MM-DD`. No database reads,
KPI formulas, mock data or recalculation are added here. **The shared view functions
and their JSON APIs already exist on main as of `08ada603`.** The daily CSV endpoint
is provided separately by [PR #19](https://github.com/7thcapitalist/Hackhaton/pull/19).
Deploy that export endpoint on the configured trusted origin before enabling emails;
this route returns `503` while the daily CSV is unavailable instead of reporting a
successful send.

The dashboard link follows the agreed `/pulse` route. Gabriel's pulse/dashboard UI
is separate pending work; confirm that page is deployed before enabling emails so
recipients can open the linked dashboard.

Sending is **disabled by default**. Joao must set these names in Vercel (see `.env.example`):

| Name | Purpose |
|------|---------|
| `CRON_SECRET` | Required `Authorization: Bearer <CRON_SECRET>`; missing config fails closed |
| `PULSE_EMAIL_ENABLED` | Only the literal `true` enables sending |
| `PULSE_FROM_EMAIL` | Sender supported by the Resend account/domain (plain address or `Name <address>`) |
| `PULSE_TO_EMAIL` | One configured recipient; request parameters cannot override it |
| `RESEND_API_KEY` | Server-only Resend API key |
| `REPORTS_VIEW_ORIGIN` | Trusted HTTPS app origin used for exports and dashboard links; never derived from request headers |

The origin falls back to `https://<VERCEL_URL>` on Vercel. Local development can use
`http://localhost:3000`; production requires HTTPS. Protected preview deployments may
block the export request and return an error; configure an accessible trusted origin
before enabling emails. Credentials are not forwarded to the export endpoint.

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

**Reset demo data:** `curl -X POST -H "x-demo-secret: $DEMO_RESET_SECRET" <url>/api/demo/reset`
wipes uploads and reloads the demo data through the parsers (same code as `npm run seed`,
staged mode, files rendered in memory; ~8 s locally, not yet timed on Turso).
Returns 503 until `DEMO_RESET_SECRET` is set in Vercel.

Bad dates or periods return 400. Demo cases in the fixtures: no Amazon file for
2026-10-02 (pulse `"missing"`); Upright re-reports some eBay/ShopGoodwill orders every day
(`duplicate_order`, Upright kept); `ebay_2026-09-14_reupload.csv` is an exact duplicate
upload; `ebay_2026-09-15.csv` has renamed columns; an unknown Amazon "Liquidations" row
(2026-09-24); an Amazon refund for an earlier file's order (2026-09-29); 11:45 PM Eastern
orders; month-end sources have no October files yet; 2025-08..10 exist for year-over-year.

## Agent skills

Shared agent skills live in `.agents/skills/` (symlinked into `.claude/skills/` for
Claude Code) and are pinned in `skills-lock.json`: `frontend-design` (Anthropic),
`web-design-guidelines` (Vercel) and `shadcn`. Add more with `npx skills add <repo>`.

## Where to read next

- [AGENTS.md](AGENTS.md): team rules, branches, PRs, who owns what
- [CONTEXT.md](CONTEXT.md): event, schedule, judging criteria
- [docs/goodwill-problem.md](docs/goodwill-problem.md): the problem and definition of done
- [docs/data-contract.md](docs/data-contract.md): database schema and data shapes
- [docs/weekend-plan.md](docs/weekend-plan.md): timeline, milestones, tasks
- [docs/research.md](docs/research.md): source file formats and platform notes
