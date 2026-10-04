import { formatDay, formatMoney } from "@/app/_lib/format";
import type { CloseDocumentView, CloseInvoiceView } from "@/close";
import { CheckIcon, ChevronIcon, WarnIcon } from "../icons";
import { TbcBadge } from "./TieOutTable";

const day = (d: string | null) => (d ? formatDay(d, { month: "short", day: "numeric", year: "numeric" }) : "—");

/** Business Central General Journal lines, one collapsible block per Document No. */
export function JournalPreview({ documents, batch }: { documents: CloseDocumentView[]; batch: string }) {
  return (
    <section aria-labelledby="jnl-h" className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3.5">
        <h2 id="jnl-h" className="text-sm font-semibold">General Journal preview</h2>
        <span className="text-xs text-ink-3">Template GENERAL · batch <span className="font-mono">{batch}</span> · + debit, − credit</span>
      </header>
      {documents.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-ink-2">No journal yet. Generate it from the files received.</p>
      ) : (
        <div className="flex flex-col">
          {documents.map(d => {
            const tbc = d.lines.filter(l => l.isPlaceholder).length;
            return (
              <details key={d.documentNo} data-print-open className="group border-b border-line-2 last:border-b-0">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                  <ChevronIcon dir="right" className="size-3.5 text-ink-3 transition-transform group-open:rotate-90" />
                  <span className="font-mono text-[12.5px] font-semibold">{d.documentNo}</span>
                  <span className="text-[12.5px] text-ink-2">{d.sourceName}</span>
                  <span className="text-xs text-ink-3">{d.lines.length} lines</span>
                  {tbc > 0 && <span className="text-xs text-warn">{tbc} TBC account{tbc === 1 ? "" : "s"}</span>}
                  <span className="ml-auto flex items-center gap-3 text-xs">
                    <span className="text-ink-3">Dr <strong className="font-semibold text-ink">{formatMoney(d.debitCents)}</strong></span>
                    <span className="text-ink-3">Cr <strong className="font-semibold text-ink">{formatMoney(d.creditCents)}</strong></span>
                    <span className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 text-[11px] font-medium ${d.balanced ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
                      {d.balanced ? <CheckIcon className="size-[10px]" /> : <WarnIcon className="size-3" />}{d.balanced ? "Balanced" : "Unbalanced"}
                    </span>
                  </span>
                </summary>
                <div className="overflow-x-auto border-t border-line-2 bg-surface-2/50">
                  <table className="w-full min-w-[900px] text-left text-xs">
                    <thead className="text-[11px] text-ink-3">
                      <tr>
                        {["Posting Date", "Document No.", "Account Type", "Account No.", "Description", "Dept", "Amount", "Bal. Account Type", "Bal. Account No."].map(h => (
                          <th key={h} scope="col" className={`px-2 py-1.5 font-medium first:pl-4 last:pr-4 ${h === "Amount" ? "text-right" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {d.lines.map(l => (
                        <tr key={l.lineNo} className={`border-t border-line-2 ${l.isPlaceholder ? "bg-warn-soft/50" : ""}`}>
                          <td className="py-1.5 pr-2 pl-4 whitespace-nowrap">{day(l.postingDate)}</td>
                          <td className="px-2 py-1.5 font-mono">{l.documentNo}</td>
                          <td className="px-2 py-1.5">{l.accountType}</td>
                          <td className="px-2 py-1.5 font-mono whitespace-nowrap">{l.accountNo}{l.isPlaceholder && <TbcBadge />}</td>
                          <td className="max-w-[280px] px-2 py-1.5" title={l.files.length ? `From ${l.factCount} rows in ${l.files.join(", ")}` : l.isBalancing ? "Balancing line" : undefined}>
                            <span className="line-clamp-1">{l.description ?? "—"}</span>
                          </td>
                          <td className="px-2 py-1.5 font-mono">{l.deptCode ?? ""}</td>
                          <td className={`px-2 py-1.5 text-right font-medium whitespace-nowrap ${l.amountCents < 0 ? "text-ink-2" : ""}`}>{formatMoney(l.amountCents)}</td>
                          <td className="px-2 py-1.5">{l.balAccountType ?? ""}</td>
                          <td className="py-1.5 pr-4 pl-2 font-mono">{l.balAccountNo ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The AR invoice for Goodwill Books (slide 39 step 6), as BC Sales Invoice lines. */
export function InvoiceCard({ invoice }: { invoice: CloseInvoiceView | null }) {
  return (
    <section aria-labelledby="inv-h" className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3.5">
        <h2 id="inv-h" className="text-sm font-semibold">AR invoice</h2>
        {invoice && <span className="text-xs text-ink-3">Customer <span className="font-mono">{invoice.customerNo ?? <span className="font-sans text-warn">TBC</span>}</span></span>}
      </header>
      {!invoice ? (
        <p className="px-4 py-4 text-[13px] text-ink-2">No invoice yet. It is built from the Goodwill Books statement when the journal is generated.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 text-xs">
            <div><dt className="text-ink-3">Invoice date</dt><dd className="font-medium">{day(invoice.invoiceDate)}</dd></div>
            <div><dt className="text-ink-3">Posting date</dt><dd className="font-medium">{day(invoice.postingDate)}</dd></div>
            <div className="col-span-2"><dt className="text-ink-3">External document no.</dt><dd className="font-mono font-medium">{invoice.externalDocumentNo ?? "—"}</dd></div>
          </dl>
          <ul className="border-t border-line-2">
            {invoice.lines.map(l => (
              <li key={l.lineNo} className={`flex items-start justify-between gap-3 border-b border-line-2 px-4 py-2 text-xs last:border-b-0 ${!l.accountNo || l.accountNo.startsWith("TBC") ? "bg-warn-soft/50" : ""}`}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{l.description ?? "—"}</span>
                  <span className="text-ink-3">
                    G/L <span className="font-mono">{l.accountNo ?? "—"}</span>{(!l.accountNo || l.accountNo.startsWith("TBC")) && <TbcBadge />}
                    {l.deptCode ? ` · Dept ${l.deptCode}` : ""} · {l.quantity} × {formatMoney(l.unitPriceCents)}
                  </span>
                </span>
                <span className="font-semibold whitespace-nowrap">{formatMoney(l.amountCents)}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-baseline justify-between border-t border-line px-4 py-3 text-[13px]">
            <span className="text-ink-2">Total ({invoice.currency})</span>
            <strong className="text-base font-semibold">{formatMoney(invoice.totalCents)}</strong>
          </p>
        </>
      )}
    </section>
  );
}
