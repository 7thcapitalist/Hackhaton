/**
 * Approve a close and export it for Business Central.
 *
 * approveClose(period, approvedBy, { force })
 *   Only from `reconciled`. With force, a `generated` close (open exceptions)
 *   can be approved: every open exception is set to `waived`, stamped with
 *   who waived it and when (audit trail). An exported close cannot be re-approved.
 *
 * exportClose(period, format)
 *   Only for `approved` (or already `exported`, to download again). Marks the
 *   close `exported`. Returns the file as a Buffer.
 *   - xlsx: sheets "General Journal" (BC columns, research.md §1, in journal
 *     page order, Amount + = debit), "Sales Invoice" (AR invoice for the
 *     Goodwill Books statement), "Trace" (line → source file + rows).
 *   - csv: the General Journal sheet only (paste into BC).
 */
import { and, eq, inArray } from "drizzle-orm";
import type ExcelJS from "exceljs";
import { getDb, type Db } from "@/db/client";
import { arInvoiceLines, arInvoices, closes, exceptions, glRules, journalLines } from "@/db/schema";
import { CloseError, assertPeriod, centsToDecimal, parseTrace, requireClose } from "./common";

export type ExportFormat = "xlsx" | "csv";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

export const exportFileName = (period: string, format: ExportFormat) => `bc-general-journal-${period}.${format}`;

export interface ApproveResult {
  period: string;
  status: "approved";
  approvedBy: string;
  approvedAt: string;
  waivedExceptions: number;
}

export async function approveClose(
  period: string,
  approvedBy: string,
  opts: { force?: boolean; db?: Db } = {},
): Promise<ApproveResult> {
  assertPeriod(period);
  const who = (approvedBy ?? "").trim();
  if (!who) throw new CloseError("bad_input", "approvedBy is required");
  const db = opts.db ?? getDb();
  const close = await requireClose(db, period);
  if (close.status === "exported") throw new CloseError("conflict", `The ${period} close was already exported.`);
  if (close.status === "collecting") throw new CloseError("conflict", `The ${period} close has not been generated yet.`);
  if (close.status === "generated" && !opts.force) {
    throw new CloseError(
      "conflict",
      `The ${period} close has open exceptions. Resolve them, or approve with force to waive them.`,
    );
  }
  const now = new Date().toISOString();
  let waived = 0;
  await db.transaction(async (tx) => {
    const open = await tx
      .select({ id: exceptions.id, message: exceptions.message })
      .from(exceptions)
      .where(and(eq(exceptions.closeId, close.id), eq(exceptions.status, "open")));
    for (const e of open) {
      await tx
        .update(exceptions)
        .set({ status: "waived", resolvedAt: now, message: `${e.message} [Waived at approval by ${who}, ${now}]` })
        .where(eq(exceptions.id, e.id));
    }
    waived = open.length;
    await tx.update(closes).set({ status: "approved", approvedBy: who, approvedAt: now }).where(eq(closes.id, close.id));
  });
  return { period, status: "approved", approvedBy: who, approvedAt: now, waivedExceptions: waived };
}

const GJ_COLUMNS = [
  "Journal Template Name",
  "Journal Batch Name",
  "Line No.",
  "Posting Date",
  "Document Type",
  "Document No.",
  "External Document No.",
  "Account Type",
  "Account No.",
  "Description",
  "Department Code",
  "Amount",
  "Bal. Account Type",
  "Bal. Account No.",
] as const;

const usDate = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const excelDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportClose(period: string, format: ExportFormat, opts: { db?: Db } = {}): Promise<Buffer> {
  assertPeriod(period);
  if (format !== "xlsx" && format !== "csv") throw new CloseError("bad_input", `format must be xlsx or csv, got "${format}"`);
  const db = opts.db ?? getDb();
  const close = await requireClose(db, period);
  if (close.status !== "approved" && close.status !== "exported") {
    throw new CloseError("conflict", `The ${period} close must be approved before export (status: ${close.status}).`);
  }

  const lines = await db.select().from(journalLines).where(eq(journalLines.closeId, close.id)).orderBy(journalLines.lineNo);
  const invoices = await db.select().from(arInvoices).where(eq(arInvoices.closeId, close.id));
  const invLines = invoices.length
    ? await db
        .select()
        .from(arInvoiceLines)
        .where(inArray(arInvoiceLines.invoiceId, invoices.map((i) => i.id)))
        .orderBy(arInvoiceLines.lineNo)
    : [];
  const rules = await db.select({ id: glRules.id, isPlaceholder: glRules.isPlaceholder, amountType: glRules.amountType }).from(glRules);
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  const gjRow = (l: (typeof lines)[number]) => [
    l.journalTemplate ?? "",
    l.journalBatch ?? "",
    l.lineNo,
    l.postingDate,
    l.documentType ?? "",
    l.documentNo,
    l.externalDocumentNo ?? "",
    l.accountType,
    l.accountNo,
    l.description ?? "",
    l.deptCode ?? "",
    centsToDecimal(l.amountCents),
    l.balAccountType ?? "",
    l.balAccountNo ?? "",
  ];

  let buffer: Buffer;
  if (format === "csv") {
    const out = [GJ_COLUMNS.join(",")];
    for (const l of lines) {
      const r = gjRow(l);
      r[3] = usDate(l.postingDate);
      r[11] = centsToDecimal(l.amountCents).toFixed(2);
      out.push(r.map(csvCell).join(","));
    }
    buffer = Buffer.from(out.join("\r\n") + "\r\n", "utf8");
  } else {
    const { Workbook } = (await import("exceljs")).default;
    const wb = new Workbook();
    wb.creator = "Mission Control (SprintHack@ND)";
    wb.created = new Date();

    // General Journal
    const gj = wb.addWorksheet("General Journal", { views: [{ state: "frozen", ySplit: 1 }] });
    gj.addRow([...GJ_COLUMNS]);
    for (const l of lines) {
      const r = gjRow(l);
      r[3] = excelDate(l.postingDate) as unknown as string;
      gj.addRow(r);
    }
    gj.getColumn(4).numFmt = "mm/dd/yyyy";
    gj.getColumn(12).numFmt = "#,##0.00;-#,##0.00";
    styleHeader(gj, [10, 12, 9, 12, 10, 16, 16, 14, 14, 40, 12, 14, 14, 14]);

    // Sales Invoice
    const si = wb.addWorksheet("Sales Invoice", { views: [{ state: "frozen", ySplit: 1 }] });
    si.addRow([
      "Customer No.",
      "Invoice Date",
      "Posting Date",
      "External Document No.",
      "Currency Code",
      "Line No.",
      "Type",
      "No.",
      "Description",
      "Department Code",
      "Quantity",
      "Unit Price",
      "Line Amount",
    ]);
    for (const inv of invoices) {
      for (const l of invLines.filter((x) => x.invoiceId === inv.id)) {
        si.addRow([
          inv.customerNo ?? "",
          excelDate(inv.invoiceDate),
          excelDate(inv.postingDate),
          inv.externalDocumentNo ?? "",
          inv.currency === "USD" ? "" : inv.currency, // BC: blank = local currency
          l.lineNo,
          l.lineType === "Account" ? "G/L Account" : "Item",
          l.accountNo ?? "",
          l.description ?? "",
          l.deptCode ?? "",
          l.quantity,
          centsToDecimal(l.unitPriceCents),
          centsToDecimal(Math.round(l.unitPriceCents * l.quantity)),
        ]);
      }
    }
    si.getColumn(2).numFmt = "mm/dd/yyyy";
    si.getColumn(3).numFmt = "mm/dd/yyyy";
    si.getColumn(12).numFmt = "#,##0.00;-#,##0.00";
    si.getColumn(13).numFmt = "#,##0.00;-#,##0.00";
    styleHeader(si, [14, 12, 12, 20, 10, 9, 12, 14, 40, 12, 9, 14, 14]);

    // Trace
    const tr = wb.addWorksheet("Trace", { views: [{ state: "frozen", ySplit: 1 }] });
    tr.addRow([
      "Sheet",
      "Line No.",
      "Document No.",
      "Account No.",
      "Placeholder account?",
      "Description",
      "Amount",
      "Fact table",
      "Fact rows",
      "Source file",
      "File rows",
      "Ingest run id",
    ]);
    const traceRows = (
      sheet: string,
      lineNo: number,
      docNo: string,
      accountNo: string,
      placeholder: boolean,
      description: string,
      cents: number,
      traceJson: string | null,
    ) => {
      const base = [sheet, lineNo, docNo, accountNo, placeholder ? "YES (TBC)" : "no", description, centsToDecimal(cents)];
      const t = parseTrace(traceJson);
      if (!t) return void tr.addRow([...base, "", "", "", "", ""]);
      if (t.kind === "balancing") {
        return void tr.addRow([...base, "balancing", t.lineNos.length, `balances lines ${t.lineNos.join(", ")}`, "", ""]);
      }
      if (t.runs.length === 0) return void tr.addRow([...base, t.table, t.count, "", "", ""]);
      t.runs.forEach((r, i) => tr.addRow([...base, t.table, i === 0 ? t.count : "", r.fileName, r.rows, r.ingestRunId]));
    };
    for (const l of lines) {
      const rule = l.glRuleId ? ruleById.get(l.glRuleId) : undefined;
      traceRows("General Journal", l.lineNo, l.documentNo, l.accountNo, !!rule?.isPlaceholder || l.accountNo.startsWith("TBC"), l.description ?? "", l.amountCents, l.traceJson);
    }
    for (const inv of invoices) {
      for (const l of invLines.filter((x) => x.invoiceId === inv.id)) {
        traceRows("Sales Invoice", l.lineNo, inv.externalDocumentNo ?? "", l.accountNo ?? "", (l.accountNo ?? "").startsWith("TBC"), l.description ?? "", Math.round(l.unitPriceCents * l.quantity), l.traceJson);
      }
    }
    tr.getColumn(7).numFmt = "#,##0.00;-#,##0.00";
    styleHeader(tr, [16, 9, 16, 14, 12, 40, 14, 12, 9, 40, 30, 38]);

    buffer = Buffer.from(await wb.xlsx.writeBuffer());
  }

  if (close.status !== "exported") {
    await db.update(closes).set({ status: "exported" }).where(eq(closes.id, close.id));
  }
  return buffer;
}

function styleHeader(ws: ExcelJS.Worksheet, widths: number[]) {
  ws.getRow(1).font = { bold: true };
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}
