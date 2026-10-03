# Production tracking (donated → identified → sent to e-com)

- What it is: internal. Goodwill's production-tracking system records when an item was donated,
  identified for e-commerce and handed to the e-commerce team [fact: Joao's decision, 2026-10-03].
  Feeds items identified, items sent to e-com, days donation → listing, time to list and the
  unlisted backlog.
- How Goodwill gets the data today: unknown; assumed a scheduled export by email [guess].
- Frequency available: assumed any range; we use one file per month = items in e-commerce custody
  during the month (sent before month end, not sold before month start) [decision].
- Live API: unknown. Connector: `email` drop folder `data/inbox/production_tracking/`; mock =
  fixture files.
- File format: CSV; 2 title lines + a blank line before the header [guess].
- Columns [guess]: `Item Tag` (= the SKU Upright uses; the item id), `Category`, `Donation Site`,
  `Donated`, `Identified for E-Com`, `Sent to E-Com`, `Stage`. Dates `09/30/2026 11:45 PM`
  (Indianapolis).
- Money fields: none.
- Buyer id field: none. No employee or donor data.
- Gotchas: same item ids as Upright inventory, merged by ingest. Items sent but not listed are the
  backlog. If Goodwill's tag differs from the Upright SKU, a mapping column is needed.
- Confidence: guess. Parser: [src/sources/production_tracking.ts](../../src/sources/production_tracking.ts).
