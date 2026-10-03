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

> The app scaffold (task T1 in [docs/weekend-plan.md](docs/weekend-plan.md)) is in
> progress. These commands work once it lands on `main`.

```bash
npm install
cp .env.example .env.local   # set TURSO_DATABASE_URL=file:local.db for local dev
npm run db:push              # create tables
npm run seed                 # load fake demo data
npm run dev                  # http://localhost:3000
```

Env vars (names only, values live in Vercel and `.env.local`, never in git):
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `CRON_SECRET`. See `.env.example`.

## Where to read next

- [AGENTS.md](AGENTS.md): team rules, branches, PRs, who owns what
- [CONTEXT.md](CONTEXT.md): event, schedule, judging criteria
- [docs/goodwill-problem.md](docs/goodwill-problem.md): the problem and definition of done
- [docs/data-contract.md](docs/data-contract.md): database schema and data shapes
- [docs/weekend-plan.md](docs/weekend-plan.md): timeline, milestones, tasks
- [docs/research.md](docs/research.md): source file formats and platform notes
