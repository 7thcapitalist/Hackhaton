# Open problems

Everything we know is broken, wrong, missing or undecided, as of Sat 2026-10-03 evening.
Checked against `main` at `3b1a62d` plus branch `gabriel/live-data`, with a local database
seeded from `data/fixtures` (`npm run seed`). Numbers are for September 2026 unless noted.

Each item: **what** is wrong, the **evidence**, the **impact**, a suggested **fix**, and an
**owner** (lane from AGENTS.md). Priorities:

- **P0**: blocks the demo. Fix before the Sunday 15:00 soft freeze.
- **P1**: a number on screen is wrong or misleading. Fix or say it out loud in the pitch.
- **P2**: cleanup, gaps and nice-to-haves.

## Status update: Sat 2026-10-03 night (data lane)

What the PRs merged since this list was written changed, for the items owned by or shared with Joao:

| # | Status now | Where |
|---|---|---|
| 1 | Fixed: production Turso seeded with the real salt, workbook baselines and golden snapshot | #24, #28, #36 |
| 4 | Partly: `BUYER_KEY_SALT`, `DEMO_RESET_SECRET` and `OPEN_API_KEY` are set; use a random reset secret before the demo, and check `CRON_SECRET` and the Blob variables | Vercel |
| 5 | By design: revenue = net (gross + shipping charged − refunds − fees); shipping label costs are subtracted in the contribution margin | #34 |
| 6 | Still true: Amazon and eBay order reports carry no category, so ~46% of revenue is "Uncategorized" (flagged in costed margins and the chatbot) | — |
| 7 | Fixed: unknown Amazon types become money lines; the Liquidations case moved to `data/demo-uploads/` | #24, #28 |
| 8 | Fixed: the missing-Supplier row moved to `data/demo-uploads/`; the baseline has 0 warnings | #28 |
| 9 | Decided: "Unique customers" = unique buyers per marketplace (one per transaction when there is no buyer id) | #33 |
| 10 | By design: Amazon's reports have no buyer id, so Amazon is excluded from buyer KPIs and the KPI note says so | #24 |
| 11 | Fixed: no KPI is "simulated" any more (items and labor arrive through sources); targets are still demo values | #38 |
| 12, 13 | Fixed: completeness is per day for daily sources, per period for monthly ones; status `not_due` | #28 |
| 14 | Fixed: rule-handled duplicates are auto-resolved; 0 open exceptions on the baseline | #28 |
| 15 | Fixed: Upright no longer warns for known "other" channels | #24 |
| 16 | Partly: parsers rebuilt to the researched real layouts (docs/sources); ShopGoodwill, Goodwill Books and Jewelry headers still need one real file | #24 |
| 18 | Fixed: `orders.supplier` filled from the Jewelry report | #36 |
| 20 | Improved: Aug–Oct 2025 and Aug–Oct 2026 are loaded (YoY works) | #21 |
| 21 | Fixed: marketplace ratings source (CSAT, NPS, conversion) | #24 |
| 22 | Fixed: daily pulse email (#20); daily pull cron in progress | #20 |
| 24, 26 | Fixed: `/close` page with owned exceptions (resolve/waive), upload history via `getIngestRuns` | #36 |
| 29 | Measured: production seed ~35 s; demo reset ~3 s from the golden snapshot | #28, #36 |

## Summary

| # | Problem | Priority | Owner |
|---|---------|----------|-------|
| 1 | Production database not confirmed seeded | P0 | Joao |
| 2 | `main` still shows the mockup's demo numbers | P0 | Gabriel |
| 3 | Export CSV / XLSX buttons return 404 | P0 | Denis |
| 4 | Vercel env vars not confirmed (salt, reset secret) | P0 | Joao |
| 5 | Revenue includes the shipping the buyer paid | P1 | Joao + team |
| 6 | 46% of orders have no category | P1 | Joao + Ryan |
| 7 | Amazon "Liquidations" row skipped | P1 | Joao |
| 8 | Jewelry row without a Supplier | P1 | Ryan / Goodwill |
| 9 | "Customers" counts transactions, not people | P1 | Team |
| 10 | Repeat buyer rate leaves out Amazon | P1 | Joao |
| 11 | 9 of 15 KPIs are simulated; targets are placeholders | P1 | Team |
| 12 | A marketplace can look "ok" when its own file is missing | P1 | Joao |
| 13 | Month completeness check is wrong for daily files | P1 | Joao |
| 14 | Handled exceptions stay "open" | P2 | Joao |
| 15 | Upright warns about Facebook / Mercari on every file | P2 | Joao |
| 16 | Three parsers guess the file layout | P2 | Ryan + Joao |
| 17 | Cash Monkey: sales channel or bulk buyer? | P2 | Ryan / Goodwill |
| 18 | Jewelry Supplier is read but not stored | P2 | Joao |
| 19 | Order view has no order time | P2 | Joao |
| 20 | KPI view has only two months of history | P2 | Joao |
| 21 | No marketplace metrics (CSAT, NPS, conversion) | P2 | Ryan + Joao |
| 22 | Daily email and cron not built | P2 | Denis |
| 23 | "Export these rows" in the drill-down has no route | P2 | Denis + Gabriel |
| 24 | Exceptions can't be resolved from the UI | P2 | Gabriel |
| 25 | UI triage of warnings matches message text | P2 | Gabriel + Joao |
| 26 | Month-end close and upload history have no screen | P2 | Gabriel |
| 27 | Monthly "due Oct 5" date is an assumption | P2 | Gabriel / Goodwill |
| 28 | Upload limits and source detection | P2 | Joao + Gabriel |
| 29 | Performance on Turso not measured | P2 | Joao + Gabriel |
| 30 | Chart colors fail the accessibility check | P2 | Gabriel |
| 31 | No tests, no CI | P2 | Dot |

---

## P0: blocks the demo

### 1. Production database not confirmed seeded
- **What:** the pages now read the database. On Vercel that is Turso, not the local file.
- **Evidence:** nobody has confirmed `npm run seed` (or `POST /api/demo/reset`) has run against the production Turso database. Demo reset takes about 8 s locally; on Turso it hasn't been timed (PR #21).
- **Impact:** if it's empty, every page shows "No data imported yet". If the reset takes longer than the Vercel function timeout, the reset button fails during the demo.
- **Fix:** seed production from a laptop (`npm run seed` with the Turso URL), open the production URL, and time one demo reset on Turso.
- **Owner:** Joao.

### 2. `main` still shows the mockup's demo numbers
- **What:** the merged UI (PR #22) runs on hard-coded numbers copied from the design. The version that reads the real views is on `gabriel/live-data`, not merged yet.
- **Impact:** the production URL shows $11.1k for Oct 2, not the seeded $4.2k, and drill-downs show invented order rows.
- **Fix:** review and merge the `gabriel/live-data` PR.
- **Owner:** Gabriel.

### 3. Export CSV / XLSX buttons return 404
- **What:** the Daily Pulse buttons link to `/api/export/pulse?date=…&format=csv|xlsx`, the routes agreed in `docs/interfaces.md` §3.
- **Evidence:** `src/app/api/export/`, `src/export/` and `src/report/` don't exist on `main`.
- **Impact:** clicking Export during the demo shows an error page.
- **Fix:** build the two routes, or hide the buttons until they exist.
- **Owner:** Denis.

### 4. Vercel env vars not confirmed
- **What:** `BUYER_KEY_SALT` and `DEMO_RESET_SECRET` must be set in the Vercel project.
- **Evidence:** without the salt, ingest logs "using an insecure dev default for buyer_key" (`src/ingest/ingest.ts`). Without the secret, `/api/demo/reset` returns 503.
- **Impact:** buyer ids are hashed with a public default, and the demo reset doesn't work.
- **Fix:** set both in Vercel and redeploy.
- **Owner:** Joao.

---

## P1: wrong or misleading numbers

### 5. Revenue includes the shipping the buyer paid
- **What:** ingest computes `net = gross + shipping − refund − fee`. "Total E-Commerce Revenue" and the pulse sum `net`, so they include the shipping the buyer paid.
- **Evidence:** September paid orders: gross $133,172, net $150,539. A ShopGoodwill order with $37.00 gross, $13.02 shipping and $2.96 fee is stored with $47.06 net.
- **Impact:** revenue is $17.4k (13%) above gross item sales for September. The cost of the shipping labels is counted in net margin, but not in revenue.
- **Fix:** decide with Goodwill whether revenue should include the shipping the buyer paid. If not, drop shipping from `net` or add a separate field. Either way, write the definition in `docs/kpi-definitions.md` and say it in the pitch.
- **Owner:** Joao (formula), team (decision).

### 6. 46% of orders have no category
- **What:** every Amazon order (1,478), every eBay order (693) and every Cash Monkey order (18) has `category = null`. Only ShopGoodwill, Upright and Jewelry orders have one.
- **Impact:** "Top 10 Categories by Revenue/Margin" and every per-category KPI cover only $93.8k of the $150.4k revenue; Amazon, eBay and Cash Monkey ($56.6k) are left out. The scorecard's "56% of total" label for the top 10 is really 56% of all revenue, not of categorized revenue.
- **Fix:** find whether the Amazon and eBay exports carry a category (Ryan, `docs/sources/`). If not, show "Uncategorized" as its own bar and label the KPIs "categorized orders only".
- **Owner:** Joao + Ryan.

### 7. Amazon "Liquidations" row skipped
- **What:** `amazon_2026-09-24.csv` row 39 has type `Liquidations` ("Liquidation proceeds", $3.10). The parser doesn't know that type and skips the row.
- **Impact:** $3.10 missing from September. It's small here, but in real data liquidations can be large.
- **Fix:** map `Liquidations` in the Amazon parser (probably revenue or an adjustment money line). Treat any unknown type as an error that needs a decision, not a silent skip.
- **Owner:** Joao. This is one of the two real issues left on the Sources page.

### 8. Jewelry row without a Supplier
- **What:** `jewelry_2026-09.csv`: "1 row(s) have no Supplier. Was the Co-Pivot step run?"
- **Impact:** that sale can't be traced to a supplier. It's planted in the fixtures, but the same thing will happen with real files.
- **Fix:** ask Goodwill what the Co-Pivot step is and who runs it. Write the answer in `docs/sources/jewelry.md`.
- **Owner:** Ryan / Goodwill. This is the second real issue on the Sources page.

### 9. "Customers" counts transactions, not people
- **What:** the pulse counts one customer per transaction (Joao, 2026-10-03, `src/lib/views/pulse.ts`), because Amazon has no buyer id.
- **Impact:** "Customers" and "Orders" are almost always the same number (110 and 110 on Oct 2). A COO will ask why.
- **Fix:** rename the metric to "Transactions", or count distinct `buyer_key` where one exists and say Amazon is estimated. Decide before the demo.
- **Owner:** Team (decision), Joao (view), Gabriel (label).

### 10. Repeat buyer rate leaves out Amazon
- **What:** 1,686 September transactions have no buyer id (1,478 Amazon, 208 other) and are left out of the repeat buyer rate.
- **Impact:** 30.6% describes ShopGoodwill, eBay and Upright buyers only.
- **Fix:** keep the KPI note (it already says so) and mention it in the pitch.
- **Owner:** Joao.

### 11. 9 of 15 KPIs are simulated; targets are placeholders
- **What:** every KPI that uses items or labor hours is computed from synthetic data, including all three 2027 anchors (Net Margin, Revenue per Labor Hour, Sell-Through). Labor cost assumes $18.00/h (`LABOR_RATE_CENTS_PER_HOUR`). All 42 KPI targets were seeded by us, not given by Goodwill.
- **Impact:** "on track / off track" is shown against targets nobody at Goodwill set. The cards say "Simulated", but the track pills don't.
- **Fix:** get real targets and a labor rate from Goodwill, or label the targets "illustrative" on the scorecard.
- **Owner:** Team (ask Goodwill), Gabriel (label).

### 12. A marketplace can look "ok" when its own file is missing
- **What:** a pulse row is "ok" if any order landed for its channel that day (`src/lib/views/pulse.ts`). Upright also reports ShopGoodwill orders, but Upright's `config_json.channels` is `["other", "ebay"]`, without `shopgoodwill`.
- **Impact:** if the ShopGoodwill file is missing on a day when Upright reported a few ShopGoodwill orders, the row shows "ok" with a fraction of the real revenue, instead of "Awaiting data".
- **Fix:** decide "missing" from the marketplace's own source file only, or add `shopgoodwill` to Upright's channels and treat Upright-only days as partial.
- **Owner:** Joao.

### 13. Month completeness check is wrong for daily files
- **What:** `checkCompleteness` treats one daily file as covering the whole month (follow-up listed in PR #21).
- **Impact:** a nightly source can show as "received" for a month with missing days.
- **Owner:** Joao.

---

## P2: cleanup, gaps and nice-to-haves

### 14. Handled exceptions stay "open"
- **What:** the import already handles these correctly, but logs each one as an open exception:

  | Count (Aug–Oct) | What | Why it's fine |
  |-------|------|---------------|
  | 443 | Duplicate orders | Upright's copy is kept; each order counts once |
  | 67 | Upright files: "Facebook Marketplace / Mercari mapped to other" | Counted under Other e-commerce |
  | 22 | Shipping: "refund submitted, not yet granted; not counted" | Counted once granted |
  | 1 | Amazon refund for an order from an earlier file | Recorded as a refund |
  | 1 | eBay file uploaded twice | Second copy ignored |

- **Impact:** `getSourceStatus` and `/api/views/sources` mark 7 of 9 sources "warnings" for September (127 open), while the UI shows 2. Denis's exports and emails will disagree with the screen.
- **Fix:** have ingest write these as resolved (or with an `info` severity), so every consumer agrees. Then the UI can drop its own filtering (#25).
- **Owner:** Joao.

### 15. Upright warns about Facebook / Mercari on every file
- **What:** see #14. Listed separately because PR #21 already names it as known noise.
- **Fix:** add Facebook Marketplace and Mercari as channels, or stop warning about known ones.
- **Owner:** Joao.

### 16. Three parsers guess the file layout
- **What:** the Cash Monkey, Jewelry and Goodwill Books parsers say "layout is a guess; confirm with a real attachment". PR #21 also says the parsers need to match the researched real formats (`docs/sources/*.md`), starting with Upright.
- **Impact:** a real file from Goodwill may not parse. The Sources page shows "File format not yet confirmed with a real export" on these tiles.
- **Fix:** get one real (anonymized) export of each from Goodwill and align the parsers.
- **Owner:** Ryan (formats), Joao (parsers).

### 17. Cash Monkey: sales channel or bulk buyer?
- **What:** parser note: "unclear whether Cash Monkey is a sales channel or a bulk buyer". Its orders currently count as e-commerce revenue under "other".
- **Fix:** ask Goodwill. If it's a bulk buyer, it may not belong in e-commerce revenue.
- **Owner:** Ryan / Goodwill.

### 18. Jewelry Supplier is read but not stored
- **What:** "Supplier is read but not stored (no column in orders)".
- **Fix:** add a column if the COO wants jewelry by supplier; otherwise drop the warning.
- **Owner:** Joao.

### 19. Order view has no order time
- **What:** `OrdersView` rows have `businessDate` but no timestamp.
- **Impact:** the drill-down can't show "2:45 PM ET" per order, as the design does. The view also sorts by `orderTs`, which isn't returned.
- **Fix:** add `orderTs` (ISO) to `OrdersView.rows`.
- **Owner:** Joao (view), Gabriel (show it).

### 20. KPI view has only two months of history
- **What:** `getScorecard` returns `value` and `previous` only.
- **Impact:** KPI sparklines are a straight line between two points.
- **Fix:** a `getKpiHistory(kpiId, months)` view, or `history: number[]` on each KPI.
- **Owner:** Joao.

### 21. No marketplace metrics
- **What:** the `marketplace_metrics` table has 0 rows, so CSAT, NPS and conversion are always "awaiting data". They're extended KPIs, not on the 15-KPI scorecard.
- **Fix:** mock data for them, or leave them out of the pitch.
- **Owner:** Ryan + Joao.

### 22. Daily email and cron not built
- **What:** `src/app/api/cron/`, `src/emails/` and the Resend integration don't exist yet. "Email this pulse" opens a pre-filled email in the user's own mail app (`mailto:`) as a stand-in.
- **Owner:** Denis.

### 23. "Export these rows" in the drill-down has no route
- **What:** the design has an "Export these rows" button in the drawer. It's hidden because no route is agreed.
- **Fix:** agree a route (e.g. `/api/export/orders?date=…&channel=…&format=csv`) in `docs/interfaces.md`, then wire it.
- **Owner:** Denis (route), Gabriel (button).

### 24. Exceptions can't be resolved from the UI
- **What:** `PATCH /api/exceptions/:id` exists, but the Sources page only lists issues.
- **Fix:** "Resolve" and "Waive" buttons with an optional note on each open issue.
- **Owner:** Gabriel.

### 25. UI triage of warnings matches message text
- **What:** the Sources page decides "needs action" vs "handled" by matching warning text with regular expressions (`src/app/_lib/data.ts`, `WARNING_RULES`). Anything unmatched is shown as needing action, so nothing is hidden by accident.
- **Impact:** if a message is reworded, the item goes back to "needs action". This is only a stopgap until #14 is fixed.
- **Fix:** a severity or code on each warning, or #14, then delete the rules.
- **Owner:** Gabriel + Joao.

### 26. Month-end close and upload history have no screen
- **What:** `/api/close/[period]` (generate, reconcile, approve, export to Business Central) and `getIngestRuns` exist, but no page uses them. The close was a big part of the problem statement.
- **Fix:** a Close page (journal lines, reconciliation, approve, download) and an upload history list on Sources.
- **Owner:** Gabriel.

### 27. Monthly "due Oct 5" date is an assumption
- **What:** the Sources page says monthly files are due on the 5th of the next month. No data or document says so.
- **Fix:** get the real deadlines from Goodwill and store them per source (e.g. `config_json.dueDay`).
- **Owner:** Gabriel / Goodwill.

### 28. Upload limits and source detection
- **What:** uploads go through `POST /api/ingest`, capped at 4 MB per request (Vercel body limit). The tile's "Upload ShopGoodwill file" button opens the same picker but doesn't send `sourceId`, so detection relies on column headers.
- **Fix:** send `sourceId` from the tile buttons. Check the size of a real month of shipping files.
- **Owner:** Gabriel (sourceId), Joao (limits).

### 29. Performance on Turso not measured
- **What:** each page load runs several views; the layout and Sources page read every ingest run (paged at 500). Locally a page takes 40–450 ms. On Turso over HTTP, with months of files, nobody has measured.
- **Fix:** time the production pages after #1. If slow, add a "date range" view instead of reading all runs, and cache per request.
- **Owner:** Joao + Gabriel.

### 30. Chart colors fail the accessibility check
- **What:** the four marketplace colors from the design fail the palette validator. The two lightest (`#b7bcef`, `#d3d6de`) are hard to tell apart and have low contrast on white.
- **Mitigation now:** legend, tooltip with names, the table above the chart, and 2 px separators between areas.
- **Fix:** darken the 3rd and 4th shades.
- **Owner:** Gabriel.

### 31. No tests, no CI
- **What:** `tests/` and `.github/` don't exist. The only checks are the parser smoke scripts (`npm run check:parsers*`).
- **Fix:** at least: the build passes, every page returns 200 against a seeded database, and pulse totals equal the sum of their order rows.
- **Owner:** Dot.

---

## Pitch and ethics notes

Things to say out loud rather than hide (see `docs/ethics.md`):

- Everything is synthetic. The banner says so on every page.
- Buyer ids are salted and hashed, never stored raw. That depends on #4.
- "Simulated" KPIs and seeded targets (#11) are demo estimates, not Goodwill's numbers.
- The scorecard summary ("What's driving it") is written by fixed rules from the numbers on the page. It is not AI and makes no claims beyond them.
- Missing data is never shown as $0. Totals say how many marketplaces reported.
