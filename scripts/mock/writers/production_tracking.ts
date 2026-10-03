/**
 * Goodwill production-tracking export (donation → identified → sent to
 * e-commerce), one file per month (current month partial):
 * data/fixtures/production_tracking/production_tracking_YYYY-MM.csv
 *
 * Layout [guess, internal system; see docs/sources/production_tracking.md]:
 * two title lines and a blank line, then the header. One row per item in
 * e-commerce custody during the month (sent before month end, not sold before
 * month start). Dates "09/30/2026 11:45 PM" (local). Item Tag = the SKU
 * Upright uses, so both files describe the same item.
 */
import { csvRow, lines, sgwDate, usDay } from "../format";
import { END_DATE, type MockModel } from "../model";
import { dailyUpload, lastDayOf, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";
import { monthWindow } from "./upright_inventory";

const HEADER = ["Item Tag", "Category", "Donation Site", "Donated", "Identified for E-Com", "Sent to E-Com", "Stage"];

export function writeProductionTracking(model: MockModel): FixtureFile[] {
  const { items, itemPeriods } = model.ops;
  return itemPeriods.map((period) => {
    const { start, end } = monthWindow(period);
    const rows = items.filter((it) => it.sentAt < end && (!it.soldAt || it.soldAt >= start));
    const blank = HEADER.slice(1).map(() => "");
    const body = [
      csvRow(["Goodwill Industries of Michiana - E-Commerce Production Report", ...blank]),
      csvRow([`Date range: ${usDay(`${period}-01`)} - ${usDay(lastDayOf(period))}`, ...blank]),
      csvRow(["", ...blank]),
      csvRow(HEADER),
      ...rows.map((it) =>
        csvRow([
          it.id,
          it.category,
          it.donationSite,
          sgwDate(it.donatedAt),
          sgwDate(it.identifiedAt),
          sgwDate(it.sentAt),
          it.listedAt && it.listedAt < end ? "Listed" : "Sent to E-Com",
        ]),
      ),
    ];
    const current = period === END_DATE.slice(0, 7);
    return {
      sourceId: "production_tracking",
      path: `production_tracking/production_tracking_${period}.csv`,
      content: lines(body, "\n"),
      uploadedAt: current ? dailyUpload(END_DATE, 34) : monthlyUpload(period, 29),
    };
  });
}
