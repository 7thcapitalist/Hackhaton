/**
 * FedEx Billing Online invoice download ("All Columns", CSV), one file per
 * closed month (shipments by ship date): data/fixtures/fedex/fedex_YYYY-MM.csv
 *
 * Layout = FedEx's data dictionary (docs/sources/fedex.md §1): header on row
 * 1, one row per tracking id per weekly invoice, ~150 columns, dates
 * yyyymmdd, plain amounts ("12.48"), 25 × (Tracking ID Charge Description,
 * Tracking ID Charge Amount) pairs with repeated header names, invoice-level
 * Original Amount Due / Current Balance repeated on every row. Credits
 * (service-failure GSR) are a negative Net Charge Amount; surcharges (address
 * correction) are billed on the invoice after the shipment's. No footer.
 * Account, recipient and shipper values are fake placeholders. LF endings.
 */
import { addDays } from "../../../src/lib/views/dates";
import { csvRow, dec, lines } from "../format";
import type { MockModel, Shipment } from "../model";
import { MONTHLY_PERIODS, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const pairs = (n: number, a: string, b: string) => Array.from({ length: n }, () => [a, b]).flat();

/** The FBO "All Columns" header, in order (FedEx data dictionary). */
export const FEDEX_ALL_COLUMNS = [
  "Bill to Account Number", "Invoice Date", "Invoice Number", "Store ID", "Original Amount Due", "Current Balance", "Payor",
  "Ground Tracking ID Prefix", "Express or Ground Tracking ID", "Transportation Charge Amount", "Net Charge Amount",
  "Service Type", "Ground Service", "Shipment Date", "POD Delivery Date", "POD Delivery Time", "POD Service Area Code",
  "POD Signature Description", "Actual Weight Amount", "Actual Weight Units", "Rated Weight Amount", "Rated Weight Units",
  "Number of Pieces", "Bundle Number", "Meter Number", "TDMasterTrackingID", "Service Packaging", "Dim Length", "Dim Width",
  "Dim Height", "Dim Divisor", "Dim Unit", "Recipient Name", "Recipient Company", "Recipient Address Line 1",
  "Recipient Address Line 2", "Recipient City", "Recipient State", "Recipient Zip Code", "Recipient Country/Territory",
  "Shipper Company", "Shipper Name", "Shipper Address Line 1", "Shipper Address Line 2", "Shipper City", "Shipper State",
  "Shipper Zip Code", "Shipper Country/Territory", "Original Customer Reference", "Original Ref#2", "Original Ref#3/PO Number",
  "Original Department Reference Description", "Updated Customer Reference", "Updated Ref#2", "Updated Ref#3/PO Number",
  "Updated Department Reference Description", "RMA#", "Original Recipient Address Line 1", "Original Recipient Address Line 2",
  "Original Recipient City", "Original Recipient State", "Original Recipient Zip Code", "Original Recipient Country/Territory",
  "Zone Code", "Cost Allocation", "Alternate Address Line 1", "Alternate Address Line 2", "Alternate City",
  "Alternate State Province", "Alternate Zip Code", "Alternate Country/Territory Code", "CrossRefTrackingID Prefix",
  "CrossRefTrackingID", "Entry Date", "Entry Number", "Customs Value", "Customs Value Currency Code", "Declared Value",
  "Declared Value Currency Code", ...pairs(4, "Commodity Description", "Commodity Country/Territory Code"),
  "Currency Conversion Date", "Currency Conversion Rate", "Multiweight Number", "Multiweight Total Multiweight Units",
  "Multiweight Total Multiweight Weight", "Multiweight Total Shipment Charge Amount", "Multiweight Total Shipment Weight",
  "Ground Tracking ID Address Correction Discount Charge Amount", "Ground Tracking ID Address Correction Gross Charge Amount",
  "Rated Method", "Sort Hub", "Estimated Weight", "Estimated Weight Unit", "Postal Class", "Process Category", "Package Size",
  "Delivery Confirmation", "Tendered Date", ...pairs(25, "Tracking ID Charge Description", "Tracking ID Charge Amount"),
  "Shipment Notes",
];
const COL = (name: string) => FEDEX_ALL_COLUMNS.indexOf(name);
const FIRST_CHARGE = COL("Tracking ID Charge Description");

export const ymd = (date: string) => date.replace(/-/g, "");

export interface FedexRow {
  invoiceDate: string;
  invoiceNo: string;
  tracking: string;
  shipDate: string;
  service: string;
  netCents: number;
  /** (description, cents) charge pairs; they sum to netCents. */
  charges: [string, number][];
  weightLb: number;
  reference: string;
}

/** One All Columns row; invoice totals are filled by the caller. */
export function fedexRow(r: FedexRow, invoiceTotalCents: number, seq: number): string[] {
  const cells: string[] = FEDEX_ALL_COLUMNS.map(() => "");
  const set = (name: string, v: string) => (cells[COL(name)] = v);
  const [service, ground] = r.service.startsWith("FedEx Ground") || r.service.startsWith("FedEx Home")
    ? ["FedEx Ground", r.service === "FedEx Home Delivery" ? "Home Delivery" : "Ground"]
    : [r.service, ""];
  set("Bill to Account Number", "000000000");
  set("Invoice Date", ymd(r.invoiceDate));
  set("Invoice Number", r.invoiceNo);
  set("Original Amount Due", dec(invoiceTotalCents));
  set("Current Balance", dec(invoiceTotalCents));
  set("Payor", "Shipper");
  set("Express or Ground Tracking ID", r.tracking);
  const transport = r.charges.length ? r.charges[0]![1] : r.netCents;
  set("Transportation Charge Amount", dec(transport));
  set("Net Charge Amount", dec(r.netCents));
  set("Service Type", service);
  set("Ground Service", ground);
  set("Shipment Date", ymd(r.shipDate));
  set("Actual Weight Amount", r.weightLb.toFixed(1));
  set("Actual Weight Units", "L");
  set("Rated Weight Amount", String(Math.max(1, Math.ceil(r.weightLb))));
  set("Rated Weight Units", "L");
  set("Number of Pieces", "1");
  set("Recipient Name", "TEST RECIPIENT");
  set("Recipient Address Line 1", `${(seq % 900) + 1} EXAMPLE AVE`);
  set("Recipient City", "TESTVILLE");
  set("Recipient State", "IN");
  set("Recipient Zip Code", "46601");
  set("Recipient Country/Territory", "US");
  set("Shipper Company", "GOODWILL MICHIANA (TEST)");
  set("Shipper Address Line 1", "100 TEST WAREHOUSE RD");
  set("Shipper City", "SOUTH BEND");
  set("Shipper State", "IN");
  set("Shipper Zip Code", "46601");
  set("Shipper Country/Territory", "US");
  set("Original Customer Reference", r.reference);
  set("Zone Code", String(2 + (seq % 6)));
  set("Rated Method", "01");
  set("Tendered Date", ymd(r.shipDate));
  r.charges.slice(0, 25).forEach(([d, c], k) => {
    cells[FIRST_CHARGE + 2 * k] = d;
    cells[FIRST_CHARGE + 2 * k + 1] = dec(c);
  });
  return cells;
}

/** Split a label cost into freight + fuel (+ residential for Home Delivery). */
export function chargesOf(service: string, cents: number): [string, number][] {
  const fuel = Math.round(cents * 0.14);
  const resi = service === "FedEx Home Delivery" ? Math.min(Math.round(cents * 0.2), 450) : 0;
  const out: [string, number][] = [["Transportation Charge", cents - fuel - resi], ["Fuel Surcharge", fuel]];
  if (resi) out.push(["Residential", resi]);
  return out;
}

/** Weekly invoices dated the Tuesday after the ship week. */
function invoiceDate(shipDate: string, weeksLater = 0): string {
  const wd = new Date(`${shipDate}T12:00:00Z`).getUTCDay(); // 0 = Sun
  const toNextTue = ((2 - wd + 7) % 7) || 7;
  return addDays(shipDate, toNextTue + 7 * weeksLater);
}
const invoiceNo = (date: string) => `8${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}01`;

export function renderFedex(rows: FedexRow[]): string {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.invoiceNo, (totals.get(r.invoiceNo) ?? 0) + r.netCents);
  return lines([csvRow(FEDEX_ALL_COLUMNS), ...rows.map((r, i) => csvRow(fedexRow(r, totals.get(r.invoiceNo)!, i)))], "\n");
}

export function writeFedex(model: MockModel): FixtureFile[] {
  return MONTHLY_PERIODS.map((period) => {
    const ships = model.shipments
      .filter((s) => s.tool === "fedex" && s.shipDate.startsWith(period))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const rows: (FedexRow & { ship: Shipment })[] = [];
    const base = (s: Shipment, inv: string) => ({
      invoiceDate: inv, invoiceNo: invoiceNo(inv), tracking: s.tracking, shipDate: s.shipDate, service: s.service,
      weightLb: s.weightLb, reference: s.ref, ship: s,
    });
    for (const s of ships) {
      rows.push({ ...base(s, invoiceDate(s.shipDate)), netCents: s.costCents, charges: chargesOf(s.service, s.costCents) });
      if (s.refund === "refunded") {
        rows.push({ ...base(s, invoiceDate(s.shipDate, 1)), netCents: -s.costCents, charges: [["Service Failure Credit (GSR)", -s.costCents]] });
      }
      if (s.surchargeCents) {
        rows.push({ ...base(s, invoiceDate(s.shipDate, 1)), netCents: s.surchargeCents, charges: [["Address Correction", s.surchargeCents]] });
      }
    }
    rows.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.ship.ts.getTime() - b.ship.ts.getTime());
    return {
      sourceId: "fedex",
      path: `fedex/fedex_${period}.csv`,
      content: renderFedex(rows),
      uploadedAt: monthlyUpload(period, 15),
    };
  });
}
