/**
 * 1st Source Bank online-banking export for business checking acct ...0101,
 * one file per closed month: data/fixtures/bank_1st_source/bank_1st_source_YYYY-MM.csv
 *
 * Layout [guess; see docs/sources/bank_1st_source.md]: account preamble, a
 * blank line, header, one row per posted transaction (Debit / Credit columns,
 * running Balance). Memos are fake but follow the payees on slide 38
 * (EasyPost, Pitney Bowes, OSM, FedEx incl. BNKDEPOSIT refunds, Amazon).
 */
import { csvRow, dec, lines, usDay } from "../format";
import type { MockModel } from "../model";
import { lastDayOf, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = ["Posting Date", "Description", "Transaction Type", "Debit", "Credit", "Balance", "Reference"];
const OPENING_CENTS = 25_000_000;

export function writeBank1stSource(model: MockModel): FixtureFile[] {
  const { bank, bankPeriods } = model.ops;
  let balance = OPENING_CENTS;
  return bankPeriods.map((period) => {
    const blank = HEADER.slice(1).map(() => "");
    const body = [
      csvRow(["1st Source Bank - Account Activity", ...blank]),
      csvRow(["Account: BUSINESS CHECKING ****0101", ...blank]),
      csvRow([`Statement period: ${usDay(`${period}-01`)} - ${usDay(lastDayOf(period))}`, ...blank]),
      csvRow(["", ...blank]),
      csvRow(HEADER),
    ];
    for (const l of bank) {
      if (!l.date.startsWith(period)) continue;
      balance += l.amountCents;
      body.push(
        csvRow([
          usDay(l.date),
          l.description,
          l.type,
          l.amountCents < 0 ? dec(-l.amountCents) : "",
          l.amountCents > 0 ? dec(l.amountCents) : "",
          dec(balance),
          l.reference,
        ]),
      );
    }
    return {
      sourceId: "bank_1st_source",
      path: `bank_1st_source/bank_1st_source_${period}.csv`,
      content: lines(body, "\r\n"),
      uploadedAt: monthlyUpload(period, 40),
    };
  });
}
