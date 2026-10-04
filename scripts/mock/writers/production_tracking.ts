/**
 * Goodwill production-tracking export (donation → identified → sent to
 * e-commerce), one file per business day:
 * data/fixtures/production_tracking/production_tracking_YYYY-MM-DD.csv
 *
 * Cadence: daily (the internal export can be scheduled every night). The
 * first day of the range is a full export (every item in e-commerce custody
 * on that day); after that each file lists the items sent to e-commerce that
 * day. Items merge by Item Tag on ingest, so the result is the same as the
 * old monthly snapshots.
 *
 * Layout [guess, internal system; see docs/sources/production_tracking.md]:
 * two title lines and a blank line, then the header. Dates "09/30/2026 11:45 PM"
 * (local). Item Tag = the SKU Upright uses, so both files describe the same item.
 */
import { localToUtc } from "../../../src/lib/views/dates";
import { addDays } from "../../../src/lib/views/dates";
import { csvRow, lines, sgwDate, usDay } from "../format";
import { START_DATE, type MockModel } from "../model";
import type { OpsItem } from "../ops";
import { ALL_DATES, dailyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = ["Item Tag", "Category", "Donation Site", "Donated", "Identified for E-Com", "Sent to E-Com", "Stage"];

/** UTC window [start, end) of one business day. */
export function dayWindow(date: string): { start: Date; end: Date } {
  return { start: localToUtc(date, 0), end: localToUtc(addDays(date, 1), 0) };
}

export function writeProductionTracking(model: MockModel): FixtureFile[] {
  const { items } = model.ops;
  return ALL_DATES.map((date) => {
    const { start, end } = dayWindow(date);
    const first = date === START_DATE;
    const rows = items.filter((it: OpsItem) =>
      first ? it.sentAt < end && (!it.soldAt || it.soldAt >= start) : it.sentAt >= start && it.sentAt < end,
    );
    const blank = HEADER.slice(1).map(() => "");
    const body = [
      csvRow(["Goodwill Industries of Michiana - E-Commerce Production Report", ...blank]),
      csvRow([`Date range: ${usDay(date)} - ${usDay(date)}${first ? " (full export)" : ""}`, ...blank]),
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
    return {
      sourceId: "production_tracking",
      path: `production_tracking/production_tracking_${date}.csv`,
      content: lines(body, "\n"),
      uploadedAt: dailyUpload(date, 34),
    };
  });
}
