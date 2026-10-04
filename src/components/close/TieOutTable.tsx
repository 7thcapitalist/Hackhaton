import { formatInt, formatMoney } from "@/app/_lib/format";
import { CheckIcon, WarnIcon } from "../icons";
import type { UiCloseView } from "./types";

type Row = { key: string; sourceId: string; sourceName: string; accountNo: string; placeholder: boolean; rows: number; journal: number; workbook: number | null; posted: number | null };

const money = (c: number | null) => (c == null ? "—" : formatMoney(c));

function Diff({ a, b }: { a: number; b: number | null }) {
  if (b == null) return <span className="text-ink-4">—</span>;
  const d = a - b;
  if (d === 0) return <span className="inline-flex items-center gap-1 text-ok"><CheckIcon className="size-[11px]" />0.00</span>;
  return <span className="inline-flex items-center gap-1 rounded bg-bad-soft px-1.5 font-semibold text-bad"><WarnIcon className="size-3" />{formatMoney(d)}</span>;
}

/**
 * Control totals: per source and account, journal (from source facts) → allocation
 * workbook → posted. Amounts are BC sign (+ debit, − credit). The Goodwill Books
 * invoice is included as revenue credits, like the reconcile step compares it.
 */
export function TieOutTable({ view }: { view: UiCloseView }) {
  const { documents, invoice, workbook, posting, summary } = view;
  const names = new Map(view.sources.map(s => [s.sourceId, s.name]));
  const map = new Map<string, Row>();
  const add = (sourceId: string, accountNo: string, cents: number, rows: number, placeholder: boolean) => {
    const key = `${sourceId}|${accountNo}`;
    const r = map.get(key) ?? { key, sourceId, sourceName: names.get(sourceId) ?? sourceId, accountNo, placeholder, rows: 0, journal: 0, workbook: null, posted: null };
    r.journal += cents;
    r.rows += rows;
    r.placeholder ||= placeholder;
    map.set(key, r);
  };
  for (const d of documents) for (const l of d.lines) if (!l.isBalancing) add(l.sourceId ?? d.sourceId ?? "—", l.accountNo, l.amountCents, l.factCount, l.isPlaceholder);
  const invoiceSource = view.sources.find(s => s.target === "invoice")?.sourceId ?? "goodwill_books";
  if (invoice) for (const l of invoice.lines) add(invoiceSource, l.accountNo ?? "TBC", -l.amountCents, l.factCount, !l.accountNo || l.accountNo.startsWith("TBC"));

  const wbLoaded = !!workbook?.loaded;
  if (wbLoaded) {
    for (const r of map.values()) r.workbook = r.journal; // no difference listed = ties
    for (const d of workbook!.differences ?? []) {
      const key = `${d.sourceId}|${d.accountNo}`;
      const r = map.get(key) ?? { key, sourceId: d.sourceId, sourceName: names.get(d.sourceId) ?? d.sourceId, accountNo: d.accountNo, placeholder: false, rows: 0, journal: d.ourCents, workbook: null, posted: null };
      r.workbook = d.workbookCents;
      map.set(key, r);
    }
  }
  const posted = posting?.status === "posted";
  if (posted) for (const r of map.values()) r.posted = r.journal;
  const rows = [...map.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.accountNo.localeCompare(b.accountNo));
  const wbDiffs = rows.filter(r => r.workbook != null && r.workbook !== r.journal).length;

  return (
    <section aria-labelledby="tie-h" className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-col gap-3 border-b border-line px-4 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="tie-h" className="text-sm font-semibold">Control totals and tie-out</h2>
          <span className="text-xs text-ink-3">
            {wbLoaded ? `Workbook: ${formatInt(workbook!.rows)} lines loaded · ${wbDiffs} difference${wbDiffs === 1 ? "" : "s"}` : "Workbook not loaded · load last month's workbook below to compare"}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <div><dt className="text-ink-3">Debits</dt><dd className="text-[15px] font-semibold">{formatMoney(summary.debitCents)}</dd></div>
          <div><dt className="text-ink-3">Credits</dt><dd className="text-[15px] font-semibold">{formatMoney(summary.creditCents)}</dd></div>
          <div><dt className="text-ink-3">Balanced documents</dt><dd className="text-[15px] font-semibold">{summary.balancedDocuments} of {summary.documents}</dd></div>
          <div><dt className="text-ink-3" title="Marketplace-facilitator sales tax: collected and remitted by the marketplace, so not journaled">Facilitator tax, not journaled</dt><dd className="text-[15px] font-semibold">{formatMoney(summary.excludedTaxCents)}</dd></div>
        </dl>
        {documents.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Journal documents">
            {documents.map(d => (
              <li key={d.documentNo} className={`inline-flex items-center gap-1.5 rounded-[4px] py-0.5 pr-2 pl-1.5 text-[11.5px] font-medium ${d.balanced ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
                {d.balanced ? <CheckIcon className="size-[11px]" /> : <WarnIcon className="size-3" />}
                <span className="font-mono font-medium">{d.documentNo}</span>
                {d.balanced ? "Balanced" : `Off by ${formatMoney(d.balanceCents)}`}
              </li>
            ))}
          </ul>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-ink-2">Generate the journal to see control totals.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[12.5px]">
            <thead className="text-[11.5px] text-ink-3">
              <tr className="border-b border-line-2">
                <th scope="col" className="px-4 py-2 font-medium">Source</th>
                <th scope="col" className="px-2 py-2 font-medium">Account</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Source rows</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Journal</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Workbook</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Δ vs workbook</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Posted{posted && posting?.simulated ? " (sim.)" : ""}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Δ vs posted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const off = r.workbook != null && r.workbook !== r.journal;
                return (
                  <tr key={r.key} className={`border-b border-line-2 last:border-b-0 ${off ? "bg-bad-soft/40" : ""}`}>
                    <th scope="row" className="px-4 py-2 font-medium">{r.sourceName}</th>
                    <td className="px-2 py-2 font-mono text-xs">{r.accountNo}{r.placeholder && <TbcBadge />}</td>
                    <td className="px-2 py-2 text-right text-ink-3">{r.rows ? formatInt(r.rows) : "—"}</td>
                    <td className="px-2 py-2 text-right font-medium">{money(r.journal)}</td>
                    <td className="px-2 py-2 text-right">{wbLoaded ? money(r.workbook) : <span className="text-ink-4">—</span>}</td>
                    <td className="px-2 py-2 text-right"><Diff a={r.journal} b={r.workbook} /></td>
                    <td className="px-2 py-2 text-right">{money(r.posted)}</td>
                    <td className="px-4 py-2 text-right"><Diff a={r.journal} b={r.posted} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function TbcBadge() {
  return (
    <span title="Placeholder account: the real Business Central account is still to be confirmed with Goodwill"
      className="ml-1.5 inline-flex items-center rounded-[4px] border border-dashed border-warn-icon bg-warn-soft px-1 font-sans text-[10.5px] font-semibold text-warn">
      TBC
    </span>
  );
}
