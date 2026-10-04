# Report exports (Denis)

Formatters use PulseView and ScorecardView from src/lib/views/types.ts.
The provider calls Joao's getPulse/getScorecard directly on the server. No HTTP
self-fetch, direct DB read, totals aggregation or KPI formula exists in exports.

## Downloads and UI handoff

- Daily CSV: /api/export/pulse?date=YYYY-MM-DD&format=csv
- Daily XLSX: /api/export/pulse?date=YYYY-MM-DD&format=xlsx
- Monthly CSV/XLSX: /api/export/scorecard?period=YYYY-MM&format=csv (or xlsx)
- Monthly PDF: /api/export/monthly?period=YYYY-MM&format=pdf
- Monthly HTML preview: /api/export/monthly?period=YYYY-MM&format=html

Daily and monthly PDF/XLSX routes use the approved CEO profile package, exactly as
Gmail preparation does. The browser buttons preserve the selected date/month.
Daily also supports `format=pdf`; scorecard supports `format=pdf`; monthly supports
`format=xlsx`. Monthly HTML uses the same layout as its generated PDF.

`DEMO_REPORT_EXPORTS_ENABLED=true` enables browser downloads only for the synthetic
demonstration. Every exported order must match a confirmed synthetic ingest file.
With the flag off, detailed routes require authorized server access. Unknown or
real provenance cannot be downloaded through this demo integration. Filters other
than date/month and format are rejected instead of silently widening the report.

`profile-provider.ts` calls the shared server views; `profile-http.ts` returns the
same package bytes used as email attachments. All three PDF routes include Chromium
in their deployment trace. No deployment or production configuration is activated
by these local changes. Gabriel's only page changes are PDF/XLSX export links and
the replacement of browser printing with a real report download.

The existing UI email button remains a mailto summary, separate from the approved
Gmail demonstration with attachments and from the secured CSV-attachment cron.
CSV and accounting-close exports retain their separate existing contracts.

## CSV and retained legacy formatter contracts

CSV is UTF-8 with BOM, comma-separated, quoted and CRLF terminated. It protects text
against spreadsheet formulas while preserving numeric refunds. Missing raw values
are blank, and display values say missing/awaiting data; zero stays zero.
Daily metadata includes timezone, totals supplied by the view, missing channels,
synthetic status and partial status. Empty channel lists also count as partial.
X-Report-Synthetic and X-Report-Status headers supply the same metadata to email.

Customers are distinct non-cancelled transactions (channel + order ID), and orders
are non-cancelled order lines, as defined in the shared pulse. Neither is recomputed.
Other e-commerce may group several channels, including Goodwill Books.

Scorecard preserves all KPI groups (15 coo15 plus extended), values, previous,
targets, units, essential limitations, statuses and 2027 anchors. Monthly XLSX opens on Scorecard,
with the 15 core indicators first and supporting indicators below, filterable by
Indicator set. Categories, Marketplaces and Sources complete the
aggregate workbook. Rank columns replace an identical ranking copy; Category
Rankings is retained when source lists differ or contain repeated entries.
Sources holds supplied file/source references, currency confirmation and the
reporting requirements. When references are absent, it shows a short source list
and that limitation. Supplied detail adds Transactions and any File Warnings.
Important labor assumptions, buyer exclusions and partial periods stay beside
the affected indicators; no full glossary is generated.
CSV identifies each row with record_type. Category detail includes revenue, margin,
units, sell-through and average price; marketplace detail preserves CSAT, NPS,
conversion and seller rating. The PDF keeps the 15 core indicators; additional measures remain in Excel.

Money is formatted from cents without currency conversion; unit describes raw
amounts and display_unit describes formatted amounts. Unit cents requires safe
integers. Percent values are percentage points: 2.4 means 2.4%; never multiply by
100 or apply Excel's percentage format to that raw value. Monthly Excel stores
normalized percentages as fractions (42.7% = 0.427) and applies percentage
formatting there. The PDF's monthly changes use current minus previous values;
rate changes use percentage points, while annual growth keeps its source period.
CSV retains source-scale values. Excel values beyond 15 significant digits are
text to avoid silent rounding.

The scorecard alone does not provide global dataset provenance; CSV marks
dataset_provenance as unknown. Monthly XLSX uses source references when supplied
and identifies absent source metadata. Status ok means
computable, including on seeded orders, and cannot certify real data. Simulated
statuses and notes are retained; category sell-through uses synthetic item data
under the shared contract. Missing marketplace values remain unavailable.
This management report is separate from Joao's Business Central close exports.

## Verification

Run npm run test:exports, npm run typecheck and npm run build.
Tests are colocated here, preserving Dot's ownership of tests/**.

Historical integration check on main 3b1a62d against Joao's 308 synthetic files ingested
through the real parsers in a fresh, isolated local database: all five download
formats returned 200. Reopened XLSX files preserved
34 KPIs (15 core, 19 extended), 15 categories, raw values and nulls. The October 2
pulse retained Amazon as missing and reported synthetic/partial metadata.
The email handler prepared that same 860-byte CSV in authenticated dry-run mode;
no provider request or real email was sent. This historical check predates the
current package; current PDF/Excel visual QA is described below.

## Monthly package update

The monthly XLSX now uses `src/report/monthly-xlsx.ts`, also called by
`scorecardXlsx`, with the Goodwill visual identity, one consolidated scorecard,
category/marketplace aggregates and a short Sources tab. A full supplied snapshot
adds every normalized order line and its source references; no records
are reconstructed from aggregate totals. Detailed XLSX downloads require authorized
server access (existing CRON_SECRET bearer gate); staff authentication is a handoff
for Joao/Gabriel. Daily formats and CSV columns are unchanged.

The monthly route defaults to a generated PDF; use explicit `format=html` for the
HTML preview. PDF and XLSX use a shared immutable input and version, and the email
preview uses those same attachment bytes. See the monthly package section in the
root README for runtime dependencies, safety limits and pending snapshot/access
integration. No email is sent and no monthly scheduler is added by this work.
