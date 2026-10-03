# Mission Control · SprintHack@ND 2026

## Setup

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
