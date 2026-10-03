# Timekeeping (payroll timecards)

- What it is: internal. Hours worked per employee and day from the payroll / timekeeping system
  (Paylocity- or ADP-style) [fact: Joao's decision; vendor unknown]. Feeds revenue and profit per
  labor hour, listings and sales per employee, and the processing-labor part of net margin.
- How Goodwill gets the data today: unknown; HR can export a timecard report [guess].
- Frequency available: per pay period / any range; we use one file per month.
- Live API: Paylocity and ADP have timecard APIs (OAuth client credentials) [fact, vendor docs];
  not wired. Connector `timekeeping`: `api_report` once `PAYROLL_API_CLIENT_ID` /
  `PAYROLL_API_CLIENT_SECRET` are set (real call not implemented: fails loudly), otherwise the
  `data/inbox/timekeeping/` drop folder; mock = fixture files.
- File format: CSV, header on line 1 [guess].
- Columns [guess]: `Company Code`, `Employee Id` (pseudonym, e.g. `EMP-1003`), `Department`,
  `Job Title`, `Work Date`, `Earning Code` (REG / OT / PTO…), `Hours`. Also accepted: one row per
  day with `Regular Hours` + `Overtime Hours`.
- Money fields: none (labor cost = hours × `LABOR_RATE_CENTS_PER_HOUR`, a KPI assumption).
- Buyer id field: none.
- Rules: only **e-commerce departments** count (department contains "e-commerce" / "ecom");
  only worked codes (REG, OT, DT), not PTO / holiday. Hours summed per employee + day.
- Privacy: employee ids only, never names; a name column is ignored with a warning.
- Gotchas: re-upload safe — `labor_hours` id = source + employee + day, so a resend replaces hours
  instead of adding them.
- Confidence: guess (layout). Parser: [src/sources/timekeeping.ts](../../src/sources/timekeeping.ts).
