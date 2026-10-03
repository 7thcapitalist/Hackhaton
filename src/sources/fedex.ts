/**
 * FedEx: "Shipping charges + refunds"
 * (slide 38: "BC GL 40356 · Dept 180 · V00122 · net BNKDEPOSIT refunds").
 * Research: docs/sources/fedex.md.
 *
 * What it is
 *   FedEx shipping invoices for e-commerce shipments. In Business Central they
 *   post to GL 40356, Department 180, vendor V00122 [fact: slide text]; refunds
 *   that came in as bank deposits ("BNKDEPOSIT") are netted against the
 *   charges [guess on mechanics]. GL/vendor codes live in gl_rules, not here.
 *
 * Layouts accepted
 *   1. FedEx Billing Online "All Columns" CSV [fact: FedEx data dictionary]:
 *      one row per tracking id per invoice, ~150 columns, dates yyyymmdd,
 *      plain amounts ("12.48"), 25 × (Tracking ID Charge Description,
 *      Tracking ID Charge Amount) pairs with the SAME header names, invoice-
 *      level Original Amount Due / Current Balance repeated (never summed).
 *   2. FedEx EDI CSV invoice [fact: CSV selectable invoice guide]: Invoice
 *      Number, Invoice Date, Type (invoice type), Tracking Number, Ship Date,
 *      Net Chrg, …
 *   3. Our older guessed layout (MM/DD/YYYY, "$12.48") still parses.
 *
 * What we emit (money_lines, + = money in)
 *   Net Charge Amount > 0 → "shipping_label" (−); < 0 → "shipping_refund" (+).
 *   The sign alone decides: charge descriptions are surcharge names (fuel,
 *   residential…), not credit flags. reference = "<invoice> / <tracking>";
 *   memo = service type + the non-empty charge descriptions.
 *   lineDate = Shipment Date, else Invoice Date.
 *   Invoice type "Resend" / "Past Due" / "Duplicate" (EDI `Type`) repeats
 *   charges already billed → skipped with one warning. An exact repeat of an
 *   (invoice, tracking, amount, descriptions) row in the same file → skipped.
 *   Bill-to account numbers and recipient name/address are never read.
 *
 * Open questions for Goodwill
 *   1. Which date decides the month: invoice date or ship date?
 *   2. "net BNKDEPOSIT refunds": refunds paid as money are not in any FedEx
 *      file; they need the bank statement.
 *   3. Are all FedEx shipments e-commerce (Dept 180)?
 */
import type { ParseContext, ParseResult, ParsedMoneyLine, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import { cell, choosePeriod, dominantPeriod, findHeaderRowAny, headerSet, isTotalRow, parseDate, preambleMatches } from "./_other";

const COLS = {
  invoice: ["Invoice Number", "Invoice #", "Invoice No", "Invoice"],
  invoiceDate: ["Invoice Date"],
  invoiceType: ["Invoice Type", "Type"],
  tracking: ["Express or Ground Tracking ID", "Tracking ID", "Tracking Number", "Ground Tracking ID", "Tracking #"],
  shipDate: ["Shipment Date", "Ship Date"],
  service: ["Service Type", "Service", "Ground Service"],
  groundService: ["Ground Service"],
  amount: ["Net Charge Amount", "Net Chrg", "Net Charge", "Net Amount", "Total Net Charge", "Charge Amount"],
};

const REQUIRED_SETS = COLS.invoice.slice(0, 3).flatMap((i) => COLS.amount.slice(0, 5).map((a) => [i, a]));
const FOREIGN = ["created_at", "tracking_code", "charge_type", "total charges", "settlement id", "order id", "channel order id"];
const DESCRIPTION_HEADERS = new Set(["tracking id charge description", "charge description"]);
const RESENT_TYPES = /resend|re-send|past due|duplicate|copy/i;

function locateHeader(table: RawTable): number {
  return findHeaderRowAny(table, REQUIRED_SETS);
}

export const fedexParser: SourceParser = {
  sourceId: "fedex",
  version: "0.2.0",

  accepts(table: RawTable, fileName: string): boolean {
    const h = locateHeader(table);
    if (h < 0) return false;
    const cells = headerSet(table[h]);
    if (FOREIGN.some((f) => cells.has(f))) return false;
    const fedexColumns = cells.has("express or ground tracking id") || cells.has("net charge amount") || cells.has("net chrg");
    const named = /fedex/i.test(fileName) || preambleMatches(table.slice(0, h), /fedex/i);
    const osm = /(^|[^a-z])osm/i.test(fileName) || preambleMatches(table.slice(0, h), /\bOSM\b/i);
    return !osm && (fedexColumns || named);
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const headerRowIndex = locateHeader(table);
    const result: ParseResult = { orders: [], moneyLines: [], warnings: [], headerRowIndex, header: [] };
    if (headerRowIndex < 0) {
      result.warnings.push({ message: "FedEx: header row not found (need Invoice Number + Net Charge Amount)." });
      return result;
    }
    const header = table[headerRowIndex];
    result.header = header.map(normalizeHeader);
    const c = columnIndex(header, COLS);
    if (c.tracking < 0) result.warnings.push({ message: "FedEx: no tracking id column; references use the invoice number only." });
    // All 25 "Tracking ID Charge Description" columns (same header name).
    const descCols = result.header.map((h, i) => (DESCRIPTION_HEADERS.has(h) ? i : -1)).filter((i) => i >= 0);

    const out: ParsedMoneyLine[] = result.moneyLines;
    const seen = new Set<string>();
    let resent = 0;
    let repeats = 0;
    for (let i = headerRowIndex + 1; i < table.length; i++) {
      const row = table[i];
      const rowNo = i + 1;
      if (isBlankRow(row) || isTotalRow(row)) continue;
      const amount = toCents(cell(row, c.amount));
      const date = parseDate(cell(row, c.shipDate)) ?? parseDate(cell(row, c.invoiceDate));
      if (amount == null || !date) {
        result.warnings.push({ row: rowNo, message: `Skipped row: ${amount == null ? "no Net Charge Amount" : "no shipment or invoice date"}.` });
        continue;
      }
      if (amount === 0) continue;
      if (RESENT_TYPES.test(cell(row, c.invoiceType))) {
        resent++;
        continue;
      }
      const invoice = cell(row, c.invoice);
      const tracking = cell(row, c.tracking);
      const descs = descCols.map((d) => cell(row, d)).filter(Boolean);
      const key = [invoice, tracking, amount, ...descs].join("|");
      if (seen.has(key)) {
        repeats++;
        continue;
      }
      seen.add(key);
      const reference = [invoice, tracking].filter(Boolean).join(" / ") || null;
      const service = [cell(row, c.service), c.groundService !== c.service ? cell(row, c.groundService) : ""].filter(Boolean).join(" ");
      const memo = ["FedEx", service, descs.slice(0, 4).join(", ")].filter(Boolean).join(" · ");
      const isCredit = amount < 0;
      out.push({
        sourceRow: rowNo,
        channel: null,
        lineDate: date.businessDate,
        period: date.businessDate.slice(0, 7),
        amountType: isCredit ? "shipping_refund" : "shipping_label",
        amountCents: isCredit ? Math.abs(amount) : -Math.abs(amount),
        bankAccountNo: null,
        reference,
        memo,
      });
    }
    if (resent) result.warnings.push({ message: `FedEx: ${resent} row(s) on re-sent / past-due invoices skipped (charges already billed on the original invoice).` });
    if (repeats) result.warnings.push({ message: `FedEx: ${repeats} exact repeat row(s) (same invoice, tracking id and amount) skipped.` });
    result.period = choosePeriod(result, dominantPeriod(out.map((l) => l.lineDate)), ctx.period);
    return result;
  },
};
