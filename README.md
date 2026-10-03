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
| File parsing | SheetJS / exceljs for CSV and XLSX exports |
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
npm run seed      # stub for now: prints row counts per table
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
| `npm run seed` | Load demo data (stub until the fixtures task lands) |

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

## Daily pulse email

`GET /api/cron/pulse` fetches `GET /api/export/pulse?date=YYYY-MM-DD&format=csv`,
attaches that CSV unchanged, and links to `/pulse?date=YYYY-MM-DD`. No database reads,
KPI formulas, mock data or recalculation are added here. **The export and view APIs
must be deployed first**: they are separate work, so this route returns `503` while
the daily CSV is unavailable instead of reporting a successful send.

The dashboard link follows the agreed `/pulse` route. That page is Gabriel's
responsibility and is not present on base main `e28dbf0`; confirm it is deployed
before enabling emails so recipients can open the linked dashboard.

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

## Where to read next

- [AGENTS.md](AGENTS.md): team rules, branches, PRs, who owns what
- [CONTEXT.md](CONTEXT.md): event, schedule, judging criteria
- [docs/goodwill-problem.md](docs/goodwill-problem.md): the problem and definition of done
- [docs/data-contract.md](docs/data-contract.md): database schema and data shapes
- [docs/weekend-plan.md](docs/weekend-plan.md): timeline, milestones, tasks
- [docs/research.md](docs/research.md): source file formats and platform notes
