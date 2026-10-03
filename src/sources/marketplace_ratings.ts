/**
 * Monthly marketplace ratings: CSAT, NPS, conversion and seller rating per
 * channel, copied from each seller dashboard (eBay Seller Hub performance,
 * Amazon Account Health / Voice of the Customer, ShopGoodwill and
 * GoodwillBooks feedback). Feeds the csat, nps and marketplace_conversion KPIs.
 *
 * Layout [guess; docs/sources/marketplace_ratings.md]
 *   Month, Marketplace, Seller Rating %, CSAT (1-5), CSAT Responses, NPS,
 *   NPS Responses, Conversion Rate %, Sessions
 *   One row per marketplace per month. A blank cell = not reported (no row).
 * Units as stored in marketplace_metrics: csat on its own scale (4.8 of 5),
 * nps −100..100, conversion_rate in percent, seller_rating as reported.
 */
import type { ParseContext, ParseResult, ParsedMarketplaceMetric, RawTable, SourceParser } from "./types";
import { isBlankRow } from "./_shared/table";
import { cellAt, channelOf, columns, emptyResult, headerRowOf, num, periodFromName } from "./_ops";

const COLS = {
  month: ["Month", "Period"],
  marketplace: ["Marketplace", "Channel"],
  rating: ["Seller Rating %", "Seller Rating", "Positive Feedback %", "Feedback Score"],
  csat: ["CSAT (1-5)", "CSAT", "Customer Satisfaction"],
  csatN: ["CSAT Responses", "CSAT Count"],
  nps: ["NPS", "Net Promoter Score"],
  npsN: ["NPS Responses", "NPS Count"],
  conversion: ["Conversion Rate %", "Conversion Rate", "Conversion %"],
};
const REQUIRED = [["Month", "Marketplace", "CSAT (1-5)"], ["Month", "Marketplace", "NPS"], ["Period", "Channel", "CSAT"]];

function periodOfCell(raw: string): string | null {
  const m = /^(\d{4})-(\d{1,2})/.exec(raw.trim()) ?? null;
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  const us = /^(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  return us ? `${us[2]}-${us[1].padStart(2, "0")}` : null;
}

export const marketplaceRatingsParser: SourceParser = {
  sourceId: "marketplace_ratings",
  version: "0.1.0",

  accepts(table: RawTable): boolean {
    return headerRowOf(table, REQUIRED) >= 0;
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const h = headerRowOf(table, REQUIRED);
    const result = emptyResult(h, table);
    if (h < 0) {
      result.warnings.push({ message: "Marketplace ratings: header not found (need Month + Marketplace + CSAT or NPS)." });
      return result;
    }
    const c = columns(table, h, COLS);
    const fallback = ctx.period ?? periodFromName(ctx.fileName);
    const out: ParsedMarketplaceMetric[] = [];
    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      if (isBlankRow(row)) continue;
      const period = periodOfCell(cellAt(row, c.month)) ?? fallback;
      const label = cellAt(row, c.marketplace);
      if (!period || !label) {
        result.warnings.push({ row: i + 1, message: "Skipped row: no month or marketplace." });
        continue;
      }
      const channel = channelOf(label);
      const add = (metric: ParsedMarketplaceMetric["metric"], idx: number, nIdx = -1) => {
        const value = num(cellAt(row, idx));
        if (value === null) return;
        const n = num(cellAt(row, nIdx));
        out.push({ channel, period, metric, value, sampleSize: n === null ? null : Math.round(n) });
      };
      add("csat", c.csat, c.csatN);
      add("nps", c.nps, c.npsN);
      add("conversion_rate", c.conversion);
      add("seller_rating", c.rating);
    }
    result.marketplaceMetrics = out;
    result.period = ctx.period ?? (new Set(out.map((m) => m.period)).size === 1 ? out[0]?.period : fallback);
    return result;
  },
};
