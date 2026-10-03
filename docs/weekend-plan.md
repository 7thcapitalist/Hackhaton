# Weekend plan: "A month at Goodwill, without the spreadsheets"

Draft for Joao's approval. Built on [goodwill-problem.md](goodwill-problem.md),
[data-contract.md](data-contract.md) and [research.md](research.md). Scope is fixed:
all three asks (nightly pulse, COO scorecard, month-end close to BC) on one data layer.

## 0. Decisions Joao needs to make now (by 1:15 PM)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Accept the data-contract changes in research.md §6 | Yes, apply in the scaffold PR (T1) |
| D2 | BC: file export only, no live BC | Yes; optional BC trial with an @nd.edu email Sat night, Joao only |
| D3 | Revenue definition for the pulse | Interim: gross + shipping − refunds, excl. marketplace tax; config flag. **Customers = number of transactions (confirmed by Amanda)**; she ranks daily sales + customer count as most important, so the pulse is the demo headline |
| D4 | Email provider | Resend free tier, send to Joao's inbox; in-app view is the fallback |
| D5 | AI note model/provider | Claude API, server-side, narrates only computed numbers; cut first |
| D6 | Owner split (§4) and Gabriel's lane | Confirm with Gabriel at 1:00 PM |
| D7 | Who goes to Amanda's office hours | Joao + Denis (Denis takes notes), book slot now |

## 1. Timeline

| When | What | Who |
|---|---|---|
| **Sat 1:00** | Kickoff (10 min): confirm owners, fill AGENTS.md Ownership, book Amanda slot (OFFICE HOURS tab) | all |
| 1:00–2:15 | **T1 scaffold** (Next.js + Drizzle + Turso + schema) → PR → merge. Vercel+Turso integration connected | Claude / Joao |
| 1:00–3:00 | T2 fixture generator (in parallel, pure TS, no DB) | Claude |
| 1:00–3:00 | Office-hours prep sheet, demo script v0, ethics page draft | Denis |
| 1:00–3:00 | UI shell + mock-data pages (against types only) | Gabriel |
| 1:00–3:00 | KPI definitions + KPI engine on in-memory fixtures | Ryan |
| **3:00–4:45** | **Amanda office hours** (15-min slot). Bring: laptop with deployed preview of the pulse + a sample BC journal xlsx; question list (goodwill-problem.md "Open questions"). Ask for one real header row per source. | Joao + Denis |
| 3:00–6:00 | Parsers (Amazon, eBay, ShopGoodwill, Upright first), ingest service, pulse view | Claude, Ryan |
| ~5:00 | Fold Amanda's answers into data-contract.md (small PR) | Joao |
| 6:00–8:30 | Close engine + BC export; scorecard wired to DB; pulse email + cron | Claude, Ryan, Gabriel |
| **Sat 9:00 PM checkpoint** | M1–M3 on `main`, deployed. Cut decisions (§6) | Joao |
| Sat night (optional) | BC trial attempt; fixture tuning | Joao |
| **Sun 11:00** | Checkpoint + standup. Remaining parsers, reconciliation, exceptions UI | all |
| 11:00–1:00 | Feature finish. Amanda/judges office hours at 1:00 if available | all |
| **Sun 1:00–2:00** | Full dry-run of the demo on prod; bug list to Dot | Denis drives, Dot QA |
| **Sun 2:00 checkpoint** | Cut anything not demo-ready | Joao |
| **Sun 2:30–3:15** | **Record demo video** (one take, prod URL). Second take by 3:15 | Joao records, Denis scripts |
| **Sun 3:00** | Soft freeze: bug fixes and polish only | |
| 3:15–3:45 | Slides final, video embedded, "built vs used", sources | Denis + Gabriel |
| **Sun 3:45** | **Submit** at innovationsprintlab.com/go/submit (slides link "anyone with link", repo, built vs used, sources). Don't wait for 4:00 | Joao |
| Sun 4:00 | Code freeze. 4:30 demos | |

## 2. Milestones (critical path first)

| # | Milestone | Done when | Due |
|---|---|---|---|
| **M1** | Scaffold + schema on `main` | `npm run build` passes on Vercel; `npm run db:push` creates all tables in Turso; `/api/health` returns DB ok on prod | Sat 2:30 |
| **M2** | Synthetic fixtures | `data/fixtures/<source>/` for Sept 2026 + 7 daily files; generator seeded and deterministic; messy cases present (list in T2) | Sat 3:30 |
| **M3** | Ingest + 4 parsers + pulse | Upload Amazon/eBay/ShopGoodwill/Upright files in UI → rows in DB → pulse page shows revenue + customers per channel + totals; missing channel shows "missing" | Sat 9:00 |
| **M4** | Close v1 | For 2026-09: journal lines from ≥4 sources, balanced, xlsx download in BC column layout | Sat 9:00 (stretch) / Sun 12:00 |
| **M5** | Scorecard | 15 KPIs + 3 anchors with MoM trend + target; "awaiting data" / "simulated" badges | Sun 12:00 |
| **M6** | Reconcile + exceptions + approval | Compare vs `workbook_baseline`; mismatches → exceptions with owner; Approve button gates export | Sun 1:00 |
| **M7** | Pulse email | Cron route + "Send now" button delivers email to Joao's inbox | Sun 1:00 |
| **M8** | Demo ready | Dry run passes on prod; "Reset demo data" works; video recorded | Sun 3:15 |

## 3. Draft GitHub issues

Labels: `agent:claude` (Claude subagent, branch `joao/claude-<topic>`), `agent:dot`
(Codex QA), `human`, plus area `area:data`, `area:close`, `area:pulse`, `area:scorecard`,
`area:ui`, `area:pitch`, `area:qa`. Priority `p0` (critical path) / `p1` / `p2` (cut first).

Folder ownership (keeps tasks file-disjoint):
`src/db/**`, `src/sources/**`, `src/ingest/**`, `src/close/**`, `scripts/**`, `data/**`
→ Claude/Joao. `src/kpis/**`, `src/ai/**` → Ryan. `src/app/**` pages and
`src/components/**` → Gabriel. `src/lib/views/**` (pure functions returning view data) →
owner named per task. `docs/pitch/**`, `docs/ethics.md`, `docs/demo-script.md` → Denis.
`tests/**`, `.github/**` → Dot.

| ID | Title | Owner / labels | May touch | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| T1 | Scaffold Next.js + Drizzle + Turso + full schema | Claude · agent:claude area:data p0 | repo root config, `src/db/**`, `drizzle.config.ts`, `.env.example`, README | none | Next.js 15 App Router TS; `src/db/schema.ts` = data contract incl. §6 changes; `src/db/client.ts` reads `TURSO_*` (with/without prefix), `file:local.db` locally; `db:push`, `seed` scripts; `/api/health`; builds on Vercel |
| T2 | Synthetic fixture generator (Sept 2026 + 7 nightly days) | Claude · agent:claude area:data p0 | `scripts/gen-fixtures.ts`, `data/fixtures/**`, `data/baseline/**` | none (types only) | Seeded RNG; real header layouts from research.md §2; ~2–5k orders across channels; fake names only; messy cases: Amazon preamble lines, eBay blank line + footer, renamed column, TZ-boundary order, refunds, duplicate file, Upright∩eBay overlap, unmapped fee type, missing source on one night, workbook baseline with one deliberate mismatch; README in `data/fixtures` |
| T3 | Parser framework + header detection + ingest service | Claude · agent:claude area:data p0 | `src/sources/_shared/**`, `src/ingest/**`, `src/app/api/ingest/route.ts` | T1 | `detectHeaderRow`, CSV + XLSX reading, auto-detect source; writes `ingest_runs` with sha256 dedupe, warnings; buyer_key salted hash; unit tests on 2 fixtures |
| T4a | Parsers: Amazon transaction + eBay orders/transactions | Claude · agent:claude area:data p0 | `src/sources/amazon.ts`, `src/sources/ebay.ts` | T2,T3 | Parse fixtures with 0 errors; preamble/footer handled; tax excluded from revenue; tests |
| T4b | Parsers: ShopGoodwill periodic + Upright paid order items | Claude · agent:claude area:data p0 | `src/sources/shopgoodwill.ts`, `src/sources/upright.ts` | T2,T3 | Period label captured; Upright rows mapped to `channel`; overlap with eBay flagged `duplicate_order` |
| T4c | Parsers: FedEx, EasyPost/PB/OSM, Goodwill Books statement, Cash Monkey, Jewelry | Claude · agent:claude area:data p1 | `src/sources/{fedex,shipping,goodwill_books,cashmonkey,jewelry}.ts` | T2,T3 | Produce `money_lines` with correct `amount_type`; FedEx refunds as negative/shipping_refund |
| T5 | Pulse view function + pulse page | view: Ryan; page: Gabriel · area:pulse p0 | `src/lib/views/pulse.ts` (Ryan), `src/app/pulse/**` (Gabriel) | T1 (+T4a/b for real data) | Per channel revenue + distinct customers + totals for a business_date in America/Indiana/Indianapolis; "missing" for absent channel; date picker; each number links to source rows |
| T6 | Pulse email + Vercel cron + "Send now" | Claude · agent:claude area:pulse p1 | `src/app/api/cron/pulse/route.ts`, `src/emails/**`, `vercel.json` | T5 view | `CRON_SECRET` checked; Resend send; HTML matches page; schedule `0 11 * * *` |
| T7 | KPI engine (15 + 3 anchors) | Ryan · human area:scorecard p0 | `src/kpis/**`, `src/lib/views/scorecard.ts`, `docs/kpi-definitions.md` | T1 types | Each KPI: key, formula, data needed, unit; returns value, prior month, MoM %, target, status (`ok`/`awaiting_data`/`simulated`); unit tests on fixtures |
| T8 | Scorecard page (one page, print-friendly) | Gabriel · human area:ui p0 | `src/app/scorecard/**`, `src/components/kpi/**` | T7 | 5 pillars × 3 KPIs + 3 anchors on top; trend arrows/sparkline; badges; prints on one page |
| T9 | AI "what's driving it" note | Ryan · human area:scorecard p2 | `src/ai/**` | T7 | Input = computed KPI JSON only; output cites KPI keys; numbers validated against input (reject note if a number isn't in input); off switch |
| T10 | Close engine: gl_rules × facts → journal lines + AR invoice | Claude · agent:claude area:close p0 | `src/close/**`, seed `gl_rules` | T4a/b (T4c for shipping) | Real codes from slide 38 seeded (GL 40356, Dept 180, V00122, GL 10009, bank 0101) + placeholders flagged; per-document balance check; trace_json per line |
| T11 | BC export (xlsx + csv) | Claude · agent:claude area:close p0 | `src/close/export/**`, `src/app/api/close/[period]/export/route.ts` | T10 | Columns per research.md §1; sheets General Journal / Sales Invoice / Trace; Description ≤50, Doc No ≤20; export blocked unless close `approved` |
| T12 | Reconcile vs workbook baseline + exceptions | Claude · agent:claude area:close p1 | `src/close/reconcile.ts` | T10, T2 baseline | Per source/account diff; mismatches → `exceptions` with owner; tolerance config |
| T13 | Close page: sources checklist, upload, lines, exceptions, Approve, Download | Gabriel · human area:ui p0 | `src/app/close/**`, `src/components/close/**` | T3 API, T10–T12 | 9-source checklist with status; drag-drop upload; exceptions table with owner; Approve (name) → Download enabled |
| T14 | App shell, nav, landing "story" page, Reset demo data button | Gabriel · human area:ui p1 | `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/shell/**` | T1 | Nav Pulse/Scorecard/Close; Goodwill-neutral styling (no Goodwill logo/branding impersonation); "Synthetic data" banner |
| T15 | Demo reset + seed route | Claude · agent:claude area:data p1 | `src/app/api/demo/reset/route.ts`, `scripts/seed.ts` | T1,T2 | Guarded by `DEMO_RESET_SECRET`; restores a known state in <10 s |
| T16 | CI: typecheck, lint, unit tests on PRs | Dot · agent:dot area:qa p0 | `.github/workflows/**`, `tests/**` config | T1 | Runs on every PR; red blocks merge (advisory during crunch) |
| T17 | Prod health watch + preview checks | Dot · agent:dot area:qa p0 | issues/comments only | T1 | After each merge: prod deploy green, `/api/health` ok, smoke pages load; files issue on failure |
| T18 | End-to-end demo test (scripted) | Dot · agent:dot area:qa p1 | `tests/e2e/**` | T5,T13 | Reset → upload 4 fixtures incl. messy one → pulse numbers → close export downloads; runs against prod |
| T19 | Synthetic data review checklist | Denis · human area:pitch p0 | `docs/fixture-review.md` | T2 | Opens each fixture in Excel; checks: no real names/addresses; headers match research.md; messy cases present; totals plausible for a mid-size Goodwill; files issues for problems |
| T20 | Ethics page | Denis · human area:pitch p1 | `docs/ethics.md` | none | Covers approval-before-posting, traceability, buyer hashing, team-level employee metrics, AI-note guardrails, synthetic data; 1 slide's worth |
| T21 | Demo script + storyboard | Denis · human area:pitch p0 | `docs/demo-script.md` | none | Follows §5; timed to 6:30; lists exact clicks and files |
| T22 | Slides (Google Slides) | Denis (+Gabriel) · human area:pitch p0 | Google Slides (link in `docs/pitch/README.md`) | T21 | Outline §5; video embedded; built-vs-used slide; sources slide |
| T23 | Business case slide + pricing | Gabriel (or Ryan) · human area:pitch p1 | `docs/pitch/business-case.md` | research.md §4 | Competitor table, hours saved estimate, pricing, rollout to other Goodwills |

Sequencing: T1 ∥ T2 ∥ T7(types-only) ∥ T14 ∥ T19-prep ∥ T20 ∥ T21 → T3 → T4a ∥ T4b ∥ T5 →
T10 → T11 ∥ T12 ∥ T13 → T6 ∥ T4c ∥ T9 → T18 → video.

## 4. Division of work and Ownership table (PROPOSAL: team still deciding)

This split is a starting point only. The team decides the final lanes; once agreed,
update this table and the Ownership table in AGENTS.md. Tasks below that name a
person are reassigned accordingly.

| Teammate | Handle | Area / owns | Branch prefix |
|---|---|---|---|
| Joao Vitor | joao | Lead, merges, data contract, Amanda liaison, demo recording. Orchestrates Claude: data layer, parsers, close engine, BC export, email/cron | `joao/`, `joao/claude-<topic>` |
| Ryan | ryan | KPIs + scorecard logic, pulse view function, AI note (`src/kpis`, `src/ai`, `src/lib/views/{pulse,scorecard}.ts`) | `ryan/` |
| Gabriel | gabriel | Frontend: app shell, Pulse/Scorecard/Close pages, components. **Confirm at 1:00**; if not frontend, swap to pitch/business case and Claude takes UI | `gabriel/` |
| Denis | denis | Pitch and demo: fixture review, ethics page, demo script, slides, office-hours notes, UI copy polish | `denis/` |
| Dot (Codex) | — | QA: CI, tests, prod/preview health, e2e demo check, demo readiness; works from `agent:dot` issues | `dot/` (via Joao) |

Denis checklist (low risk, high visibility):
- [ ] 1:00 Book Amanda's slot; print/prep question list (top 6 from goodwill-problem.md).
- [ ] 3:00 Office hours with Joao: take notes into `docs/amanda-notes.md`.
- [ ] T19 fixture review as soon as T2 lands.
- [ ] T20 ethics page; T21 demo script; T22 slides.
- [ ] Sun 1:00 drive the dry run, timing each segment.
- [ ] Sun 3:45 submission form checklist (§5).

## 5. Demo video (7:00 hard cut; aim 6:30) and slides

Record on the **production URL**, one take, after "Reset demo data". Banner visible:
"All data synthetic".

| Time | Segment | On screen |
|---|---|---|
| 0:00–0:30 | **Problem in Goodwill's words**: slide 19 quotes ("From manual reporting to management visibility", "A nightly report creates a daily pulse", "From manual month-end close to Business Central integration") + 9 sources → workbook → BC picture | Slide |
| 0:30–1:00 | Our answer in one line: one data layer, three outputs; usable tomorrow with their files, BC and the workbook kept | Diagram slide |
| 1:00–2:15 | **Nightly pulse**: open email in inbox (sent by cron/"Send now"); then app: revenue + customers per marketplace + totals; one channel "missing" (didn't upload) instead of $0; click a number → source rows | Inbox + app |
| 2:15–4:45 | **Month-end close (example 1: clean source)**: checklist of 9 sources; drop Amazon file → parsed. **Example 2: messy file**: eBay export with footer + renamed column → parser warns, maps it, flags; Upright overlap → duplicate flagged to owner. Generate journal → balanced lines with GL 40356 / Dept 180 etc. → reconcile vs workbook → one mismatch exception routed to named owner → Approve → download BC journal xlsx; show it opened in Excel in BC column layout (and pasted into BC if trial worked) | App + Excel |
| 4:45–5:45 | **COO scorecard**: 3 anchors on top (net margin, revenue/labor hour, sell-through), 15 KPIs with trend/target; "simulated" badges on labor/pipeline KPIs; AI note narrating only computed numbers | App |
| 5:45–6:30 | Limits + next steps, honestly: synthetic data; BC via file, API next; their wave plan (slide 42) as our rollout; ethics in 3 bullets | Slide |

Disclose on screen: synthetic data; formats inferred from public docs where we lacked
samples; BC import not live (unless trial works); labor/pipeline data simulated.

Slide outline (Google Slides, anyone-with-link):
1. Title + team. 2. Problem in their words (slide 19). 3. Today: 9 sources → workbook → BC.
4. Our approach: one data layer, three outputs. 5. **Embedded demo video.**
6. How it works (architecture; parsers as config; trace to row). 7. Fits their constraints
(BC stays, workbook as check, Excel-friendly, ~$0–20/mo running cost). 8. Ethics.
9. Business case: no BC/Goodwill-source tool exists; rollout to other Goodwills; pricing.
10. Limits + next steps (wave plan). 11. Built vs used. 12. Sources.

Submission checklist (by 3:45 PM):
- [ ] Slides link set to "anyone with the link can view"; video plays inside slides.
- [ ] GitHub repo link; `main` = demoed build; README has run steps.
- [ ] **Built vs used**: built = parsers, data layer, close engine, BC export, KPI engine,
      UI, fixture generator; used = Next.js, Vercel, Turso, Drizzle, Resend, SheetJS/exceljs,
      Claude API (AI note), AI coding agents (Claude Code, Codex) for development.
- [ ] Sources cited: Goodwill pitch deck, research.md URLs.
- [ ] Repo history starts this weekend (no pre-built code).

## 6. Cut lines

| Checkpoint | If behind on… | Cut |
|---|---|---|
| **Sat 9 PM** | M3 not done | Drop T4c to Sun; pulse in app only (no email); Gabriel pauses scorecard UI to help pulse page |
| | M4 not started | Close limited to Amazon + eBay + ShopGoodwill + FedEx (4 sources, disclosed) |
| **Sun 11 AM** | Close not exporting | Stop scorecard work beyond KPIs with data; everyone on close |
| | Scorecard engine incomplete | Show KPIs we have; rest "awaiting data"; drop AI note (T9) |
| | Email not working | In-app pulse + "this is the email" HTML preview |
| **Sun 2 PM** | Anything not passing dry run | Hide it from the demo path; no new features; record by 2:30 with what works |

Never cut: header detection / messy-file handling, traceability, approval gate, the
"synthetic data" disclosure.

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| No real data or headers | Parsers wrong for their files | Public-doc headers; ask Amanda for one header row per source; header aliases in `config_json` so fixes are config, not code |
| BC format/setup unknown (dimension names, templates, signs) | Export not importable | Column layout from MS docs; template/batch/dept caption configurable; ask Amanda if Department is global dim 1; optional BC trial |
| Scope breadth (3 asks, 9 sources) | Nothing finished | Critical path first (M1–M3); 4 sources deep before 9 shallow; cut lines above |
| Double counting (Upright overlaps eBay/ShopGoodwill) | Wrong pulse numbers in front of Goodwill's judge | `dedupe_key` + revenue authority flag; ask Amanda |
| Vercel/Turso env setup | Prod broken at demo | Joao connects Turso integration in first hour (no prefix); `/api/health`; Dot watches prod after each merge |
| Merge conflicts across 4 people + agents | Lost time | Folder ownership above; schema changes only by Claude/Joao PRs |
| Team skill gaps (Denis beginner, Gabriel unknown) | Idle or risky work | Denis on checklisted pitch/QA tasks; Gabriel lane confirmed at 1:00 with swap option |
| Overclaiming (zeroes Working Evidence) | Score hit | Disclosure slide + on-screen banner; "built vs used" exact |
| Video not recorded in time | No demo | Record by 2:30 Sun; backup take by 3:15; submit 3:45 |
| AI note invents numbers | Ethics + trust | Number validation against computed JSON; cut first if shaky |
