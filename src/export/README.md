# Report exports (Denis)

Formatters use PulseView and ScorecardView from src/lib/views/types.ts.
The provider calls Joao's getPulse/getScorecard directly on the server. No HTTP
self-fetch, direct DB read, totals aggregation or KPI formula exists in exports.

## Downloads and UI handoff

- Daily CSV: /api/export/pulse?date=YYYY-MM-DD&format=csv
- Daily XLSX: /api/export/pulse?date=YYYY-MM-DD&format=xlsx
- Monthly CSV/XLSX: /api/export/scorecard?period=YYYY-MM&format=csv (or xlsx)
- Printable monthly HTML file: /api/export/monthly?period=YYYY-MM

Gabriel can link to these URLs using the selected day/month. His pages are unchanged.
The HTML file layout is proposed for his review; browser/print QA remains pending.
400 means invalid input; 503 means the shared data is unavailable (check DB setup).
No fake production fallback exists. Use the database setup in the main README.

## Preserved data and units

CSV is UTF-8 with BOM, comma-separated, quoted and CRLF terminated. It protects text
against spreadsheet formulas while preserving numeric refunds. Missing raw values
are blank, and display values say missing/awaiting data; zero stays zero.
Daily metadata includes timezone, totals supplied by the view, missing channels,
synthetic status and partial status. Empty channel lists also count as partial.
X-Report-Synthetic and X-Report-Status headers supply the same metadata to email.

Customers are distinct non-cancelled transactions (channel + order ID), and orders
are non-cancelled order lines, as defined in the shared pulse. Neither is recomputed.
Other e-commerce may group several channels, including Goodwill Books.

Scorecard preserves all KPI groups (15 coo15 plus extended), raw values, previous,
targets, units, notes, statuses and 2027 anchors. XLSX has five sheets: Scorecard,
Categories Revenue, Categories Margin, Category Detail and Marketplace Metrics.
CSV identifies each row with record_type. Category detail includes revenue, margin,
units, sell-through and average price; marketplace detail preserves CSAT, NPS,
conversion and seller rating. HTML separates core and extended indicators.

Money is formatted from cents without currency conversion; unit describes raw
amounts and display_unit describes formatted amounts. Unit cents requires safe
integers. Percent values are percentage points: 2.4 means 2.4%; never multiply by
100 or apply Excel's percentage format to that raw value. Excel values beyond 15
significant digits are text to avoid silent rounding.

The scorecard does not provide global dataset provenance; CSV/XLSX mark
dataset_provenance as unknown. Status ok means
computable, including on seeded orders, and cannot certify real data. Simulated
statuses and notes are retained; category sell-through uses synthetic item data
under the shared contract. Missing marketplace values remain unavailable.
This management report is separate from Joao's Business Central close exports.

## Verification

Run npm run test:exports, npm run typecheck and npm run build.
Tests are colocated here, preserving Dot's ownership of tests/**.

Integration checked against Joao's deterministic seed in a fresh, isolated local
database: all five download formats returned 200. Reopened XLSX files preserved
34 KPIs (15 core, 19 extended), 14 categories, raw values and nulls. The October 2
pulse retained Amazon as missing and reported synthetic/partial metadata.
The email handler prepared that same 856-byte CSV in authenticated dry-run mode;
no provider request or real email was sent. Browser and print QA remain pending.
