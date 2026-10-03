/**
 * EasyPost Shipments API (JSON) parser: the API twin of the "EasyPost
 * Shipment CSV report" layout in ./shipping_osm_pb_easypost.ts.
 * sourceId is "shipping_osm_pb_easypost", same as the CSV parser, and the
 * money lines are built with the SAME rules, amounts, dates, references and
 * memos, so a shipment pulled by API matches the same shipment in the CSV.
 *
 * Accepted documents (one API response per file, saved verbatim):
 *  - List all shipments: GET /v2/shipments → { shipments: Shipment[], has_more }
 *  - Retrieve a shipment: GET /v2/shipments/:id → Shipment (object "Shipment")
 *  https://docs.easypost.com/docs/shipments
 *  Shipment fields used: id ("shp_…"), created_at (ISO 8601 UTC), tracking_code,
 *  selected_rate { carrier, service, rate (decimal string) }, fees[] (Fee:
 *  { object "Fee", type "LabelFee" | "PostageFee" | "InsuranceFee" | …,
 *  amount (decimal string), charged, refunded }), refund_status
 *  ("submitted" | "refunded" | "rejected" | null), mode ("test" | "production").
 *
 * Rules (identical to the CSV layout, see that file's header):
 *  - "shipping_label" = −(PostageFee + LabelFee + InsuranceFee) when a
 *    PostageFee exists, else −selected_rate.rate. Fees with charged=false are ignored.
 *  - refund_status "refunded" → "shipping_refund" = +(PostageFee or rate).
 *    "submitted" → warning (pending, not counted). "rejected"/null → nothing.
 *  - Shipments without selected_rate (never purchased) → skipped with a warning.
 *  - line_date = business date (America/Indiana/Indianapolis) of created_at;
 *    reference = tracking_code (else id); memo = "EasyPost <carrier> <service>".
 *  - mode is not used: a test-key pull produces test shipments, and that is
 *    the caller's choice (the connector reports which key mode it used).
 *
 * The EasyPost Payment Log is not a JSON list endpoint we use: the connector
 * pulls it with the Reports API, which returns the same CSV the existing
 * parser reads.
 */
import type { ParsedMoneyLine, ParseResult } from "./types";
import { parseDate, choosePeriod, dominantPeriod } from "./_other";
import { arr, decimalCents, isObj, jsonSourceParser, str, topKeys, type Obj } from "./_shared/json";

function isShipment(v: unknown): v is Obj {
  return isObj(v) && (v.object === "Shipment" || (typeof v.id === "string" && v.id.startsWith("shp_")));
}

function shipmentsOf(json: unknown): Obj[] | null {
  if (isObj(json) && Array.isArray(json.shipments)) return json.shipments.filter(isObj);
  if (isShipment(json)) return [json];
  return null;
}

function line(
  rowNo: number, date: string, amountType: string, cents: number, reference: string | null, memo: string,
): ParsedMoneyLine {
  return {
    sourceRow: rowNo, channel: null, lineDate: date, period: date.slice(0, 7),
    amountType, amountCents: cents, bankAccountNo: null, reference, memo,
  };
}

export const easypostApiParser = jsonSourceParser({
  sourceId: "shipping_osm_pb_easypost",
  version: "api-1.0.0",

  acceptsJson(json: unknown): boolean {
    const list = shipmentsOf(json);
    return list !== null && (list.length === 0 ? isObj(json) && "has_more" in json : list.every(isShipment));
  },

  parseJson(json, ctx): ParseResult {
    const result: ParseResult = { orders: [], moneyLines: [], warnings: [], headerRowIndex: 0, header: topKeys(json) };
    const list = shipmentsOf(json);
    if (!list) {
      result.warnings.push({ message: "Not an EasyPost shipments response." });
      return result;
    }
    const out = result.moneyLines;
    const warn = (row: number, message: string) => result.warnings.push({ row, message });

    list.forEach((s, i) => {
      const rowNo = i + 1;
      const d = parseDate(str(s.created_at));
      if (!d) { warn(rowNo, `Bad created_at "${str(s.created_at)}"; skipped.`); return; }
      const rate = isObj(s.selected_rate) ? s.selected_rate : null;
      const tracking = str(s.tracking_code) || str(s.id) || null;
      if (!rate) { warn(rowNo, `Shipment ${tracking ?? ""}: not purchased (no selected_rate); skipped.`); return; }
      const memo = `EasyPost ${[str(rate.carrier), str(rate.service)].filter(Boolean).join(" ")}`.trim();

      const fees = arr(s.fees).filter((f): f is Obj => isObj(f) && f.charged !== false);
      const feeOf = (type: string): number | null => {
        const hits = fees.filter((f) => str(f.type) === type).map((f) => decimalCents(f.amount) ?? 0);
        return hits.length ? hits.reduce((a, b) => a + b, 0) : null;
      };
      const postage = feeOf("PostageFee");
      const total = (postage ?? 0) + (feeOf("LabelFee") ?? 0) + (feeOf("InsuranceFee") ?? 0);
      const rateCents = decimalCents(rate.rate);
      const cost = postage != null ? total : rateCents;
      if (cost == null) { warn(rowNo, `Shipment ${tracking ?? ""}: no rate or fees; skipped.`); return; }
      if (cost !== 0) out.push(line(rowNo, d.businessDate, "shipping_label", -Math.abs(cost), tracking, memo));

      const refund = str(s.refund_status).toLowerCase();
      if (refund === "refunded") {
        const back = Math.abs(postage ?? rateCents ?? 0);
        if (back) out.push(line(rowNo, d.businessDate, "shipping_refund", back, tracking, `${memo} (refund)`));
      } else if (refund === "submitted") {
        warn(rowNo, `Shipment ${tracking ?? ""}: refund submitted, not yet granted; not counted.`);
      } else if (refund && refund !== "rejected" && refund !== "not_applicable") {
        warn(rowNo, `Shipment ${tracking ?? ""}: unknown refund_status "${refund}".`);
      }
    });

    result.period = choosePeriod(result, dominantPeriod(out.map((l) => l.lineDate)), ctx.period);
    const day = ctx.fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
    if (day && out.length > 0 && out.every((l) => l.lineDate === day)) result.businessDate = day;
    return result;
  },
});
