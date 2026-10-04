/**
 * Three-way tie-out (slide 41 WS5: "reconcile source, workbook-equivalent and
 * posted totals"), per (source, account):
 *
 *   source facts  →  our journal / AR invoice  →  workbook baseline  →  posted in BC
 *
 * - sourceCents: recomputed from the facts (collectFactGroups, the same sums
 *   the engine uses) through the CURRENT gl_rules, in BC sign. The clearing
 *   account gets minus the net of the source's other lines (as the engine's
 *   balancing line does). Independent of the stored journal, so a rule edited
 *   after generation, or a lost line, shows up as a difference.
 * - journalCents: stored journal_lines (+ = debit), plus AR invoice lines for
 *   Goodwill Books in BC sign (revenue = credit = negative).
 * - workbookCents: `workbook_baseline` rows for the period (the prior
 *   allocation workbook's journal output). null when the source has no
 *   baseline rows (not compared); 0 when the source has rows but not this account.
 * - postedCents: per-account totals BC echoed back when the close was posted
 *   (simulated today, see posting.ts). null until posted.
 *
 * Department is informational here (rows are keyed by source + account), the
 * same grain the workbook's journal tabs are checked at.
 *
 * Tolerance: amounts must agree to the cent. Any difference of $0.01 or more
 * is a mismatch (RECON_TOLERANCE_CENTS = 0 extra cents allowed).
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { arInvoiceLines, arInvoices, glRules, journalLines, sources, workbookBaseline, type Close, type GlRule } from "@/db/schema";
import { collectFactGroups } from "./engine";
import { CLEARING, INVOICE_SOURCE, SOURCE_CODES } from "./gl-rules";
import type { PostingResponse } from "./posting";

/** Extra cents allowed before a difference counts. 0 = must match to the cent. */
export const RECON_TOLERANCE_CENTS = 0;

export const UNMAPPED_ACCOUNT = "(unmapped)";

export interface TieOutRow {
  sourceId: string;
  sourceName: string;
  accountNo: string;
  /** Department codes seen on our lines / the workbook rows, comma separated. */
  deptCodes: string;
  target: "journal" | "invoice";
  sourceCents: number;
  journalCents: number;
  workbookCents: number | null;
  postedCents: number | null;
  /** journal - source. */
  sourceDiffCents: number;
  /** journal - workbook (null = no baseline for the source). */
  workbookDiffCents: number | null;
  /** posted - journal (null = not posted). */
  postedDiffCents: number | null;
  ok: boolean;
}

export interface TieOut {
  rows: TieOutRow[];
  workbookLoaded: boolean;
  workbookRows: number;
  posted: boolean;
}

export const differs = (d: number | null) => d !== null && Math.abs(d) > RECON_TOLERANCE_CENTS;

export function parsePostingResponse(json: string | null | undefined): PostingResponse | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as PostingResponse;
  } catch {
    return null;
  }
}

export async function computeTieOut(db: Db, close: Close): Promise<TieOut> {
  const [{ groups }, ruleRows, sourceRows, lines, invoices, baseline] = await Promise.all([
    collectFactGroups(db, close.period),
    db.select().from(glRules),
    db.select({ id: sources.id, name: sources.name }).from(sources),
    db.select().from(journalLines).where(eq(journalLines.closeId, close.id)),
    db.select().from(arInvoices).where(eq(arInvoices.closeId, close.id)),
    db.select().from(workbookBaseline).where(eq(workbookBaseline.period, close.period)),
  ]);
  const invLines = invoices.length
    ? await db.select().from(arInvoiceLines).where(inArray(arInvoiceLines.invoiceId, invoices.map((i) => i.id)))
    : [];
  const rules = new Map<string, GlRule>();
  for (const r of [...ruleRows].sort((a, b) => b.isPlaceholder - a.isPlaceholder)) rules.set(`${r.sourceId}|${r.amountType}`, r);
  const name = new Map(sourceRows.map((s) => [s.id, s.name]));

  type Acc = { source: number; journal: number; workbook: number | null; posted: number | null; depts: Set<string> };
  const rows = new Map<string, Acc>();
  const at = (sourceId: string, accountNo: string) => {
    const k = `${sourceId}|${accountNo}`;
    let a = rows.get(k);
    if (!a) {
      a = { source: 0, journal: 0, workbook: null, posted: null, depts: new Set() };
      rows.set(k, a);
    }
    return a;
  };

  // ---- Source facts through the rules ---------------------------------------
  const openNet = new Map<string, number>();
  for (const g of groups.values()) {
    const rule = rules.get(`${g.sourceId}|${g.amountType}`);
    if (!rule) {
      at(g.sourceId, UNMAPPED_ACCOUNT).source += g.amountCents;
      continue;
    }
    if (g.sourceId === INVOICE_SOURCE) {
      at(g.sourceId, rule.accountNo).source += -g.amountCents;
      continue;
    }
    const cents = g.amountCents * rule.journalSign;
    at(g.sourceId, rule.accountNo).source += cents;
    if (!rule.balAccountNo) openNet.set(g.sourceId, (openNet.get(g.sourceId) ?? 0) + cents);
  }
  for (const [sourceId, net] of openNet) {
    const rule = rules.get(`${sourceId}|${CLEARING}`);
    if (rule && net) at(sourceId, rule.accountNo).source += -net;
  }

  // ---- Our journal + invoice ------------------------------------------------
  for (const l of lines) {
    const a = at(l.sourceId ?? "?", l.accountNo);
    a.journal += l.amountCents;
    if (l.deptCode) a.depts.add(l.deptCode);
  }
  for (const l of invLines) {
    const a = at(INVOICE_SOURCE, l.accountNo ?? "");
    a.journal += -Math.round(l.unitPriceCents * l.quantity);
    if (l.deptCode) a.depts.add(l.deptCode);
  }

  // ---- Workbook baseline ----------------------------------------------------
  const baselineSources = new Set(baseline.map((b) => b.sourceId ?? "?"));
  for (const b of baseline) {
    const a = at(b.sourceId ?? "?", b.accountNo);
    a.workbook = (a.workbook ?? 0) + b.amountCents;
    if (b.deptCode) a.depts.add(b.deptCode);
  }
  for (const [k, a] of rows) {
    if (a.workbook === null && baselineSources.has(k.split("|")[0]) && !k.endsWith(`|${UNMAPPED_ACCOUNT}`)) a.workbook = 0;
  }

  // ---- Posted (BC response) -------------------------------------------------
  const posted = close.postingStatus === "posted";
  if (posted) {
    const resp = parsePostingResponse(close.postingResponseJson);
    for (const p of resp?.post?.byAccount ?? []) at(p.sourceId, p.accountNo).posted = (at(p.sourceId, p.accountNo).posted ?? 0) + p.cents;
    for (const [k, a] of rows) if (a.posted === null && !k.endsWith(`|${UNMAPPED_ACCOUNT}`)) a.posted = 0;
  }

  const order = Object.keys(SOURCE_CODES);
  const rank = (s: string) => (order.indexOf(s) < 0 ? order.length : order.indexOf(s));
  const out: TieOutRow[] = [...rows.entries()]
    .map(([k, a]) => {
      const [sourceId, accountNo] = k.split("|");
      const sourceDiffCents = a.journal - a.source;
      const workbookDiffCents = a.workbook === null ? null : a.journal - a.workbook;
      const postedDiffCents = a.posted === null ? null : a.posted - a.journal;
      return {
        sourceId,
        sourceName: name.get(sourceId) ?? sourceId,
        accountNo,
        deptCodes: [...a.depts].sort().join(", "),
        target: sourceId === INVOICE_SOURCE ? ("invoice" as const) : ("journal" as const),
        sourceCents: a.source,
        journalCents: a.journal,
        workbookCents: a.workbook,
        postedCents: a.posted,
        sourceDiffCents,
        workbookDiffCents,
        postedDiffCents,
        ok: !differs(sourceDiffCents) && !differs(workbookDiffCents) && !differs(postedDiffCents),
      };
    })
    .filter((r) => r.sourceCents || r.journalCents || r.workbookCents || r.postedCents)
    .sort((a, b) => rank(a.sourceId) - rank(b.sourceId) || a.accountNo.localeCompare(b.accountNo));

  return { rows: out, workbookLoaded: baseline.length > 0, workbookRows: baseline.length, posted };
}
