/**
 * getCloseView(period): everything the close page needs, in one call.
 * Works before a close exists (status "collecting": only the sources checklist).
 *
 * Money is integer cents. Journal amounts use BC sign (+ = debit, - = credit).
 */
import { eq, inArray, like, or } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { arInvoiceLines, arInvoices, exceptions, glRules, ingestRuns, journalLines, orders, sources } from "@/db/schema";
import { INVOICE_SOURCE, SOURCE_CODES } from "./gl-rules";
import { assertPeriod, findClose, fmtUsd, parseEvents, parseTrace, type CloseEvent } from "./common";
import type { Close, IngestRun } from "@/db/schema";
import type { PostingStatus } from "./posting";
import { computeTieOut, differs, parsePostingResponse, UNMAPPED_ACCOUNT } from "./tieout";
import { loadWorkbookBaseline } from "./workbook";

export type CloseStatus = "collecting" | "generated" | "reconciled" | "approved" | "exported";

export interface CloseSourceFile {
  ingestRunId: string;
  fileName: string;
  uploadedAt: string;
  status: "parsed" | "parsed_with_warnings" | "failed";
  rowCount: number;
  warningCount: number;
}

export interface CloseSourceItem {
  sourceId: string;
  name: string;
  kind: string;
  /** received = at least one good file; warnings = received, but a file has warnings or failed. */
  status: "received" | "missing" | "warnings";
  fileCount: number;
  warningCount: number;
  lastUploadedAt: string | null;
  /** Where its money goes in the close. */
  target: "journal" | "invoice";
  files: CloseSourceFile[];
}

export interface CloseLineView {
  lineNo: number;
  documentNo: string;
  postingDate: string;
  accountType: string;
  accountNo: string;
  deptCode: string | null;
  description: string | null;
  amountCents: number;
  balAccountType: string | null;
  balAccountNo: string | null;
  sourceId: string | null;
  amountType: string | null;
  isPlaceholder: boolean;
  isBalancing: boolean;
  /** Number of fact rows behind the line (0 for balancing lines). */
  factCount: number;
  files: string[];
}

export interface CloseDocumentView {
  documentNo: string;
  sourceId: string | null;
  sourceName: string;
  postingDate: string;
  lines: CloseLineView[];
  debitCents: number;
  creditCents: number;
  /** Σ amount of lines without their own balancing account; 0 = balanced. */
  balanceCents: number;
  balanced: boolean;
}

export interface CloseAccountTotal {
  accountType: string;
  accountNo: string;
  deptCode: string | null;
  debitCents: number;
  creditCents: number;
  netCents: number;
  isPlaceholder: boolean;
}

export interface CloseInvoiceView {
  customerNo: string | null;
  invoiceDate: string | null;
  postingDate: string | null;
  externalDocumentNo: string | null;
  currency: string;
  lines: {
    lineNo: number;
    accountNo: string | null;
    description: string | null;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
    deptCode: string | null;
    factCount: number;
  }[];
  totalCents: number;
}

export interface CloseExceptionView {
  id: string;
  kind: string;
  sourceId: string | null;
  message: string;
  expectedCents: number | null;
  actualCents: number | null;
  owner: string | null;
  status: "open" | "resolved" | "waived";
  createdAt: string;
  resolvedAt: string | null;
}

export interface CloseView {
  period: string;
  status: CloseStatus;
  closeId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  sources: CloseSourceItem[];
  documents: CloseDocumentView[];
  totalsByAccount: CloseAccountTotal[];
  invoice: CloseInvoiceView | null;
  exceptions: CloseExceptionView[];
  summary: {
    journalLines: number;
    documents: number;
    balancedDocuments: number;
    debitCents: number;
    creditCents: number;
    placeholderLines: number;
    openExceptions: number;
    /** Marketplace-facilitator tax in the period, not journaled. */
    excludedTaxCents: number;
    sourcesReceived: number;
    sourcesExpected: number;
  };
  /** Slide 40's six target-close steps, in order. */
  steps: CloseStep[];
  /** Prior allocation workbook baseline and where our journal differs from it. */
  workbook: CloseWorkbookView;
  /** Business Central import / posting status (simulated today). */
  posting: ClosePostingView;
  /** GET this for the reconciliation evidence XLSX. */
  evidenceUrl: string;
  /** Audit trail (oldest first). */
  auditTrail: CloseEvent[];
  /** Which actions make sense now. */
  can: {
    generate: boolean;
    approve: boolean;
    forceApprove: boolean;
    export: boolean;
    markImported: boolean;
    markPosted: boolean;
  };
}

export type CloseStepKey = "acquire" | "archive" | "enrich" | "rules" | "bc_output" | "post_reconcile";

export interface CloseStep {
  key: CloseStepKey;
  label: string;
  status: "done" | "warning" | "todo";
  detail: string;
}

export interface CloseWorkbookDifference {
  sourceId: string;
  accountNo: string;
  /** Our journal / invoice total for the source + account, BC sign. */
  ourCents: number;
  workbookCents: number;
  /** ourCents - workbookCents. */
  diffCents: number;
}

export interface CloseWorkbookView {
  loaded: boolean;
  rows: number;
  differences: CloseWorkbookDifference[];
}

export interface ClosePostingView {
  status: PostingStatus;
  batch: string | null;
  documentNos: string[];
  postedAt: string | null;
  postedBy: string | null;
  importedAt: string | null;
  importedBy: string | null;
  /** true = no real Business Central call was made (SimulatedBcAdapter). */
  simulated: boolean;
}

const STEP_LABELS: Record<CloseStepKey, string> = {
  acquire: "Acquire",
  archive: "Archive",
  enrich: "Enrich",
  rules: "Apply rules",
  bc_output: "Create BC output",
  post_reconcile: "Post + reconcile",
};

async function hasColumn(db: Db, table: string, column: string): Promise<boolean> {
  const r = await db.$client.execute(`pragma table_info(${table})`);
  return r.rows.some((row) => (row as unknown as { name: string }).name === column);
}

export async function getCloseView(period: string, opts: { db?: Db } = {}): Promise<CloseView> {
  assertPeriod(period);
  const db = opts.db ?? getDb();
  const close = await findClose(db, period);

  // ---- Sources checklist ----------------------------------------------------
  const [sourceRows, runs] = await Promise.all([
    db.select().from(sources).where(eq(sources.active, 1)),
    db
      .select()
      .from(ingestRuns)
      .where(or(eq(ingestRuns.period, period), like(ingestRuns.businessDate, `${period}-%`))),
  ]);
  const order = Object.keys(SOURCE_CODES);
  const sourceList: CloseSourceItem[] = sourceRows
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((s) => {
      const files: CloseSourceFile[] = runs
        .filter((r) => r.sourceId === s.id)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
        .map((r) => ({
          ingestRunId: r.id,
          fileName: r.fileName,
          uploadedAt: r.uploadedAt,
          status: r.status,
          rowCount: r.rowCount,
          warningCount: countWarnings(r.warningsJson) + (r.status === "failed" ? 1 : 0),
        }));
      const good = files.some((f) => f.status !== "failed");
      const warningCount = files.reduce((n, f) => n + f.warningCount, 0);
      return {
        sourceId: s.id,
        name: s.name,
        kind: s.kind,
        status: !good ? "missing" : warningCount ? "warnings" : "received",
        fileCount: files.length,
        warningCount,
        lastUploadedAt: files[0]?.uploadedAt ?? null,
        target: s.id === INVOICE_SOURCE ? "invoice" : "journal",
        files,
      };
    });

  const taxRows = await db
    .select({ tax: orders.taxCents, status: orders.status })
    .from(orders)
    .where(like(orders.businessDate, `${period}-%`));
  const excludedTaxCents = taxRows.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.tax, 0);

  const sourcesReceived = sourceList.filter((s) => s.status !== "missing").length;
  const empty: BaseView = {
    period,
    status: (close?.status ?? "collecting") as CloseStatus,
    closeId: close?.id ?? null,
    approvedBy: close?.approvedBy ?? null,
    approvedAt: close?.approvedAt ?? null,
    sources: sourceList,
    documents: [],
    totalsByAccount: [],
    invoice: null,
    exceptions: [],
    summary: {
      journalLines: 0,
      documents: 0,
      balancedDocuments: 0,
      debitCents: 0,
      creditCents: 0,
      placeholderLines: 0,
      openExceptions: 0,
      excludedTaxCents,
      sourcesReceived,
      sourcesExpected: sourceList.length,
    },
    can: { generate: true, approve: false, forceApprove: false, export: false },
  };
  if (!close) return finish(db, period, empty, null, runs, []);

  // ---- Journal --------------------------------------------------------------
  const [lines, rules, invoices, excRows] = await Promise.all([
    db.select().from(journalLines).where(eq(journalLines.closeId, close.id)).orderBy(journalLines.lineNo),
    db.select().from(glRules),
    db.select().from(arInvoices).where(eq(arInvoices.closeId, close.id)),
    db.select().from(exceptions).where(eq(exceptions.closeId, close.id)).orderBy(exceptions.createdAt),
  ]);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const sourceName = new Map(sourceRows.map((s) => [s.id, s.name]));

  const lineViews: CloseLineView[] = lines.map((l) => {
    const rule = l.glRuleId ? ruleById.get(l.glRuleId) : undefined;
    const t = parseTrace(l.traceJson);
    return {
      lineNo: l.lineNo,
      documentNo: l.documentNo,
      postingDate: l.postingDate,
      accountType: l.accountType,
      accountNo: l.accountNo,
      deptCode: l.deptCode,
      description: l.description,
      amountCents: l.amountCents,
      balAccountType: l.balAccountType,
      balAccountNo: l.balAccountNo,
      sourceId: l.sourceId,
      amountType: rule?.amountType ?? null,
      isPlaceholder: !!rule?.isPlaceholder || l.accountNo.startsWith("TBC"),
      isBalancing: t?.kind === "balancing",
      factCount: t?.kind === "facts" ? t.count : 0,
      files: t?.kind === "facts" ? [...new Set(t.runs.map((r) => r.fileName))] : [],
    };
  });

  const docMap = new Map<string, CloseLineView[]>();
  for (const l of lineViews) docMap.set(l.documentNo, [...(docMap.get(l.documentNo) ?? []), l]);
  const documents: CloseDocumentView[] = [...docMap.entries()].map(([documentNo, ls]) => {
    const balanceCents = ls.filter((l) => !l.balAccountNo).reduce((s, l) => s + l.amountCents, 0);
    return {
      documentNo,
      sourceId: ls[0].sourceId,
      sourceName: sourceName.get(ls[0].sourceId ?? "") ?? ls[0].sourceId ?? "",
      postingDate: ls[0].postingDate,
      lines: ls,
      debitCents: ls.reduce((s, l) => s + Math.max(0, l.amountCents), 0),
      creditCents: ls.reduce((s, l) => s + Math.max(0, -l.amountCents), 0),
      balanceCents,
      balanced: balanceCents === 0,
    };
  });

  const totals = new Map<string, CloseAccountTotal>();
  for (const l of lineViews) {
    const k = `${l.accountType}|${l.accountNo}|${l.deptCode ?? ""}`;
    const t = totals.get(k) ?? {
      accountType: l.accountType,
      accountNo: l.accountNo,
      deptCode: l.deptCode,
      debitCents: 0,
      creditCents: 0,
      netCents: 0,
      isPlaceholder: l.isPlaceholder,
    };
    if (l.amountCents > 0) t.debitCents += l.amountCents;
    else t.creditCents -= l.amountCents;
    t.netCents += l.amountCents;
    t.isPlaceholder ||= l.isPlaceholder;
    totals.set(k, t);
  }
  const totalsByAccount = [...totals.values()].sort((a, b) => a.accountNo.localeCompare(b.accountNo));

  // ---- Invoice --------------------------------------------------------------
  let invoice: CloseInvoiceView | null = null;
  if (invoices.length) {
    const inv = invoices[0];
    const invLines = await db
      .select()
      .from(arInvoiceLines)
      .where(inArray(arInvoiceLines.invoiceId, [inv.id]))
      .orderBy(arInvoiceLines.lineNo);
    const ls = invLines.map((l) => {
      const t = parseTrace(l.traceJson);
      return {
        lineNo: l.lineNo,
        accountNo: l.accountNo,
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        amountCents: Math.round(l.unitPriceCents * l.quantity),
        deptCode: l.deptCode,
        factCount: t?.kind === "facts" ? t.count : 0,
      };
    });
    invoice = {
      customerNo: inv.customerNo,
      invoiceDate: inv.invoiceDate,
      postingDate: inv.postingDate,
      externalDocumentNo: inv.externalDocumentNo,
      currency: inv.currency,
      lines: ls,
      totalCents: ls.reduce((s, l) => s + l.amountCents, 0),
    };
  }

  const excViews: CloseExceptionView[] = excRows.map((e) => ({
    id: e.id,
    kind: e.kind,
    sourceId: e.sourceId,
    message: e.message,
    expectedCents: e.expectedCents,
    actualCents: e.actualCents,
    owner: e.owner,
    status: e.status,
    createdAt: e.createdAt,
    resolvedAt: e.resolvedAt,
  }));
  const openExceptions = excViews.filter((e) => e.status === "open").length;
  const status = close.status as CloseStatus;

  const base: BaseView = {
    ...empty,
    documents,
    totalsByAccount,
    invoice,
    exceptions: excViews,
    summary: {
      ...empty.summary,
      journalLines: lineViews.length,
      documents: documents.length,
      balancedDocuments: documents.filter((d) => d.balanced).length,
      debitCents: documents.reduce((s, d) => s + d.debitCents, 0),
      creditCents: documents.reduce((s, d) => s + d.creditCents, 0),
      placeholderLines: lineViews.filter((l) => l.isPlaceholder).length,
      openExceptions,
    },
    can: {
      generate: status !== "exported",
      approve: status === "reconciled",
      forceApprove: status === "generated",
      export: status === "approved" || status === "exported",
    },
  };
  return finish(db, period, base, close, runs, excViews);
}

function countWarnings(json: string | null): number {
  if (!json) return 0;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

type BaseView = Omit<CloseView, "steps" | "workbook" | "posting" | "evidenceUrl" | "auditTrail" | "can"> & {
  can: Pick<CloseView["can"], "generate" | "approve" | "forceApprove" | "export">;
};

/** Adds the control-layer fields (steps, workbook, posting, evidence, audit, can). */
async function finish(
  db: Db,
  period: string,
  base: BaseView,
  close: Close | null,
  runs: IngestRun[],
  excViews: CloseExceptionView[],
): Promise<CloseView> {
  const baseline = await loadWorkbookBaseline(db, period);
  const tie = close ? await computeTieOut(db, close) : null;
  const postingStatus = (close?.postingStatus ?? "not_posted") as PostingStatus;
  const response = parsePostingResponse(close?.postingResponseJson);
  let documentNos: string[] = [];
  try {
    documentNos = close?.bcDocumentNos ? (JSON.parse(close.bcDocumentNos) as string[]) : [];
  } catch {
    documentNos = [];
  }

  const workbook: CloseWorkbookView = {
    loaded: baseline.length > 0,
    rows: baseline.length,
    differences: (tie?.rows ?? [])
      .filter((r) => differs(r.workbookDiffCents))
      .map((r) => ({
        sourceId: r.sourceId,
        accountNo: r.accountNo,
        ourCents: r.journalCents,
        workbookCents: r.workbookCents ?? 0,
        diffCents: r.workbookDiffCents ?? 0,
      })),
  };
  const posting: ClosePostingView = {
    status: postingStatus,
    batch: close?.bcBatch ?? null,
    documentNos,
    postedAt: close?.postedAt ?? null,
    postedBy: close?.postedBy ?? null,
    importedAt: close?.importedAt ?? null,
    importedBy: close?.importedBy ?? null,
    simulated: response?.simulated ?? true,
  };

  // ---- Slide 40 steps -------------------------------------------------------
  const s = base.summary;
  const missing = base.sources.filter((x) => x.status === "missing");
  const open = excViews.filter((e) => e.status === "open");
  const steps: CloseStep[] = [];
  const step = (key: CloseStepKey, status: CloseStep["status"], detail: string) => steps.push({ key, label: STEP_LABELS[key], status, detail });

  step(
    "acquire",
    s.sourcesReceived === 0 ? "todo" : missing.length ? "warning" : "done",
    s.sourcesReceived === 0
      ? "No source files for the period yet."
      : `${s.sourcesReceived}/${s.sourcesExpected} sources received, ${runs.length} file(s)` + (missing.length ? `; missing: ${missing.map((x) => x.name).join(", ")}.` : "."),
  );

  // Archive columns come from another lane; read them only if they exist.
  const archiveCol = runs.length ? await hasColumn(db, "ingest_runs", "archive_key") : false;
  let archived = 0;
  if (archiveCol) {
    const r = await db.$client.execute({
      sql: "select count(*) as n from ingest_runs where (period = ? or business_date like ?) and archive_key is not null and archive_key <> ''",
      args: [period, `${period}-%`],
    });
    archived = Number((r.rows[0] as unknown as { n: number }).n ?? 0);
  }
  const failedRuns = runs.filter((r) => r.status === "failed").length;
  step(
    "archive",
    runs.length === 0 ? "todo" : failedRuns || (archiveCol && archived < runs.length) ? "warning" : "done",
    runs.length === 0
      ? "Nothing to archive yet."
      : `${runs.length} file(s) fingerprinted (SHA-256) with run history` +
          (archiveCol ? `, ${archived}/${runs.length} archived` : "") +
          (failedRuns ? `; ${failedRuns} failed to parse.` : "."),
  );

  let supplierDetail = "";
  let supplierGap = 0;
  if (runs.length && (await hasColumn(db, "orders", "supplier"))) {
    const r = await db.$client.execute({
      sql: "select count(*) as n, sum(case when supplier is null or supplier = '' then 1 else 0 end) as gap from orders where source_id = 'jewelry' and business_date like ?",
      args: [`${period}-%`],
    });
    const row = r.rows[0] as unknown as { n: number; gap: number | null };
    supplierGap = Number(row.gap ?? 0);
    supplierDetail = `; Jewelry supplier on ${Number(row.n) - supplierGap}/${Number(row.n)} order(s)`;
  }
  step(
    "enrich",
    runs.length === 0 ? "todo" : supplierGap ? "warning" : "done",
    runs.length === 0 ? "Waiting for source files." : `Facts carry source, channel and period metadata${supplierDetail}.`,
  );

  const unmappedOpen = open.filter((e) => e.kind === "unmapped_amount").length;
  const srcDiffs = (tie?.rows ?? []).filter((r) => r.accountNo !== UNMAPPED_ACCOUNT && differs(r.sourceDiffCents)).length;
  step(
    "rules",
    !close ? "todo" : unmappedOpen || srcDiffs ? "warning" : "done",
    !close
      ? "Generate the close to apply the GL rules."
      : `${s.journalLines} journal line(s) from the GL rules (${s.placeholderLines} on placeholder TBC accounts)` +
          (unmappedOpen ? `; ${unmappedOpen} unmapped amount group(s)` : "") +
          (srcDiffs ? `; ${srcDiffs} account(s) no longer tie to the facts` : "") +
          ".",
  );

  const unbalanced = s.documents - s.balancedDocuments;
  step(
    "bc_output",
    !close ? "todo" : unbalanced || s.journalLines === 0 ? "warning" : "done",
    !close
      ? "No General Journal or AR invoice yet."
      : `${s.journalLines} General Journal line(s) in ${s.documents} document(s) (${s.balancedDocuments} balanced, debits ${fmtUsd(s.debitCents)} = credits ${fmtUsd(s.creditCents)})` +
          (base.invoice ? ` + AR invoice ${fmtUsd(base.invoice.totalCents)}` : "") +
          (base.status === "exported" ? "; exported." : "; not exported yet."),
  );

  const openRecon = open.filter((e) => e.kind === "reconcile_mismatch").length;
  const postLabel = `${postingStatus}${posting.simulated && postingStatus !== "not_posted" ? " (simulated BC)" : ""}`;
  step(
    "post_reconcile",
    !close
      ? "todo"
      : postingStatus === "failed" || openRecon
        ? "warning"
        : postingStatus === "posted" && open.length === 0
          ? "done"
          : "todo",
    !close
      ? "Generate, approve and export first."
      : `Posting: ${postLabel}${posting.batch ? ` (batch ${posting.batch})` : ""}; workbook ${workbook.loaded ? `${workbook.differences.length} difference(s)` : "not loaded"}; ${open.length} open exception(s)` +
          (openRecon ? ` (${openRecon} reconcile mismatch)` : "") +
          ".",
  );

  return {
    ...base,
    steps,
    workbook,
    posting,
    evidenceUrl: `/api/close/${period}/evidence`,
    auditTrail: parseEvents(close?.eventsJson),
    can: {
      ...base.can,
      markImported: base.status === "exported" && (postingStatus === "not_posted" || postingStatus === "failed"),
      markPosted: postingStatus === "imported",
    },
  };
}

