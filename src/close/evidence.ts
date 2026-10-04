/**
 * Reconciliation evidence package (slide 41 WS5 "auditable month-end operating
 * model", slide 42 definition of done). exportEvidence(period) → XLSX:
 *
 *   Summary         period, status, approval, BC posting status, control
 *                   totals, pass/fail checks (one per definition-of-done item)
 *   Source package  every file behind the close: source, cadence, file name,
 *                   uploaded at, SHA-256, archive key (if the ingest_runs
 *                   archive columns exist), rows, parse status, exceptions
 *   Tie-out         per source/account: source facts → journal → workbook →
 *                   posted, with the differences
 *   Journal         BC General Journal columns (+ source)
 *   AR Invoice      the Goodwill Books sales invoice
 *   Exceptions      kind, source, owner, status, resolved by / at, message
 *   Rules applied   GL rule per source / amount type, placeholder flag, use in this close
 *   Audit trail     generated / reconciled / workbook / approved / exported /
 *                   imported / posted events with actor and time
 *
 * Read-only apart from logging an `evidence_exported` event. Works for any
 * close that exists (an un-approved close produces a package that says so).
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { arInvoiceLines, arInvoices, exceptions, glRules, journalLines, moneyLines, sources } from "@/db/schema";
import { cadenceOf } from "@/ingest/config";
import { INVOICE_SOURCE, SOURCE_CODES } from "./gl-rules";
import { appendEvent, assertPeriod, centsToDecimal, fmtUsd, parseEvents, requireClose } from "./common";
import { GJ_COLUMNS, styleHeader } from "./export";
import { resolvedByOf } from "./exceptions";
import { computeTieOut, differs, parsePostingResponse, UNMAPPED_ACCOUNT } from "./tieout";

export const EVIDENCE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const evidenceFileName = (period: string) => `close-evidence-${period}.xlsx`;

export interface EvidenceCheck {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

const MONEY = "#,##0.00;-#,##0.00";
const money = (c: number | null | undefined) => (c == null ? null : centsToDecimal(c));

/** Raw ingest_runs rows, so archive columns added by another lane show up when they exist. */
async function rawRuns(db: Db, period: string): Promise<Record<string, unknown>[]> {
  const r = await db.$client.execute({
    sql: "select * from ingest_runs where period = ? or business_date like ? order by source_id, uploaded_at",
    args: [period, `${period}-%`],
  });
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c, (row as unknown as Record<string, unknown>)[c]])));
}

const archiveKeyOf = (r: Record<string, unknown>): string => {
  for (const k of ["archive_key", "archive_path", "archive_url", "blob_key", "blob_url"]) {
    if (typeof r[k] === "string" && r[k]) return r[k] as string;
  }
  const k = Object.keys(r).find((c) => c.startsWith("archive") && typeof r[c] === "string" && r[c]);
  return k ? String(r[k]) : "";
};

export async function exportEvidence(period: string, opts: { db?: Db; by?: string } = {}): Promise<Buffer> {
  assertPeriod(period);
  const db = opts.db ?? getDb();
  const close = await requireClose(db, period);

  const [sourceRows, runs, lines, invoices, excRows, ruleRows, tie, stmtRows] = await Promise.all([
    db.select().from(sources).where(eq(sources.active, 1)),
    rawRuns(db, period),
    db.select().from(journalLines).where(eq(journalLines.closeId, close.id)).orderBy(journalLines.lineNo),
    db.select().from(arInvoices).where(eq(arInvoices.closeId, close.id)),
    db.select().from(exceptions).where(eq(exceptions.closeId, close.id)).orderBy(exceptions.createdAt),
    db.select().from(glRules),
    computeTieOut(db, close),
    db.select().from(moneyLines).where(eq(moneyLines.period, period)),
  ]);
  // Exceptions raised while ingesting this period's files (not linked to the close).
  const runIds = runs.map((r) => String(r.id));
  const ingestExc = runIds.length
    ? (
        await Promise.all(
          Array.from({ length: Math.ceil(runIds.length / 500) }, (_, i) =>
            db.select({ ingestRunId: exceptions.ingestRunId, status: exceptions.status }).from(exceptions).where(inArray(exceptions.ingestRunId, runIds.slice(i * 500, i * 500 + 500))),
          ),
        )
      ).flat()
    : [];
  const invLines = invoices.length
    ? await db.select().from(arInvoiceLines).where(inArray(arInvoiceLines.invoiceId, invoices.map((i) => i.id))).orderBy(arInvoiceLines.lineNo)
    : [];

  const order = Object.keys(SOURCE_CODES);
  const rank = (id: string) => (order.indexOf(id) < 0 ? order.length : order.indexOf(id));
  const sourceName = new Map(sourceRows.map((s) => [s.id, s.name]));
  const events = parseEvents(close.eventsJson);
  const posting = parsePostingResponse(close.postingResponseJson);
  const docNos: string[] = close.bcDocumentNos ? (JSON.parse(close.bcDocumentNos) as string[]) : [];

  // ---- Checks (slide 42 definition of done) ---------------------------------
  const goodRunSources = new Set(runs.filter((r) => r.status !== "failed").map((r) => String(r.source_id)));
  const missing = sourceRows.filter((s) => !goodRunSources.has(s.id));
  const docs = new Map<string, number>();
  for (const l of lines) if (!l.balAccountNo) docs.set(l.documentNo, (docs.get(l.documentNo) ?? 0) + l.amountCents);
  const unbalanced = [...docs.values()].filter((n) => n !== 0).length;
  const debit = lines.reduce((s, l) => s + Math.max(0, l.amountCents), 0);
  const credit = lines.reduce((s, l) => s + Math.max(0, -l.amountCents), 0);
  const invoiceTotal = invLines.reduce((s, l) => s + Math.round(l.unitPriceCents * l.quantity), 0);
  const stmt = stmtRows.filter((m) => m.sourceId === INVOICE_SOURCE && m.amountType === "statement_payment");
  const stmtTotal = stmt.length ? stmt.reduce((s, m) => s + m.amountCents, 0) : null;
  const srcDiff = tie.rows.filter((r) => r.accountNo !== UNMAPPED_ACCOUNT && differs(r.sourceDiffCents));
  const unmapped = tie.rows.filter((r) => r.accountNo === UNMAPPED_ACCOUNT);
  const wbDiff = tie.rows.filter((r) => differs(r.workbookDiffCents));
  const postDiff = tie.rows.filter((r) => differs(r.postedDiffCents));
  const openExc = excRows.filter((e) => e.status === "open");
  const placeholderRules = new Set(ruleRows.filter((r) => r.isPlaceholder).map((r) => r.id));

  const checks: EvidenceCheck[] = [
    {
      key: "sources_captured",
      label: "Every required source is captured",
      pass: missing.length === 0,
      detail: missing.length ? `Missing: ${missing.map((s) => s.name).join(", ")}` : `${sourceRows.length}/${sourceRows.length} sources, ${runs.length} file(s).`,
    },
    {
      key: "rules_reproduced",
      label: "Period and shipping rules are reproduced (every amount mapped)",
      pass: unmapped.length === 0,
      detail: unmapped.length ? `${unmapped.length} source(s) with unmapped amounts.` : "Every fact amount has a GL rule.",
    },
    {
      key: "journal_balances",
      label: "Journal documents balance (debits = credits)",
      pass: lines.length > 0 && unbalanced === 0,
      detail: `${docs.size - unbalanced}/${docs.size} documents; debits ${fmtUsd(debit)}, credits ${fmtUsd(credit)}.`,
    },
    {
      key: "journal_ties_to_sources",
      label: "Journal lines reconcile to the source facts",
      pass: srcDiff.length === 0,
      detail: srcDiff.length ? `${srcDiff.length} account(s) differ.` : `${tie.rows.length - unmapped.length} source/account totals tie.`,
    },
    {
      key: "invoice_reconciles",
      label: "AR invoice output reconciles to the statement",
      pass: invLines.length === 0 ? stmtTotal === null : stmtTotal === invoiceTotal,
      detail: `Invoice ${fmtUsd(invoiceTotal)} vs statement ${stmtTotal === null ? "missing" : fmtUsd(stmtTotal)}.`,
    },
    {
      key: "workbook_matches",
      label: "Matches the allocation workbook (or differences are owned)",
      pass: tie.workbookLoaded && (wbDiff.length === 0 || excRows.filter((e) => e.kind === "reconcile_mismatch" && e.status === "open").length === 0),
      detail: !tie.workbookLoaded
        ? "No workbook baseline loaded."
        : wbDiff.length
          ? `${wbDiff.length} account difference(s); see Tie-out and Exceptions (${excRows.filter((e) => e.kind === "reconcile_mismatch" && e.status !== "open").length} resolved/waived).`
          : `${tie.workbookRows} workbook line(s) match to the cent.`,
    },
    {
      key: "exceptions_closed",
      label: "No open exceptions",
      pass: openExc.length === 0,
      detail: `${excRows.length} exception(s): ${openExc.length} open, ${excRows.filter((e) => e.status === "resolved").length} resolved, ${excRows.filter((e) => e.status === "waived").length} waived.`,
    },
    {
      key: "approved",
      label: "Approved by a named person",
      pass: !!close.approvedBy,
      detail: close.approvedBy ? `${close.approvedBy} at ${close.approvedAt}` : "Not approved.",
    },
    {
      key: "posting_retained",
      label: "Posting status retained",
      pass: close.postingStatus === "posted" && postDiff.length === 0,
      detail: `${close.postingStatus}${posting?.simulated ? " (SIMULATED BC)" : ""}${close.bcBatch ? `, batch ${close.bcBatch}` : ""}${postDiff.length ? `, ${postDiff.length} posted difference(s)` : ""}.`,
    },
  ];

  const { Workbook } = (await import("exceljs")).default;
  const wb = new Workbook();
  wb.creator = "Mission Control (SprintHack@ND)";
  wb.created = new Date();

  // ---- Summary --------------------------------------------------------------
  const su = wb.addWorksheet("Summary");
  su.addRow(["Month-end close evidence package"]).font = { bold: true, size: 14 };
  const kv: [string, unknown][] = [
    ["Period", period],
    ["Close status", close.status],
    ["Approved by", close.approvedBy ?? ""],
    ["Approved at", close.approvedAt ?? ""],
    ["BC posting status", close.postingStatus + (posting?.simulated ? " (SIMULATED: no real Business Central call)" : "")],
    ["BC batch", close.bcBatch ?? ""],
    ["BC document numbers", docNos.join(", ")],
    ["Imported by / at", close.importedBy ? `${close.importedBy} / ${close.importedAt ?? ""}` : ""],
    ["Posted by / at", close.postedBy ? `${close.postedBy} / ${close.postedAt ?? ""}` : ""],
    ["Generated at (package)", new Date().toISOString()],
    ["", ""],
    ["Control totals", ""],
    ["Journal lines", lines.length],
    ["Journal documents", docs.size],
    ["Total debits", money(debit)],
    ["Total credits", money(credit)],
    ["AR invoice lines", invLines.length],
    ["AR invoice total", money(invoiceTotal)],
    ["Goodwill Books statement payment", money(stmtTotal)],
    ["Workbook baseline lines", tie.workbookRows],
    ["Workbook net (all sources)", money(tie.rows.reduce((s, r) => s + (r.workbookCents ?? 0), 0))],
    ["Files in the source package", runs.length],
  ];
  for (const [k, v] of kv) {
    const row = su.addRow([k, v]);
    if (typeof v === "number" && /debit|credit|total|net|payment/i.test(k)) row.getCell(2).numFmt = MONEY;
    if (k === "Control totals") row.font = { bold: true };
  }
  su.addRow([]);
  su.addRow(["Check", "Result", "Detail"]).font = { bold: true };
  for (const c of checks) su.addRow([c.label, c.pass ? "PASS" : "FAIL", c.detail]);
  su.getColumn(1).width = 52;
  su.getColumn(2).width = 40;
  su.getColumn(3).width = 80;

  // ---- Source package -------------------------------------------------------
  const sp = wb.addWorksheet("Source package", { views: [{ state: "frozen", ySplit: 1 }] });
  sp.addRow(["Source", "Source id", "Cadence", "Acquisition", "Owner", "File name", "Uploaded at", "Period / date", "SHA-256", "Archive key", "Rows", "Parse status", "Warnings", "Open ingest exceptions", "Close exceptions"]);
  const excByRun = new Map<string, number>();
  for (const e of ingestExc) if (e.ingestRunId && e.status === "open") excByRun.set(e.ingestRunId, (excByRun.get(e.ingestRunId) ?? 0) + 1);
  const closeExcBySource = new Map<string, number>();
  for (const e of excRows) if (e.sourceId) closeExcBySource.set(e.sourceId, (closeExcBySource.get(e.sourceId) ?? 0) + 1);
  for (const s of [...sourceRows].sort((a, b) => rank(a.id) - rank(b.id))) {
    const rs = runs.filter((r) => r.source_id === s.id);
    const base = [s.name, s.id, cadenceOf(s.id, s.configJson), s.acquisition ?? "", s.owner ?? ""];
    if (!rs.length) {
      sp.addRow([...base, "(no file received)", "", "", "", "", 0, "missing", 0, 0, closeExcBySource.get(s.id) ?? 0]);
      continue;
    }
    rs.forEach((r, i) => {
      let warnings = 0;
      try {
        const w = JSON.parse(String(r.warnings_json ?? "[]"));
        warnings = Array.isArray(w) ? w.length : 0;
      } catch {
        /* ignore */
      }
      sp.addRow([
        ...base,
        String(r.file_name ?? ""),
        String(r.uploaded_at ?? ""),
        String(r.period ?? r.business_date ?? ""),
        String(r.file_sha256 ?? ""),
        archiveKeyOf(r),
        Number(r.row_count ?? 0),
        String(r.status ?? ""),
        warnings,
        excByRun.get(String(r.id)) ?? 0,
        i === 0 ? (closeExcBySource.get(s.id) ?? 0) : "",
      ]);
    });
  }
  styleHeader(sp, [20, 22, 9, 30, 14, 36, 24, 12, 66, 30, 8, 20, 9, 12, 10]);

  // ---- Tie-out --------------------------------------------------------------
  const to = wb.addWorksheet("Tie-out", { views: [{ state: "frozen", ySplit: 1 }] });
  to.addRow(["Source", "Account No.", "Department", "Target", "Source facts", "Journal / invoice", "Workbook", "Posted (BC)", "Journal - facts", "Journal - workbook", "Posted - journal", "Result"]);
  for (const r of tie.rows) {
    to.addRow([
      r.sourceName,
      r.accountNo,
      r.deptCodes,
      r.target === "invoice" ? "AR invoice" : "General Journal",
      money(r.sourceCents),
      money(r.journalCents),
      r.workbookCents === null ? "n/a" : money(r.workbookCents),
      r.postedCents === null ? "not posted" : money(r.postedCents),
      money(r.sourceDiffCents),
      r.workbookDiffCents === null ? "" : money(r.workbookDiffCents),
      r.postedDiffCents === null ? "" : money(r.postedDiffCents),
      r.accountNo === UNMAPPED_ACCOUNT ? "UNMAPPED" : r.ok ? "ties" : "DIFFERENCE",
    ]);
  }
  for (const c of [5, 6, 7, 8, 9, 10, 11]) to.getColumn(c).numFmt = MONEY;
  styleHeader(to, [22, 16, 11, 16, 14, 16, 14, 14, 14, 16, 14, 12]);

  // ---- Journal --------------------------------------------------------------
  const gj = wb.addWorksheet("Journal", { views: [{ state: "frozen", ySplit: 1 }] });
  gj.addRow([...GJ_COLUMNS, "Source", "Placeholder account?"]);
  const ruleById = new Map(ruleRows.map((r) => [r.id, r]));
  for (const l of lines) {
    gj.addRow([
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
      money(l.amountCents),
      l.balAccountType ?? "",
      l.balAccountNo ?? "",
      sourceName.get(l.sourceId ?? "") ?? l.sourceId ?? "",
      (l.glRuleId && ruleById.get(l.glRuleId)?.isPlaceholder) || l.accountNo.startsWith("TBC") ? "YES (TBC)" : "no",
    ]);
  }
  gj.getColumn(12).numFmt = MONEY;
  styleHeader(gj, [10, 12, 9, 12, 10, 16, 16, 14, 14, 40, 12, 14, 14, 14, 20, 12]);

  // ---- AR Invoice -----------------------------------------------------------
  const ai = wb.addWorksheet("AR Invoice", { views: [{ state: "frozen", ySplit: 1 }] });
  ai.addRow(["Customer No.", "Invoice Date", "Posting Date", "External Document No.", "Currency Code", "Line No.", "Type", "No.", "Description", "Department Code", "Quantity", "Unit Price", "Line Amount"]);
  for (const inv of invoices) {
    for (const l of invLines.filter((x) => x.invoiceId === inv.id)) {
      ai.addRow([
        inv.customerNo ?? "",
        inv.invoiceDate ?? "",
        inv.postingDate ?? "",
        inv.externalDocumentNo ?? "",
        inv.currency === "USD" ? "" : inv.currency,
        l.lineNo,
        l.lineType === "Account" ? "G/L Account" : "Item",
        l.accountNo ?? "",
        l.description ?? "",
        l.deptCode ?? "",
        l.quantity,
        money(l.unitPriceCents),
        money(Math.round(l.unitPriceCents * l.quantity)),
      ]);
    }
  }
  ai.addRow([]);
  ai.addRow(["Total", "", "", "", "", "", "", "", "", "", "", "", money(invoiceTotal)]).font = { bold: true };
  ai.getColumn(12).numFmt = MONEY;
  ai.getColumn(13).numFmt = MONEY;
  styleHeader(ai, [14, 12, 12, 20, 10, 9, 12, 14, 40, 12, 9, 14, 14]);

  // ---- Exceptions -----------------------------------------------------------
  const ex = wb.addWorksheet("Exceptions", { views: [{ state: "frozen", ySplit: 1 }] });
  ex.addRow(["Kind", "Source", "Owner", "Status", "Expected", "Actual", "Raised at", "Resolved by", "Resolved at", "Message"]);
  for (const e of excRows) {
    ex.addRow([
      e.kind,
      sourceName.get(e.sourceId ?? "") ?? e.sourceId ?? "",
      e.owner ?? "",
      e.status,
      money(e.expectedCents),
      money(e.actualCents),
      e.createdAt,
      e.status === "open" ? "" : (resolvedByOf(e.message) ?? "(not recorded)"),
      e.resolvedAt ?? "",
      e.message,
    ]);
  }
  if (!excRows.length) ex.addRow(["(none)"]);
  ex.getColumn(5).numFmt = MONEY;
  ex.getColumn(6).numFmt = MONEY;
  styleHeader(ex, [20, 20, 14, 10, 14, 14, 24, 18, 24, 120]);

  // ---- Rules applied --------------------------------------------------------
  const ru = wb.addWorksheet("Rules applied", { views: [{ state: "frozen", ySplit: 1 }] });
  ru.addRow(["Source", "Amount type", "Account type", "Account No.", "Department", "Vendor No.", "Bal. Account No.", "Journal sign", "Placeholder?", "Lines in this close", "Amount in this close"]);
  const use = new Map<string, { n: number; cents: number }>();
  for (const l of lines) {
    if (!l.glRuleId) continue;
    const u = use.get(l.glRuleId) ?? { n: 0, cents: 0 };
    u.n++;
    u.cents += l.amountCents;
    use.set(l.glRuleId, u);
  }
  for (const r of [...ruleRows].sort((a, b) => rank(a.sourceId) - rank(b.sourceId) || a.amountType.localeCompare(b.amountType))) {
    const u = use.get(r.id);
    ru.addRow([
      sourceName.get(r.sourceId) ?? r.sourceId,
      r.amountType,
      r.accountType,
      r.accountNo,
      r.deptCode ?? "",
      r.vendorNo ?? "",
      r.balAccountNo ?? "",
      r.journalSign,
      placeholderRules.has(r.id) ? "YES (TBC with Goodwill)" : "confirmed",
      u?.n ?? 0,
      u ? money(u.cents) : null,
    ]);
  }
  ru.getColumn(11).numFmt = MONEY;
  styleHeader(ru, [22, 16, 14, 16, 11, 11, 14, 11, 22, 10, 16]);

  // ---- Audit trail ----------------------------------------------------------
  const au = wb.addWorksheet("Audit trail", { views: [{ state: "frozen", ySplit: 1 }] });
  au.addRow(["At", "Action", "Actor", "Detail"]);
  const now = new Date().toISOString();
  const actor = opts.by ?? "system";
  for (const e of [...events, { at: now, action: "evidence_exported", actor, detail: "this package" }]) {
    au.addRow([e.at, e.action, e.actor, e.detail ?? ""]);
  }
  styleHeader(au, [26, 20, 18, 120]);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  await appendEvent(db, close.id, { action: "evidence_exported", actor, at: now, detail: `${evidenceFileName(period)} (${buffer.length} bytes)` });
  return buffer;
}
