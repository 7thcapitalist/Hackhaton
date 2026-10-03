# Jewelry report ("Co-Pivot")

- **What it is:** A separate report for jewelry items specifically, split out from general
  merchandise — jewelry is handled, appraised and possibly sourced differently.
- **How Goodwill gets the data today:** Slide 38: *"Jewelry Report... Request report;
  Co-Pivot populates Supplier."* "Request report" implies someone asks for it rather than
  self-serve downloading it from a portal.
- **Frequency available:** Monthly (month-end input only; no evidence it's available more
  often).
- **Live API:** None — nothing public exists for "Co-Pivot." It may be an internal tool,
  a vendor name, or a nickname for something else entirely. **Completely unconfirmed —
  ask Amanda. Don't guess what it stands for in the pitch.**
- **File format:** Unknown. Guess: CSV or XLSX, generated per request rather than
  self-serve.
- **Columns (guess):** `Item ID, Description, Category (=Jewelry), Supplier, Sale Price,
  Fee, Net, Sale Date`.
- **Money fields:** `Sale Price` = revenue; `Fee` = fee; `Net` = Sale Price − Fee (guess).
- **Buyer id field:** Unknown/guess — assume none for now.
- **Gotchas:**
  - `Supplier` is an unusual field for a Goodwill report — donated goods normally have no
    "supplier." Jewelry may be consigned or sourced/bought-in rather than donated, which
    could matter for how margin is computed on this category specifically.
  - This is the least-confirmed source of the 9 — treat the fixture as a clearly-labeled
    placeholder, not a confident guess like the marketplace sources.
- **Confidence:** Guess, essentially unconfirmed end to end. No public links exist.
