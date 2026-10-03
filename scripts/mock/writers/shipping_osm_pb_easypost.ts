/**
 * Postage bought through EasyPost, Pitney Bowes SendPro 360 and OSM Worldwide,
 * four files per closed month in data/fixtures/shipping_osm_pb_easypost/
 * (layouts = the four samples in src/sources/__samples__/other/):
 *
 * - shipping_osm_pb_easypost_YYYY-MM.csv: EasyPost Shipment CSV report
 *   (created_at UTC ISO, rate/label_fee/postage_fee, refund_status
 *   refunded | submitted).
 * - shipping_osm_pb_easypost_paylog_YYYY-MM.csv: EasyPost Payment Log
 *   (recharges from the bank when the wallet runs low, label refunds credited
 *   back, a monthly service fee) with the running balance.
 * - shipping_osm_pb_easypost_pb_YYYY-MM.csv: Pitney Bowes shipment details
 *   (title line; Label / Refund / Refill rows).
 * - shipping_osm_pb_easypost_osm_YYYY-MM.csv: OSM Worldwide invoice (title
 *   line naming OSM; weekly invoices; credits negative; Total footer).
 *
 * All LF line endings. A refunded EasyPost label shows up in BOTH EasyPost
 * files (that is how EasyPost reports it; the parser counts it once).
 */
import { addDays } from "../../../src/lib/views/dates";
import { csvRow, dec, isoUtc, lines, usDay, usd } from "../format";
import { localToUtc } from "../../../src/lib/views/dates";
import type { MockModel, Shipment } from "../model";
import { lastDayOf, MONTHLY_PERIODS, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const SID = "shipping_osm_pb_easypost";

const byTime = (a: Shipment, b: Shipment) => a.ts.getTime() - b.ts.getTime() || a.tracking.localeCompare(b.tracking);

function easypostShipments(ships: Shipment[]): string {
  const header = ["created_at", "id", "tracking_code", "status", "carrier", "service", "rate", "label_fee", "postage_fee", "insurance_fee", "refund_status", "reference", "batch_id"];
  const rows = ships.map((s, i) =>
    csvRow([
      isoUtc(s.ts), s.shipmentId, s.tracking, s.refund ? "unknown" : i % 9 === 0 ? "in_transit" : "delivered", s.carrier,
      s.service, dec(s.costCents), "0.00", dec(s.costCents), "", s.refund ?? "", s.ref, "",
    ]),
  );
  return lines([csvRow(header), ...rows], "\n");
}

/**
 * EasyPost wallet: recharge $1,000 from the bank whenever the balance would go
 * under $300; label refunds come back the next day. The balance carries over
 * from month to month (`state`).
 */
function easypostPaylog(period: string, ships: Shipment[], state: { balance: number; seq: number }): string {
  const header = ["created_at", "id", "status", "source_type", "target_type", "charge_type", "amount", "balance", "description"];
  type Ev = { t: number; kind: "label" | "refund" | "fee"; cents: number; s?: Shipment };
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
  evs.sort((a, b) => a.t - b.t);
  const out: string[] = [];
  const row = (t: number, status: string, src: string, tgt: string, type: string, cents: number, desc: string) => {
    state.seq++;
    out.push(csvRow([isoUtc(new Date(t)), `paylog_${String(state.seq).padStart(6, "0")}`, status, src, tgt, type, dec(cents), dec(state.balance), desc]));
  };
  for (const e of evs) {
    if (e.kind === "label") {
      if (state.balance - e.cents < 30_000) {
        state.balance += 100_000;
        row(e.t - 60_000, "complete", "bank_account", "easypost_bank", "recharge", 100_000, "Recharge from bank account");
      }
      state.balance -= e.cents; // label purchases are not rows in the payment log
    } else if (e.kind === "refund") {
      state.balance += e.cents;
      row(e.t, "complete", "refund", "user", "refund", e.cents, `Refund for ${e.s!.shipmentId}`);
    } else {
      state.balance -= e.cents;
      row(e.t, "complete", "user", "easypost_bank", "service_fee", e.cents, "Monthly service fee");
    }
  }
  return lines([csvRow(header), ...out], "\n");
}

/** Pitney Bowes: refill $500 when the meter would drop under $150. */
function pitneyBowes(period: string, ships: Shipment[], state: { balance: number }): string {
  const header = ["Shipment Create Date", "Carrier Name", "Service", "Tracking Number", "Total Charges", "Transaction Type"];
  const monthEnd = lastDayOf(period);
  type Ev = { date: string; t: number; cells: string[] };
  const evs: Ev[] = [];
  for (const s of ships) {
    if (state.balance - s.costCents < 15_000) {
      state.balance += 50_000;
      evs.push({ date: s.shipDate, t: s.ts.getTime() - 1, cells: [usDay(s.shipDate), "", "Postage Refill", "", usd(50_000), "Refill"] });
    }
    state.balance -= s.costCents;
    evs.push({ date: s.shipDate, t: s.ts.getTime(), cells: [usDay(s.shipDate), s.carrier, s.service, s.tracking, usd(s.costCents), "Label"] });
    if (s.refund === "refunded") {
      const day = addDays(s.shipDate, 1) <= monthEnd ? addDays(s.shipDate, 1) : monthEnd;
      state.balance += s.costCents;
      evs.push({ date: day, t: localToUtc(day, 17 * 3600).getTime(), cells: [usDay(day), s.carrier, s.service, s.tracking, usd(s.costCents), "Refund"] });
    }
  }
  evs.sort((a, b) => a.t - b.t);
  return lines([csvRow(["Pitney Bowes SendPro 360 - Shipment Details", "", "", "", "", ""]), csvRow(header), ...evs.map((e) => csvRow(e.cells))], "\n");
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
    files.push(
      { sourceId: SID, path: `${SID}/${SID}_${period}.csv`, content: easypostShipments(ep), uploadedAt: monthlyUpload(period, 20) },
      { sourceId: SID, path: `${SID}/${SID}_paylog_${period}.csv`, content: easypostPaylog(period, ep, epState), uploadedAt: monthlyUpload(period, 21) },
      { sourceId: SID, path: `${SID}/${SID}_pb_${period}.csv`, content: pitneyBowes(period, of("pitney_bowes"), pbState), uploadedAt: monthlyUpload(period, 22) },
      { sourceId: SID, path: `${SID}/${SID}_osm_${period}.csv`, content: osmInvoice(period, of("osm")), uploadedAt: monthlyUpload(period, 23) },
    );
  }
  return files;
}
