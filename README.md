# Mission Control · SprintHack@ND 2026

**A month at Goodwill, without the spreadsheets.** One data layer for Goodwill Michiana's
online sales that powers three things: a nightly sales pulse, a monthly COO scorecard
and a month-end close export for Business Central.

## Tech stack

| Layer | Choice |
|-------|--------|
| App | Next.js 15 (App Router, TypeScript) |
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
npm run seed      # deterministic synthetic data, 2026-08-01..2026-10-03 (wipes + reloads facts)
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
| `npm run seed` | Wipe and reload deterministic synthetic data (sources, channels, KPI targets, orders, money lines, items, labor hours, exceptions) for 2026-08-01..2026-10-03 |
| `npm run ingest -- <file...> [--source id] [--period YYYY-MM]` | Parse export files and write clean rows to the database (same pipeline as `POST /api/ingest`) |
| `npm run ingest -- --check <YYYY-MM or YYYY-MM-DD>` | List sources with no file for that period/day and record `missing_source` exceptions |
| `npm run close -- YYYY-MM [--approve <name> [--force]] [--export file.xlsx]` | Month-end close: generate + reconcile the Business Central journal and AR invoice, approve, export. Same as `GET/POST /api/close/YYYY-MM` and `GET /api/close/YYYY-MM/export?format=xlsx (or csv)` |

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

Prefixed names from the Vercel Turso integration (e.g. `STORAGE_TURSO_DATABASE_URL`)
are also accepted. Database code: `src/db/schema.ts` (schema), `src/db/client.ts`
(`getDb()`), `drizzle.config.ts`.

## View functions

Pages, exports and the pulse email read data only through these server-only functions
(`src/lib/views`, types in `src/lib/views/types.ts`). Money is integer cents; dates are
business dates in America/Indiana/Indianapolis. KPI formulas live in `src/kpis/`.

| Function | JSON route | Notes |
|----------|-----------|-------|
| `getPulse(date)` | `/api/views/pulse?date=YYYY-MM-DD` (default yesterday) | Rows per pulse group; a channel with no file that day is `"missing"` with nulls, excluded from totals |
| `getPulseSeries(from, to)` | `/api/views/pulse-series?from=…&to=…` (≤ 366 days) | Same rules, one value per day |
| `getScorecard(period)` | `/api/views/scorecard?period=YYYY-MM` (default last full month) | 15 KPIs; `status` is `ok`, `simulated` (synthetic items/labor) or `awaiting_data` (value null) |
| `getSourceStatus(period)` | `/api/views/sources?period=YYYY-MM` (default this month) | `received` / `warnings` / `missing` per source, open exceptions |
| `getOrders({channel,date,period,limit,offset})` | `/api/views/orders?…` | Drill-down rows with `ingestRunId` + `sourceRow` |
| `getExceptions({status,sourceId,kind,period,limit,offset})` | `/api/views/exceptions?…` | Exceptions inbox + `countsByKind`; resolve with `PATCH /api/exceptions/:id` `{ status, note? }` |
| `getIngestRuns({sourceId,period,limit,offset})` | `/api/views/ingest-runs?…` | Upload history with the first 20 warnings per file |

**Reset demo data:** `curl -X POST -H "x-demo-secret: $DEMO_RESET_SECRET" <url>/api/demo/reset`
wipes uploads and reloads the seed (same code as `npm run seed`, about 1–2 s locally).
Returns 503 until `DEMO_RESET_SECRET` is set in Vercel.

Bad dates or periods return 400. Seeded demo cases: Amazon is `"missing"` on
2026-10-02; Upright has an open duplicate-order exception in 2026-09; month-end sources
(Cash Monkey, Jewelry, shipping, FedEx, Goodwill Books) have no October files yet.

## Where to read next

- [AGENTS.md](AGENTS.md): team rules, branches, PRs, who owns what
- [CONTEXT.md](CONTEXT.md): event, schedule, judging criteria
- [docs/goodwill-problem.md](docs/goodwill-problem.md): the problem and definition of done
- [docs/data-contract.md](docs/data-contract.md): database schema and data shapes
- [docs/weekend-plan.md](docs/weekend-plan.md): timeline, milestones, tasks
- [docs/research.md](docs/research.md): source file formats and platform notes
