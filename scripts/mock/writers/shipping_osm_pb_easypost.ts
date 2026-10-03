/**
 * Postage bought through EasyPost, Pitney Bowes and OSM Worldwide, six files
 * per closed month in data/fixtures/shipping_osm_pb_easypost/
 * (layouts: docs/sources/shipping_osm_pb_easypost.md):
 *
 * - shipping_osm_pb_easypost_YYYY-MM.csv: EasyPost Shipment CSV report, the
 *   real 43 default columns (+ batch_id). Address columns carry obviously fake
 *   values; the parser never reads them. Cost date = postage_label_created_at.
 *   Messy case: the month's first OSM labels were bought through EasyPost with
 *   carrier "OSMWorldwide" and the one-cent placeholder rate: the postage is
 *   on the OSM invoice, so the parser must not count them here.
 * - shipping_osm_pb_easypost_paylog_YYYY-MM.csv: EasyPost Payment Log, real
 *   format: unsigned "$12.34000" amounts, direction in source_type →
 *   target_type, one `service_fee` row per label bought (with its Tracking
 *   Number), refunds credited back, recharges from the bank (one per month is
 *   `creditable`), a monthly account service fee (no tracking), and in
 *   September a `payment_refund` (wallet balance returned to the bank).
 * - shipping_osm_pb_easypost_pb_YYYY-MM.csv / _pb-refills_ / _pb-refunds_:
 *   Pitney Bowes history exports, one file per history type (Shipments,
 *   Postage refills, USPS Refunds), as PitneyShip / SendPro Online export them.
 *   Column names are a guess.
 * - shipping_osm_pb_easypost_osm_YYYY-MM.csv: OSM Worldwide invoice (title
 *   line naming OSM; weekly invoices; credits negative; Total footer).
 *
 * All LF line endings. A refunded EasyPost label shows up in BOTH EasyPost
 * files, and every label purchase is a service_fee in the payment log (that
 * is how EasyPost reports it; the parser counts each once).
 */
import { addDays } from "../../../src/lib/views/dates";
import { csvRow, dec, isoUtc, lines, usDay, usd } from "../format";
import { localToUtc } from "../../../src/lib/views/dates";
import type { MockModel, Shipment } from "../model";
import { lastDayOf, MONTHLY_PERIODS, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const SID = "shipping_osm_pb_easypost";

const byTime = (a: Shipment, b: Shipment) => a.ts.getTime() - b.ts.getTime() || a.tracking.localeCompare(b.tracking);

const EP_HEADER = [
  "created_at", "id", "tracking_code", "status",
  "from_address_id", "from_name", "from_company", "from_street1", "from_street2", "from_city", "from_state", "from_zip", "from_country", "from_residential",
  "to_address_id", "to_name", "to_company", "to_street1", "to_street2", "to_city", "to_state", "to_zip", "to_country", "to_residential",
  "parcel_id", "length", "width", "height", "weight", "predefined_package", "postage_label_created_at", "rate_id",
  "service", "carrier", "rate", "insured_value", "is_return", "refund_status", "reference", "label_fee", "postage_fee", "insurance_fee", "options",
  "batch_id",
];
const CITIES = [["Testville", "IN", "46601"], ["Sampleton", "OH", "43004"], ["Mocksburg", "MI", "49001"], ["Fakeport", "IL", "60601"]] as const;

function easypostShipments(ships: Shipment[], osmViaEasypost: Shipment[]): string {
  const all = [...ships.map((s) => ({ s, osm: false })), ...osmViaEasypost.map((s) => ({ s, osm: true }))].sort((a, b) => byTime(a.s, b.s));
  const rows = all.map(({ s, osm }, i) => {
    const [city, state, zip] = CITIES[i % CITIES.length]!;
    const id = osm ? `shp_osm${s.tracking.slice(-8)}` : s.shipmentId;
    const labelAt = new Date(s.ts.getTime() + 1000);
    const oz = Math.round(s.weightLb * 16 * 10) / 10;
    return csvRow([
      isoUtc(s.ts), id, s.tracking, s.refund ? "unknown" : i % 9 === 0 ? "in_transit" : "delivered",
      "adr_from0001", "Goodwill E-Com (test)", "Goodwill Michiana (test)", "100 Test Warehouse Rd", "", "South Bend", "IN", "46601", "US", "false",
      `adr_to${String(i).padStart(6, "0")}`, "Test Buyer", "", `${(i % 900) + 1} Example Ave`, "", city, state, zip, "US", "true",
      `prcl_${String(i).padStart(6, "0")}`, "10", "8", "4", oz.toFixed(1), "", isoUtc(labelAt), `rate_${String(i).padStart(6, "0")}`,
      osm ? "BPM" : s.service, osm ? "OSMWorldwide" : s.carrier, osm ? "0.01" : dec(s.costCents), "", "false",
      osm ? "" : (s.refund ?? ""), s.ref, "0.00", osm ? "0.00" : dec(s.costCents), "0.00",
      '[{"label_format":"PDF"},{"print_custom_1":"ecom"}]', "",
    ]);
  });
  return lines([csvRow(EP_HEADER), ...rows], "\n");
}

/** "$12.34000": EasyPost payment-log money (unsigned, 5 decimals). */
const ep5 = (cents: number) => `$${dec(Math.abs(cents))}000`;

/**
 * EasyPost wallet: recharge $1,000 from the bank whenever the balance would go
 * under $300; every label is a service_fee debit; label refunds come back the
 * next day. The balance carries over from month to month (`state`).
 */
function easypostPaylog(period: string, ships: Shipment[], state: { balance: number; seq: number }): string {
  const header = ["created_at", "id", "status", "source_type", "target_type", "charge_type", "amount", "balance", "description", "Tracking Number"];
  type Ev = { t: number; kind: "label" | "refund" | "fee" | "withdraw"; cents: number; s?: Shipment };
  const evs: Ev[] = [];
  const monthEnd = lastDayOf(period);
  for (const s of ships) {
    evs.push({ t: s.ts.getTime(), kind: "label", cents: s.costCents, s });
    if (s.refund === "refunded") {
      const day = addDays(s.shipDate, 1) <= monthEnd ? addDays(s.shipDate, 1) : monthEnd;
      evs.push({ t: localToUtc(day, 18 * 3600).getTime(), kind: "refund", cents: s.costCents, s });
    }
  }
  evs.push({ t: localToUtc(`${period}-15`, 8 * 3600).getTime(), kind: "fee", cents: 100 });
  if (period === "2026-09") evs.push({ t: localToUtc(`${period}-28`, 9 * 3600).getTime(), kind: "withdraw", cents: 5_000 });
  evs.sort((a, b) => a.t - b.t);
  const out: string[] = [];
  let creditableDone = false;
  const row = (t: number, status: string, src: string, tgt: string, type: string, cents: number, desc: string, tracking = "") => {
    state.seq++;
    out.push(csvRow([isoUtc(new Date(t)), `paylog_${String(state.seq).padStart(6, "0")}`, status, src, tgt, type, ep5(cents), ep5(state.balance), desc, tracking]));
  };
  for (const e of evs) {
    if (e.kind === "label") {
      if (state.balance - e.cents < 30_000) {
        state.balance += 100_000;
        const status = creditableDone ? "complete" : "creditable";
        creditableDone = true;
        row(e.t - 60_000, status, "bank_account", "user", "recharge", 100_000, "");
      }
      state.balance -= e.cents;
      row(e.t, "complete", "user", "easypost_bank", "service_fee", e.cents, "", e.s!.tracking);
    } else if (e.kind === "refund") {
      state.balance += e.cents;
      row(e.t, "complete", "refund", "user", "refund", e.cents, "", e.s!.tracking);
    } else if (e.kind === "withdraw") {
      state.balance -= e.cents;
      row(e.t, "complete", "user", "payment_refund", "payment_refund", e.cents, "");
    } else {
      state.balance -= e.cents;
      row(e.t, "complete", "user", "easypost_bank", "service_fee", e.cents, "");
    }
  }
  return lines([csvRow(header), ...out], "\n");
}

/**
 * Pitney Bowes: refill $500 when the meter would drop under $150. Three
 * history files: Shipments, Postage (refills), USPS Refunds.
 */
function pitneyBowes(period: string, ships: Shipment[], state: { balance: number }): { shipments: string; refills: string; refunds: string } {
  const monthEnd = lastDayOf(period);
  const shipRows: string[] = [];
  const refillRows: string[] = [];
  const refundRows: { t: number; cells: string[] }[] = [];
  let refillSeq = 0;
  for (const s of ships) {
    if (state.balance - s.costCents < 15_000) {
      state.balance += 50_000;
      refillSeq++;
      refillRows.push(csvRow([usDay(s.shipDate), `PB-REFILL-${period.replace("-", "")}-${refillSeq}`, "ACH 1st Source ...0101", usd(50_000)]));
    }
    state.balance -= s.costCents;
    const ref = s.ref.length > 20 ? s.ref.slice(0, 20) : s.ref;
    shipRows.push(csvRow([usDay(s.shipDate), s.carrier, s.service, s.tracking, "ECOM", ref, s.weightLb.toFixed(1), usd(s.costCents), usd(0), usd(s.costCents)]));
    if (s.refund === "refunded") {
      const day = addDays(s.shipDate, 1) <= monthEnd ? addDays(s.shipDate, 1) : monthEnd;
      state.balance += s.costCents;
      refundRows.push({ t: localToUtc(day, 17 * 3600).getTime(), cells: [usDay(day), s.tracking, s.carrier, s.service, usd(s.costCents), "Approved"] });
    }
  }
  refundRows.sort((a, b) => a.t - b.t);
  return {
    shipments: lines([csvRow(["Date", "Carrier", "Service", "Tracking Number", "Cost Center", "Reference", "Weight (lb)", "Postage", "Extra Services", "Total"]), ...shipRows], "\n"),
    refills: lines([csvRow(["Date", "Transaction ID", "Payment Method", "Amount"]), ...refillRows], "\n"),
    refunds: lines([csvRow(["Request Date", "Tracking Number", "Carrier", "Service", "Refund Amount", "Refund Status"]), ...refundRows.map((r) => csvRow(r.cells))], "\n"),
  };
}

/** OSM Worldwide: weekly invoices (Mondays), credits negative, Total footer. */
function osmInvoice(period: string, ships: Shipment[]): string {
  const header = ["Invoice #", "Ship Date", "Tracking", "Service", "Weight", "Charge"];
  const monthEnd = lastDayOf(period);
  const invoiceOf = (date: string) => {
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    const monday = addDays(date, -((wd + 6) % 7));
    return `OSM-INV-${monday.replace(/-/g, "")}`;
  };
  const rows: { t: number; cells: string[]; cents: number }[] = [];
  for (const s of ships) {
    rows.push({ t: s.ts.getTime(), cents: s.costCents, cells: [invoiceOf(s.shipDate), usDay(s.shipDate), s.tracking, s.service, s.weightLb.toFixed(1), usd(s.costCents)] });
    if (s.refund === "refunded") {
      const day = addDays(s.shipDate, 3) <= monthEnd ? addDays(s.shipDate, 3) : monthEnd;
      rows.push({ t: localToUtc(day, 12 * 3600).getTime(), cents: -s.costCents, cells: [invoiceOf(day), usDay(day), s.tracking, "Credit - undeliverable", s.weightLb.toFixed(1), usd(-s.costCents)] });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  const total = rows.reduce((t, r) => t + r.cents, 0);
  return lines(
    [
      csvRow(["OSM Worldwide invoice", "", "", "", "", ""]),
      csvRow(header),
      ...rows.map((r) => csvRow(r.cells)),
      csvRow(["", "", "", "", "Total", usd(total)]),
    ],
    "\n",
  );
}

export function writeShipping(model: MockModel): FixtureFile[] {
  const files: FixtureFile[] = [];
  const epState = { balance: 40_000, seq: 0 };
  const pbState = { balance: 30_000 };
  for (const period of MONTHLY_PERIODS) {
    const of = (tool: Shipment["tool"]) => model.shipments.filter((s) => s.tool === tool && s.shipDate.startsWith(period)).sort(byTime);
    const ep = of("easypost");
    const osm = of("osm");
    const pb = pitneyBowes(period, of("pitney_bowes"), pbState);
    const sep = period === "2026-09";
    files.push(
      {
        sourceId: SID, path: `${SID}/${SID}_${period}.csv`, content: easypostShipments(ep, osm.slice(0, 3)), uploadedAt: monthlyUpload(period, 20),
        ...(sep ? { note: "real 43-column shipment report; 3 OSM labels bought through EasyPost (carrier-billed, 1-cent rate) must not count" } : {}),
      },
      {
        sourceId: SID, path: `${SID}/${SID}_paylog_${period}.csv`, content: easypostPaylog(period, ep, epState), uploadedAt: monthlyUpload(period, 21),
        ...(sep ? { note: "every label is also a service_fee row; refunds also in the shipment report; creditable recharge; payment_refund" } : {}),
      },
      { sourceId: SID, path: `${SID}/${SID}_pb_${period}.csv`, content: pb.shipments, uploadedAt: monthlyUpload(period, 22) },
      { sourceId: SID, path: `${SID}/${SID}_pb-refills_${period}.csv`, content: pb.refills, uploadedAt: monthlyUpload(period, 22) },
      { sourceId: SID, path: `${SID}/${SID}_pb-refunds_${period}.csv`, content: pb.refunds, uploadedAt: monthlyUpload(period, 22) },
      { sourceId: SID, path: `${SID}/${SID}_osm_${period}.csv`, content: osmInvoice(period, osm), uploadedAt: monthlyUpload(period, 23) },
    );
  }
  return files;
}
