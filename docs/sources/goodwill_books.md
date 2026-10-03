# Goodwill Books (GoodwillBooks.com)

Researched 2026-10-03. Each claim is tagged **[fact]** (official or reputable source, linked)
or **[guess]**. Links are at the bottom.

**Bottom line: the statement layout is not public.** We know who runs the marketplace and how
the statement arrives (monthly email). Columns are a guess until Amanda forwards one statement.

## Template answers

- **What it is:** GoodwillBooks.com, a used books/media marketplace "powered by a network of
  Goodwill locations across the United States", 1.5M+ items, free standard shipping. **[fact,
  [B1][B2]]** It is **operated by Goodwill Industries of the Columbia Willamette** (Portland,
  OR); the Terms of Use are an agreement with that Goodwill. **[fact, [B3]]** The site sets one
  price per title for all sellers ("dynamically chooses the best price"). **[fact, [B4]]**
  Sales tax "is applied automatically based upon the order's shipping address". **[fact, [B3]]**
  Goodwill Michiana (South Bend) is a seller. **[fact, [B5]]** The Columbia Willamette book
  operation also sells on eBay (store `goodwillbks`) and AbeBooks. **[fact, [B6][B7]]** Whether
  partner Goodwills' items are also syndicated to those marketplaces: **[guess: possible]**.
- **How Goodwill gets the data today (slide 38):** "Prior-month payment statement · Monthly
  email attachment". **[fact, slide 38]** So Columbia Willamette (the operator) pays partner
  Goodwills monthly and emails a statement. **[guess, strong]**
- **Frequency available:** monthly only, for the prior month. **[fact, slide 38]**
- **Live API:** **none public.** The storefront ran on Magento (a Magento build by Watermelon
  Web Works). **[fact, [B8] page title]** Magento has a REST API, but it belongs to the operator,
  not to partner sellers. **[guess]** Not feasible.
- **File format:** unknown (CSV, XLSX or PDF). **[ask]**
- **Columns:** unknown. Our assumed layout: §1.
- **Money fields:** likely sale price, a commission/fee (the network's cut, possibly covering
  free shipping and card processing), net. Tax probably excluded (collected and remitted by the
  operator as marketplace facilitator). **[guess]**
- **Buyer id field:** probably none; partner sellers likely never see buyers. **[guess]** Per
  the decision, customers = distinct order numbers on the statement.
- **Gotchas:** §6.
- **Confidence:** operator, cadence, channel: high. Layout: low.

## 1. The real export

Unknown. Our parser's assumed layout (from `src/sources/goodwill_books.ts`, **[guess]**):

```
GoodwillBooks
Statement Period: 09/01/2026 - 09/30/2026
Payment Date: 10/10/2026
Order #, Order Date, SKU, ISBN, Title, Qty, Sale Price, Commission, Net
GB-110011, 09/03/2026, SKU-4007, 9780000000011, Paperback: Mystery Novel, 1, 6.99, 1.40, 5.59
…
Total Sales, , , , , , 1234.56
Total Commission, …
Adjustments, …
Net Payment, …
```

What a real statement plausibly contains, by analogy with marketplace remittance statements
**[guess]**: per-order lines (order number, date, ISBN/SKU, title, price, fees), returns as
negative lines, a fee summary, and a net payment amount with the payment date/method.

**Ask Amanda:** forward last month's email (attachment + body). Specifically: file type; header
row; whether fees are one commission or several (processing, shipping subsidy); how returns
appear; payment date and the bank account it lands in (to match the 1st Source deposit).

## 2. Live API options

| Option | Status |
|---|---|
| GoodwillBooks seller API | none published **[fact: none found]** |
| Operator's Magento REST API | exists for the operator only **[guess]**; not for partners |
| Upright | GoodwillBooks is **not** in Upright's documented integrations (ShopGoodwill, eBay, Shopify, OfferUp, FB Marketplace, GoodwillFinds) **[fact, docs/research.md §3]**; our Upright sample has a `GoodwillBooks` channel, which is **[guess]** |

**Feasibility:** none for an API. Best automation is email-based (§5).

## 3. JSON shape

N/A.

## 4. Parser gap (src/sources/goodwill_books.ts)

**Status (2026-10-03, parser v0.2.0):** 1 open (PDF) · 2 open (summary-only statement) ·
3 **fixed** (also accepted with a generic name: GWB- order ids, a "payment statement" /
"statement period" preamble with book columns, or ISBN + any fee column) · 4 ok · 5 open ·
6 ok · 7 open (still money lines only; order emission left to the other lane).

The parser is honest about being a guess (it always warns "statement layout is a guess"). Risks
when the real file arrives:

1. **PDF**: if the attachment is a PDF, nothing parses (reader accepts .csv/.tsv/.txt/.xlsx).
   We'd need manual entry of 3–4 totals (sales, fees, adjustments, net payment) — a small
   "statement entry" form would be the pragmatic answer.
2. **Header detection** needs an `Order #`-like column **and** a price-like column
   (`REQUIRED_SETS`). A summary-only statement (no order lines) would fail.
3. **`accepts()`** needs "Goodwill Books" in the file name or preamble, or both ISBN and
   Commission columns. A generic attachment name like `Statement_092026.xlsx` without a
   preamble and without an ISBN column would not be recognized.
4. **Fee sign**: parser assumes Commission is shown positive and subtracts it; if the statement
   shows it negative, `Math.abs` keeps it correct. OK.
5. **Tax**: no tax column handled. If the statement includes tax in Sale Price, revenue is
   overstated. Ask.
6. **Period**: from "Statement Period"/"Period:" preamble, else dominant order-date month. OK.
7. **Upright overlap**: parser emits only money lines (no orders), so no double counting with
   Upright orders, but then Goodwill Books has **no orders/customers** in the pulse unless
   Upright lists them. Decide: emit orders from statement lines (each order # = one customer)
   when Upright doesn't cover the channel.

## 5. Daily acquisition — recommendation

Daily is impossible (monthly statement). Least manual work: an **email forwarding rule** from
Amanda's inbox to an ingest address (e.g. Resend inbound / a dedicated mailbox) that saves the
attachment and calls our upload route. That is a standing mail rule on Goodwill's side, so it
needs their explicit setup and consent. Until then: manual upload once a month.

## 6. Gotchas

- Monthly, for the **prior** month: the September statement arrives in October; the close for
  September waits for it.
- `statement_payment` is a control total; never add it to revenue (already a decision).
- Free shipping to buyers: the seller may bear shipping (label cost or a fee). Don't miss that
  cost in margin.
- The operator is another Goodwill; the payment may be an inter-Goodwill transfer, possibly
  invoiced (slide 39's "AR invoice"?). **[guess]**

## Links

- [B1] GoodwillBooks.com home: https://www.goodwillbooks.com/
- [B2] GoodwillBooks About us: https://www.goodwillbooks.com/about-us
- [B3] GoodwillBooks Terms & Conditions (operator: Goodwill Industries of the Columbia
  Willamette; sales tax): https://www.goodwillbooks.com/term-conditions
- [B4] GoodwillBooks seller pages ("dynamically chooses the best price"):
  https://www.goodwillbooks.com/all-sellers
- [B5] Goodwill Michiana seller page: https://www.goodwillbooks.com/south-bend-indiana
- [B6] GoodwillBooks eBay store: https://www.ebay.com/str/goodwillbks
- [B7] Goodwill Books on AbeBooks (Hillsboro, OR): https://www.abebooks.com/goodwill-books-hillsboro-or-u.s.a/608019/sf
- [B8] Watermelon Web Works, "Goodwill Books: Magento-Powered Integrated Book Retailer":
  https://watermelonwebworks.com/melon_portfolio/goodwill-books-magento-powered-integrated-book-retailer/
