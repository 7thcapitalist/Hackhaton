/**
 * Mock EasyPost responses, in the exact real shapes:
 *  - GET /v2/shipments → { shipments: Shipment[], has_more }   https://docs.easypost.com/docs/shipments
 *  - Reports API payment_log CSV (same columns as the dashboard export)
 *    https://docs.easypost.com/docs/reports
 *    https://support.easypost.com/hc/en-us/articles/4405420574861-Payment-Log-CSV-Report
 *
 * Shipments come from an EasyPost shipment CSV in data/fixtures/
 * shipping_osm_pb_easypost/ when one covers the day (same shipments, API
 * shape), otherwise they are generated deterministically from the date.
 * mode is "test": these are not real labels. Addresses are fake.
 */
import { dec, eventTimes, rng } from "../util";

export interface MockShipment {
  id: string;
  createdAt: string; // ISO UTC, no millis (EasyPost style)
  trackingCode: string;
  status: string;
  carrier: string;
  service: string;
  rateCents: number;
  labelFeeCents: number;
  postageFeeCents: number | null;
  insuranceFeeCents: number | null;
  refundStatus: string | null;
  reference: string | null;
}

const isoSec = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export function generateShipments(day: string): MockShipment[] {
  const r = rng(`easypost:${day}`);
  const n = r.int(3, 6);
  return eventTimes(r, day, n, false).map((t, i) => {
    const ups = r.chance(0.15);
    const priority = !ups && r.chance(0.2);
    const rate = ups ? r.int(950, 1450) : priority ? r.int(880, 1250) : r.int(455, 760);
    const refunded = r.chance(0.08);
    return {
      id: `shp_${r.hex(32)}`,
      createdAt: isoSec(t),
      trackingCode: ups ? `1Z${r.digits(16)}` : `9400${r.digits(18)}`,
      status: refunded ? "unknown" : r.pick(["pre_transit", "in_transit", "delivered"]),
      carrier: ups ? "UPS" : "USPS",
      service: ups ? "Ground" : priority ? "Priority" : "GroundAdvantage",
      rateCents: rate,
      labelFeeCents: ups ? 5 : 0,
      postageFeeCents: rate,
      insuranceFeeCents: r.chance(0.1) ? r.int(50, 120) : null,
      refundStatus: refunded ? "refunded" : null,
      reference: `ECOM-${day.replace(/-/g, "")}-${i + 1}`,
    };
  });
}

/** Rows of an EasyPost Shipment CSV report (header → value maps) → mock shipments. */
export function shipmentsFromCsvRows(rows: Record<string, string>[]): MockShipment[] {
  const cents = (v: string | undefined) => (v && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Math.round(parseFloat(v) * 100) : null);
  return rows
    .filter((row) => row.created_at && row.id)
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      trackingCode: row.tracking_code ?? "",
      status: row.status || "unknown",
      carrier: row.carrier ?? "",
      service: row.service ?? "",
      rateCents: cents(row.rate) ?? 0,
      labelFeeCents: cents(row.label_fee) ?? 0,
      postageFeeCents: cents(row.postage_fee),
      insuranceFeeCents: cents(row.insurance_fee),
      refundStatus: row.refund_status || null,
      reference: row.reference || null,
    }));
}

const ADDRESS_FROM = {
  id: "adr_mockfrom0000000000000000000001", object: "Address", mode: "test",
  name: "Goodwill E-commerce (mock)", company: null, street1: "1805 Test Ave", street2: null,
  city: "South Bend", state: "IN", zip: "46628", country: "US", phone: null, email: null,
  residential: false, verifications: {},
};

export function toEasypostShipment(s: MockShipment): Record<string, unknown> {
  const r = rng(`easypost-shp:${s.id}`);
  const fees: Record<string, unknown>[] = [
    { object: "Fee", type: "LabelFee", amount: dec(s.labelFeeCents, 5), charged: true, refunded: false },
  ];
  if (s.postageFeeCents != null) {
    fees.push({ object: "Fee", type: "PostageFee", amount: dec(s.postageFeeCents, 5), charged: true, refunded: s.refundStatus === "refunded" });
  }
  if (s.insuranceFeeCents != null) {
    fees.push({ object: "Fee", type: "InsuranceFee", amount: dec(s.insuranceFeeCents, 5), charged: true, refunded: false });
  }
  const rateId = `rate_${r.hex(32)}`;
  const rate = {
    id: rateId, object: "Rate", created_at: s.createdAt, updated_at: s.createdAt, mode: "test",
    service: s.service, carrier: s.carrier, rate: dec(s.rateCents), currency: "USD",
    retail_rate: dec(Math.round(s.rateCents * 1.15)), retail_currency: "USD",
    list_rate: dec(Math.round(s.rateCents * 1.05)), list_currency: "USD",
    billing_type: "easypost", delivery_days: r.int(2, 5), delivery_date: null,
    delivery_date_guaranteed: false, est_delivery_days: r.int(2, 5),
    shipment_id: s.id, carrier_account_id: `ca_${r.hex(32)}`,
  };
  return {
    id: s.id,
    object: "Shipment",
    mode: "test",
    created_at: s.createdAt,
    updated_at: s.createdAt,
    reference: s.reference,
    status: s.status,
    tracking_code: s.trackingCode,
    is_return: false,
    options: { currency: "USD", label_format: "PNG", date_advance: 0 },
    messages: [],
    to_address: {
      id: `adr_${r.hex(32)}`, object: "Address", mode: "test", name: "Mock Buyer", company: null,
      street1: "100 Test St", street2: null, city: "Indianapolis", state: "IN", zip: "46204",
      country: "US", phone: null, email: null, residential: true, verifications: {},
    },
    from_address: ADDRESS_FROM,
    return_address: ADDRESS_FROM,
    buyer_address: null,
    parcel: { id: `prcl_${r.hex(32)}`, object: "Parcel", mode: "test", length: 10, width: 8, height: 4, weight: r.int(8, 64), predefined_package: null },
    customs_info: null,
    rates: [rate],
    selected_rate: rate,
    postage_label: {
      id: `pl_${r.hex(32)}`, object: "PostageLabel", created_at: s.createdAt, updated_at: s.createdAt,
      date_advance: 0, integrated_form: "none", label_date: s.createdAt, label_resolution: 300,
      label_size: "4x6", label_type: "default", label_file_type: "image/png",
      label_url: "https://easypost-files.s3.us-west-2.amazonaws.com/files/postage_label/mock.png",
      label_pdf_url: null, label_zpl_url: null, label_epl2_url: null, label_file: null,
    },
    tracker: null,
    insurance: s.insuranceFeeCents != null ? dec(s.insuranceFeeCents * 100) : null,
    fees,
    batch_id: null,
    batch_status: null,
    batch_message: null,
    usps_zone: s.carrier === "USPS" ? r.int(1, 8) : null,
    refund_status: s.refundStatus,
    scan_form: null,
    forms: [],
  };
}

/** List-all-shipments response. */
export function shipmentsPage(shipments: MockShipment[]): Record<string, unknown> {
  // The API lists newest first.
  const sorted = [...shipments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { shipments: sorted.map(toEasypostShipment), has_more: false };
}

/** Payment log report CSV for one day: a wallet recharge plus refunds of refunded labels. */
export function paymentLogCsv(day: string, shipments: MockShipment[]): string {
  const r = rng(`easypost-paylog:${day}`);
  const header = "created_at,id,status,source_type,target_type,charge_type,amount,balance,description";
  const rows: string[] = [];
  let balance = r.int(150, 400) * 100;
  const morning = isoSec(new Date(`${day}T13:00:00Z`));
  const topup = Math.max(10000, Math.ceil(shipments.reduce((a, s) => a + s.rateCents, 0) / 5000) * 5000);
  balance += topup;
  rows.push([morning, `paylog_${r.hex(24)}`, "complete", "bank_account", "easypost_bank", "recharge", dec(topup), dec(balance), "Recharge from bank account"].join(","));
  for (const s of shipments.filter((x) => x.refundStatus === "refunded")) {
    const amt = s.postageFeeCents ?? s.rateCents;
    balance += amt;
    rows.push([s.createdAt, `paylog_${r.hex(24)}`, "complete", "refund", "user", "refund", dec(amt), dec(balance), `Refund for ${s.id}`].join(","));
  }
  return [header, ...rows].join("\n") + "\n";
}
