/**
 * Month-end close engine: facts for a period → BC General Journal lines + one
 * AR invoice, stored in `journal_lines` / `ar_invoices` / `ar_invoice_lines`.
 *
 * generateClose(period)
 *   1. Ensures config + default GL rules exist; creates or refreshes the
 *      `closes` row (status `generated`; any previous approval is cleared).
 *   2. Sums facts per (source, amount_type, channel) for the period:
 *        orders (business_date in the period, cancelled skipped) →
 *          sale / shipping_income / refund / marketplace_fee (see gl-rules.ts);
 *        money_lines (period = P) → their own amount_type.
 *      Goodwill Books `statement_payment` is a control total: never posted,
 *      used by reconcile. Marketplace-facilitator tax is reported as excluded.
 *   3. One document per source (Document No. ECOM-2609-AMZ, ≤ 20 chars),
 *      lines ordered by amount type, plus one balancing line from the
 *      source's `clearing` rule. Amount = fact amount × journal_sign
 *      (+ = debit). Description ≤ 50 chars. trace_json lists the fact ids
 *      (or count + ingest runs + row ranges when there are many).
 *   4. Goodwill Books goes to an AR invoice (customer TBC placeholder), one
 *      line per amount type, not to the General Journal.
 *   5. Amounts without a GL rule → `unmapped_amount` exception (amount kept
 *      in actual_cents), never silently dropped.
 *   6. Runs reconcile (reconcile.ts), which raises `unbalanced_document`,
 *      `reconcile_mismatch`, `missing_source` and sets status `reconciled`
 *      when nothing blocking is open.
 *
 * Idempotent: regenerating a period deletes and rebuilds its journal lines,
 * invoice and close exceptions (waived exceptions are recreated as open).
 * An `exported` close is only regenerated with `force: true`.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, ne } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  arInvoiceLines,
  arInvoices,
  channels,
  closes,
  exceptions,
  glRules,
  ingestRuns,
  journalLines,
  moneyLines,
  orders,
  sources,
  type GlRule,
  type NewArInvoiceLine,
  type NewDataException,
  type NewJournalLine,
} from "@/db/schema";
import {
  AMOUNT_TYPE_ORDER,
  CLEARING,
  INVOICE_SOURCE,
  SOURCE_CODES,
  amountTypeLabel,
  ensureGlRules,
} from "./gl-rules";
import {
  CloseError,
  JOURNAL_TEMPLATE,
  TRACE_ID_LIMIT,
  appendEvent,
  assertPeriod,
  documentNo,
  findClose,
  fmtUsd,
  journalBatch,
  periodEnd,
  periodLabel,
  rowRanges,
  truncate,
  type BalancingTrace,
  type FactTrace,
} from "./common";
import { reconcileClose, type ReconcileResult } from "./reconcile";

export interface GenerateOptions {
  db?: Db;
  /** Allow regenerating an exported close. */
  force?: boolean;
  /** Who ran it (audit trail). Default "system". */
  by?: string;
}

export interface GenerateResult {
  closeId: string;
  period: string;
  status: string;
  documents: { documentNo: string; sourceId: string; lines: number; debitCents: number; creditCents: number }[];
  journalLines: number;
  invoiceLines: number;
  unmapped: { sourceId: string; amountType: string; channel: string | null; amountCents: number; facts: number }[];
  /** Marketplace-facilitator tax per source (not journaled). */
  excludedTaxCents: Record<string, number>;
  reconcile: ReconcileResult;
}

export interface Group {
  sourceId: string;
  amountType: string;
  channel: string | null;
  amountCents: number;
  tables: Set<"orders" | "money_lines">;
  ids: string[];
  runRows: Map<string, number[]>;
}

export interface FactGroups {
  /** Key: source|amount_type|channel. */
  groups: Map<string, Group>;
  /** Marketplace-facilitator tax per source (not journaled). */
  excludedTaxCents: Record<string, number>;
  /** Goodwill Books statement reference (invoice External Document No.). */
  statementRef: string | null;
}

const CHUNK = 200;

export async function generateClose(period: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
  assertPeriod(period);
  const db = opts.db ?? getDb();
  await ensureGlRules(db);

  const existing = await findClose(db, period);
  if (existing?.postingStatus === "posted") {
    throw new CloseError("conflict", `The ${period} close is posted in Business Central. Reverse it there before regenerating.`);
  }
  if (existing?.status === "exported" && !opts.force) {
    throw new CloseError("conflict", `The ${period} close was already exported. Regenerate with force to rebuild it.`);
  }
  const closeId = existing?.id ?? randomUUID();

  // ---- Config ---------------------------------------------------------------
  const [ruleRows, sourceRows, channelRows] = await Promise.all([
    db.select().from(glRules),
    db.select().from(sources),
    db.select().from(channels),
  ]);
  const rules = new Map<string, GlRule>();
  // Confirmed rules win over placeholders if two rules share (source, amount_type).
  for (const r of [...ruleRows].sort((a, b) => b.isPlaceholder - a.isPlaceholder)) {
    rules.set(`${r.sourceId}|${r.amountType}`, r);
  }
  const sourceName = new Map(sourceRows.map((s) => [s.id, s.name]));
  const channelName = new Map(channelRows.map((c) => [c.id, c.name]));

  // ---- Facts ----------------------------------------------------------------
  // ---- Facts ----------------------------------------------------------------
  const { groups, excludedTaxCents, statementRef } = await collectFactGroups(db, period);

  // File names for traces.
  const runIds = [...new Set([...groups.values()].flatMap((g) => [...g.runRows.keys()]))];
  const fileName = new Map<string, string>();
  for (let i = 0; i < runIds.length; i += 500) {
    const rows = await db
      .select({ id: ingestRuns.id, fileName: ingestRuns.fileName })
      .from(ingestRuns)
      .where(inArray(ingestRuns.id, runIds.slice(i, i + 500)));
    for (const r of rows) fileName.set(r.id, r.fileName);
  }
  const traceOf = (g: Group): FactTrace => ({
    kind: "facts",
    table: g.tables.size > 1 ? "mixed" : [...g.tables][0],
    count: g.ids.length,
    ids: g.ids.length <= TRACE_ID_LIMIT ? g.ids : undefined,
    runs: [...g.runRows.entries()]
      .map(([ingestRunId, rows]) => ({ ingestRunId, fileName: fileName.get(ingestRunId) ?? "?", rows: rowRanges(rows) }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName)),
  });

  // ---- Build lines ----------------------------------------------------------
  const typeRank = (t: string) => {
    const i = AMOUNT_TYPE_ORDER.indexOf(t);
    return i < 0 ? AMOUNT_TYPE_ORDER.length - 1 : i;
  };
  const sorted = [...groups.values()].sort(
    (a, b) =>
      sourceRank(a.sourceId) - sourceRank(b.sourceId) ||
      typeRank(a.amountType) - typeRank(b.amountType) ||
      (a.channel ?? "").localeCompare(b.channel ?? ""),
  );

  const label = periodLabel(period);
  const postingDate = periodEnd(period);
  const describe = (rule: GlRule, g: { sourceId: string; amountType: string; channel: string | null }) => {
    const src = sourceName.get(g.sourceId) ?? g.sourceId;
    const ch = g.channel && g.channel !== g.sourceId ? ` (${channelName.get(g.channel) ?? g.channel})` : "";
    const tpl = rule.descriptionTemplate || "{source} {type}{channel} {period}";
    return truncate(
      tpl
        .replace("{source}", src)
        .replace("{type}", amountTypeLabel(g.amountType))
        .replace("{channel}", ch)
        .replace("{period}", label)
        .replace(/\s+/g, " ")
        .trim(),
    );
  };

  const jLines: NewJournalLine[] = [];
  const invLines: NewArInvoiceLine[] = [];
  const unmapped: GenerateResult["unmapped"] = [];
  const invoiceId = randomUUID();
  let lineNo = 0;
  const docs = new Map<string, NewJournalLine[]>();

  for (const g of sorted) {
    const rule = rules.get(`${g.sourceId}|${g.amountType}`);
    if (!rule) {
      unmapped.push({ sourceId: g.sourceId, amountType: g.amountType, channel: g.channel, amountCents: g.amountCents, facts: g.ids.length });
      continue;
    }
    if (g.sourceId === INVOICE_SOURCE) {
      invLines.push({
        id: randomUUID(),
        invoiceId,
        lineNo: (invLines.length + 1) * 10000,
        lineType: "Account",
        accountNo: rule.accountNo,
        description: describe(rule, g),
        quantity: 1,
        unitPriceCents: g.amountCents, // invoice lines keep the fact sign: + = billed to the customer
        deptCode: rule.deptCode,
        traceJson: JSON.stringify(traceOf(g)),
      });
      continue;
    }
    const docNo = documentNo(period, SOURCE_CODES[g.sourceId] ?? g.sourceId.slice(0, 3).toUpperCase());
    const amount = g.amountCents * rule.journalSign;
    if (!amount) continue;
    const line: NewJournalLine = {
      id: randomUUID(),
      closeId,
      journalTemplate: JOURNAL_TEMPLATE,
      journalBatch: journalBatch(period),
      lineNo: (lineNo += 10000),
      postingDate,
      documentType: null,
      documentNo: docNo,
      externalDocumentNo: null,
      accountType: rule.accountType,
      accountNo: rule.accountNo,
      deptCode: rule.deptCode,
      balAccountType: rule.balAccountNo ? rule.balAccountType : null,
      balAccountNo: rule.balAccountNo,
      description: describe(rule, g),
      amountCents: amount,
      sourceId: g.sourceId,
      glRuleId: rule.id,
      traceJson: JSON.stringify(traceOf(g)),
    };
    jLines.push(line);
    const list = docs.get(docNo) ?? [];
    list.push(line);
    docs.set(docNo, list);
  }

  // Balancing line per document (lines with their own Bal. Account balance themselves).
  for (const [docNo, list] of docs) {
    const sourceId = list[0].sourceId!;
    const open = list.filter((l) => !l.balAccountNo);
    const net = open.reduce((s, l) => s + l.amountCents, 0);
    if (!net) continue;
    const rule = rules.get(`${sourceId}|${CLEARING}`);
    if (!rule) continue; // reconcile raises unbalanced_document
    const trace: BalancingTrace = { kind: "balancing", documentNo: docNo, lineNos: open.map((l) => l.lineNo) };
    const line: NewJournalLine = {
      ...list[0],
      id: randomUUID(),
      lineNo: 0, // renumbered below
      accountType: rule.accountType,
      accountNo: rule.accountNo,
      deptCode: rule.deptCode,
      balAccountType: null,
      balAccountNo: null,
      description: describe(rule, { sourceId, amountType: CLEARING, channel: null }),
      amountCents: -net,
      glRuleId: rule.id,
      traceJson: JSON.stringify(trace),
    };
    const idx = jLines.lastIndexOf(list[list.length - 1]);
    jLines.splice(idx + 1, 0, line);
  }
  // Renumber so line numbers follow document order; fix balancing traces.
  const oldToNew = new Map<number, number>();
  jLines.forEach((l, i) => {
    if (l.lineNo) oldToNew.set(l.lineNo, (i + 1) * 10000);
    l.lineNo = (i + 1) * 10000;
  });
  for (const l of jLines) {
    const t = JSON.parse(l.traceJson!) as FactTrace | BalancingTrace;
    if (t.kind === "balancing") {
      t.lineNos = t.lineNos.map((n) => oldToNew.get(n) ?? n);
      l.traceJson = JSON.stringify(t);
    }
  }

  // ---- Exceptions -----------------------------------------------------------
  const exc: NewDataException[] = unmapped.map((u) => ({
    id: randomUUID(),
    closeId,
    sourceId: u.sourceId,
    kind: "unmapped_amount",
    message: truncate(
      `No GL rule for ${sourceName.get(u.sourceId) ?? u.sourceId} / ${u.amountType}${u.channel ? ` (${u.channel})` : ""}: ` +
        `${fmtUsd(u.amountCents)} from ${u.facts} fact row(s) not posted. Add a gl_rules row, then regenerate.`,
      500,
    ),
    actualCents: u.amountCents,
    owner: "Accounting",
    status: "open",
  }));

  // ---- Write (one transaction) ----------------------------------------------
  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(closes)
        .set({
          status: "generated",
          approvedBy: null,
          approvedAt: null,
          postingStatus: "not_posted",
          bcBatch: null,
          bcDocumentNos: null,
          importedAt: null,
          importedBy: null,
          postedAt: null,
          postedBy: null,
          postingResponseJson: null,
        })
        .where(eq(closes.id, closeId));
      const oldInvoices = await tx.select({ id: arInvoices.id }).from(arInvoices).where(eq(arInvoices.closeId, closeId));
      if (oldInvoices.length) {
        await tx.delete(arInvoiceLines).where(inArray(arInvoiceLines.invoiceId, oldInvoices.map((i) => i.id)));
        await tx.delete(arInvoices).where(eq(arInvoices.closeId, closeId));
      }
      await tx.delete(journalLines).where(eq(journalLines.closeId, closeId));
      await tx.delete(exceptions).where(eq(exceptions.closeId, closeId));
    } else {
      await tx.insert(closes).values({ id: closeId, period, status: "generated" });
    }
    for (let i = 0; i < jLines.length; i += CHUNK) {
      await tx.insert(journalLines).values(jLines.slice(i, i + CHUNK));
    }
    if (invLines.length) {
      await tx.insert(arInvoices).values({
        id: invoiceId,
        closeId,
        customerNo: "TBC-GWBOOKS",
        invoiceDate: postingDate,
        postingDate,
        externalDocumentNo: (statementRef ?? `GB-STMT-${period.replace("-", "")}`).slice(0, 35),
        currency: "USD",
      });
      await tx.insert(arInvoiceLines).values(invLines);
    }
    if (exc.length) await tx.insert(exceptions).values(exc);
  });

  await appendEvent(db, closeId, {
    action: "generated",
    actor: opts.by ?? "system",
    detail: `${jLines.length} journal lines in ${docs.size} documents, ${invLines.length} invoice lines${existing ? " (regenerated)" : ""}`,
  });
  const reconcile = await reconcileClose(period, { db, by: opts.by });

  const documents = [...docs.keys()].map((docNo) => {
    const ls = jLines.filter((l) => l.documentNo === docNo);
    return {
      documentNo: docNo,
      sourceId: ls[0].sourceId!,
      lines: ls.length,
      debitCents: ls.reduce((s, l) => s + Math.max(0, l.amountCents), 0),
      creditCents: ls.reduce((s, l) => s + Math.max(0, -l.amountCents), 0),
    };
  });

  return {
    closeId,
    period,
    status: reconcile.status,
    documents,
    journalLines: jLines.length,
    invoiceLines: invLines.length,
    unmapped,
    excludedTaxCents,
    reconcile,
  };
}

const SOURCE_ORDER = Object.keys(SOURCE_CODES);
function sourceRank(id: string): number {
  const i = SOURCE_ORDER.indexOf(id);
  return i < 0 ? SOURCE_ORDER.length : i;
}

/**
 * Sum the period's facts per (source, amount_type, channel), exactly as the
 * journal is built. Exported so reconcile can tie the journal back to the
 * facts independently of the stored journal lines.
 */
export async function collectFactGroups(db: Db, period: string): Promise<FactGroups> {
  const [orderRows, lineRows] = await Promise.all([
    db
      .select({
        id: orders.id,
        sourceId: orders.sourceId,
        channel: orders.channel,
        ingestRunId: orders.ingestRunId,
        sourceRow: orders.sourceRow,
        gross: orders.grossCents,
        shipping: orders.shippingCents,
        refund: orders.refundCents,
        fee: orders.feeCents,
        tax: orders.taxCents,
      })
      .from(orders)
      .where(and(like(orders.businessDate, `${period}-%`), ne(orders.status, "cancelled"))),
    db.select().from(moneyLines).where(eq(moneyLines.period, period)),
  ]);

  const groups = new Map<string, Group>();
  const add = (
    table: "orders" | "money_lines",
    sourceId: string,
    amountType: string,
    channel: string | null,
    cents: number,
    id: string,
    runId: string,
    row: number,
  ) => {
    if (!cents) return;
    const key = `${sourceId}|${amountType}|${channel ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { sourceId, amountType, channel, amountCents: 0, tables: new Set(), ids: [], runRows: new Map() };
      groups.set(key, g);
    }
    g.amountCents += cents;
    g.tables.add(table);
    g.ids.push(id);
    const rows = g.runRows.get(runId) ?? [];
    rows.push(row);
    g.runRows.set(runId, rows);
  };

  const excludedTaxCents: Record<string, number> = {};
  for (const o of orderRows) {
    add("orders", o.sourceId, "sale", o.channel, o.gross, o.id, o.ingestRunId, o.sourceRow);
    add("orders", o.sourceId, "shipping_income", o.channel, o.shipping, o.id, o.ingestRunId, o.sourceRow);
    add("orders", o.sourceId, "refund", o.channel, -o.refund, o.id, o.ingestRunId, o.sourceRow);
    add("orders", o.sourceId, "marketplace_fee", o.channel, -o.fee, o.id, o.ingestRunId, o.sourceRow);
    if (o.tax) excludedTaxCents[o.sourceId] = (excludedTaxCents[o.sourceId] ?? 0) + o.tax;
  }
  let statementRef: string | null = null;
  for (const m of lineRows) {
    if (m.amountType === "statement_payment") {
      statementRef ??= m.reference;
      continue; // control total, checked by reconcile
    }
    // EasyPost payment-log refunds are informational: the shipment report is
    // the authority for label refunds (see shipping_osm_pb_easypost.ts).
    if (m.amountType === "wallet_refund") continue;
    // 1st Source bank statement lines are informational until bank reconciliation
    // (they mirror payouts and shipping already counted from the source reports).
    if (m.sourceId === "bank_1st_source") continue;
    add("money_lines", m.sourceId, m.amountType, m.channel, m.amountCents, m.id, m.ingestRunId, m.sourceRow);
  }

  return { groups, excludedTaxCents, statementRef };
}