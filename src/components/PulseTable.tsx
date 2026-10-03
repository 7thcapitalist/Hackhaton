"use client";
import type { ReactNode } from "react";
import type { ChannelId, PulseRow, PulseTotals } from "@/app/_lib/types";
import { formatInt, formatMoney, formatStamp } from "@/app/_lib/format";
import { FileIcon, WarnIcon } from "./icons";

export type PulseField = "revenue" | "customers" | "orders";
type PulseTableProps = {
  rows: PulseRow[];
  totals: PulseTotals;
  dateLabel: string; // "Fri, Oct 2"
  onCellClick: (channelId: ChannelId | "total", field: PulseField) => void;
  onMissingClick: (channelId: ChannelId) => void;
};

const SERIES = ["bg-s1", "bg-s2", "bg-s3", "bg-s4"];
const cols = "grid grid-cols-[minmax(0,1.4fr)_170px_150px_120px_110px_minmax(0,1.5fr)] items-center gap-x-5 px-5.5";

function Num({ children, onClick, bold, label }: { children: ReactNode; onClick: () => void; bold?: boolean; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className={`-mx-1.5 justify-self-end rounded-md px-1.5 py-1 underline decoration-ink-4 decoration-dotted underline-offset-[5px] transition-colors hover:bg-accent-soft hover:text-accent hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent ${bold ? "text-[15.5px] font-bold" : "text-[14.5px] font-medium"}`}>
      {children}
    </button>
  );
}

export function PulseTable({ rows, totals, dateLabel, onCellClick, onMissingClick }: PulseTableProps) {
  const ok = rows.filter(r => r.status === "ok");
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5.5 py-4">
        <h2 className="text-[15px] font-semibold">By marketplace</h2>
        <span className="flex items-center gap-[7px] rounded-full bg-accent-soft px-2.5 py-1 text-[12.5px] text-accent">
          <FileIcon className="size-[13px]" />Every number traces to its source rows. Click one.
        </span>
      </header>
      <div className="overflow-x-auto">
        <div className="min-w-[960px]" role="table" aria-label={`Pulse by marketplace, ${dateLabel}`}>
          <div role="row" className={`${cols} h-9 border-b border-line bg-surface-2 text-[11.5px] font-medium tracking-[0.03em] text-ink-3 uppercase`}>
            <span role="columnheader">Marketplace</span><span role="columnheader">Share of revenue</span><span role="columnheader" className="text-right">Revenue</span>
            <span role="columnheader" className="text-right">Customers</span><span role="columnheader" className="text-right">Orders</span><span role="columnheader">Source file</span>
          </div>
          {rows.map((r, i) => r.status === "ok" ? (
            <div role="row" key={r.channelId} className={`${cols} h-[58px] border-b border-line-2`}>
              <Label row={r} swatch={SERIES[i % SERIES.length]} />
              <Share pct={totals.revenueCents ? (r.revenueCents! / totals.revenueCents) * 100 : 0} swatch={SERIES[i % SERIES.length]} />
              <Num label={`${r.label} revenue ${formatMoney(r.revenueCents!)}, show source rows`} onClick={() => onCellClick(r.channelId, "revenue")}>{formatMoney(r.revenueCents!)}</Num>
              <Num label={`${r.label} customers ${formatInt(r.customers!)}, show source rows`} onClick={() => onCellClick(r.channelId, "customers")}>{formatInt(r.customers!)}</Num>
              <Num label={`${r.label} orders ${formatInt(r.orders!)}, show source rows`} onClick={() => onCellClick(r.channelId, "orders")}>{formatInt(r.orders!)}</Num>
              <div className="flex min-w-0 flex-col" title={r.sourceFiles.join("\n")}>
                <span className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs text-ink-2">
                  <span className="truncate">{r.sourceFiles[0] ?? "No orders"}</span>
                  {r.sourceFiles.length > 1 && <span className="shrink-0 font-sans text-ink-3">+{r.sourceFiles.length - 1}</span>}
                </span>
                {r.importedAt && <span className="text-xs text-ink-3">Imported {formatStamp(r.importedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET</span>}
              </div>
            </div>
          ) : (
            <div role="row" key={r.channelId}
              className="grid h-[58px] grid-cols-[minmax(0,1.4fr)_170px_400px_minmax(0,1.5fr)] items-center gap-x-5 border-b border-line-2 bg-[repeating-linear-gradient(135deg,transparent_0_7px,var(--line2)_7px_8px)] px-5.5">
              <Label row={r} missing />
              <span className="text-[12.5px] text-ink-3">Not included</span>
              <button type="button" onClick={() => onMissingClick(r.channelId)}
                className="flex items-center gap-2.5 justify-self-end rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-warn-icon focus-visible:outline-2 focus-visible:outline-accent">
                <span className="flex items-center gap-1.5 font-semibold text-warn"><WarnIcon className="size-3.5 text-warn-icon" />Awaiting data</span>
                No file received for {dateLabel}
              </button>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-xs text-ink-3">{r.expectedFile ?? "No file yet"}</span>
                <span className="text-xs text-ink-3">Not received yet</span>
              </div>
            </div>
          ))}
          <div role="row" className={`${cols} h-[60px] border-t-[1.5px] border-ink`}>
            <div className="flex flex-col"><span className="font-bold">Total e-commerce</span>
              <span className="text-xs text-ink-3">{ok.length} of {rows.length} marketplaces reporting</span></div>
            <span />
            <Num bold label={`Total revenue ${formatMoney(totals.revenueCents)}, show source rows`} onClick={() => onCellClick("total", "revenue")}>{formatMoney(totals.revenueCents)}</Num>
            <Num bold label={`Total customers ${formatInt(totals.customers)}, show source rows`} onClick={() => onCellClick("total", "customers")}>{formatInt(totals.customers)}</Num>
            <Num bold label={`Total orders ${formatInt(totals.orders)}, show source rows`} onClick={() => onCellClick("total", "orders")}>{formatInt(totals.orders)}</Num>
            <span className="text-xs text-ink-3">{new Set(ok.flatMap(r => r.sourceFiles)).size} files · {ok.length} of {rows.length} reporting</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Label({ row, swatch, missing }: { row: PulseRow; swatch?: string; missing?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className={`size-2.5 shrink-0 rounded-[3px] ${missing ? "border-[1.5px] border-dashed border-ink-4" : swatch}`} />
      <div className="flex min-w-0 flex-col">
        <span className={`font-medium ${missing ? "text-ink-2" : ""}`}>{row.label}</span>
        <span className="truncate text-xs text-ink-3">{row.sublabel}</span>
      </div>
    </div>
  );
}

function Share({ pct, swatch }: { pct: number; swatch: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${swatch}`} style={{ width: `${pct}%` }} /></div>
      <span className="w-9 text-right text-[12.5px] text-ink-2">{Math.round(pct)}%</span>
    </div>
  );
}
