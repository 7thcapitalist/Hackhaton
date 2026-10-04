# Data lane: status report (Saturday night)

Owner: Joao (with Claude). Everything below is merged into `main` unless marked open.
The tables are explained in [joao-database.md](joao-database.md), and the KPI formulas
in [../kpi-definitions.md](../kpi-definitions.md). What is still wrong or undecided is in
[../open-problems.md](../open-problems.md). The Saturday-afternoon version of this report
is in git history.

## What the data lane delivers

```
14 sources ─▶ fake APIs / export files in each platform's real format
           ─▶ 23 parsers (CSV, XLSX, JSON) ─▶ cleaning ─▶ Turso
           ─▶ view functions + 34 KPIs + costs ─▶ dashboard · email · exports · chatbot · close
```

| Piece | State |
|---|---|
| Sources | 9 sales/shipping/statement sources plus 5 operations sources (production tracking, Upright inventory, timekeeping, marketplace ratings, 1st Source bank). Each is pulled at its highest real cadence: daily, except OSM (weekly) and the Goodwill Books statement (monthly) |
| Connectors | Fake APIs in the real response shapes for Upright, eBay, Amazon (Finances) and EasyPost; email/manual drop folders for the rest. Real calls run only when credentials are set (`npm run pull`, `POST /api/connectors/pull`) |
| Cleaning | Upright is the source of truth for duplicate orders; rule-handled duplicates are auto-resolved; tax is never revenue; buyers are hashed; days are in Indiana time; a missing day shows "missing", not $0 |
| Mock data | Aug–Oct 2026 daily plus Aug–Oct 2025, calibrated to Goodwill Michiana's Form 990 and real marketplace fees. 0 open issues on the baseline; messy cases for live demos in `data/demo-uploads/` |
| KPIs | 34 KPIs (slides 33–36), all "ok" when computable. "Unique customers" per marketplace. Contribution margin 52.4% for Sep 2026, tied to `getCostBreakdown` |
| Costs | `getCostBreakdown` (P&L view) and `getCostedMargin` (by category or channel, with the allocation method stated) |
| Month-end close | `/close` page following slide 40's six steps: GL rules, then a balanced journal and AR invoice, workbook reconciliation, approval, Business Central export, simulated import and posting, an 8-sheet evidence package, a raw-file archive with signed links, Supplier enrichment |
| Chatbot | OpenAI (Sol) with dashboard tools and guarded read-only SQL, a business context pack, and an accuracy eval passing 16/16 (`npm run eval:chat`) |
| Production | Turso loaded with the real salt, workbook baselines and golden snapshot; Blob store connected |

## Run it

```bash
npm install
npm run db:push
npm run seed
npm run dev
```

| Command | What it does |
|---|---|
| `npm run seed` | Pulls every fixture through the mock connectors and the parsers, then saves the golden snapshot (~20 s locally, ~35 s on Turso) |
| `npm run demo:reset` | Restores the golden snapshot (~3 s). Use it after a live demo |
| `npm run close -- 2026-09 --approve <name> --export out.xlsx` | Month-end close from the command line |
| `npm run eval:chat` | Chatbot accuracy test (~$0.10 per run) |
| `npm run check:parsers` / `-other` / `-api` / `-ops`, `check:costs`, `check:chat-sql` | Smoke checks |

## Demo checklist

1. Run `npm run demo:reset` against production right before the demo.
2. Show the Overview, Pulse and Scorecard pages (all KPIs ok), then ask the chatbot "Why were sales lower yesterday?"
3. Upload a file from `data/demo-uploads/` (see its README) and show the issue it raises.
4. On `/close` for September, run the full flow:
   1. Generate.
   2. Resolve the FedEx workbook difference ($43.18) and waive the 1-cent one.
   3. Reconcile, approve, then export.
   4. Mark it imported, then posted.
   5. Download the evidence package.
5. Reset again afterwards.

## Honest limits (for the pitch)

- All data is mock data calibrated to public benchmarks; nothing is Goodwill's real sales.
- Parsers follow researched real layouts. ShopGoodwill, the Goodwill Books statement and the Jewelry report still need one real file each to confirm.
- 46 of 50 journal lines use placeholder ("TBC") accounts until Goodwill shares its chart of accounts. Business Central import and posting are simulated, and the BC API adapter is a documented stub.
- Labor cost uses an assumed $18/h loaded rate. Overhead is not in the data.

## Open in the data lane

- A daily pull cron that is safe for production (in progress).
- The Archive step showing 6/6 on the seeded data (in progress).
- Real files from Goodwill for the remaining guessed layouts, and their chart of accounts.
