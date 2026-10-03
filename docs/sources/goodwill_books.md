# Goodwill Books

- **What it is:** **GoodwillBooks.com**, a shared marketplace run across a network of
  Goodwills (not Michiana-specific) — Goodwill Industries of Michiana is one of many
  sellers on it. `kind = statement`.
- **How Goodwill gets the data today:** A **monthly email attachment** — a payment/payout
  statement, not a self-serve portal download. Slide 38: *"Prior-month payment
  statement."*
- **Frequency available:** Monthly only — no evidence of daily or on-demand access, since
  it's an emailed statement rather than a dashboard export.
- **Live API:** None — GoodwillBooks.com has no public seller API; only its public
  seller/about pages exist. Not usable this weekend.
- **File format:** Guess — likely a PDF or XLSX statement attached to an email, not a
  clean tabular CSV. May need a different ingestion path (email attachment, not a plain
  upload) and fuzzier header detection than the marketplace CSVs.
- **Columns (guess):** A header block (`Seller`, `Period`, `Payment date`) followed by
  line items: `Order #, SKU/ISBN, Title, Sale Price, Commission/Fee, Net`, then a payment
  total.
- **Money fields:** `Sale Price` = revenue; `Commission/Fee` = fee; `Net` = Sale Price −
  Fee. The statement's **payment total** = the actual payout (money in) — a candidate
  source for a `money_lines` payout row and possibly the AR invoice.
- **Buyer id field:** None — statements are seller-facing, no buyer identity exposed.
- **Gotchas:**
  - Ingestion needs an email-attachment path, not just a file upload, to match how
    Goodwill actually receives this.
  - It's a human-readable statement, not a tidy export — header/line detection will be
    fuzzier than the marketplace CSVs; don't reuse the CSV header-row-finder as-is.
- **Confidence:** Guess, mostly unconfirmed. Links: [GoodwillBooks seller page](https://www.goodwillbooks.com/south-bend-indiana), [about](https://www.goodwillbooks.com/about-us).
