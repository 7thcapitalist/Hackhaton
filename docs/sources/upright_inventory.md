# Upright Lister inventory (listed / sold)

- What it is: internal (listing tool). Upright Lister records when each product was listed, by
  whom, at what price, on which marketplace, how often it was relisted and when it sold
  [fact: Joao's decision, 2026-10-03, that listing and sale timestamps come from Upright].
  Feeds listings created, listings per employee, days to sell, sell-through, aged / unsold and
  relisted inventory.
- How Goodwill gets the data today: not on slide 38. Assumed: an inventory / products export from
  Lister, scheduled by email like the Paid Order Items report [guess].
- Frequency available: any time (snapshot); we use one file per month = products on hand during
  the month, state at month end [decision].
- Live API: Upright's Lister Public API is documented for `reports/order_items` only (see
  [upright.md](upright.md)); a products endpoint is not public [guess]. Connector: `email` drop
  folder `data/inbox/upright_inventory/`; mock = fixture files.
- File format: CSV, header on line 1, CRLF [guess].
- Columns [guess]: `Product ID`, `SKU` (= production item tag; the item id), `Title`, `Category`,
  `Status` (Active / Sold), `Marketplace`, `Listed By` (employee pseudonym), `List Price`,
  `Quantity`, `Created At`, `Listed At`, `Sold At`, `Sold Price`, `Relist Count`. Dates
  `9/30/2026 11:45:00 PM` (Indianapolis). Parser aliases: `Custom Label`, `Lister`, `Date Listed`…
- Money fields: list / sold price only. **No revenue** from this file (orders come from the order
  reports).
- Buyer id field: none.
- Gotchas: monthly snapshots repeat an item; ingest **merges by item id** (non-null new value wins,
  null never erases, relist count only grows), so production tracking and this file fill the same
  `items` row. Marketplace → `channel_source_id` (Mercari / Facebook → `upright`).
- Confidence: guess (layout). Parser: [src/sources/upright_inventory.ts](../../src/sources/upright_inventory.ts).
