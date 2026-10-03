/**
 * FedEx: "Shipping charges + refunds"
 * (slide 38: "BC GL 40356 · Dept 180 · V00122 · net BNKDEPOSIT refunds").
 *
 * What it is
 *   FedEx shipping invoices for e-commerce shipments. In Business Central they
 *   post to GL 40356, Department 180, vendor V00122 [fact: slide text], and
 *   refunds that came in as bank deposits ("BNKDEPOSIT") are netted against
 *   the charges [reading of slide text; guess on mechanics]. GL/vendor codes
 *   live in gl_rules, not here.
 *
 * Assumed layout [partial fact]
 *   FedEx Billing Online → Reporting → Create Report → Invoice filter set →
 *   All Columns → CSV. One row per tracking id (shipment) per invoice.
 *   Columns used (aliases in COLS):
 *     Invoice Number, Invoice Date, Express or Ground Tracking ID,
 *     Shipment Date, Service Type, Net Charge Amount,
 *     (optional) Tracking ID Charge Description / Invoice Type
 *   Sources: https://help.reveelgroup.com/knowledge/how-to-download-data-from-fedex-billing-online-user
 *            https://www.fedex.com/content/dam/fedex/us-united-states/services/csv_selectable_invoice_and_fixed-length_remittance_records.pdf
 *   Credits/refunds show as negative Net Charge Amount or as adjustment /
 *   credit lines [partial fact]. Bill-to account numbers are NOT kept.
 *
 * What we emit (money_lines, + = money in)
 *   positive charge → "shipping_label" (negative amount)
 *   negative charge, or a credit/refund/GSR description → "shipping_refund" (+)
 *   reference = "<invoice> / <tracking>", memo = service type (+ description).
 *   lineDate = Shipment Date, else Invoice Date.
 *
 * Open questions for Goodwill
 *   1. Which FedEx file do they download (FBO invoice CSV, or a PDF)? Which date
 *      decides the month: invoice date or ship date?
 *   2. "net BNKDEPOSIT refunds": are refunds read from the bank statement
 *      (BNKDEPOSIT lines) rather than from FedEx? If so, we need that file too.
 *   3. Are all FedEx shipments e-commerce (Dept 180), or must some be excluded?
 */
import type { ParseContext, ParseResult, ParsedMoneyLine, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import { cell, choosePeriod, dominantPeriod, findHeaderRowAny, headerSet, isTotalRow, parseDate, preambleMatches } from "./_other";

const COLS = {
  invoice: ["Invoice Number", "Invoice #", "Invoice No", "Invoice"],
  invoiceDate: ["Invoice Date"],
  tracking: ["Express or Ground Tracking ID", "Tracking ID", "Tracking Number", "Ground Tracking ID", "Tracking #"],
  shipDate: ["Shipment Date", "Ship Date"],
  service: ["Service Type", "Service", "Ground Service"],
  amount: ["Net Charge Amount", "Net Charge", "Net Amount", "Total Net Charge", "Amount Due", "Charge Amount"],
  description: ["Tracking ID Charge Description", "Charge Description", "Description", "Invoice Type", "Type"],
};

const REQUIRED_SETS = COLS.invoice.slice(0, 3).flatMap((i) => COLS.amount.slice(0, 4).map((a) => [i, a]));
const FOREIGN = ["created_at", "tracking_code", "charge_type", "total charges", "settlement id", "order id", "channel order id"];

function locateHeader(table: RawTable): number {
  return findHeaderRowAny(table, REQUIRED_SETS);
}

export const fedexParser: SourceParser = {
  sourceId: "fedex",
  version: "0.1.0",

  accepts(table: RawTable, fileName: string): boolean {
    const h = locateHeader(table);
    if (h < 0) return false;
    const cells = headerSet(table[h]);
    if (FOREIGN.some((f) => cells.has(f))) return false;
    const fedexColumns = cells.has("express or ground tracking id") || cells.has("net charge amount");
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

    const out: ParsedMoneyLine[] = result.moneyLines;
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
      const invoice = cell(row, c.invoice);
      const tracking = cell(row, c.tracking);
      const desc = cell(row, c.description);
      const reference = [invoice, tracking].filter(Boolean).join(" / ") || null;
      const memo = ["FedEx", cell(row, c.service), desc].filter(Boolean).join(" · ");
      const isCredit = amount < 0 || /credit|refund|gsr|money.?back|rebate/i.test(desc);
      if (isCredit && amount > 0 && !/credit|refund/i.test(desc)) {
        result.warnings.push({ row: rowNo, message: `Positive amount on a "${desc}" line; treated as a refund.` });
      }
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
    result.period = choosePeriod(result, dominantPeriod(out.map((l) => l.lineDate)), ctx.period);
    return result;
  },
};
