/**
 * Workbook baseline: the prior E-Commerce Allocation workbook's journal output
 * for a period (slide 39 step 4 "Journal Entry tabs"), loaded so the
 * generated close can be proven against it before manual posting is retired
 * (slide 42 wave 3 "Reproduce + validate").
 *
 * CSV columns (header names matched case-insensitively, extra columns ignored):
 *   Source       source id (fedex), name (FedEx) or code (FDX)
 *   Account No.  BC account number
 *   Department   BC Department Code (blank = none)
 *   Amount       BC sign: + = debit, - = credit. "1,234.56", "-43.18",
 *                "(43.18)" and "$" are accepted. For Goodwill Books (AR
 *                invoice) revenue lines are credits (negative), like the journal.
 *
 * importWorkbookBaseline REPLACES the period's baseline rows (idempotent),
 * then re-runs reconcile if the close exists, so the workbook tie-out and its
 * owned exceptions update immediately.
 */
import { createHash, randomUUID } from "node:crypto";
import Papa from "papaparse";
import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { sources, workbookBaseline, type NewWorkbookBaseline } from "@/db/schema";
import { ensureGlRules, SOURCE_CODES } from "./gl-rules";
import { CloseError, appendEvent, assertPeriod, findClose, fmtUsd, parseMoneyToCents } from "./common";
import { reconcileClose, type ReconcileResult } from "./reconcile";

export const WORKBOOK_COLUMNS = ["Source", "Account No.", "Department", "Amount"] as const;

export interface WorkbookImportResult {
  period: string;
  fileName: string;
  sha256: string;
  rows: number;
  netCents: number;
  bySource: { sourceId: string; rows: number; netCents: number }[];
  /** Present when a close exists for the period (it was re-reconciled). */
  reconcile: ReconcileResult | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function importWorkbookBaseline(
  period: string,
  csv: string | Buffer,
  opts: { db?: Db; fileName?: string; by?: string } = {},
): Promise<WorkbookImportResult> {
  assertPeriod(period);
  const db = opts.db ?? getDb();
  await ensureGlRules(db); // makes sure the sources exist
  const text = (typeof csv === "string" ? csv : csv.toString("utf8")).replace(/^﻿/, "");
  const sha256 = createHash("sha256").update(text).digest("hex");
  const fileName = opts.fileName ?? "workbook.csv";

  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy" });
  const headers = parsed.meta.fields ?? [];
  const col = (want: string, alts: string[] = []) => headers.find((h) => [want, ...alts].map(norm).includes(norm(h)));
  const cSource = col("Source");
  const cAccount = col("Account No.", ["Account", "Account Number", "G/L Account No."]);
  const cDept = col("Department", ["Department Code", "Dept"]);
  const cAmount = col("Amount");
  if (!cSource || !cAccount || !cAmount) {
    throw new CloseError("bad_input", `Workbook CSV needs columns ${WORKBOOK_COLUMNS.join(", ")} (got: ${headers.join(", ") || "none"}).`);
  }

  const sourceRows = await db.select({ id: sources.id, name: sources.name }).from(sources);
  const lookup = new Map<string, string>();
  for (const s of sourceRows) {
    lookup.set(norm(s.id), s.id);
    lookup.set(norm(s.name), s.id);
    if (SOURCE_CODES[s.id]) lookup.set(norm(SOURCE_CODES[s.id]), s.id);
  }

  const rows: NewWorkbookBaseline[] = [];
  const problems: string[] = [];
  parsed.data.forEach((r, i) => {
    const line = i + 2;
    const rawSource = (r[cSource] ?? "").trim();
    const accountNo = (r[cAccount] ?? "").trim();
    if (!rawSource && !accountNo) return;
    const sourceId = lookup.get(norm(rawSource));
    const cents = parseMoneyToCents(r[cAmount]);
    if (!sourceId) problems.push(`row ${line}: unknown source "${rawSource}"`);
    if (!accountNo) problems.push(`row ${line}: missing Account No.`);
    if (Number.isNaN(cents)) problems.push(`row ${line}: bad Amount "${r[cAmount]}"`);
    if (!sourceId || !accountNo || Number.isNaN(cents)) return;
    const dept = cDept ? (r[cDept] ?? "").trim() : "";
    rows.push({ id: randomUUID(), period, sourceId, accountNo, deptCode: dept || null, amountCents: cents });
  });
  if (problems.length) {
    throw new CloseError("bad_input", `Workbook CSV has ${problems.length} bad row(s): ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? "; ..." : ""}`);
  }
  if (!rows.length) throw new CloseError("bad_input", "Workbook CSV has no rows.");

  await db.transaction(async (tx) => {
    await tx.delete(workbookBaseline).where(eq(workbookBaseline.period, period));
    for (let i = 0; i < rows.length; i += 200) await tx.insert(workbookBaseline).values(rows.slice(i, i + 200));
  });

  const by = new Map<string, { rows: number; netCents: number }>();
  for (const r of rows) {
    const b = by.get(r.sourceId!) ?? { rows: 0, netCents: 0 };
    b.rows++;
    b.netCents += r.amountCents;
    by.set(r.sourceId!, b);
  }
  const netCents = rows.reduce((s, r) => s + r.amountCents, 0);

  let reconcile: ReconcileResult | null = null;
  const close = await findClose(db, period);
  if (close) {
    await appendEvent(db, close.id, {
      action: "workbook_imported",
      actor: opts.by ?? "system",
      detail: `${fileName} (sha256 ${sha256.slice(0, 12)}…): ${rows.length} rows, net ${fmtUsd(netCents)}`,
    });
    reconcile = await reconcileClose(period, { db, by: opts.by });
  }
  return {
    period,
    fileName,
    sha256,
    rows: rows.length,
    netCents,
    bySource: [...by.entries()].map(([sourceId, v]) => ({ sourceId, ...v })),
    reconcile,
  };
}

/** Baseline rows for a period (for views / evidence). */
export async function loadWorkbookBaseline(db: Db, period: string) {
  return db.select().from(workbookBaseline).where(eq(workbookBaseline.period, period));
}
