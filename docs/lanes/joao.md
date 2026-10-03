# Joao's lane: one clean database for all nine sources

Owner: Joao (with Claude). Lane boundaries are in [AGENTS.md](../../AGENTS.md); the
handoffs are in [interfaces.md](../interfaces.md).

## 1. The problem I am solving

Goodwill Michiana sells online on several marketplaces and pays shipping carriers. Each
of the **nine sources** on slide 38 delivers its data a different way: a portal download,
an emailed attachment, a monthly statement. Each has its own columns, timing and quirks.
Today a person downloads every file, copies numbers into an allocation workbook, and types
entries into Business Central. Nobody sees a daily number. The monthly KPIs take days.

My job is the layer in the middle:

```
9 different files  ──▶  parsers  ──▶  cleaning  ──▶  ONE database  ──▶  KPI formulas + view functions
 (Ryan maps them)        (me)          (me)           (me)               (me)  ──▶ Gabriel's dashboard
                                                                                ──▶ Denis's exports/email
```

If my layer is right, everything downstream is just "call a function and show the result".
If it's wrong (double counting, a missing day shown as $0, tax counted as revenue), every
chart is wrong and Goodwill's finance person will notice in the first minute.

## 2. What "clean" means (my acceptance bar)

| Rule | Why |
|---|---|
| Every row traces back to its file and row number (`ingest_run_id`, `source_row`) | Finance has to trust the number; any figure can be clicked back to its source |
| The same file uploaded twice is ignored (`duplicate_file`) | People re-download files |
| The same order from two sources counts once (`dedupe_key`, `duplicate_order`) | Upright reports eBay and ShopGoodwill orders too |
| Marketplace-collected tax never counts as revenue (`tax_cents`) | It isn't Goodwill's money |
| A channel with no file for a day shows **missing**, not $0 | $0 and "we don't know" are different decisions |
| Days are counted in Indiana time, not UTC | An order at 11:45 PM belongs to that day |
| Buyers are stored only as a salted hash (`buyer_key`) | Privacy; we could still count repeat buyers later (today every transaction is a customer) |
| A renamed column or extra header lines don't break the parser | Real exports are messy |
| Problems become rows in `exceptions` with an owner, never silent | The demo shows that we catch them |

## 3. Pieces of my lane and their status

| # | Piece | Where | Who | Status |
|---|---|---|---|---|
| 1 | Schema (all tables) | `src/db/schema.ts` | Claude | Done, on `main` (PR #11) |
| 2 | Team split + interfaces | `AGENTS.md`, `docs/interfaces.md` | Claude | Done, on `main` (PR #12) |
| 3 | Parser contract + shared helpers | `src/sources/types.ts`, `src/sources/_shared/` | Claude | Pushed: `joao/claude-ingest-contract` |
| 4 | Synthetic seed + 5 view functions + 15 KPI formulas + `/api/views/*` | `scripts/seed*`, `src/lib/views/`, `src/kpis/`, `src/app/api/views/` | agent | Running: `joao/claude-seed-views` |
| 5 | Ingest pipeline: read CSV/XLSX, pick parser, clean, write DB, upload API, missing-source check | `src/ingest/`, `src/sources/index.ts`, `src/app/api/ingest/` | agent | Running: `joao/claude-ingest` |
| 6 | Parsers: Amazon, eBay, ShopGoodwill, Upright | `src/sources/<id>.ts` | agent | Running: `joao/claude-parsers-marketplace` |
| 7 | Parsers: Cash Monkey, Jewelry, OSM/PB/EasyPost, FedEx, Goodwill Books | `src/sources/<id>.ts` | agent | Running: `joao/claude-parsers-other` |
| 8 | Wire parsers into the registry, run Ryan's fixtures end to end | `src/sources/index.ts` | Claude + Joao | After 5–7 and Ryan's fixtures |
| 9 | Production database: push schema + seed to Turso, check `/api/health` on the Vercel URL | — | Joao (needs his Turso/Vercel login) | After 4 merges |
| 10 | Month-end close (GL rules → BC journal file) | `src/close/` | later | Deferred until the pulse, dashboard and reports work |

## 4. Step by step

### Step 1: done while I'm at lunch (agents)
Pieces 4–7 run in parallel. Each agent works in its own worktree and branch, only in its
own files, and must pass typecheck, build and its own check script before reporting.
Claude reviews each result before any PR is opened.

### Step 2: when I'm back (about 30 min of my time)
1. Read Claude's summary: what each agent built, what failed, what was assumed.
2. Approve the PRs in this order (Claude opens them):
   1. **Parser contract** (piece 3): tiny, everything else builds on it.
   2. **Seed + views** (piece 4): this unblocks Gabriel and Denis. Tell them right after.
   3. **Ingest** (piece 5).
   4. **Parsers** (pieces 6 and 7). Claude wires the registry in the same step.
3. Check every Vercel preview before merging: `/api/health` returns ok, and
   `/api/views/pulse?date=2026-10-01` returns numbers.

### Step 3: production database (only I can do it)
```bash
npx vercel env pull .env.local
npm run db:push
npm run seed
```
Then open `<prod-url>/api/health` and `<prod-url>/api/views/pulse?date=2026-10-02`. Amazon
should show `missing`.

### Step 4: connect Ryan's work (when his docs and fixtures land)
For each source Ryan documents in `docs/sources/<id>.md` with files in `data/fixtures/<id>/`:
1. Run `npm run ingest -- data/fixtures/<id>/<file>`.
2. If it fails or a number looks wrong, Claude adjusts that parser's column aliases and
   assumptions. Our parsers were written from public docs, so expect small fixes.
3. When all 9 ingest cleanly, switch the demo from seed data to fixture data
   (`is_synthetic` badge off for those sources).

### Step 5: harden for the demo (Saturday night)
- Run the messy cases on purpose and confirm each becomes an exception, not a wrong
  number: a duplicate upload, an Upright/eBay duplicate, a missing day, a renamed column,
  an order near midnight.
- Give Gabriel an exceptions view if he wants a "data health" panel (`getSourceStatus`
  already exists).
- Write down the limits honestly for the pitch: synthetic data, parsers built from public
  docs, no live APIs yet.

### Step 6: if there's time (Sunday morning)
- Month-end close (piece 10): GL rules from slide 38 → a Business Central journal file.
- One live API connector as an extra (eBay sandbox or EasyPost test mode), if Ryan finds
  it feasible.

## 5. Things I depend on (and what I do meanwhile)

| From | What | Until it arrives |
|---|---|---|
| Ryan | Real column layouts + fixtures per source | Parsers use public docs and their own samples |
| Amanda (Goodwill) | What counts as a customer, gross vs net, the day cutoff, whether Upright covers every channel | Documented defaults: net revenue, one customer per transaction, Indiana midnight, Upright is the source of truth for orders |
| Gabriel, Denis | Nothing. They depend on me | — |

## 6. Open questions to bring to Amanda (via Ryan)

1. "Customers": unique buyers or orders? Summed across channels, or each person once?
2. Revenue: gross, or net of fees and refunds?
3. Which report is the source of truth when Upright and eBay/ShopGoodwill both show an order?
4. What are ShopGoodwill "Period 1" and "Period 3"? What is "Co-Pivot"?
5. Can we see one real header row (anonymized) per source?
