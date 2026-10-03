# Marketplace ratings (CSAT / NPS / conversion / seller rating)

- What it is: monthly customer and marketplace health numbers per channel, copied from the
  seller dashboards: eBay Seller Hub (performance, traffic → conversion), Amazon Account Health /
  Voice of the Customer, ShopGoodwill and GoodwillBooks feedback [fact: Joao's decision; numbers
  per marketplace are what each dashboard shows]. Feeds the `csat`, `nps` and
  `marketplace_conversion` KPIs (slide 34).
- How Goodwill gets the data today: not on slide 38; assumed someone copies the numbers monthly
  [guess].
- Frequency available: monthly.
- Live API: eBay Analytics API (seller standards, traffic report) and Amazon SP-API could feed
  part of it [fact: they exist]; not wired. Connector `marketplace_ratings`: `api_report` once
  `MARKETPLACE_RATINGS_API_KEY` is set (fails loudly until implemented), else
  `data/inbox/marketplace_ratings/`; mock = fixture files.
- File format: CSV, header on line 1 [decision: our own template].
- Columns: `Month` (YYYY-MM), `Marketplace`, `Seller Rating %`, `CSAT (1-5)`, `CSAT Responses`,
  `NPS` (−100..100), `NPS Responses`, `Conversion Rate %`, `Sessions`. Blank = not reported.
- Money fields: none. Buyer id field: none.
- Gotchas: scales differ per marketplace (stored as reported); `marketplace_metrics` id = source +
  channel + period + metric, so a corrected file replaces values.
- Confidence: guess (values and layout are mock). Parser:
  [src/sources/marketplace_ratings.ts](../../src/sources/marketplace_ratings.ts).
