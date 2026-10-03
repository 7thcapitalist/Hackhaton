/**
 * OSM / Pitney Bowes / EasyPost: "Shipping amounts" (slide 38: "1st Source acct 0101 · GL 10009").
 * Research and open questions: docs/sources/shipping_osm_pb_easypost.md.
 *
 * Postage for e-commerce shipments bought through three tools. Slide 38 ties
 * them to 1st Source bank account 0101 and GL 10009. [fact: slide text]
 * Signs: + = money in to Goodwill. Carrier/service go in memo; tracking in
 * reference. bankAccountNo "0101" only on wallet top-ups (the cash movement).
 * Buyer address / email / phone columns are never read.
 *
 * Layouts (auto-detected from the header):
 *   1. EasyPost Shipment CSV report [fact: ~43 default columns, docs §1a]
 *      Cost date = postage_label_created_at (label bought), else created_at.
 *      Cost = postage_fee + label_fee + insurance_fee ("shipping_label", −);
 *      `rate` only when the fee columns are absent.
 *      Carrier-billed labels (carrier OSM / FedEx / UPS / DHL… with no
 *      postage_fee: EasyPost does
 *      not collect the postage, the carrier invoices it): postage is NOT
 *      counted here (it comes from the OSM / FedEx invoice), never `rate`;
 *      only EasyPost's own label/insurance fees count. One warning per file
 *      says how many rows were set aside.
 *      refund_status "refunded" → "shipping_refund" (+ postage_fee or rate;
 *      label fee not refunded [guess]); "submitted" → warning; "rejected" → 0.
 *   2. EasyPost Payment Log CSV report [fact: real sample, docs §1b]
 *      Amounts are unsigned ("$12.34000"); direction comes from
 *      source_type → target_type (target "user" = into the wallet, source
 *      "user" = out of the wallet). status complete / completed / creditable
 *      count; pending / failure are skipped.
 *      RULE (no double count) [decision, 2026-10-03]: the SHIPMENT report is
 *      the authority for label cost and label refunds; the PAYMENT LOG is the
 *      authority for cash (recharges, withdrawals) and true account fees.
 *        - recharge → "postage_topup" (− , bank 0101: cash leaves 1st Source).
 *        - payment_refund (wallet balance paid back to the bank/card) →
 *          "postage_topup" (+, bank 0101).
 *        - refund / partial_refund → "wallet_refund" (+, INFORMATIONAL: no KPI
 *          sums it and the close skips it).
 *        - service_fee: label purchases are logged as service_fee. A row tied
 *          to a shipment (tracking / shipment id filled) is a LABEL → not
 *          emitted (counted from the shipment report). A row with no shipment
 *          is a real account fee → "adjustment" (−). When the file has no
 *          tracking / shipment column, every service_fee is treated as a label
 *          and skipped, with one warning.
 *        - other = "delta" (carrier adjustment, APV), manual_credit /
 *          manual_debit, insurance, subscription, payment_failure_deduction →
 *          "adjustment", signed by direction.
 *   3. Pitney Bowes [column names: guess; one file per history type, fact]
 *      PitneyShip / SendPro Online export separate files: Shipments, Postage
 *      (refills), USPS Refunds. The kind comes from a type column, else the
 *      file name (refill / postage / fund → refills; refund → refunds), else
 *      the header (Refund Amount → refunds). Transaction types (also the PB
 *      Shipping API names): POSTAGE PRINT / Label → "shipping_label" (−);
 *      POSTAGE REFUND / Refund (status not denied/pending) → "shipping_refund"
 *      (+); POSTAGE FUND / Refill → "postage_topup" (−, bank 0101);
 *      APV-POSTAGE OVERPAID / CREDIT ADJUSTMENT → "adjustment" (+);
 *      APV-POSTAGE UNDERPAID / DEBIT ADJUSTMENT / FEE → "adjustment" (−);
 *      APV-DISPUTE ADJUSTMENT → "adjustment" (credit if the amount is negative).
 *   4. OSM Worldwide invoice [guess: no public format]
 *      Invoice #, Ship Date, Tracking, Service, Weight, Charge (credits negative).
 *      Only detected when the file name or a title line says "OSM".
 *
 * Open questions for Goodwill
 *   1. Which file does finance actually use for the GL 10009 entry: carrier
 *      reports, EasyPost payment log, or the 1st Source statement?
 *   2. Is 10009 prepaid postage (asset) or cash? Where is postage EXPENSE booked?
 *   3. OSM: invoice format and how it is paid (ACH from 0101?).
 */
import type { ParseContext, ParseResult, ParsedMoneyLine, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import { cell, choosePeriod, dominantPeriod, findHeaderRowAny, headerSet, isTotalRow, parseDate, preambleMatches } from "./_other";

const BANK_ACCOUNT = "0101";

type Layout = "easypost_shipments" | "easypost_payment_log" | "pitney_bowes" | "osm";

const EP_SHIP = {
  date: ["created_at", "Created At"],
  labelDate: ["postage_label_created_at"],
  id: ["id", "shipment_id"],
  tracking: ["tracking_code", "Tracking Code"],
  carrier: ["carrier", "Carrier"],
  service: ["service", "Service"],
  rate: ["rate", "Rate", "postage_cost"],
  labelFee: ["label_fee"],
  postageFee: ["postage_fee"],
  insuranceFee: ["insurance_fee"],
  refundStatus: ["refund_status", "Refund Status"],
};
const EP_PAY = {
  date: ["created_at", "Created At"],
  id: ["id"],
  status: ["status"],
  sourceType: ["source_type"],
  targetType: ["target_type"],
  chargeType: ["charge_type", "Charge Type"],
  amount: ["amount", "Amount"],
  description: ["description"],
  other: ["other"],
  shipmentId: ["shipment_id"],
  tracking: ["tracking_code", "Tracking Number", "tracking_number"],
};
const PB = {
  date: ["Shipment Create Date", "Create Date", "Ship Date", "Shipment Date", "Date", "Transaction Date", "Request Date", "Purchase Date"],
  carrier: ["Carrier Name", "Carrier"],
  service: ["Service", "Service Name", "Carrier Service", "Class of Service", "Mail Class"],
  tracking: ["Tracking Number", "Tracking #", "Tracking No"],
  amount: ["Total Charges", "Total Charge", "Total Cost", "Total", "Refund Amount", "Postage Amount", "Amount"],
  type: ["Transaction Type", "Type"],
  status: ["Refund Status", "Status"],
};
const OSM = {
  invoice: ["Invoice #", "Invoice Number", "Invoice No", "Invoice"],
  date: ["Ship Date", "Shipment Date", "Date", "Invoice Date"],
  tracking: ["Tracking", "Tracking Number", "Tracking #", "Package ID"],
  service: ["Service", "Service Level", "Product"],
  weight: ["Weight", "Weight (lb)", "Billed Weight"],
  amount: ["Charge", "Total Charge", "Amount", "Total", "Charges"],
};

const LAYOUT_SETS: Record<Layout, string[][]> = {
  easypost_shipments: [["created_at", "tracking_code", "carrier", "rate"], ["created_at", "tracking_code", "carrier", "postage_fee"]],
  easypost_payment_log: [["created_at", "charge_type", "amount"]],
  pitney_bowes: [
    ...["Shipment Create Date", "Create Date", "Ship Date", "Shipment Date", "Date", "Transaction Date"].flatMap((d) => [
      ["Carrier Name", "Tracking Number", "Total Charges", d],
      ["Carrier", "Tracking Number", "Total Charges", d],
      ["Carrier", "Tracking Number", "Total", "Postage", d],
    ]),
    ["Request Date", "Tracking Number", "Refund Amount"],
  ],
  osm: OSM.invoice.flatMap((inv) => OSM.tracking.slice(0, 2).flatMap((t) => OSM.amount.slice(0, 3).map((a) => [inv, t, a]))),
};
/** PB postage-refill history: no tracking column, so only with a PB file name. */
const PB_REFILL_SETS = [["Date", "Payment Method", "Amount"], ["Purchase Date", "Payment Method", "Amount"], ["Date", "Transaction ID", "Amount"]];

/** Carriers billed by the carrier itself, not by EasyPost (bring-your-own account). */
const CARRIER_BILLED = /^(osm|osmworldwide|osm worldwide|fedex|fedexdefault|fedexsmartpost|ups|upsdap|dhl\w*|ontrac)$/i;

function detect(table: RawTable, fileName: string): { layout: Layout; header: number } | null {
  for (const layout of ["easypost_shipments", "easypost_payment_log", "pitney_bowes"] as Layout[]) {
    const h = findHeaderRowAny(table, LAYOUT_SETS[layout]);
    if (h >= 0) return { layout, header: h };
  }
  if (/(^|[^a-z])(pb|pitney)/i.test(fileName)) {
    const h = findHeaderRowAny(table, PB_REFILL_SETS);
    if (h >= 0) return { layout: "pitney_bowes", header: h };
  }
  const h = findHeaderRowAny(table, LAYOUT_SETS.osm);
  if (h >= 0) {
    const cells = headerSet(table[h]);
    const fedexLike = /fedex/i.test(fileName) || cells.has("net charge amount") || cells.has("express or ground tracking id");
    const named = /(^|[^a-z])osm/i.test(fileName) || preambleMatches(table.slice(0, h), /\bOSM\b/i);
    if (named && !fedexLike) return { layout: "osm", header: h };
  }
  return null;
}

function line(
  rowNo: number, date: string, amountType: string, cents: number,
  reference: string | null, memo: string | null, bank: string | null = null,
): ParsedMoneyLine {
  return {
    sourceRow: rowNo, channel: null, lineDate: date, period: date.slice(0, 7),
    amountType, amountCents: cents, bankAccountNo: bank, reference, memo,
  };
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Payment-log direction: +1 into the wallet, -1 out of it, 0 unknown. */
function direction(source: string, target: string): number {
  if (target === "user") return 1;
  if (source === "user") return -1;
  return 0;
}

type PbKind = "shipments" | "refills" | "refunds";

function pbKind(fileName: string, header: Set<string>): PbKind {
  if (/refill|postage[-_ ]?(history|purchase)|fund/i.test(fileName.replace(/refund/gi, ""))) return "refills";
  if (/refund/i.test(fileName) || header.has("refund amount")) return "refunds";
  if (header.has("payment method") && !header.has("tracking number")) return "refills";
  return "shipments";
}

export const shippingOsmPbEasypostParser: SourceParser = {
  sourceId: "shipping_osm_pb_easypost",
  version: "0.3.0",

  accepts(table: RawTable, fileName: string): boolean {
    return detect(table, fileName) !== null;
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const found = detect(table, ctx.fileName);
    const result: ParseResult = { orders: [], moneyLines: [], warnings: [], headerRowIndex: found?.header ?? -1, header: [] };
    if (!found) {
      result.warnings.push({ message: "Shipping: not an EasyPost shipment/payment-log, Pitney Bowes or OSM layout." });
      return result;
    }
    const header = table[found.header];
    result.header = header.map(normalizeHeader);
    const out = result.moneyLines;
    const warn = (row: number, message: string) => result.warnings.push({ row, message });
    const carrierBilled = { n: 0, rate: 0 };
    let labelServiceFees = 0;

    const hdr = headerSet(header);
    const pbFileKind = found.layout === "pitney_bowes" ? pbKind(ctx.fileName, hdr) : "shipments";
    const epShip = columnIndex(header, EP_SHIP);
    const epPay = columnIndex(header, EP_PAY);
    const pb = columnIndex(header, PB);
    const osm = columnIndex(header, OSM);

    for (let i = found.header + 1; i < table.length; i++) {
      const row = table[i];
      const rowNo = i + 1;
      if (isBlankRow(row) || isTotalRow(row)) continue;

      if (found.layout === "easypost_shipments") {
        const c = epShip;
        const d = parseDate(cell(row, c.labelDate)) ?? parseDate(cell(row, c.date));
        if (!d) { warn(rowNo, `Bad created_at "${cell(row, c.date)}"; skipped.`); continue; }
        const tracking = cell(row, c.tracking) || cell(row, c.id) || null;
        const carrier = cell(row, c.carrier);
        const memo = `EasyPost ${[carrier, cell(row, c.service)].filter(Boolean).join(" ")}`.trim();
        const postage = toCents(cell(row, c.postageFee));
        const labelFee = toCents(cell(row, c.labelFee)) ?? 0;
        const insurance = toCents(cell(row, c.insuranceFee)) ?? 0;
        const rate = toCents(cell(row, c.rate));
        // Carrier-billed: an OSM / FedEx / UPS… label for which EasyPost charged no
        // postage (postage_fee 0 or absent). A postage_fee > 0 means EasyPost did
        // collect the postage, so it counts like any label.
        const billedByCarrier = CARRIER_BILLED.test(carrier.replace(/[^a-z]/gi, "")) && !(postage && postage > 0);
        let cost: number | null;
        let refundable: number;
        if (billedByCarrier) {
          // Postage is on the carrier's invoice; only EasyPost's own fees count.
          carrierBilled.n++;
          carrierBilled.rate += Math.abs(rate ?? 0);
          cost = labelFee + insurance;
          refundable = 0;
        } else if (postage != null || c.postageFee >= 0) {
          cost = (postage ?? 0) + labelFee + insurance;
          refundable = Math.abs(postage ?? 0);
        } else {
          cost = rate;
          refundable = Math.abs(rate ?? 0);
        }
        if (cost == null) { warn(rowNo, `Shipment ${tracking ?? ""}: no rate or fees; skipped.`); continue; }
        if (cost !== 0) out.push(line(rowNo, d.businessDate, "shipping_label", -Math.abs(cost), tracking, memo));
        const refund = cell(row, c.refundStatus).toLowerCase();
        if (refund === "refunded") {
          if (refundable) out.push(line(rowNo, d.businessDate, "shipping_refund", refundable, tracking, `${memo} (refund)`));
        } else if (refund === "submitted") {
          warn(rowNo, `Shipment ${tracking ?? ""}: refund submitted, not yet granted; not counted.`);
        } else if (refund && refund !== "rejected" && refund !== "not_applicable") {
          warn(rowNo, `Shipment ${tracking ?? ""}: unknown refund_status "${refund}".`);
        }
      } else if (found.layout === "easypost_payment_log") {
        const c = epPay;
        const d = parseDate(cell(row, c.date));
        const amt = toCents(cell(row, c.amount));
        if (!d || amt == null) { warn(rowNo, "Payment log row without date or amount; skipped."); continue; }
        const status = cell(row, c.status).toLowerCase();
        if (status && !["complete", "completed", "creditable"].includes(status)) {
          warn(rowNo, `Payment log ${cell(row, c.id)}: status "${status}"; skipped.`);
          continue;
        }
        if (amt === 0) continue;
        const type = cell(row, c.chargeType).toLowerCase();
        const src = cell(row, c.sourceType).toLowerCase();
        const tgt = cell(row, c.targetType).toLowerCase();
        // Direction from source/target; a signed amount is the fallback.
        const dir = direction(src, tgt) || (amt < 0 ? -1 : 0);
        const shipmentRef = cell(row, c.tracking) || cell(row, c.shipmentId);
        const ref = shipmentRef || cell(row, c.id) || null;
        const memo = `EasyPost ${type}${cell(row, c.description) ? `: ${cell(row, c.description)}` : ""}`;
        const abs = Math.abs(amt);
        const signed = (fallback: number) => (dir || fallback) * abs;
        if (type === "recharge") out.push(line(rowNo, d.businessDate, "postage_topup", -abs, ref, memo, BANK_ACCOUNT));
        else if (type === "payment_refund") out.push(line(rowNo, d.businessDate, "postage_topup", abs, ref, `${memo} (wallet balance returned to the bank)`, BANK_ACCOUNT));
        // Informational only: the shipment report carries the same refund (see RULE in the header).
        else if (type === "refund" || type === "partial_refund") out.push(line(rowNo, d.businessDate, "wallet_refund", abs, ref, `${memo} (informational; counted from the shipment report)`));
        else if (cell(row, c.other).toLowerCase() === "delta") out.push(line(rowNo, d.businessDate, "adjustment", signed(-1), ref, `${memo} (carrier adjustment)`));
        else if (type === "service_fee") {
          const hasShipmentColumn = c.tracking >= 0 || c.shipmentId >= 0;
          if (!hasShipmentColumn || shipmentRef) labelServiceFees++;
          else {
            out.push(line(rowNo, d.businessDate, "adjustment", signed(-1), ref, memo));
          }
        } else if (type === "manual_credit") out.push(line(rowNo, d.businessDate, "adjustment", signed(1), ref, memo));
        else if (["manual_debit", "insurance", "subscription", "payment_failure_deduction"].includes(type)) {
          out.push(line(rowNo, d.businessDate, "adjustment", signed(-1), ref, memo));
        } else warn(rowNo, `Payment log: unknown charge_type "${type}"; not counted.`);
      } else if (found.layout === "pitney_bowes") {
        const c = pb;
        const d = parseDate(cell(row, c.date));
        const amt = toCents(cell(row, c.amount));
        if (!d || amt == null) { warn(rowNo, "Pitney Bowes row without date or amount; skipped."); continue; }
        const type = (cell(row, c.type) || cell(row, c.status)).toLowerCase();
        const status = cell(row, c.status).toLowerCase();
        const tracking = cell(row, c.tracking) || null;
        const memo = `Pitney Bowes ${[cell(row, c.carrier), cell(row, c.service)].filter(Boolean).join(" ")}`.trim();
        const abs = Math.abs(amt);
        const isRefund = /refund|void/.test(type) || (pbFileKind === "refunds" && !/fund\b|refill/.test(type));
        const isRefill = /postage fund|refill|top.?up|deposit|add.?funds|postage purchase/.test(type) || (pbFileKind === "refills" && !type);
        if (/apv.*overpaid|credit adjustment/.test(type)) out.push(line(rowNo, d.businessDate, "adjustment", abs, tracking, `${memo} (${type})`));
        else if (/apv.*underpaid|debit adjustment|^fee$/.test(type)) out.push(line(rowNo, d.businessDate, "adjustment", -abs, tracking, `${memo} (${type})`));
        else if (/apv|dispute/.test(type)) out.push(line(rowNo, d.businessDate, "adjustment", amt < 0 ? abs : -abs, tracking, `${memo} (${type})`));
        else if (isRefund) {
          if (/denied|reject/.test(status)) continue;
          if (/request|pending|submitted/.test(status)) { warn(rowNo, `Pitney Bowes refund ${tracking ?? ""}: ${status}, not yet granted; not counted.`); continue; }
          out.push(line(rowNo, d.businessDate, "shipping_refund", abs, tracking, `${memo} (refund)`));
        } else if (isRefill) out.push(line(rowNo, d.businessDate, "postage_topup", -abs, tracking, `${memo} (postage refill)`.trim(), BANK_ACCOUNT));
        else if (/credit/.test(type) || amt < 0) out.push(line(rowNo, d.businessDate, "shipping_refund", abs, tracking, `${memo} (credit)`));
        else {
          if (type && !/ship|label|print|purchase|complete|deliver|transit/.test(type)) warn(rowNo, `Pitney Bowes: unknown type "${type}"; treated as a label.`);
          out.push(line(rowNo, d.businessDate, "shipping_label", -abs, tracking, memo));
        }
      } else {
        const c = osm;
        const d = parseDate(cell(row, c.date));
        const amt = toCents(cell(row, c.amount));
        if (!d || amt == null) { warn(rowNo, "OSM row without date or amount; skipped."); continue; }
        const ref = [cell(row, c.invoice), cell(row, c.tracking)].filter(Boolean).join(" / ") || null;
        const memo = `OSM ${cell(row, c.service)}`.trim();
        if (amt < 0) out.push(line(rowNo, d.businessDate, "shipping_refund", -amt, ref, `${memo} (credit)`));
        else out.push(line(rowNo, d.businessDate, "shipping_label", -amt, ref, memo));
      }
    }
    if (carrierBilled.n) {
      result.warnings.push({
        message: `${carrierBilled.n} EasyPost label(s) billed by the carrier (OSM/FedEx/UPS; rates ${fmt(carrierBilled.rate)}): postage not counted here, it comes from the carrier's invoice.`,
      });
    }
    if (labelServiceFees && !(found.layout === "easypost_payment_log" && (epPay.tracking >= 0 || epPay.shipmentId >= 0))) {
      result.warnings.push({
        message: `${labelServiceFees} service_fee row(s) without a tracking/shipment column were treated as label purchases and not counted (the shipment report is the authority for label cost).`,
      });
    }
    result.period = choosePeriod(result, dominantPeriod(out.map((l) => l.lineDate)), ctx.period);
    return result;
  },
};
