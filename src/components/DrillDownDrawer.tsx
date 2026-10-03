"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SourceOrder } from "@/app/_lib/types";
import { formatInt, formatMoney } from "@/app/_lib/format";
import { CheckIcon, CloseIcon, FileIcon, UploadIcon, WarnIcon } from "./icons";

export type DrawerContent =
  | {
      kind: "rows";
      title: string;          // "ShopGoodwill · Revenue"
      value: string;          // "$6,842.15"
      caption: string;        // "158 orders · net of marketplace fees"
      fileLabel: string;      // file name or "3 source files"
      fileMeta: string;       // "Imported 6:04 AM ET · 158 rows"
      orders: SourceOrder[];
      totalNetCents: number;  // must equal the pulse number
      complete: boolean;      // false when the day has more rows than were loaded
      exportHref?: string;
    }
  | {
      kind: "missing";
      title: string;          // "Other e-comm · no file yet"
      expectedFile: string;
      lastReceived: string;
      feeds: string;
    };

type DrillDownDrawerProps = { content: DrawerContent | null; dateLong: string; dateShort: string; onClose: () => void };

const PREVIEW_ROWS = 13;
const grid = "grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_84px_84px_minmax(0,1.25fr)] items-center gap-x-3.5 px-4 sm:px-6.5";

export function DrillDownDrawer({ content, dateLong, dateShort, onClose }: DrillDownDrawerProps) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!content) return;
    setShowAll(false);
    const prevFocus = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prevFocus?.focus();
    };
  }, [content, onClose]);

  if (!content) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div className="absolute inset-0 bg-[var(--scrim)]" onClick={onClose} />
      <aside className="relative flex h-full w-[660px] max-w-full flex-col border-l border-line bg-surface shadow-[-12px_0_40px_rgba(0,0,0,.14)]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 pt-5.5 pb-4.5 sm:px-6.5">
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-accent"><FileIcon className="size-[13px]" />Traced to source</span>
            <h2 id="drawer-title" className="text-xl font-semibold tracking-[-0.01em]">{content.title}</h2>
            <span className="text-[13px] text-ink-3">{dateLong} · Eastern Time</span>
          </div>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
            <CloseIcon />
          </button>
        </header>

        {content.kind === "missing" ? (
          <div className="flex flex-col gap-5 overflow-y-auto p-4 sm:p-6.5">
            <div className="flex gap-3.5 rounded-xl border border-line bg-surface-2 p-4.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-warn-soft text-warn-icon"><WarnIcon className="size-4.5" /></span>
              <div className="flex flex-col gap-1">
                <p className="text-[15px] font-semibold">Awaiting data</p>
                <p className="text-[13.5px] text-pretty text-ink-2">No file has arrived for {dateShort}. These numbers are left out of today&apos;s totals rather than shown as $0. They&apos;ll fill in automatically once the export is imported.</p>
              </div>
            </div>
            <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 text-[13px]">
              <dt className="text-ink-3">Expected file</dt><dd className="font-mono text-[12.5px] break-all">{content.expectedFile}</dd>
              <dt className="text-ink-3">Last day with data</dt><dd>{content.lastReceived}</dd>
              <dt className="text-ink-3">Feeds</dt><dd>{content.feeds}</dd>
            </dl>
            <div className="flex flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed border-line px-5 py-7.5 text-center">
              <UploadIcon className="size-5.5 text-ink-3" />
              <span className="text-sm font-medium">Drop the export here (CSV or XLSX)</span>
              <span className="text-[12.5px] text-ink-3">or <Link href="/sources" className="text-accent hover:text-ink">open Data Sources</Link></span>
            </div>
          </div>
        ) : (
          <RowsBody content={content} showAll={showAll} onShowAll={() => setShowAll(true)} />
        )}
      </aside>
    </div>
  );
}

function RowsBody({ content: c, showAll, onShowAll }: { content: Extract<DrawerContent, { kind: "rows" }>; showAll: boolean; onShowAll: () => void }) {
  const rows = showAll ? c.orders : c.orders.slice(0, PREVIEW_ROWS);
  const sum = c.orders.reduce((a, o) => a + o.netCents, 0);
  const reconciled = sum === c.totalNetCents;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-4.5 sm:px-6.5">
        <div className="flex flex-col gap-1">
          <p className="text-[40px] leading-none font-semibold tracking-[-0.03em]">{c.value}</p>
          <p className="text-[13px] text-ink-2">{c.caption}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-ink-3">
          <span className="font-mono text-ink-2">{c.fileLabel}</span>
          <span>{c.fileMeta}</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="min-w-[560px]">
          <div className={`${grid} sticky top-0 h-8 border-y border-line bg-surface-2 text-[11px] font-medium tracking-[0.03em] text-ink-3 uppercase`}>
            <span>Order</span><span>Category</span><span className="text-right">Gross</span><span className="text-right">Net</span><span>Source · row</span>
          </div>
          {rows.map(o => (
            <div key={o.id} className={`${grid} h-[46px] border-b border-line-2 text-[13px] hover:bg-surface-2`}>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-[12.5px]">{o.orderId}</span>
                <span className="text-[11.5px] text-ink-3">{o.channelLabel}{o.status !== "paid" && <span className="font-medium text-warn"> · {o.status}</span>}</span>
              </div>
              <span className="text-ink-2">{o.category}</span>
              <span className="text-right text-ink-3">{formatMoney(o.grossCents)}</span>
              <span className="text-right font-medium">{formatMoney(o.netCents)}</span>
              <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px] text-ink-3">
                <span className="truncate">{o.sourceFile}</span>
                <span className="shrink-0 rounded border border-line bg-surface-2 px-1 text-ink-2">r{o.sourceRow}</span>
              </div>
            </div>
          ))}
          {c.orders.length > rows.length && (
            <button type="button" onClick={onShowAll} className="px-4 py-3 text-left text-[12.5px] text-ink-3 hover:text-accent sm:px-6.5">
              + {formatInt(c.orders.length - rows.length)} more rows · <span className="font-medium text-accent">show all</span>
            </button>
          )}
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-surface-2 px-4 py-3.5 sm:px-6.5">
        {!c.complete ? (
          <span className="text-[13px] text-ink-2">Showing the first {formatInt(c.orders.length)} rows of this day.</span>
        ) : reconciled ? (
          <span className="flex items-center gap-2 text-[13px]">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ok-soft text-ok"><CheckIcon /></span>
            <span><strong className="font-semibold">Reconciled.</strong> Net of {formatInt(c.orders.length)} rows = {formatMoney(sum)}, matches the pulse.</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-[13px] text-bad"><WarnIcon />Rows sum to {formatMoney(sum)}, pulse shows {formatMoney(c.totalNetCents)}.</span>
        )}
        {c.exportHref && (
          <a href={c.exportHref} className="flex h-8 items-center gap-[7px] rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-ink hover:bg-surface-2">Export these rows</a>
        )}
      </footer>
    </div>
  );
}
