# Live demo uploads

The seeded baseline is **clean**: every file that is due is there, nothing warns, zero open
exceptions. These five files are the messy cases, to upload **on stage** (Sources page upload,
or `npm run ingest -- data/demo-uploads/<file>`). The seed never ingests them.
`npm run demo:reset` puts the database back to the clean baseline in a few seconds.

They are generated with the fixtures (`npm run mock:generate`, checked by `-- --check`) from
`scripts/mock/demo-uploads.ts`, all for business day 2026-10-02.

| File | Upload | What it shows |
|---|---|---|
| `01_ebay_2026-10-02_reupload.csv` | **twice** | First upload: the eBay export for Oct 2 parses, but its 21 orders are already in from the nightly eBay API pull, so all are dropped as duplicates (auto-resolved, nothing double-counted). Second upload: same bytes → `duplicate_file`, "already ingested … nothing was inserted" (auto-resolved). |
| `02_amazon_2026-10-02_unknown_type.csv` | once | An Amazon transaction of a type the parser does not know (`Liquidations`, $3.10): booked as an adjustment so money is never dropped, and **one open `parse_warning`** for a human to look at. |
| `03_upright_2026-10-02_overlap.csv` | once | Upright lists 6 ShopGoodwill orders that are already in the ShopGoodwill file. Upright is the source of truth for orders, so its rows **replace** the marketplace rows (6 replaced, `duplicate_order` auto-resolved, "kept Upright (revenue authority)"). Revenue does not change. |
| `04_ebay_renamed_columns.csv` | once | The same eBay export with renamed headers (`Order ID`, `Buyer User ID`, `Item Price`, `Order Date`). It is still recognized and parsed (aliases); its orders are already known, so they dedupe. No warning. |
| `05_jewelry_no_supplier.csv` | once | A daily Jewelry Report where one row lost its Supplier: parsed, **one open `parse_warning`** ("1 row(s) have no Supplier"). |

After all five: 2 open exceptions (02 and 05), everything else auto-resolved.
Then `npm run demo:reset` (or POST `/api/demo/reset`) → 0 open again.
