# Source docs: summary

One doc per source, using the template in [docs/interfaces.md §1](../interfaces.md). Each doc
tags claims as fact or guess and lists its links. Decisions that apply to all of them:
**Upright is the source of truth for orders** (marketplace files add fees, refunds, payouts and
orders Upright doesn't list), and **every transaction counts as a different customer**.

| Source id | Delivery today (slide 38) | Frequency | Live API? | Feasible this weekend? | Confidence in real format |
|---|---|---|---|---|---|
| [`upright`](upright.md) | Lister → Reports → Paid Order Items → generate, email delivery, save as Excel | any range (daily OK) | **Yes**: Lister Public API `GET app.uprightlabs.com/api/reports/order_items`, token from Settings → Developer | Only if Goodwill makes a token; otherwise fixtures | **High** for columns A–AH (official help text); medium for exact header spelling |
| [`ebay`](ebay.md) | Seller Hub → Performance → Sales → change date → "Download listings sales report" | any range; Seller Hub Reports can be scheduled daily | **Yes**: Sell Fulfillment `getOrders`, Sell Finances `getTransactions` (OAuth) | No (needs Goodwill's eBay consent) | **High** for the Orders report (official 80-column list); **low** for the Listings sales report Goodwill seems to use |
| [`amazon`](amazon.md) | Seller Central → Payments → Reports Repository → request / refresh / download ("payments summary") | any range ≤ 365 days, ~3 h to generate | **Yes**: SP-API Finances `listTransactions`; settlement V2 flat file. Date Range Transaction report is **not** requestable via API | No (needs developer registration + Finance role, can take weeks) | **Medium-high** for Transaction CSV columns; medium for preamble/date format; 2 new 2026 columns |
| [`shopgoodwill`](shopgoodwill.md) | Seller portal → periodic marketplace reports, filter year/month, Period 1 / Period 3 | per period (several per month) | **No** official seller API (use Upright's API for ShopGoodwill orders) | No | **Low** (no public layout; members-only portal). Pacific time zone: medium-high |
| [`goodwill_books`](goodwill_books.md) | Prior-month payment statement, monthly email attachment | monthly only | **No** | No | **Low** (operator known: Goodwill Columbia Willamette; layout unknown) |
| `cashmonkey` | see [docs/sources/cashmonkey.md](cashmonkey.md) | | | | |
| `jewelry` | see [docs/sources/jewelry.md](jewelry.md) | | | | |
| `shipping_osm_pb_easypost` | see [docs/sources/shipping_osm_pb_easypost.md](shipping_osm_pb_easypost.md) | | | | |
| `fedex` | see [docs/sources/fedex.md](fedex.md) | | | | |

## Top parser gaps found (details in each doc, §4)

- **upright:** real headers are `Order Item Price` / `Order Item Subtotal` and `Order Ordered
  At` / `Order Paid At`; the parser's aliases (`price`, `ordered at`) match exactly only, so
  **every real row would be skipped**. Order-level money (cols V–AB, incl. `Refund Amount`) is
  repeated on every item row of a multi-item order.
- **ebay:** Goodwill likely downloads the **Listings sales report** (per listing, no order
  number), not the Orders report the parser needs. The real Orders report has **no** `Order
  Status`, `Refund Amount` or fee columns.
- **amazon:** "payments summary" may be the **Summary PDF** (unparseable); ask for the
  Transaction CSV. Unknown `type` values (e.g. `Shipping Services`) are dropped.
- **shopgoodwill:** all columns are guesses; default time zone should be Pacific, not
  Indianapolis.
- **goodwill_books:** layout is a guess; a PDF attachment would not parse.
