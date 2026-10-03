/**
 * Monthly marketplace ratings, one file per month, prior year and current
 * year: data/fixtures/marketplace_ratings/marketplace_ratings_YYYY-MM.csv
 *
 * Layout [guess; see docs/sources/marketplace_ratings.md]: one row per
 * marketplace, values copied from each seller dashboard (eBay Seller Hub
 * performance, Amazon Account Health / Voice of the Customer, ShopGoodwill
 * and GoodwillBooks feedback). Blank = the marketplace does not report it.
 */
import { csvRow, lines } from "../format";
import { END_DATE, type MockModel } from "../model";
import { dailyUpload, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = [
  "Month", "Marketplace", "Seller Rating %", "CSAT (1-5)", "CSAT Responses", "NPS", "NPS Responses",
  "Conversion Rate %", "Sessions",
];
const s = (v: number | null) => (v == null ? "" : String(v));

export function writeMarketplaceRatings(model: MockModel): FixtureFile[] {
  const { ratings, ratingPeriods } = model.ops;
  return ratingPeriods.map((period) => {
    const body = [
      csvRow(HEADER),
      ...ratings
        .filter((r) => r.period === period)
        .map((r) =>
          csvRow([period, r.marketplace, s(r.sellerRating), s(r.csat), s(r.csatResponses), s(r.nps), s(r.npsResponses), s(r.conversionPct), s(r.sessions)]),
        ),
    ];
    const current = period === END_DATE.slice(0, 7);
    return {
      sourceId: "marketplace_ratings",
      path: `marketplace_ratings/marketplace_ratings_${period}.csv`,
      content: lines(body, "\n"),
      uploadedAt: current ? dailyUpload(END_DATE, 36) : monthlyUpload(period, 32),
    };
  });
}
