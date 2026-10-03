# Report exports (Denis)

Pure formatters consume the `PulseView` / `ScorecardView` shape in
`docs/interfaces.md`. They never query the database, sum totals, or calculate KPIs.
The structural types in `types.ts` are temporary until Joao publishes shared types.

## Daily CSV

`GET /api/export/pulse?date=2026-10-02&format=csv`

CSV is UTF-8 with BOM, comma-separated, quoted, and uses CRLF records. It includes
the business date, timezone, source-provided totals, raw integer cents, decimal money,
customers, orders, missing channels, completeness and synthetic-data status.
Missing values stay blank in raw columns and read `missing` in display columns.
Totals in a partial report describe available data, not proof that every source arrived.
Text formula prefixes are escaped; numeric refunds remain negative numbers.

## Other output formats

- Daily XLSX: `/api/export/pulse?date=2026-10-02&format=xlsx`.
- Monthly CSV/XLSX: `/api/export/scorecard?period=2026-09&format=csv` (or `xlsx`).
- Standalone printable monthly report: `/api/export/monthly?period=2026-09` (HTML file).
  Proposed file format for Gabriel to review; his page layout is unchanged.
  Print/save as PDF in a browser. Browser rendering/print QA is still pending.

ExcelJS writes typed cells, a frozen header and filters. Scorecard XLSX separates
indicators and category rankings; CSV uses a `record_type` discriminator in one table.
Raw values, previous values, targets, units, notes and simulation/availability statuses
are preserved. Money display columns convert cents only; percent scale is unconfirmed,
so percentage values remain raw, without an automatic x100 or Excel percent format.
No fixed count of indicators is enforced: the upstream view supplies the list.
Amounts and fractional metrics beyond Excel's 15-significant-digit limit are text,
avoiding silent rounding.
`unit` describes raw values; `display_unit` describes formatted KPI amounts (currency
units or currency units per hour). Monetary amounts in `cents` must be safe integers.
Empty pulse channel lists are partial even when the supplied totals are zero.
Daily response headers `X-Report-Synthetic` and `X-Report-Status` let the email module
display the same synthetic/partial status as the attached export.

## Dependency on Joao

`getPulse`, `getScorecard` and `/api/views/*` do not exist on base main `e28dbf0`.
For now the HTTP boundary calls the documented JSON routes on a trusted deployment
origin (`REPORTS_VIEW_ORIGIN`, otherwise `https://VERCEL_URL`, or localhost in dev).
It rejects redirects and invalid/mismatched JSON and returns 503 while views are
unavailable. There is no fake production fallback. Replace this boundary with direct
server imports when the shared functions land; formatters will remain unchanged.

Revenue and customer definitions belong to those views. The Goodwill procedure
counts Paid Orders rows, while the draft interface specifies distinct buyers.
The exporter preserves supplied counts; that definition still needs team/partner validation.
No reporting currency is inferred or converted; money is expressed in the view's
reporting currency and raw cents are retained.

## Handoff to Gabriel and QA

Use the download URL in a normal link or button, passing the selected business date.
No page/component owned by Gabriel is changed. Check response status before showing
a successful download; 400 means invalid input, 503 means a missing upstream dependency.

Run `npm run test:exports` and `npm run typecheck`. Tests are colocated in Denis's
folder, preserving Dot's ownership of `tests/**`.
