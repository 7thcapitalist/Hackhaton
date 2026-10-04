/**
 * Load the prior allocation workbook's journal output as the baseline a close
 * is reconciled against (slide 42 "reproduce + validate").
 *
 *   npm run workbook:import -- data/workbook/E-Commerce_Allocation_2026-09.csv --period 2026-09 [--by "Amanda"]
 *   npm run workbook:import -- --all            # every data/workbook/E-Commerce_Allocation_YYYY-MM.csv
 *   npm run workbook:import -- --make-mock      # DEV: rewrite the mock CSVs from generated closes (see below)
 *
 * CSV columns: Source, Account No., Department, Amount (BC sign: + debit, - credit).
 * Replaces the period's workbook_baseline rows and, if the close exists,
 * re-runs reconcile so differences become owned reconcile_mismatch exceptions.
 *
 * --make-mock generates the closes for 2026-08 and 2026-09 from the seeded
 * facts and writes their journal + AR invoice totals per (source, account,
 * department) as the mock workbook output:
 *   2026-08 matches exactly;
 *   2026-09 carries two realistic differences: the workbook missed netting one
 *   $43.18 FedEx BNKDEPOSIT refund (FedEx 40356 and vendor V00122 both off by
 *   $43.18), and a $0.01 rounding difference on one Goodwill Books invoice line.
 * Synthetic data only. Uses TURSO_DATABASE_URL (default file:local.db).
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { revalidateViews } from "./revalidate-views";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const DIR = "data/workbook";
const fileFor = (period: string) => path.join(DIR, `E-Commerce_Allocation_${period}.csv`);

export async function importWorkbookFile(file: string, period: string, by?: string) {
  const { importWorkbookBaseline } = await import("../src/close");
  const text = await readFile(file, "utf8");
  return importWorkbookBaseline(period, text, { fileName: path.basename(file), by: by ?? "workbook-import script" });
}

/** Import every data/workbook/E-Commerce_Allocation_YYYY-MM.csv. Used by the seed. */
export async function importAllWorkbooks(log: (l: string) => void = console.log) {
  let names: string[] = [];
  try {
    names = (await readdir(DIR)).filter((n) => /^E-Commerce_Allocation_\d{4}-\d{2}\.csv$/.test(n)).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const period = n.match(/(\d{4}-\d{2})/)![1];
    const r = await importWorkbookFile(path.join(DIR, n), period, "seed");
    log(`Workbook baseline ${period}: ${r.rows} rows from ${n}${r.reconcile ? ` (close re-reconciled: ${r.reconcile.status})` : ""}`);
    out.push(r);
  }
  return out;
}

async function makeMock() {
  const { getDb } = await import("../src/db/client");
  const { generateClose, getCloseView, SOURCE_CODES } = await import("../src/close");
  const { sources } = await import("../src/db/schema");
  const db = getDb();
  const names = new Map((await db.select({ id: sources.id, name: sources.name }).from(sources)).map((s) => [s.id, s.name]));
  await mkdir(DIR, { recursive: true });
  for (const period of ["2026-08", "2026-09"]) {
    await generateClose(period, { force: true, by: "workbook mock" });
    const v = await getCloseView(period);
    const acc = new Map<string, number>();
    const add = (sourceId: string, accountNo: string, dept: string | null, cents: number) => {
      const k = `${sourceId}|${accountNo}|${dept ?? ""}`;
      acc.set(k, (acc.get(k) ?? 0) + cents);
    };
    for (const d of v.documents) for (const l of d.lines) add(l.sourceId ?? "?", l.accountNo, l.deptCode, l.amountCents);
    for (const l of v.invoice?.lines ?? []) add("goodwill_books", l.accountNo ?? "", l.deptCode, -l.amountCents);

    if (period === "2026-09") {
      // The workbook missed netting one $43.18 FedEx refund: expense higher, vendor credit higher.
      const exp = [...acc.keys()].find((k) => k.startsWith("fedex|40356|"));
      const ven = [...acc.keys()].find((k) => k.startsWith("fedex|V00122|"));
      if (!exp || !ven) throw new Error("FedEx lines not found for 2026-09; seed first");
      acc.set(exp, acc.get(exp)! + 4318);
      acc.set(ven, acc.get(ven)! - 4318);
      // Rounding: the workbook's fee split rounds one Goodwill Books line a cent differently.
      const gwb = [...acc.keys()].find((k) => k.startsWith("goodwill_books|"));
      if (!gwb) throw new Error("Goodwill Books invoice lines not found for 2026-09");
      acc.set(gwb, acc.get(gwb)! - 1);
    }
    const order = Object.keys(SOURCE_CODES);
    const rows = [...acc.entries()]
      .filter(([, c]) => c !== 0)
      .sort(([a], [b]) => order.indexOf(a.split("|")[0]) - order.indexOf(b.split("|")[0]) || a.localeCompare(b));
    const csv = ["Source,Account No.,Department,Amount"];
    for (const [k, c] of rows) {
      const [sourceId, accountNo, dept] = k.split("|");
      csv.push([names.get(sourceId) ?? sourceId, accountNo, dept, (c / 100).toFixed(2)].map((x) => (/[",]/.test(x) ? `"${x}"` : x)).join(","));
    }
    await writeFile(fileFor(period), csv.join("\r\n") + "\r\n");
    console.log(`Wrote ${fileFor(period)} (${rows.length} rows)`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  };
  if (argv.includes("--make-mock")) return makeMock();
  if (argv.includes("--all")) {
    await importAllWorkbooks();
    return;
  }
  const file = argv.find((a) => !a.startsWith("--") && a !== opt("--period") && a !== opt("--by"));
  const period = opt("--period") ?? file?.match(/(\d{4}-\d{2})/)?.[1];
  if (!file || !period) {
    console.error("Usage: npm run workbook:import -- <file.csv> --period YYYY-MM [--by Name] | --all | --make-mock");
    process.exit(2);
  }
  const r = await importWorkbookFile(file, period, opt("--by"));
  console.log(`Loaded ${r.rows} workbook rows for ${period} from ${r.fileName} (sha256 ${r.sha256.slice(0, 12)}…)`);
  if (r.reconcile) {
    for (const c of r.reconcile.checks) console.log(`  [${c.status.toUpperCase().padEnd(7)}] ${c.label}: ${c.detail}`);
    console.log(`Close status: ${r.reconcile.status}, ${r.reconcile.openExceptions} open exception(s)`);
  } else {
    console.log("No close generated for the period yet; the baseline is used when it is.");
  }
  await revalidateViews();
}

if (process.argv[1] && /workbook-baseline\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    if (err && typeof err === "object" && "code" in err && err.name === "CloseError") console.error(`[${err.code}] ${err.message}`);
    else console.error(err);
    process.exit(1);
  });
}
