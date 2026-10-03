# Data lane: status report (Saturday, after lunch)

Everything below is on branch **`joao/data-layer`** (draft PR #16). Nothing is on `main`
yet. Read this first, then [joao-database.md](joao-database.md) for the tables and
[joao.md](joao.md) for the plan.

## Where we are

| # | Step | Status |
|---|---|---|
| 1 | Schema (all tables) | ✅ on `main` |
| 2 | Team split + interfaces | ✅ on `main` |
| 3 | Parser contract + shared helpers | ✅ on `joao/data-layer` |
| 4 | Synthetic seed + view functions + 15 KPIs + `/api/views/*` | ✅ on `joao/data-layer` |
| 5 | Ingest pipeline + upload API + missing-source check | ✅ on `joao/data-layer` |
| 6 | Parsers: Amazon, eBay, ShopGoodwill, Upright | ✅ on `joao/data-layer` |
| 7 | Parsers: Cash Monkey, Jewelry, OSM/PB/EasyPost, FedEx, Goodwill Books | ✅ on `joao/data-layer` |
| 8 | Wire all 9 parsers, test end to end | ✅ done (results below) |
| **9** | **You: review, merge #16 to `main`, push schema + seed to production Turso** | **⏭ next** |
| 10 | Run Ryan's fixtures through the parsers, fix column differences | waiting on Ryan |
| 11 | Messy demo cases, honest limits for the pitch | tonight |
| 12 | Month-end close, an optional live API | Sunday, if there's time |

### Follow-up round (running while Joao is at lunch)

| Task | Branch | Merges into |
|---|---|---|
| **A. Month-end close v1:** GL rules (slide 38 facts + marked placeholders) → balanced journal documents → reconcile checks → approve → Business Central Excel/CSV export with a Trace sheet; `getCloseView` for a close page; `/api/close/[period]`; `npm run close` | `joao/claude-close` | `joao/data-layer` |
| **B. Data health + demo:** `getExceptions` and `getIngestRuns` views + routes, `PATCH /api/exceptions/[id]` to resolve, `parse_failed` kind, EasyPost double-count rule, statement total kept out of revenue, `POST /api/demo/reset` | ✅ merged into `joao/data-layer` | — |
| **C. CI for parsers:** GitHub Actions runs typecheck, both parser checks and build on every PR | issue #17 (Dot) | `main` |

After A and B merge, the data lane covers all three of Goodwill's asks on the back end:
the nightly pulse, the monthly scorecard and the month-end close. What's left is
Gabriel's and Denis's screens and outputs on top, plus swapping in Ryan's real layouts.

Checks on the merged branch: `typecheck` ✅ · `build` ✅ (7 API routes) ·
`check:parsers` ✅ (7 samples) · `check:parsers-other` ✅ (8 samples).

## How data flows now

```
file (CSV/XLSX)
  │  POST /api/ingest   or   npm run ingest -- <file>
  ▼
src/ingest/read.ts        file → RawTable (every row, preamble included)
  ▼
src/sources/index.ts      detectParser(): first parser whose accepts() says yes
  ▼
src/sources/<id>.ts       pure parser: find header, map columns, cents, Indiana dates
  ▼
src/ingest/ingest.ts      cleaning + one atomic write:
                           • same file again (sha256)       → ignored, duplicate_file
                           • same order from 2 sources      → kept once, duplicate_order
                             (marketplace report beats Upright, whichever arrives first)
                           • buyer id → salted hash (raw id never stored)
                           • tax kept out of net; net = gross + shipping − refund − fee
                           • warnings → ingest_runs.warnings_json + 1 parse_warning
  ▼
DB: ingest_runs · orders · money_lines · exceptions
  ▼
src/kpis/ + src/lib/views/   getPulse · getPulseSeries · getScorecard · getSourceStatus · getOrders
  ▼
/api/views/*  → Gabriel's pages, Denis's exports and email
```

## End-to-end test (all 15 sample files, fresh database)

| File | Detected as | Result |
|---|---|---|
| amazon_2026-09 | amazon | 12 orders, 4 money lines, 2 warnings (unknown type "Liquidations"; refund for an order not in the file) |
| amazon_2026-10-01 | amazon | 10 orders, 2 money lines (renamed columns handled) |
| ebay_2026-09 / 2026-10-01 | ebay | 14 + 10 orders |
| shopgoodwill_2026-08 / 09 | shopgoodwill | 10 + 15 orders, "Period 3" / "Period 1" captured |
| upright_2026-09 | upright | 15 orders, **3 duplicates caught** (already in the eBay/ShopGoodwill files) |
| cashmonkey, jewelry | cashmonkey, jewelry | 15 + 12 orders (layout is a guess, flagged) |
| fedex, goodwill_books | fedex, goodwill_books | 14 + 28 money lines |
| 4 shipping layouts (EasyPost shipments, EasyPost payment log, Pitney Bowes, OSM) | shipping_osm_pb_easypost | 13 + 4 + 6 + 5 money lines |

Reverse order (Upright first, then eBay and ShopGoodwill): eBay **replaced** 2 Upright rows
and ShopGoodwill replaced 1, because the marketplace's own report wins. Uploading eBay
again returned `duplicate`. The pulse then read the parsed data correctly: Amazon showed
**missing** on a day with no Amazon file.

## Check it yourself (10 minutes)

```bash
git fetch && git switch joao/data-layer
npm install
npm run db:push
npm run check:parsers
npm run check:parsers-other
npm run ingest -- src/sources/__samples__/upright_2026-09.csv
npm run ingest -- src/sources/__samples__/ebay_2026-09.csv
npm run seed
npm run dev
```

`check:parsers` and `check:parsers-other` print what every parser read. Ingesting eBay
after Upright should show "replaced=2". `npm run seed` resets the database to the
synthetic demo data.

Then open:
- <http://localhost:3000/api/views/pulse?date=2026-10-02>: Amazon should be `missing`.
- <http://localhost:3000/api/views/scorecard?period=2026-09>: the 15 KPIs.
- <http://localhost:3000/api/views/sources?period=2026-10>: which sources are in or missing.

Use `npm run db:studio` to browse the tables.

## Files you now own

| Path | What it is |
|---|---|
| `src/db/schema.ts` | all tables (see joao-database.md) |
| `src/sources/types.ts`, `_shared/table.ts` | parser contract, shared helpers |
| `src/sources/_shared/marketplace.ts`, `_other.ts` | helpers each parser agent added (date parsing with time zones, header aliases) |
| `src/sources/<id>.ts` × 9 | one parser per source; **each file starts with a comment block of fact/guess assumptions** |
| `src/sources/__samples__/**` | synthetic sample files (ours; Ryan's go in `data/fixtures/`) |
| `src/sources/index.ts` | parser registry (order = auto-detect priority) |
| `src/ingest/*` | read, ingest/cleaning, config (sources, channels, revenue authority), completeness |
| `src/kpis/*` | 15 KPI formulas, one function each |
| `src/lib/views/*` | the view functions Gabriel and Denis call |
| `src/app/api/ingest`, `src/app/api/views/*` | HTTP routes |
| `scripts/seed*`, `scripts/ingest-file.ts`, `scripts/check-parsers*.ts` | CLI tools |

## Decisions the agents made (you should know these, and confirm with Amanda)

1. **Source of truth for duplicate orders:** the marketplace's own report beats Upright
   (`revenue_authority`: 1 for ShopGoodwill, Amazon, eBay, Cash Monkey and Goodwill Books;
   0 for Upright, Jewelry and shipping).
2. **Revenue = net** = gross + shipping charged − refunds − fees. Tax is never included.
3. **Customers = distinct hashed buyers per channel.** The total is the sum of the channels.
   **Amazon's transaction report has no buyer id**, so Amazon customer counts can't come
   from that file.
4. **The pulse has 4 rows** (ShopGoodwill, Amazon, eBay, Other e-commerce). Goodwill
   Books, Cash Monkey and Jewelry roll up into "Other".
5. **KPI choices:**
   - net margin = (revenue − shipping cost) / revenue, with no labor or overhead yet;
   - growth is month over month (there's no prior-year data);
   - unsold = open listings older than 60 days;
   - repeat buyer = 2 or more orders in the month.
6. **Ops KPIs are "simulated":** items and labor hours are synthetic until Goodwill says
   where that data lives.
7. **Upright is treated as daily** in the seed so "Other" has nightly data. Slide 38 says
   it's a monthly file.
8. **A Goodwill Books `statement_payment` line is a control total:** never add it to
   revenue. Checked: no view or KPI does.
9. **EasyPost shipments vs payment log:** the shipment report is the authority for label
   cost and refunds. Payment-log refunds are stored as `wallet_refund`, which is visible
   for tracing but never summed. **Postage top-ups are not a cost**: they're cash moved
   into the postage wallet, and the labels bought with that cash are already counted.

## Known gaps / risks

- **Layouts are guesses for ShopGoodwill, Cash Monkey, Jewelry, OSM and Goodwill Books.**
  Amazon, eBay, EasyPost and FedEx are partly confirmed from public docs. Expect fixes
  when Ryan's real samples arrive. Parsers use column aliases, so most fixes are one line.
- **Goodwill Books revenue only exists in the seed.** The real statement parser emits
  `money_lines` (sale, fee, payment), not `orders`, so a real Goodwill Books upload won't
  show on the pulse or scorecard yet. The fix is for the parser to also emit one order per
  statement line (channel `goodwill_books`), with the close using those orders and not the
  `sale` money lines. Do it after the close is merged, so the two don't double count.
- `orders` has no Supplier column (Jewelry's "Co-Pivot" step). Add one only if the close
  needs it.
- The seed and the synthetic buyer keys use a fixed salt; real ingest uses `BUYER_KEY_SALT`.
  **Set `BUYER_KEY_SALT` in Vercel.**

## Open questions for Amanda (consolidated)

1. Which report is the source of truth when Upright and eBay/ShopGoodwill both show an order?
2. "Customers": unique buyers or orders? Summed across channels?
3. Revenue: gross, or net of fees and refunds?
4. ShopGoodwill: the real columns, what Period 1 and Period 3 mean, the time zone of End Date, who keeps the buyer premium.
5. eBay "listing sales report" = the Seller Hub Orders report? Where do eBay fees and refunds come from?
6. Amazon "payments summary" = the Date Range report? Can we see a real header?
7. Cash Monkey: a sales channel or a bulk buyer? Real columns?
8. Jewelry: what are "Co-Pivot" and Supplier? Which marketplace sells it (risk of double counting)?
9. Shipping GL 10009: is the source of truth the carrier reports, the EasyPost payment log, or the 1st Source bank statement?
10. FedEx "net BNKDEPOSIT refunds": do refunds come from bank deposits?
11. Goodwill Books statement: format (CSV/XLSX/PDF), fees, payment date and account.
12. Where do labor hours and item timestamps (donated → listed → sold) live?

## Your next 30 minutes

1. Skim this report and [joao-database.md](joao-database.md).
2. Run "Check it yourself" above, or at least open the Vercel preview of PR #16 and hit
   `/api/health` and `/api/views/pulse?date=2026-10-01`. The preview DB may need
   `db:push` + `seed`.
3. Mark PR #16 ready and merge it to `main` (squash). Then tell Gabriel and Denis
   the view functions are on `main`.
4. Production DB:
   ```bash
   npx vercel env pull .env.local
   npm run db:push
   npm run seed
   ```
   Then open `<prod-url>/api/views/pulse?date=2026-10-02`.
5. Send Ryan the Amanda questions above. When his fixtures land, run them with
   `npm run ingest -- data/fixtures/<id>/<file>` and we'll fix whatever differs.
