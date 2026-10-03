/**
 * 1st Source Bank, business checking acct ...0101 (slide 38: "1st Source acct
 * 0101 · GL 10009"). Research (docs/sources/shipping_osm_pb_easypost.md) says
 * the month-end shipping figure is most likely read off this statement, so we
 * load it. INFORMATIONAL for now: the close skips these lines; a later step
 * reconciles them against the shipping tools and marketplace payouts.
 *
 * Layout [guess; 1st Source online banking CSV export, docs/sources/bank_1st_source.md]
 *   Preamble (bank name, "Account: ... ****0101", statement period), blank
 *   line, header: Posting Date, Description, Transaction Type, Debit, Credit,
 *   Balance, Reference. A single signed Amount column is also accepted.
 *
 * Each row → one money_line (+ = deposit), memo = description, classified:
 *   bank_postage_debit     EasyPost / Pitney Bowes / USPS / Stamps postage refills
 *   bank_carrier_debit     OSM Worldwide / FedEx / UPS payments
 *   bank_carrier_refund    BNKDEPOSIT carrier refunds (e.g. FedEx) and other carrier credits
 *   bank_marketplace_deposit  Amazon / eBay / ShopGoodwill / PayPal / Mercari / Goodwill Books deposits
 *   bank_other_deposit / bank_other_withdrawal  everything else
 * None of these amount types has a GL rule or is counted as shipping cost.
 */
import type { ParseContext, ParseResult, RawTable, SourceParser } from "./types";
import { isBlankRow, toCents } from "./_shared/table";
import { cellAt, columns, dayOf, emptyResult, headerRowOf, periodFromName } from "./_ops";

const COLS = {
  date: ["Posting Date", "Post Date", "Date", "Transaction Date"],
  description: ["Description", "Memo", "Payee"],
  type: ["Transaction Type", "Type"],
  debit: ["Debit", "Withdrawals", "Debits"],
  credit: ["Credit", "Deposits", "Credits"],
  amount: ["Amount"],
  reference: ["Reference", "Check Number", "Ref"],
};
const REQUIRED = [["Posting Date", "Description", "Debit"], ["Posting Date", "Description", "Amount"], ["Post Date", "Description", "Amount"]];

const POSTAGE = /easypost|pitney|postage|usps|stamps\.com/i;
const CARRIER = /osm worldwide|\bosm\b|fedex|\bups\b|dhl/i;
const MARKET = /amazon|ebay|shopgoodwill|paypal|mercari|goodwill ?books|upright|cash ?monkey/i;

export function classifyBankLine(description: string, type: string, cents: number): string {
  const text = `${description} ${type}`;
  if (cents > 0 && (/bnkdeposit/i.test(text) || /refund|credit/i.test(description)) && (CARRIER.test(text) || POSTAGE.test(text))) {
    return "bank_carrier_refund";
  }
  if (cents < 0 && POSTAGE.test(text)) return "bank_postage_debit";
  if (cents < 0 && CARRIER.test(text)) return "bank_carrier_debit";
  if (cents > 0 && MARKET.test(text)) return "bank_marketplace_deposit";
  return cents > 0 ? "bank_other_deposit" : "bank_other_withdrawal";
}

function channelOfMemo(memo: string): string | null {
  if (/shopgoodwill/i.test(memo)) return "shopgoodwill";
  if (/amazon/i.test(memo)) return "amazon";
  if (/ebay/i.test(memo)) return "ebay";
  if (/goodwill ?books/i.test(memo)) return "goodwill_books";
  return null;
}

export const bank1stSourceParser: SourceParser = {
  sourceId: "bank_1st_source",
  version: "0.1.0",

  accepts(table: RawTable, fileName: string): boolean {
    const h = headerRowOf(table, REQUIRED);
    if (h < 0) return false;
    const pre = table.slice(0, h).flat().join(" ");
    return /1st source|first source|\*{2,}\d{4}|x{2,}\d{4}/i.test(pre) || /1st.?source|bank/i.test(fileName);
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const h = headerRowOf(table, REQUIRED);
    const result = emptyResult(h, table);
    if (h < 0) {
      result.warnings.push({ message: "1st Source bank: header not found (need Posting Date + Description + Debit/Amount)." });
      return result;
    }
    const pre = table.slice(0, h).flat().join(" ");
    const account = /[*xX]{2,}(\d{4})/.exec(pre)?.[1] ?? "0101";
    const c = columns(table, h, COLS);
    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      if (isBlankRow(row)) continue;
      const lineDate = dayOf(cellAt(row, c.date));
      const description = cellAt(row, c.description);
      if (!lineDate) {
        if (!/total|ending balance|beginning balance/i.test(row.join(" "))) {
          result.warnings.push({ row: i + 1, message: `Skipped row: bad date "${cellAt(row, c.date)}".` });
        }
        continue;
      }
      let cents: number | null;
      if (c.amount >= 0) cents = toCents(cellAt(row, c.amount));
      else {
        const debit = toCents(cellAt(row, c.debit));
        const credit = toCents(cellAt(row, c.credit));
        cents = debit == null && credit == null ? null : (credit ?? 0) - Math.abs(debit ?? 0);
      }
      if (cents == null || cents === 0) {
        result.warnings.push({ row: i + 1, message: `Skipped row: no amount (${description}).` });
        continue;
      }
      const type = cellAt(row, c.type);
      result.moneyLines.push({
        sourceRow: i + 1,
        channel: channelOfMemo(description),
        lineDate,
        period: lineDate.slice(0, 7),
        amountType: classifyBankLine(description, type, cents),
        amountCents: cents,
        payoutId: null,
        settlementId: null,
        bankAccountNo: account,
        reference: cellAt(row, c.reference) || null,
        memo: type ? `${description} [${type}]` : description,
      });
    }
    const months = new Set(result.moneyLines.map((m) => m.period));
    result.period = ctx.period ?? (months.size === 1 ? [...months][0] : periodFromName(ctx.fileName));
    return result;
  },
};
