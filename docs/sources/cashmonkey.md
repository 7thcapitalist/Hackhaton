# Cash Monkey

- **What it is:** Likely **CashMonkey Solutions**, a recommerce / bulk-book(and-media)
  buying platform. **Unconfirmed whether it's a buyer of Goodwill's books and media
  (Goodwill sells to them in bulk) or a listing/sales platform with its own end
  customers.** This flips whether "customers" even applies to this source — top-priority
  open question.
- **How Goodwill gets the data today:** Slide 38: *"Orders · full month; submit/download
  CSV; save as Excel."*
- **Frequency available:** Monthly only — slide 38 says "full month," no evidence of a
  shorter range being used today.
- **Live API:** None found. `cashmonkeysolutions.com` is an institutional site only, no
  developer docs. Not usable this weekend — fixtures only.
- **File format:** XLSX (downloaded as CSV, then re-saved as Excel per the slide 38
  workflow). Columns are a guess.
- **Columns (guess):** `Order ID, Order Date, Item Count, Gross, Fees, Net, Status`.
- **Money fields:** `Gross` = revenue (or payment received, if they're a bulk buyer, not a
  marketplace). `Fees` = fee. `Net` = Gross − Fees.
- **Buyer id field:** Probably none. If CashMonkey is a B2B bulk buyer, there's one
  counterparty (CashMonkey itself), not individual consumers — no `buyer_key` expected for
  this source. Flagging this as an assumption, not a fact.
- **Gotchas:** The single biggest unresolved question of all 9 sources. If it's a bulk
  sale (B2B), it belongs in `money_lines` as a payout, not in `orders` with a customer
  count at all — that's a real branch in how we model it, not just a column guess.
  **Ask Amanda today.**
- **Confidence:** Guess, essentially unconfirmed end to end. Link: [cashmonkeysolutions.com](https://cashmonkeysolutions.com/).
