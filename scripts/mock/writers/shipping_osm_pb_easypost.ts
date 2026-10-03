/**
 * Postage bought through EasyPost, Pitney Bowes and OSM Worldwide, in
 * data/fixtures/shipping_osm_pb_easypost/ (layouts:
 * docs/sources/shipping_osm_pb_easypost.md). KEY = YYYY-MM-DD (daily files,
 * current year) or YYYY-MM (prior year, one file per month). OSM invoices are
 * weekly: _osm_<invoice Monday>.csv covers the previous Mon..Sun.
 *
 * - shipping_osm_pb_easypost_KEY.csv: EasyPost Shipment CSV report, the
 *   real 43 default columns (+ batch_id). Address columns carry obviously fake
 *   values; the parser never reads them. Cost date = postage_label_created_at.
 *   Messy case: the month's first OSM labels were bought through EasyPost with
 *   carrier "OSMWorldwide" and the one-cent placeholder rate: the postage is
 *   on the OSM invoice, so the parser must not count them here.
 * - shipping_osm_pb_easypost_paylog_KEY.csv: EasyPost Payment Log, real
 *   format: unsigned "$12.34000" amounts, direction in source_type →
 *   target_type, one `service_fee` row per label bought (with its Tracking
 *   Number), refunds credited back, recharges from the bank (one per month is
 *   `creditable`), a monthly account service fee (no tracking), and in
 *   September a `payment_refund` (wallet balance returned to the bank).
 * - shipping_osm_pb_easypost_pb_KEY.csv / _pb-refills_ / _pb-refunds_:
 *   Pitney Bowes history exports, one file per history type (Shipments,
 *   Postage refills, USPS Refunds), as PitneyShip / SendPro Online export them.
 *   Column names are a guess.
 * - shipping_osm_pb_easypost_osm_KEY.csv: OSM Worldwide invoice (title
 *   line naming OSM; weekly invoices; credits negative; Total footer).
 *
 * All LF line endings. A refunded EasyPost label shows up in BOTH EasyPost
 * files, and every label purchase is a service_fee in the payment log (that
 * is how EasyPost reports it; the parser counts each once).
 */
import { addDays } from "../../../src/lib/views/dates";
import { csvRow, dec, isoUtc, lines, usDay, usd } from "../format";
import { localToUtc } from "../../../src/lib/views/dates";
import { SEED_NOW, START_DATE, type MockModel, type Shipment } from "../model";
import { ALL_DATES, DONE_WEEKS, PRIOR_YEAR_PERIODS, dailyUpload, lastDayOf, mondayOf, monthlyUpload, weeklyUpload } from "../schedule";
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

/** File key of a date: the month for the prior year (monthly files), else the day. */
const keyOf = (date: string) => (date < START_DATE ? date.slice(0, 7) : date);
/** Last day a refund may land on: prior-year refunds stay inside their month's file. */
const refundDay = (shipDate: string, lagDays: number) => {
  const d = addDays(shipDate, lagDays);
  return shipDate < START_DATE && d > lastDayOf(shipDate.slice(0, 7)) ? lastDayOf(shipDate.slice(0, 7)) : d;
};
const NOW = Date.parse(SEED_NOW);

type Keyed = { key: string; t: number; cells: string[] };
function groupByKey(rows: Keyed[]): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  for (const r of [...rows].sort((a, b) => a.t - b.t)) {
    const list = out.get(r.key) ?? [];
    list.push(r.cells);
    out.set(r.key, list);
  }
  return out;
}

const PAYLOG_HEADER = ["created_at", "id", "status", "source_type", "target_type", "charge_type", "amount", "balance", "description", "Tracking Number"];

/**
 * EasyPost wallet over the whole range, in time order: recharge $1,000 from
 * the bank whenever the balance would go under $300 (the month's first
 * recharge is `creditable`); every label is a service_fee debit; label
 * refunds come back the next day; a $1 account fee on the 15th; in September
 * a payment_refund (wallet balance returned to the bank). Rows are keyed by
 * file (month for the prior year, business day after that); nothing after
 * SEED_NOW is written.
 */
function easypostPaylog(ships: Shipment[], months: readonly string[]): Keyed[] {
  type Ev = { t: number; date: string; kind: "label" | "refund" | "fee" | "withdraw"; cents: number; s?: Shipment };
  const evs: Ev[] = [];
  for (const s of ships) {
    evs.push({ t: s.ts.getTime(), date: s.shipDate, kind: "label", cents: s.costCents, s });
    if (s.refund === "refunded") {
      const day = refundDay(s.shipDate, 1);
      evs.push({ t: localToUtc(day, 18 * 3600).getTime(), date: day, kind: "refund", cents: s.costCents, s });
    }
  }
  for (const m of months) evs.push({ t: localToUtc(`${m}-15`, 8 * 3600).getTime(), date: `${m}-15`, kind: "fee", cents: 100 });
  evs.push({ t: localToUtc("2026-09-28", 9 * 3600).getTime(), date: "2026-09-28", kind: "withdraw", cents: 5_000 });
  evs.sort((a, b) => a.t - b.t);
  const out: Keyed[] = [];
  const state = { balance: 40_000, seq: 0 };
  const creditable = new Set<string>();
  const row = (t: number, date: string, status: string, src: string, tgt: string, type: string, cents: number, tracking = "") => {
    state.seq++;
    out.push({
      key: keyOf(date),
      t,
      cells: [isoUtc(new Date(t)), `paylog_${String(state.seq).padStart(6, "0")}`, status, src, tgt, type, ep5(cents), ep5(state.balance), "", tracking],
    });
  };
  for (const e of evs) {
    if (e.t >= NOW) continue;
    if (e.kind === "label") {
      if (state.balance - e.cents < 30_000) {
        state.balance += 100_000;
        const month = e.date.slice(0, 7);
        row(e.t - 60_000, e.date, creditable.has(month) ? "complete" : "creditable", "bank_account", "user", "recharge", 100_000);
        creditable.add(month);
      }
      state.balance -= e.cents;
      row(e.t, e.date, "complete", "user", "easypost_bank", "service_fee", e.cents, e.s!.tracking);
    } else if (e.kind === "refund") {
      state.balance += e.cents;
      row(e.t, e.date, "complete", "refund", "user", "refund", e.cents, e.s!.tracking);
    } else if (e.kind === "withdraw") {
      state.balance -= e.cents;
      row(e.t, e.date, "complete", "user", "payment_refund", "payment_refund", e.cents);
    } else {
      state.balance -= e.cents;
      row(e.t, e.date, "complete", "user", "easypost_bank", "service_fee", e.cents);
    }
  }
  return out;
}

/**
 * Pitney Bowes over the whole range: refill $500 when the meter would drop
 * under $150. Three history exports: Shipments, Postage (refills), USPS Refunds.
 */
function pitneyBowes(ships: Shipment[]): { shipments: Keyed[]; refills: Keyed[]; refunds: Keyed[] } {
  const shipments: Keyed[] = [];
  const refills: Keyed[] = [];
  const refunds: Keyed[] = [];
  const state = { balance: 30_000 };
  const refillSeq = new Map<string, number>();
  for (const s of ships) {
    if (s.ts.getTime() >= NOW) continue;
    const key = keyOf(s.shipDate);
    if (state.balance - s.costCents < 15_000) {
      state.balance += 50_000;
      const month = s.shipDate.slice(0, 7);
      const n = (refillSeq.get(month) ?? 0) + 1;
      refillSeq.set(month, n);
      refills.push({ key, t: s.ts.getTime() - 60_000, cells: [usDay(s.shipDate), `PB-REFILL-${month.replace("-", "")}-${n}`, "ACH 1st Source ...0101", usd(50_000)] });
    }
    state.balance -= s.costCents;
    const ref = s.ref.length > 20 ? s.ref.slice(0, 20) : s.ref;
    shipments.push({ key, t: s.ts.getTime(), cells: [usDay(s.shipDate), s.carrier, s.service, s.tracking, "ECOM", ref, s.weightLb.toFixed(1), usd(s.costCents), usd(0), usd(s.costCents)] });
    if (s.refund === "refunded") {
      const day = refundDay(s.shipDate, 1);
      const t = localToUtc(day, 17 * 3600).getTime();
      if (t >= NOW) continue;
      state.balance += s.costCents;
      refunds.push({ key: keyOf(day), t, cells: [usDay(day), s.tracking, s.carrier, s.service, usd(s.costCents), "Approved"] });
    }
  }
  return { shipments, refills, refunds };
}
const PB_HEADERS = {
  shipments: ["Date", "Carrier", "Service", "Tracking Number", "Cost Center", "Reference", "Weight (lb)", "Postage", "Extra Services", "Total"],
  refills: ["Date", "Transaction ID", "Payment Method", "Amount"],
  refunds: ["Request Date", "Tracking Number", "Carrier", "Service", "Refund Amount", "Refund Status"],
};

/** OSM Worldwide invoice number: one per week (Monday). */
const invoiceOf = (date: string) => `OSM-INV-${mondayOf(date).replace(/-/g, "")}`;

/** OSM invoice rows (charges + credits), credits 3 days after the label. */
function osmRows(ships: Shipment[]): { date: string; t: number; cents: number; cells: string[] }[] {
  const rows: { date: string; t: number; cents: number; cells: string[] }[] = [];
  for (const s of ships) {
    rows.push({ date: s.shipDate, t: s.ts.getTime(), cents: s.costCents, cells: [invoiceOf(s.shipDate), usDay(s.shipDate), s.tracking, s.service, s.weightLb.toFixed(1), usd(s.costCents)] });
    if (s.refund === "refunded") {
      const day = refundDay(s.shipDate, 3);
      rows.push({ date: day, t: localToUtc(day, 12 * 3600).getTime(), cents: -s.costCents, cells: [invoiceOf(day), usDay(day), s.tracking, "Credit - undeliverable", s.weightLb.toFixed(1), usd(-s.costCents)] });
    }
  }
  return rows.sort((a, b) => a.t - b.t);
}

function osmInvoice(title: string, rows: { cents: number; cells: string[] }[]): string {
  const total = rows.reduce((t, r) => t + r.cents, 0);
  return lines(
    [
      csvRow([title, "", "", "", "", ""]),
      csvRow(["Invoice #", "Ship Date", "Tracking", "Service", "Weight", "Charge"]),
      ...rows.map((r) => csvRow(r.cells)),
      csvRow(["", "", "", "", "Total", usd(total)]),
    ],
    "\n",
  );
}

/**
 * Prior year: six files per month. Current year (highest frequency each tool
 * supports): EasyPost shipments + payment log and the Pitney Bowes history
 * exports DAILY (one file per business day; an empty refills/refunds export is
 * not written), OSM WEEKLY (its invoice cycle; the running week is not
 * invoiced yet).
 */
export function writeShipping(model: MockModel): FixtureFile[] {
  const files: FixtureFile[] = [];
  const all = (tool: Shipment["tool"]) => model.shipments.filter((s) => s.tool === tool).sort(byTime);
  const ep = all("easypost").filter((s) => s.ts.getTime() < NOW);
  const osm = all("osm");
  // The first OSM labels of each month were bought through EasyPost (carrier-billed, 1-cent rate).
  const osmVia = new Set<Shipment>();
  const perMonth = new Map<string, number>();
  for (const s of osm) {
    const m = s.shipDate.slice(0, 7);
    const n = perMonth.get(m) ?? 0;
    if (n < 3) osmVia.add(s);
    perMonth.set(m, n + 1);
  }
  const months = [...PRIOR_YEAR_PERIODS, ...new Set(ALL_DATES.map((d) => d.slice(0, 7)))];
  const paylog = groupByKey(easypostPaylog(ep, months));
  const pb = pitneyBowes(all("pitney_bowes"));
  const pbBy = { shipments: groupByKey(pb.shipments), refills: groupByKey(pb.refills), refunds: groupByKey(pb.refunds) };

  const keys: { key: string; upload: (offset: number) => string }[] = [
    ...PRIOR_YEAR_PERIODS.map((p) => ({ key: p, upload: (o: number) => monthlyUpload(p, o) })),
    ...ALL_DATES.map((d) => ({ key: d, upload: (o: number) => dailyUpload(d, o) })),
  ];
  for (const { key, upload } of keys) {
    const inKey = (s: Shipment) => keyOf(s.shipDate) === key;
    files.push({ sourceId: SID, path: `${SID}/${SID}_${key}.csv`, content: easypostShipments(ep.filter(inKey), osm.filter((s) => osmVia.has(s) && inKey(s))), uploadedAt: upload(20) });
    const pl = paylog.get(key);
    if (pl?.length) files.push({ sourceId: SID, path: `${SID}/${SID}_paylog_${key}.csv`, content: lines([csvRow(PAYLOG_HEADER), ...pl.map((c) => csvRow(c))], "\n"), uploadedAt: upload(21) });
    for (const [kind, suffix] of [["shipments", "pb"], ["refills", "pb-refills"], ["refunds", "pb-refunds"]] as const) {
      const rows = pbBy[kind].get(key);
      if (rows?.length) files.push({ sourceId: SID, path: `${SID}/${SID}_${suffix}_${key}.csv`, content: lines([csvRow(PB_HEADERS[kind]), ...rows.map((c) => csvRow(c))], "\n"), uploadedAt: upload(22) });
    }
  }
  // OSM: monthly invoice file for the prior year, weekly invoices after that.
  const rows = osmRows(osm);
  for (const p of PRIOR_YEAR_PERIODS) {
    files.push({ sourceId: SID, path: `${SID}/${SID}_osm_${p}.csv`, content: osmInvoice("OSM Worldwide invoice", rows.filter((r) => r.date.startsWith(p))), uploadedAt: monthlyUpload(p, 23) });
  }
  for (const mon of DONE_WEEKS) {
    const week = rows.filter((r) => r.date >= START_DATE && mondayOf(r.date) === mon);
    files.push({ sourceId: SID, path: `${SID}/${SID}_osm_${addDays(mon, 7)}.csv`, content: osmInvoice(`OSM Worldwide invoice ${invoiceOf(mon)}`, week), uploadedAt: weeklyUpload(mon, 23) });
  }
  return files;
}
