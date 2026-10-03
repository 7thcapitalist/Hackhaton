/**
 * ShopGoodwill seller portal "Periodic Marketplace Report", one file per day:
 * data/fixtures/shopgoodwill/shopgoodwill_YYYY-MM-DD.csv
 *
 * Layout = src/sources/__samples__/shopgoodwill_2026-09.csv: a preamble
 * (portal, report name, seller, year/month, "Report,Period 1"), a blank line,
 * the header, one row per item, a "Totals" row. CRLF line endings. End Date
 * "09/30/2026 11:45 PM" (local). Net = bid + shipping + handling − refund − fee
 * (the buyer premium belongs to ShopGoodwill and is not in Net).
 *
 * Messy case: the 11:45 PM Eastern auction on 2026-09-30.
 */
import { csvRow, dec, lines, monthName, sgwDate } from "../format";
import { ordersOn, type MockModel, type MockOrder } from "../model";
import { ALL_DATES, PRIOR_YEAR_PERIODS, dailyUpload, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = [
  "Order ID", "Item ID", "Title", "Category", "End Date", "Winning Bid", "Shipping", "Handling",
  "Buyer Premium", "Seller Fee", "Refund", "Net", "Buyer ID", "Status",
];
const HANDLING = 200;

function row(o: MockOrder): string[] {
  const handling = Math.min(HANDLING, o.shippingCents);
  const net = o.grossCents + o.shippingCents - o.refundCents - o.feeCents;
  const status =
    o.status === "cancelled" ? "Cancelled" : o.status === "refunded" ? "Refunded" : o.seq % 4 === 0 ? "Shipped" : "Paid";
  return [
    o.orderId, o.itemId, o.title, o.category, sgwDate(o.ts), dec(o.grossCents), dec(o.shippingCents - handling),
    dec(handling), dec(Math.round(o.grossCents * 0.05)), dec(o.feeCents), dec(o.refundCents), dec(net),
    o.buyerId ?? "", status,
  ];
}

function render(orders: MockOrder[], period: string, title: string, label: string): string {
  const bids = orders.reduce((s, o) => s + o.grossCents, 0);
  const body = [
    "ShopGoodwill Seller Portal",
    title,
    "Seller,Goodwill Industries of Michiana (TEST DATA)",
    `Year,${period.slice(0, 4)},Month,${monthName(period)}`,
    `Report,${label}`,
    "",
    csvRow(HEADER),
    ...orders.map((o) => csvRow(row(o))),
    csvRow(["Totals", "", "", "", "", dec(bids), "", "", "", "", "", "", "", ""]),
  ];
  return lines(body, "\r\n");
}

export function writeShopgoodwill(model: MockModel): FixtureFile[] {
  // Prior year: the month-end "all reports" pull (Period 3), like shopgoodwill_2026-08 sample.
  const monthly = PRIOR_YEAR_PERIODS.map((period) => ({
    sourceId: "shopgoodwill",
    path: `shopgoodwill/shopgoodwill_${period}.csv`,
    content: render(
      model.orders
        .filter((o) => o.stream === "shopgoodwill" && o.businessDate.startsWith(period))
        .sort((a, b) => a.ts.getTime() - b.ts.getTime() || a.seq - b.seq),
      period,
      "Periodic Marketplace Report - All Reports",
      "Period 3",
    ),
    uploadedAt: monthlyUpload(period, 0),
  }));
  const daily = ALL_DATES.map((date) => ({
    sourceId: "shopgoodwill",
    path: `shopgoodwill/shopgoodwill_${date}.csv`,
    content: render(ordersOn(model, "shopgoodwill", date), date.slice(0, 7), "Periodic Marketplace Report", "Period 1"),
    uploadedAt: dailyUpload(date, 0),
    ...(date === "2026-09-30" ? { note: "auction ending 11:45 PM Eastern" } : {}),
  }));
  return [...monthly, ...daily];
}
