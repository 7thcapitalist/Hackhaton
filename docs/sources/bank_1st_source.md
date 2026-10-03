# 1st Source bank, acct 0101

- What it is: statement. Goodwill's business checking at 1st Source Bank (South Bend). Slide 38
  says "OSM / PB / EasyPost · Shipping amounts · 1st Source acct 0101 · GL 10009" [fact], and the
  shipping research ([shipping_osm_pb_easypost.md](shipping_osm_pb_easypost.md)) concludes the
  month-end shipping figure is most likely read off this statement [guess]. Idea from Ryan.
- How Goodwill gets the data today: online banking statement / activity export [guess].
- Frequency available: daily activity; we use one file per closed month.
- Live API: no public API for a small business account (BAI2 / CSV export or a bank feed
  aggregator) [guess]. Connector: `manual` drop folder `data/inbox/bank_1st_source/` or upload;
  mock = fixture files.
- File format: CSV with a preamble (bank, `Account: BUSINESS CHECKING ****0101`, statement
  period), blank line, header [guess].
- Columns [guess]: `Posting Date`, `Description`, `Transaction Type` (ACH CREDIT, ACH DEBIT,
  BNKDEPOSIT, POS DEBIT, SERVICE CHARGE), `Debit`, `Credit`, `Balance`, `Reference`. A single
  signed `Amount` column is also accepted.
- Money fields: each row → one `money_lines` row (+ = deposit), `bank_account_no` from the
  preamble, memo = description, classified by memo:
  `bank_postage_debit` (EasyPost / Pitney Bowes / USPS refills), `bank_carrier_debit` (OSM, FedEx),
  `bank_carrier_refund` (BNKDEPOSIT FedEx refunds), `bank_marketplace_deposit` (Amazon, eBay,
  ShopGoodwill… payouts), `bank_other_deposit` / `bank_other_withdrawal`.
- **Informational for now**: the close skips these lines and no KPI counts them (amount types are
  distinct from `shipping_label` / `shipping_refund`). Next step: reconcile bank debits against
  the shipping tools and deposits against marketplace payouts.
- Buyer id field: none.
- Gotchas: real memos will differ per payee; adjust the classifier regexes in the parser.
- Confidence: guess. Parser: [src/sources/bank_1st_source.ts](../../src/sources/bank_1st_source.ts).
