# Jewelry Report

Source id: `jewelry` · Parser: `src/sources/jewelry.ts` (v0.1.0)
Researched 2026-10-03. **Almost everything here is a guess**: there is no public information
about a Goodwill "Jewelry Report" or "Co-Pivot". Tags: **[fact]** = slide text or a linked public
source; **[guess]** = our inference.

- **What it is (slide):** "Jewelry · Jewelry Report · Request report; Co-Pivot populates
  Supplier" (slide 38) [fact]. Slide 41 workstream 2: "automate **Jewelry Supplier
  enrichment**"; slide 40 step 03 "Enrich: **Supplier assignment** · source labels" [fact].
  So the report arrives **without** a usable Supplier and finance adds it by hand.
- **Most plausible interpretation [guess]:**
  - The **Jewelry Report** is a monthly list of **jewelry items sold online** (most likely on
    ShopGoodwill, where Goodwills sell fine/vintage jewelry
    ([ShopGoodwill](https://shopgoodwill.com/help/faqdetail/about-shopgoodwill),
    [goodwill.org](https://www.goodwill.org/shoppers/shop-online/))), which Goodwill has to
    **request** (from the e-commerce/jewelry team or from the platform) rather than download.
  - **"Co-Pivot"** is most likely **Microsoft Copilot in Excel** (a speaker's spelling of
    "Copilot") or an **Excel pivot / lookup** step, used to fill a **Supplier** column per row
    [guess; ask].
  - **Supplier** = where the item came from, used to split revenue in the allocation workbook:
    candidates are (a) the **store / donation site** that sourced it, (b) an **outside vendor**
    for purchased new goods, or (c) a **partner Goodwill or consignor** whose items Goodwill
    Michiana sells and must pay out [guess].
  - Other readings: a precious-metal / scrap-gold sale to a refiner (Supplier = refiner); or a
    report from a third-party jewelry processor [guess, less likely].
- **How Goodwill gets the data today:** "Request report" (someone sends it on request, probably
  by email) [fact for "request"; channel guess].
- **Frequency available:** monthly at close [fact]; daily unknown.
- **Live API:** none known [guess]. If the source is ShopGoodwill, see `docs/sources/shopgoodwill.md`.
- **File format:** probably Excel (XLSX) with title lines and possibly a pivot/total row [guess].
- **Confidence:** **guess** throughout. Ask Amanda.

## Columns (best guess, no evidence)
| Column (guess) | Meaning | Example |
|---|---|---|
| Sale Date / End Date | date sold (auction end) | `09/14/2026` |
| Order ID | marketplace order id | `SG-123456789` |
| Item ID | listing / item number | `204567890` |
| Description / Title | item title | `14K Gold Chain 18in` |
| Category | jewelry sub-category | `Fine Jewelry` |
| Sold Price | hammer/sale price | `245.00` |
| Shipping | shipping charged | `6.95` |
| Fees | platform fee | `24.50` |
| Supplier | **added by Co-Pivot** | `Store 12 - Mishawaka` |

## Money fields and signs [guess]
Sale price = revenue; fees positive costs; returns negative or flagged in a status column.
Buyer id: none expected; if a buyer name/username exists, hash it.

## Gotchas
- **Double counting** [guess, important]: if the jewelry sells on ShopGoodwill (or eBay), those
  sales are already in the ShopGoodwill/eBay files. The Jewelry Report would then be an
  **allocation/enrichment input** (who gets credit), not extra revenue. Needs the marketplace
  order or item id to link.
- If Supplier means a consignor/partner to be paid, this source creates a **payable**, not just
  revenue.
- A pivot export may have subtotal rows per supplier and a grand total row.

## Parser gap (real format vs `src/sources/jewelry.ts`)

**Status (2026-10-03, parser v0.2.0):** 1 **fixed** (rows carry the marketplace channel, from
a Marketplace column or the order-id pattern, plus the marketplace order/item ids, so items
already in the ShopGoodwill/eBay/Upright files are dropped by dedupe: no new revenue) ·
2 **open** (Supplier not stored: needs `orders.supplier` or an enrichment table) · 3 **fixed**
(raw report without Supplier accepted: Supplier column, jewelry name/title, or mostly jewelry
descriptions) · 4 open (a ShopGoodwill-shaped export would still go to the ShopGoodwill
parser) · 5 **fixed** (pivot subtotals "X Total" skipped; items described "Total …" kept) ·
6 ok.
1. **Treated as revenue**: parser emits orders (channel `other`, category Jewelry). If the items
   are already in ShopGoodwill/eBay files, this double counts. It should probably *enrich*
   existing orders (set supplier/category by item id) instead of adding orders.
2. **Supplier not stored** (no column in `orders`), but Supplier is the whole point of the slide
   ("Supplier assignment" in slide 40). Needs `orders.supplier` or an enrichment table.
3. **Recognition**: `accepts()` needs a Supplier column or "jewel" in the file name/title. The
   *raw* requested report (before Co-Pivot) may have neither → unrecognized.
4. If the report is a ShopGoodwill export, its real headers may match the ShopGoodwill parser
   first (FOREIGN list here only blocks `winning bid`, `buyer username`, etc.).
5. Pivot subtotal rows like "Store 12 Total" are only skipped if a cell *starts with* "Total";
   "<name> Total" rows would be read as items. And `isTotalRow` drops any item whose description
   starts with "Total".
6. Category from the file is ignored on purpose (always "Jewelry") (fine).

## Daily acquisition recommendation
Monthly manual upload for now (it is a requested report). If it turns out to be a ShopGoodwill
report filtered to jewelry, derive it from the ShopGoodwill feed (filter category = Jewelry) and
replace "Co-Pivot" with a **Supplier mapping table** (item id or SKU prefix → supplier) that our
app applies automatically. That is the "automate Jewelry Supplier enrichment" deliverable on
slide 41.

## Accounting notes / questions for the accountant
1. Who produces the Jewelry Report and from what system? Can you share one (anonymized)?
2. What is "Co-Pivot": Microsoft Copilot in Excel, a pivot table, or a person/tool name?
3. What does Supplier mean (store, donation site, vendor, partner Goodwill, consignor)? What does
   the allocation workbook do with it (revenue split by department? a payable?)
4. Where is the jewelry sold (ShopGoodwill, eBay, stores)? Are these sales already in those files?
5. Which GL / department does jewelry revenue post to?

## Sources
- `docs/goodwill-problem.md`, slides 38, 40, 41 (Goodwill's deck)
- [ShopGoodwill: what is ShopGoodwill](https://shopgoodwill.com/help/faqdetail/about-shopgoodwill)
- [Goodwill Industries International: shop online](https://www.goodwill.org/shoppers/shop-online/)
- Searches for "Goodwill jewelry report supplier" and "Co-Pivot" returned nothing relevant (2026-10-03).
