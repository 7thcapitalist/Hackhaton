/**
 * Marketplace ratings copied from each seller dashboard (eBay Seller Hub
 * performance, Amazon Account Health / Voice of the Customer, ShopGoodwill
 * and GoodwillBooks feedback).
 *
 * Cadence: daily rolling snapshot in the current year
 * (data/fixtures/marketplace_ratings/marketplace_ratings_YYYY-MM-DD.csv): one
 * row per marketplace for the running month, month-to-date. On ingest each
 * day's file upserts the month's row per channel + metric (same unique key),
 * so the KPI always reads the latest value. Prior year: one file per month
 * (marketplace_ratings_YYYY-MM.csv).
 *
 * Layout [guess; see docs/sources/marketplace_ratings.md]: Month, Marketplace,
 * the metrics, and (daily files) "As Of". Blank = the marketplace does not
 * report it.
 */
import { csvRow, lines } from "../format";
import type { MockModel } from "../model";
import { ALL_DATES, PRIOR_YEAR_PERIODS, dailyUpload, lastDayOf, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = [
  "Month", "Marketplace", "Seller Rating %", "CSAT (1-5)", "CSAT Responses", "NPS", "NPS Responses",
  "Conversion Rate %", "Sessions",
];
const s = (v: number | null) => (v == null ? "" : String(v));

export function writeMarketplaceRatings(model: MockModel): FixtureFile[] {
  const { ratings } = model.ops;
  const monthly = PRIOR_YEAR_PERIODS.map((period) => ({
    sourceId: "marketplace_ratings",
    path: `marketplace_ratings/marketplace_ratings_${period}.csv`,
    content: lines(
      [
        csvRow(HEADER),
        ...ratings
          .filter((r) => r.period === period)
          .map((r) => csvRow([period, r.marketplace, s(r.sellerRating), s(r.csat), s(r.csatResponses), s(r.nps), s(r.npsResponses), s(r.conversionPct), s(r.sessions)])),
      ],
      "\n",
    ),
    uploadedAt: monthlyUpload(period, 32),
  }));
  const daily = ALL_DATES.map((date) => {
    const period = date.slice(0, 7);
    // Month-to-date: counts grow with the days elapsed; the rates are the month's.
    const f = Number(date.slice(8, 10)) / Number(lastDayOf(period).slice(8, 10));
    const part = (v: number | null) => (v == null ? null : Math.max(1, Math.round(v * f)));
    return {
      sourceId: "marketplace_ratings",
      path: `marketplace_ratings/marketplace_ratings_${date}.csv`,
      content: lines(
        [
          csvRow([...HEADER, "As Of"]),
          ...ratings
            .filter((r) => r.period === period)
            .map((r) =>
              csvRow([period, r.marketplace, s(r.sellerRating), s(r.csat), s(part(r.csatResponses)), s(r.nps), s(part(r.npsResponses)), s(r.conversionPct), s(part(r.sessions)), date]),
            ),
        ],
        "\n",
      ),
      uploadedAt: dailyUpload(date, 36),
    };
  });
  return [...monthly, ...daily];
}
