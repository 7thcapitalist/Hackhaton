# Profile reports: review and integration

These reports reuse the approved Goodwill PDF styles, embedded official logo,
chart components, PDF renderer and Excel presentation. Five illustrative profiles
select different sections and authorized datasets from one engine. They do not
provision employee accounts or represent an approved Goodwill organization chart.

| Proposed profile | Daily | Monthly | Demo scope |
| --- | --- | --- | --- |
| Controller / Finance Lead | Source readiness, exceptions, revenue cross-check, MTD | Source evidence, reconciliation, actual close state and references | All e-commerce operations |
| COO | Revenue, previous day, MTD, at most two highlights | Three 2027 priorities and 15 core indicators | All e-commerce operations |
| CEO | Revenue, same weekday last week, MTD, at most two highlights | Three 2027 priorities, channel/category context and 15 core indicators; detailed Excel | Synthetic e-commerce demo only; separate grant, no employee access or accounting close |
| E-commerce Director | Reporting groups, prior-day/prior-week inputs, missing sources | Channels, categories, selected operating indicators | All e-commerce operations |
| Marketplace Channel Lead | Returned channel records, prior seven-day mean when available | Channel comparison and category records | ShopGoodwill only |

## Generate the synthetic review packages

From the repository, with Node dependencies already installed and Chrome or Edge
available on Windows:

```powershell
node --import tsx src/report/profile-demo.ts <known-synthetic-demo-origin> <output-directory> 2026-10-03 2026-09 --synthetic-demo
```

The final optional argument selects profiles, for example `finance,channel`.
The origin must be the team's known fictitious-data environment. This CLI only
performs GET requests; it does not seed, ingest, close, approve, export accounting
entries or send mail. Open `index.html` in the output directory. Start with Finance
and compare its purpose with the channel-only samples. The QA JSON files are
sanitized validation inputs, not email attachments.

Each frequency/profile folder contains one real PDF, its corresponding XLSX,
`Email-Preview.html` and a local scoped report preview. The preview link is **not an
authenticated employee dashboard**. It deliberately does not link a restricted
profile to the all-company dashboard. No preview has recipients or a send date.

## Change presentation without changing access

Edit `reportProfiles` in `profiles.ts`: section order (`pages`), selected indicators,
tabs, comparison bases, maximum highlights and subject label are frequency-specific.
The same file holds greeting, opening, optional note and signature. A safe example
is removing the `trend` section or lowering `maxHighlights` within an existing
grant. Numbers and mandatory prototype/scope notices come from the collected data,
not editable email copy.

`demoAccess` is a separate set of **illustrative server-owned grants**. Changing a
title to CEO does not grant access. A new CEO or staff presentation needs a separately
confirmed scope; neither inherits COO or channel-lead access automatically. The
collector rechecks the complete plan before reading. Channel demonstrations call
only the orders view with a channel filter, never global KPI, pulse, source-status,
exception or close views. Buyer identifiers and source archive URLs are excluded.
Workbook panes freeze seven header rows with `topLeftCell=A8`, with no horizontal
split, hidden sheets or hidden data columns.

## Shared export and email path

`collectProfileSnapshot` makes one immutable package input, including period, scope,
generation time and data version. `exportProfilePackage` is the common PDF/XLSX
entry point. `profileEmailPreview` attaches those exact bytes. Download adapters
should call `prepareProfileDownload` with a server-resolved plan; a query parameter
is never authority. There is no cross-profile cache.

The existing daily delivery and legacy organization export routes are preserved.
Profile selection is not yet connected to the application's export buttons. The
new local review downloads use the same files as the attachment previews. The
server integration seam is ready, but real employee-facing routes remain blocked
until João/Gabriel supply verified authorization and appropriately scoped views.

The email payload cap is the existing 38 MB including base64, below the provider's
40 MB limit. Both files must succeed before a package is returned. No truncation is
used to meet the limit. `profileAttemptKey` includes recipient identity, frequency,
period, grant, scope, profile and content version. A future sender still needs a
durable attempt ledger and provider idempotency; the preview is not a send system.
Provider acceptance must never be described as delivery confirmation.

## Data limits and exact dependencies

- **Amanda / João:** confirm actual roles, recipients, organizational/channel
  scopes, selected content, numeric targets and alert thresholds. Source example
  targets remain explicitly unapproved. No real accounts have been assigned.
- **João / Gabriel:** provide authenticated server resolution of those grants and
  a dashboard URL whose underlying queries enforce the same scope. UI profile
  selection alone must not grant access. Do not expose detailed public exports.
- **João:** provide channel-scoped customer and operating metrics, source readiness
  and exception views. Until then, these values are unavailable in channel reports.
  Channel revenue is the labeled sum of returned net order amounts; empty days are
  unknown. A seven-day mean needs seven non-missing days, and does not prove feed
  completeness. Original files are not recreated from normalized records.
- **João:** an atomic scoped snapshot/version would strengthen multi-view
  consistency. Current pagination and before/after checks detect some changes, but
  cannot supply transactional isolation. Both documents always use the same
  collected input. Historical source/exception state is not reconstructed: source
  assessment dates and generation time are labeled separately from report dates.
- **João / accounting owner:** validate the earlier margin change (42.7% to 52.5%)
  against historical cost inputs. Current source values and cost notes are retained;
  the presentation does not recalculate margin. An `exported` close state is not
  evidence of posting in Business Central. Invoice/journal references are evidence
  supplied by the close API, not new accounting operations.
- Monthly examples require a completed calendar period. Reporting an unfinished
  month requires an explicit as-of contract; daily MTD does not imply approved close.

## Validation

```powershell
node --import tsx --test src/report/profile.test.ts src/report/monthly.test.ts src/export/*.test.ts src/emails/*.test.ts
npm.cmd run typecheck
npm.cmd run build
```

Tests use injected synthetic readers and never touch production or send email.
Generated PDFs must also be counted and visually examined page by page; generated
workbooks must be reopened and representative tabs rendered. Build success alone
does not validate appearance, deployed authorization, email delivery or Vercel's
PDF runtime. Approve the documents before any sending, scheduling or deployment.


## CEO presentation demonstration

Select `ceo` in the demo CLI to generate the focused review index. The daily PDF
uses a same-weekday comparison and MTD; the monthly PDF uses three pages for the
executive summary, channel changes/category context and the 15 core indicators.
The matching workbooks retain normalized orders and source-file references with
no buyer details. The CEO grant is a separate synthetic-demo proposal, not a real
employee entitlement, and does not include accounting-close data.

`ceoDemoEmail(package, knownDemoOrigin, documentLinks?)` reuses the shared email template and the
exact exported attachment bytes. It adds period-specific HTTPS dashboard links
for the organization-wide synthetic demo and the full official HTTPS PNG logo.
The previous sent Gmail revision retained a CID reference but lost its inline image;
the HTTPS source survives draft editing. PDF/XLSX still embed their offline logos.
Optional `documentLinks: { pdf, xlsx }` must contain absolute HTTPS URLs to the exact
attachment files. The caller must verify recipient access; the generator neither
hosts files nor grants access. Both filenames become links, including in plain text.
Without supplied links, delivered emails retain attachment labels rather than
inventing recipient-specific Gmail URLs. Local previews retain relative file links.
It cannot be used for a restricted channel profile and never sends mail itself.
The authorized presentation test was sent manually through Denis's connected
Gmail account. This does not configure Resend or activate the daily cron, monthly
scheduling, employee routing or production permissions.


### Frontend-aligned CEO revision (October 4, 2026)

The stable project origin is https://hackhaton-eight.vercel.app (GitHub repository
homepage; verified against the successful production deployment). The demonstration
email links use this origin with the exact report date/period. The CEO salutation
is Debie Coble, confirmed at https://goodwill-ni.org/excel-center/; this does not
select her as a recipient or imply real employee permissions.

PDFs use the deployed frontend's light palette and embedded OFL Figtree/Barlow
Condensed Latin fonts; font licenses are in `frontend-fonts-OFL.txt`. Existing
Goodwill logo assets and print-friendly pages are retained. Excel uses the same
light palette and portable Arial text rather than requiring custom installed fonts.
Email layout uses nested presentation tables and 32px cell padding because Gmail
removed the earlier semantic main wrapper. The actual Gmail-stored draft HTML was
read back to verify retained padding, dated links and attachment metadata.

For a daily report with dated source files, if every successful file arrived before
the business day ended in Indianapolis, it is labeled partial and complete-day
deltas are withheld. Prior amounts remain labeled references in Excel. This uses
source-file timing, as the frontend does; it is not accounting-close approval.
No KPI formula or shared view was changed. The CEO daily PDF shows the source
order count separately from normalized line records and marketplace revenue mix.

### Application downloads share the email package

`profile-provider.ts` composes existing server views for the fixed, approved CEO
demonstration profile. `export/profile-http.ts` selects PDF/XLSX/HTML from the same
`exportProfilePackage` used for Gmail preparation. Application links retain the
selected date/month; Scorecard no longer substitutes browser printing for the PDF.
The synthetic demo flag and per-order ingest provenance checks are mandatory for
unauthenticated demo downloads. They do not grant employee access. Default mode
continues to require server authorization. Unsupported profile/channel filters
are rejected rather than silently returning all-company data.

The shared order view on older branches omits currency. Organization-wide reports
retain Joao's existing USD confirmation and explicitly note missing per-record
currency; any supplied non-USD currency still fails. Restricted channel reports
retain their stricter per-record currency requirement.
