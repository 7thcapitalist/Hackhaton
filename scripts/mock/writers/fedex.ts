/**
 * FedEx Billing Online invoice report (All Columns → CSV), one file per closed
 * month (shipments by ship date): data/fixtures/fedex/fedex_YYYY-MM.csv
 *
 * Layout = src/sources/__samples__/other/fedex_2026-09.csv: header on row 1,
 * one row per tracking id per weekly invoice, credits as negative Net Charge
 * Amount with a description, a "Total" footer. LF line endings, "$12.48".
 * The bill-to account number is a fake placeholder.
 *
 * Credits (service-failure GSR) and surcharges (address correction) are billed
 * on the invoice after the shipment's.
 */
import { addDays } from "../../../src/lib/views/dates";
import { csvRow, lines, usDay, usd } from "../format";
import type { MockModel, Shipment } from "../model";
import { MONTHLY_PERIODS, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = [
  "Bill to Account Number", "Invoice Date", "Invoice Number", "Express or Ground Tracking ID", "Shipment Date",
  "Service Type", "Tracking ID Charge Description", "Net Charge Amount",
];
const ACCOUNT = "000000000";

/** Weekly invoices dated the Tuesday after the ship week. */
function invoiceDate(shipDate: string, weeksLater = 0): string {
  const wd = new Date(`${shipDate}T12:00:00Z`).getUTCDay(); // 0 = Sun
  const toNextTue = ((2 - wd + 7) % 7) || 7;
  return addDays(shipDate, toNextTue + 7 * weeksLater);
}
const invoiceNo = (date: string) => `9-${date.slice(2, 4)}${date.slice(5, 7)}-${date.slice(8, 10)}001`;

export function writeFedex(model: MockModel): FixtureFile[] {
  return MONTHLY_PERIODS.map((period) => {
    const ships = model.shipments
      .filter((s) => s.tool === "fedex" && s.shipDate.startsWith(period))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const rows: { inv: string; ship: Shipment; desc: string; cents: number }[] = [];
    for (const s of ships) {
      rows.push({ inv: invoiceDate(s.shipDate), ship: s, desc: "", cents: s.costCents });
      if (s.refund === "refunded") rows.push({ inv: invoiceDate(s.shipDate, 1), ship: s, desc: "Service failure credit (GSR)", cents: -s.costCents });
      if (s.surchargeCents) rows.push({ inv: invoiceDate(s.shipDate, 1), ship: s, desc: "Address correction", cents: s.surchargeCents });
    }
    rows.sort((a, b) => a.inv.localeCompare(b.inv) || a.ship.ts.getTime() - b.ship.ts.getTime());
    const total = rows.reduce((t, r) => t + r.cents, 0);
    const body = [
      csvRow(HEADER),
      ...rows.map((r) =>
        csvRow([ACCOUNT, usDay(r.inv), invoiceNo(r.inv), r.ship.tracking, usDay(r.ship.shipDate), r.ship.service, r.desc, usd(r.cents)]),
      ),
      csvRow(["", "", "", "", "", "", "Total", usd(total)]),
    ];
    return {
      sourceId: "fedex",
      path: `fedex/fedex_${period}.csv`,
      content: lines(body, "\n"),
      uploadedAt: monthlyUpload(period, 15),
    };
  });
}
