/**
 * Run the month-end close for a period from the command line.
 *
 *   npm run close -- 2026-09                         # generate + reconcile, print summary
 *   npm run close -- 2026-09 --approve "Amanda"      # ...then approve (only if reconciled)
 *   npm run close -- 2026-09 --approve "Amanda" --force   # approve and waive open exceptions
 *   npm run close -- 2026-09 --approve Amanda --export out.xlsx   # ...then write the BC file (.xlsx or .csv)
 *   npm run close -- 2026-09 --no-generate --export out.csv       # export an already approved close
 *   npm run close -- 2026-09 --no-generate --resolve-all Amanda --note "why"     # resolve every open exception
 *   npm run close -- 2026-09 --no-generate --mark-imported Amanda --mark-posted Amanda   # SIMULATED BC import + post
 *   npm run close -- 2026-09 --no-generate --evidence evidence.xlsx               # reconciliation evidence package
 *   npm run close -- 2026-09 --no-generate --json                   # print the CloseView JSON
 *
 * Order when combined: generate → resolve → approve → export → import → post → evidence.
 * Uses TURSO_DATABASE_URL from .env.local / .env (default file:local.db).
 */
import { writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { revalidateViews } from "./revalidate-views";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function parseArgs(argv: string[]) {
  const o = {
    period: undefined as string | undefined,
    approve: undefined as string | undefined,
    exportPath: undefined as string | undefined,
    force: false,
    generate: true,
    resolveAll: undefined as string | undefined,
    note: undefined as string | undefined,
    markImported: undefined as string | undefined,
    markPosted: undefined as string | undefined,
    evidence: undefined as string | undefined,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--approve") o.approve = argv[++i];
    else if (a.startsWith("--approve=")) o.approve = a.slice(10);
    else if (a === "--export") o.exportPath = argv[++i];
    else if (a.startsWith("--export=")) o.exportPath = a.slice(9);
    else if (a === "--force") o.force = true;
    else if (a === "--no-generate") o.generate = false;
    else if (a === "--resolve-all") o.resolveAll = argv[++i];
    else if (a === "--note") o.note = argv[++i];
    else if (a === "--mark-imported") o.markImported = argv[++i];
    else if (a === "--mark-posted") o.markPosted = argv[++i];
    else if (a === "--evidence") o.evidence = argv[++i];
    else if (a === "--json") o.json = true;
    else if (!o.period) o.period = a;
  }
  return o;
}

const usd = (c: number) =>
  (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const period = o.period;
  if (!period) {
    console.error(
      "Usage: npm run close -- YYYY-MM [--approve <name> [--force]] [--export <file.xlsx|file.csv>] [--no-generate]\n" +
        "       [--resolve-all <name> [--note <text>]] [--mark-imported <name>] [--mark-posted <name>] [--evidence <file.xlsx>] [--json]",
    );
    process.exit(2);
  }
  const close = await import("../src/close");
  const { generateClose, approveClose, exportClose, getCloseView, CloseError } = close;

  try {
    if (o.generate) {
      const r = await generateClose(period, { force: o.force, by: "close script" });
      console.log(`Close ${period}: ${r.journalLines} journal lines in ${r.documents.length} documents, ${r.invoiceLines} invoice lines.`);
      for (const c of r.reconcile.checks) console.log(`  [${c.status.toUpperCase().padEnd(7)}] ${c.label}: ${c.detail}`);
      const tax = Object.entries(r.excludedTaxCents);
      if (tax.length) console.log(`  Excluded marketplace-facilitator tax: ${tax.map(([s, c]) => `${s} ${usd(c)}`).join(", ")}`);
    }

    if (o.resolveAll) {
      const before = await getCloseView(period);
      for (const e of before.exceptions.filter((x) => x.status === "open")) {
        const r = await close.resolveCloseException(period, e.id, { status: "resolved", by: o.resolveAll, note: o.note });
        console.log(`Resolved ${e.kind} (${e.sourceId ?? "-"}, owner ${e.owner}) by ${o.resolveAll}; close ${r.closeStatus}, ${r.openExceptions} open left.`);
      }
    }

    if (o.approve) {
      const a = await approveClose(period, o.approve, { force: o.force });
      console.log(`Approved by ${a.approvedBy} at ${a.approvedAt}${a.waivedExceptions ? ` (${a.waivedExceptions} exception(s) waived)` : ""}.`);
    }

    if (o.exportPath) {
      const format = o.exportPath.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
      const buf = await exportClose(period, format, { by: o.approve ?? "close script" });
      await writeFile(o.exportPath, buf);
      console.log(`Wrote ${o.exportPath} (${buf.length} bytes, ${format}).`);
    }

    if (o.markImported) {
      const r = await close.markImported(period, { by: o.markImported });
      console.log(`BC import (${r.simulated ? "SIMULATED" : "live"}): ${r.postingStatus}, batch ${r.bcBatch}, documents ${r.documentNos.join(", ")}`);
      for (const c of r.response.validation) console.log(`  [${c.ok ? "OK  " : "FAIL"}] ${c.label}: ${c.detail}`);
    }
    if (o.markPosted) {
      const r = await close.markPosted(period, { by: o.markPosted });
      console.log(`BC post (${r.simulated ? "SIMULATED" : "live"}): ${r.postingStatus}, documents ${r.documentNos.join(", ")}`);
      for (const c of r.reconcile?.checks ?? []) console.log(`  [${c.status.toUpperCase().padEnd(7)}] ${c.label}: ${c.detail}`);
    }
    if (o.evidence) {
      const buf = await close.exportEvidence(period, { by: "close script" });
      await writeFile(o.evidence, buf);
      console.log(`Wrote ${o.evidence} (${buf.length} bytes, evidence package).`);
    }

    const v = await getCloseView(period);
    if (o.json) {
      console.log(JSON.stringify(v, null, 2));
      return;
    }
    console.log(`\nStatus: ${v.status}${v.approvedBy ? ` (approved by ${v.approvedBy})` : ""}`);
    console.log(`Sources: ${v.summary.sourcesReceived}/${v.summary.sourcesExpected} received` +
      (v.sources.some((s) => s.status === "missing") ? ` (missing: ${v.sources.filter((s) => s.status === "missing").map((s) => s.name).join(", ")})` : ""));
    console.log("\nDocument           Lines        Debit        Credit   Balanced");
    for (const d of v.documents) {
      console.log(`${d.documentNo.padEnd(18)} ${String(d.lines.length).padStart(5)} ${usd(d.debitCents).padStart(12)} ${usd(d.creditCents).padStart(13)}   ${d.balanced ? "yes" : `NO (${usd(d.balanceCents)})`}`);
    }
    console.log(`${"TOTAL".padEnd(18)} ${String(v.summary.journalLines).padStart(5)} ${usd(v.summary.debitCents).padStart(12)} ${usd(v.summary.creditCents).padStart(13)}`);
    console.log(`Placeholder-account lines: ${v.summary.placeholderLines}/${v.summary.journalLines}`);
    if (v.invoice) {
      console.log(`\nAR invoice ${v.invoice.externalDocumentNo} → customer ${v.invoice.customerNo}: ${v.invoice.lines.length} lines, total ${usd(v.invoice.totalCents)}`);
    }
    const unmapped = v.exceptions.filter((e) => e.kind === "unmapped_amount");
    console.log(`\nUnmapped amount groups: ${unmapped.length}`);
    console.log(`Exceptions: ${v.exceptions.length} (${v.summary.openExceptions} open)`);
    for (const e of v.exceptions) console.log(`  - [${e.status}] ${e.kind} (owner ${e.owner}): ${e.message}`);
    console.log(`\nWorkbook baseline: ${v.workbook.loaded ? `${v.workbook.rows} rows, ${v.workbook.differences.length} account difference(s)` : "not loaded"}`);
    for (const d of v.workbook.differences) console.log(`  ${d.sourceId} ${d.accountNo}: ours ${usd(d.ourCents)} vs workbook ${usd(d.workbookCents)} (diff ${usd(d.diffCents)})`);
    console.log(`BC posting: ${v.posting.status}${v.posting.simulated && v.posting.status !== "not_posted" ? " (SIMULATED)" : ""}${v.posting.batch ? `, batch ${v.posting.batch}` : ""}`);
    console.log("Steps: " + v.steps.map((s) => `${s.label}=${s.status}`).join(" · "));
  } catch (err) {
    if (err instanceof CloseError) {
      console.error(`[${err.code}] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  await revalidateViews();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
