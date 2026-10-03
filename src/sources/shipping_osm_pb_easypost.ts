/**
 * OSM / Pitney Bowes / EasyPost: "Shipping amounts" (slide 38: "1st Source acct 0101 · GL 10009").
 *
 * What it is
 *   Postage for e-commerce shipments bought through three tools. Slide 38 ties
 *   them to 1st Source bank account 0101 and GL 10009. [fact: slide text]
 *   Our reading: postage is prepaid (wallet top-ups debited from 1st Source
 *   0101) and GL 10009 is a cash / prepaid-postage account. [guess]
 *   The real source of truth for the close may be the BANK statement (debits
 *   from 0101), not the carrier reports. [guess; ask]
 *
 * One parser, four layouts (auto-detected from the header):
 *   1. EasyPost Shipment CSV report [fact: columns per EasyPost docs]
 *      created_at (UTC ISO), id, tracking_code, status, carrier, service, rate,
 *      label_fee, postage_fee, insurance_fee, refund_status
 *      (submitted | refunded | rejected), reference, batch_id …
 *      https://support.easypost.com/hc/en-us/articles/8108495510157-Shipment-CSV-Report
 *      → "shipping_label" = -(postage_fee + label_fee + insurance_fee), or -rate
 *        when the fee columns are absent. refund_status "refunded" → also a
 *        "shipping_refund" = +(postage_fee or rate) [guess: label fee not refunded].
 *        "submitted" → warning (pending), "rejected" → nothing.
 *   2. EasyPost Payment Log CSV report [fact: columns per EasyPost docs]
 *      created_at, id, status, source_type, target_type, charge_type, amount,
 *      balance, description
 *      https://support.easypost.com/hc/en-us/articles/4405420574861-Payment-Log-CSV-Report
 *      charge_type recharge → "postage_topup" (-, bank 0101); refund /
 *      partial_refund → "wallet_refund" (+, INFORMATIONAL, see rule below);
 *      manual_credit / manual_debit / service_fee / insurance / subscription →
 *      "adjustment" (sign by direction); anything else → warning.
 *      Non-complete status → skipped.
 *
 *   RULE (no double count of EasyPost refunds) [decision, 2026-10-03]
 *      A label refund shows up in BOTH EasyPost reports: as refund_status
 *      "refunded" on the shipment report and as a refund row in the payment
 *      log. The SHIPMENT report is the authority for label cost and refunds;
 *      the PAYMENT LOG is the authority for cash (recharges) and account
 *      adjustments. So payment-log refunds are emitted as "wallet_refund",
 *      an amount type no KPI sums and no default GL rule maps: they stay
 *      visible for traceability but never count. The rule is per row and
 *      order-independent (no matter which file is uploaded first, nothing is
 *      deleted). Cost: if Goodwill only ever uploads the payment log, refunds
 *      do not reduce shipping cost; map "wallet_refund" in gl_rules if
 *      finance confirms the payment log is their source of truth.
 *   3. Pitney Bowes SendPro 360 / PitneyAnalytics "Shipment details" report
 *      [partial fact: columns configurable]
 *      Shipment Create Date, Carrier Name, Service, Tracking Number,
 *      Total Charges, (Transaction Type / Refund Status)
 *      https://www.pitneybowes.com/us/support/article/000094526/running-a-shipment-details-report-in-sendpro-360.html
 *      → "shipping_label" (-), refund rows → "shipping_refund" (+), postage
 *        refill rows → "postage_topup" (-, bank 0101). [refund/refill: guess]
 *   4. OSM Worldwide invoice [guess: no public format]
 *      Invoice #, Ship Date, Tracking, Service, Weight, Charge (credits negative).
 *      Only detected when the file name or a title line says "OSM".
 *
 * Signs: + = money in to Goodwill. Carrier/service go in memo; tracking in
 * reference. bankAccountNo "0101" only on top-ups (the cash movement). [guess]
 *
 * Open questions for Goodwill
 *   1. Which file does finance actually use for the GL 10009 entry: carrier
 *      reports, EasyPost payment log, or the 1st Source statement?
 *   2. Is 10009 prepaid postage (asset) or cash? Where is postage EXPENSE booked?
 *   3. Does EasyPost bill per label (post-pay) or from a prepaid wallet?
 *   4. OSM: invoice format and how it is paid (ACH from 0101?).
 *   5. If both the EasyPost shipment report and payment log are uploaded,
 *      refunds appear in both. Handled by the RULE above (shipment report
 *      wins); confirm with finance.
 */
import type { ParseContext, ParseResult, ParsedMoneyLine, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import { cell, choosePeriod, dominantPeriod, findHeaderRowAny, headerSet, isTotalRow, parseDate, preambleMatches } from "./_other";

const BANK_ACCOUNT = "0101";

type Layout = "easypost_shipments" | "easypost_payment_log" | "pitney_bowes" | "osm";

const EP_SHIP = {
  date: ["created_at", "Created At"],
  id: ["id", "shipment_id"],
  tracking: ["tracking_code", "Tracking Code"],
  carrier: ["carrier", "Carrier"],
  service: ["service", "Service"],
  rate: ["rate", "Rate", "postage_cost"],
  labelFee: ["label_fee"],
  postageFee: ["postage_fee"],
  insuranceFee: ["insurance_fee"],
  refundStatus: ["refund_status", "Refund Status"],
  reference: ["reference"],
};
const EP_PAY = {
  date: ["created_at", "Created At"],
  id: ["id"],
  status: ["status"],
  chargeType: ["charge_type", "Charge Type"],
  amount: ["amount", "Amount"],
  description: ["description"],
  tracking: ["tracking_code", "Tracking Number", "tracking_number"],
};
const PB = {
  date: ["Shipment Create Date", "Create Date", "Ship Date", "Shipment Date", "Date", "Transaction Date"],
  carrier: ["Carrier Name", "Carrier"],
  service: ["Service", "Service Name", "Carrier Service", "Class of Service"],
  tracking: ["Tracking Number", "Tracking #", "Tracking No"],
  amount: ["Total Charges", "Total Charge", "Total Cost", "Postage Amount", "Amount"],
  type: ["Transaction Type", "Type", "Refund Status", "Status"],
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
  pitney_bowes: PB.date.flatMap((d) => [
    ["Carrier Name", "Tracking Number", "Total Charges", d],
    ["Carrier", "Tracking Number", "Total Charges", d],
  ]),
  osm: OSM.invoice.flatMap((inv) => OSM.tracking.slice(0, 2).flatMap((t) => OSM.amount.slice(0, 3).map((a) => [inv, t, a]))),
};

function detect(table: RawTable, fileName: string): { layout: Layout; header: number } | null {
  for (const layout of ["easypost_shipments", "easypost_payment_log", "pitney_bowes"] as Layout[]) {
    const h = findHeaderRowAny(table, LAYOUT_SETS[layout]);
    if (h >= 0) return { layout, header: h };
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

export const shippingOsmPbEasypostParser: SourceParser = {
  sourceId: "shipping_osm_pb_easypost",
  version: "0.2.0",

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

    for (let i = found.header + 1; i < table.length; i++) {
      const row = table[i];
      const rowNo = i + 1;
      if (isBlankRow(row) || isTotalRow(row)) continue;

      if (found.layout === "easypost_shipments") {
        const c = columnIndex(header, EP_SHIP);
        const d = parseDate(cell(row, c.date));
        if (!d) { warn(rowNo, `Bad created_at "${cell(row, c.date)}"; skipped.`); continue; }
        const tracking = cell(row, c.tracking) || cell(row, c.id) || null;
        const memo = `EasyPost ${[cell(row, c.carrier), cell(row, c.service)].filter(Boolean).join(" ")}`.trim();
        const postage = toCents(cell(row, c.postageFee));
        const fees = (postage ?? 0) + (toCents(cell(row, c.labelFee)) ?? 0) + (toCents(cell(row, c.insuranceFee)) ?? 0);
        const rate = toCents(cell(row, c.rate));
        const cost = postage != null ? fees : rate;
        if (cost == null) { warn(rowNo, `Shipment ${tracking ?? ""}: no rate or fees; skipped.`); continue; }
        if (cost !== 0) out.push(line(rowNo, d.businessDate, "shipping_label", -Math.abs(cost), tracking, memo));
        const refund = cell(row, c.refundStatus).toLowerCase();
        if (refund === "refunded") {
          const back = Math.abs(postage ?? rate ?? 0);
          if (back) out.push(line(rowNo, d.businessDate, "shipping_refund", back, tracking, `${memo} (refund)`));
        } else if (refund === "submitted") {
          warn(rowNo, `Shipment ${tracking ?? ""}: refund submitted, not yet granted; not counted.`);
        } else if (refund && refund !== "rejected" && refund !== "not_applicable") {
          warn(rowNo, `Shipment ${tracking ?? ""}: unknown refund_status "${refund}".`);
        }
      } else if (found.layout === "easypost_payment_log") {
        const c = columnIndex(header, EP_PAY);
        const d = parseDate(cell(row, c.date));
        const amt = toCents(cell(row, c.amount));
        if (!d || amt == null) { warn(rowNo, "Payment log row without date or amount; skipped."); continue; }
        const status = cell(row, c.status).toLowerCase();
        if (status && status !== "complete" && status !== "completed") {
          warn(rowNo, `Payment log ${cell(row, c.id)}: status "${status}"; skipped.`);
          continue;
        }
        const type = cell(row, c.chargeType).toLowerCase();
        const ref = cell(row, c.tracking) || cell(row, c.id) || null;
        const memo = `EasyPost ${type}${cell(row, c.description) ? `: ${cell(row, c.description)}` : ""}`;
        const abs = Math.abs(amt);
        if (type === "recharge") out.push(line(rowNo, d.businessDate, "postage_topup", -abs, ref, memo, BANK_ACCOUNT));
        // Informational only: the shipment report carries the same refund (see RULE in the header).
        else if (type === "refund" || type === "partial_refund") out.push(line(rowNo, d.businessDate, "wallet_refund", abs, ref, `${memo} (informational; counted from the shipment report)`));
        else if (type === "manual_credit") out.push(line(rowNo, d.businessDate, "adjustment", abs, ref, memo));
        else if (["manual_debit", "service_fee", "insurance", "subscription", "payment_failure_deduction"].includes(type)) {
          out.push(line(rowNo, d.businessDate, "adjustment", -abs, ref, memo));
        } else warn(rowNo, `Payment log: unknown charge_type "${type}"; not counted.`);
      } else if (found.layout === "pitney_bowes") {
        const c = columnIndex(header, PB);
        const d = parseDate(cell(row, c.date));
        const amt = toCents(cell(row, c.amount));
        if (!d || amt == null) { warn(rowNo, "Pitney Bowes row without date or amount; skipped."); continue; }
        const type = cell(row, c.type).toLowerCase();
        const tracking = cell(row, c.tracking) || null;
        const memo = `Pitney Bowes ${[cell(row, c.carrier), cell(row, c.service)].filter(Boolean).join(" ")}`.trim();
        if (/refund|credit|void/.test(type) || amt < 0) out.push(line(rowNo, d.businessDate, "shipping_refund", Math.abs(amt), tracking, `${memo} (refund)`));
        else if (/refill|top.?up|deposit|add.?funds/.test(type)) out.push(line(rowNo, d.businessDate, "postage_topup", -Math.abs(amt), tracking, `${memo} (postage refill)`, BANK_ACCOUNT));
        else {
          if (type && !/ship|label|print|purchase|complete|deliver|transit|^$/.test(type)) warn(rowNo, `Pitney Bowes: unknown type "${type}"; treated as a label.`);
          out.push(line(rowNo, d.businessDate, "shipping_label", -Math.abs(amt), tracking, memo));
        }
      } else {
        const c = columnIndex(header, OSM);
        const d = parseDate(cell(row, c.date));
        const amt = toCents(cell(row, c.amount));
        if (!d || amt == null) { warn(rowNo, "OSM row without date or amount; skipped."); continue; }
        const ref = [cell(row, c.invoice), cell(row, c.tracking)].filter(Boolean).join(" / ") || null;
        const memo = `OSM ${cell(row, c.service)}`.trim();
        if (amt < 0) out.push(line(rowNo, d.businessDate, "shipping_refund", -amt, ref, `${memo} (credit)`));
        else out.push(line(rowNo, d.businessDate, "shipping_label", -amt, ref, memo));
      }
    }
    result.period = choosePeriod(result, dominantPeriod(out.map((l) => l.lineDate)), ctx.period);
    return result;
  },
};
