/**
 * 1st Source Bank online-banking export for business checking acct ...0101.
 * Current year: a daily statement (BAI-style previous-day report), one file
 * per finished day: data/fixtures/bank_1st_source/bank_1st_source_YYYY-MM-DD.csv.
 * Prior year: one file per month (bank_1st_source_YYYY-MM.csv).
 *
 * Layout [guess; see docs/sources/bank_1st_source.md]: account preamble with
 * the statement period, a blank line, header, one row per posted transaction
 * (Debit / Credit columns, running Balance). Memos are fake but follow the
 * payees on slide 38 (EasyPost, Pitney Bowes, OSM, FedEx incl. BNKDEPOSIT
 * refunds, Amazon). Weekends have no postings (preamble + header only).
 */
import { csvRow, dec, lines, usDay } from "../format";
import type { MockModel } from "../model";
import { DONE_DATES, PRIOR_YEAR_PERIODS, dailyUpload, lastDayOf, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = ["Posting Date", "Description", "Transaction Type", "Debit", "Credit", "Balance", "Reference"];
const OPENING_CENTS = 25_000_000;

export function writeBank1stSource(model: MockModel): FixtureFile[] {
  const { bank } = model.ops;
  let balance = OPENING_CENTS;
  const specs = [
    ...PRIOR_YEAR_PERIODS.map((p) => ({ key: p, from: `${p}-01`, to: lastDayOf(p), upload: monthlyUpload(p, 40) })),
    ...DONE_DATES.map((d) => ({ key: d, from: d, to: d, upload: dailyUpload(d, 40) })),
  ];
  return specs.map(({ key, from, to, upload }) => {
    const blank = HEADER.slice(1).map(() => "");
    const body = [
      csvRow(["1st Source Bank - Account Activity", ...blank]),
      csvRow(["Account: BUSINESS CHECKING ****0101", ...blank]),
      csvRow([`Statement period: ${usDay(from)} - ${usDay(to)}`, ...blank]),
      csvRow(["", ...blank]),
      csvRow(HEADER),
    ];
    for (const l of bank) {
      if (!l.date.startsWith(key)) continue;
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
      path: `bank_1st_source/bank_1st_source_${key}.csv`,
      content: lines(body, "\r\n"),
      uploadedAt: upload,
    };
  });
}
