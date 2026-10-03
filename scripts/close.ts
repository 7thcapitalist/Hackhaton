/**
 * Run the month-end close for a period from the command line.
 *
 *   npm run close -- 2026-09                         # generate + reconcile, print summary
 *   npm run close -- 2026-09 --approve "Amanda"      # ...then approve (only if reconciled)
 *   npm run close -- 2026-09 --approve "Amanda" --force   # approve and waive open exceptions
 *   npm run close -- 2026-09 --approve Amanda --export out.xlsx   # ...then write the BC file (.xlsx or .csv)
 *   npm run close -- 2026-09 --no-generate --export out.csv       # export an already approved close
 *
 * Uses TURSO_DATABASE_URL from .env.local / .env (default file:local.db).
 */
import { writeFile } from "node:fs/promises";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function parseArgs(argv: string[]) {
  let period: string | undefined;
  let approve: string | undefined;
  let exportPath: string | undefined;
  let force = false;
  let generate = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--approve") approve = argv[++i];
    else if (a.startsWith("--approve=")) approve = a.slice(10);
    else if (a === "--export") exportPath = argv[++i];
    else if (a.startsWith("--export=")) exportPath = a.slice(9);
    else if (a === "--force") force = true;
    else if (a === "--no-generate") generate = false;
    else if (!period) period = a;
  }
  return { period, approve, exportPath, force, generate };
}

const usd = (c: number) =>
  (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { period, approve, exportPath, force, generate } = parseArgs(process.argv.slice(2));
  if (!period) {
    console.error("Usage: npm run close -- YYYY-MM [--approve <name> [--force]] [--export <file.xlsx|file.csv>] [--no-generate]");
    process.exit(2);
  }
  const { generateClose, approveClose, exportClose, getCloseView, CloseError } = await import("../src/close");

  try {
    if (generate) {
      const r = await generateClose(period, { force });
      console.log(`Close ${period}: ${r.journalLines} journal lines in ${r.documents.length} documents, ${r.invoiceLines} invoice lines.`);
      for (const c of r.reconcile.checks) console.log(`  [${c.status.toUpperCase().padEnd(7)}] ${c.label}: ${c.detail}`);
      const tax = Object.entries(r.excludedTaxCents);
      if (tax.length) console.log(`  Excluded marketplace-facilitator tax: ${tax.map(([s, c]) => `${s} ${usd(c)}`).join(", ")}`);
    }

    if (approve) {
      const a = await approveClose(period, approve, { force });
      console.log(`Approved by ${a.approvedBy} at ${a.approvedAt}${a.waivedExceptions ? ` (${a.waivedExceptions} exception(s) waived)` : ""}.`);
    }

    if (exportPath) {
      const format = exportPath.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
      const buf = await exportClose(period, format);
      await writeFile(exportPath, buf);
      console.log(`Wrote ${exportPath} (${buf.length} bytes, ${format}).`);
    }

    const v = await getCloseView(period);
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
    for (const e of v.exceptions) console.log(`  - [${e.status}] ${e.kind}: ${e.message}`);
  } catch (err) {
    if (err instanceof CloseError) {
      console.error(`[${err.code}] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
