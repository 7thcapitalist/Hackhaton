"use client";
import type { ReactNode } from "react";
import type { ChannelId, PulseRow, PulseTotals } from "@/app/_lib/types";
import { formatInt, formatMoney } from "@/app/_lib/format";
import { WarnIcon } from "./icons";
import { marketplaceColor } from "./marketplaceColors";
import { Tooltip } from "./Tooltip";

export type PulseField = "revenue" | "customers" | "orders";
type PulseTableProps = {
  rows: PulseRow[];
  totals: PulseTotals;
  dateLabel: string; // "Fri, Oct 2"
  onCellClick: (channelId: ChannelId | "total", field: PulseField) => void;
  onMissingClick: (channelId: ChannelId) => void;
};

/** Marketplaces whose files have no buyer id, so Customers falls back to one per transaction there. */
export const NO_BUYER_ID: Partial<Record<ChannelId, string>> = {
  amazon: "Amazon sends no buyer ID",
  other: "CashMonkey, Jewelry and some Upright orders have no buyer ID",
};

// Marketplace · Revenue · Share · Unique customers · Orders. The share column gets extra room on its
// left so "Revenue" (right-aligned) and "Share of revenue" (left-aligned) don't read as one label.
const cols = "grid grid-cols-[minmax(180px,1fr)_112px_minmax(120px,220px)_116px_72px] items-center gap-x-5 px-4 sm:px-5.5";
const th = "text-[12px] font-medium whitespace-nowrap text-ink-3";

function Num({ children, onClick, bold, label }: { children: ReactNode; onClick: () => void; bold?: boolean; label: string }) {
  return (
    <Tooltip text="View source rows" align="end" className="justify-self-end">
      <button type="button" onClick={onClick} aria-label={label}
        className={`-mx-1.5 rounded-md px-1.5 py-1 tabular-nums underline decoration-ink-4 decoration-dotted underline-offset-[5px] transition-colors hover:bg-accent-soft hover:text-accent hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent ${bold ? "text-[15.5px] font-bold" : "text-[14.5px] font-medium"}`}>
        {children}
      </button>
    </Tooltip>
  );
}

export function PulseTable({ rows, totals, dateLabel, onCellClick, onMissingClick }: PulseTableProps) {
  const ok = rows.filter(r => r.status === "ok").sort((a, b) => (b.revenueCents ?? 0) - (a.revenueCents ?? 0));
  const missing = rows.filter(r => r.status === "missing");
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="border-b border-line px-4 py-4 sm:px-5.5">
        <h2 className="text-[14px] font-semibold">By marketplace</h2>
      </header>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]" role="table" aria-label={`Pulse by marketplace, ${dateLabel}`}>
          <div role="row" className={`${cols} h-10 border-b border-line bg-surface-2`}>
            <span role="columnheader" className={th}>Marketplace</span>
            <span role="columnheader" className={`${th} text-right`}>Revenue</span>
            <span role="columnheader" className={`${th} pl-3`}>Share of revenue</span>
            <span role="columnheader" className={`${th} text-right`}>Unique customers</span>
            <span role="columnheader" className={`${th} text-right`}>Orders</span>
          </div>
          {ok.map(r => (
            <div role="row" key={r.channelId} className={`${cols} min-h-[58px] border-b border-line-2 py-2`}>
              <Label row={r} />
              <Num label={`${r.label} revenue ${formatMoney(r.revenueCents!)}, view source rows`} onClick={() => onCellClick(r.channelId, "revenue")}>{formatMoney(r.revenueCents!)}</Num>
              <Share pct={totals.revenueCents ? (r.revenueCents! / totals.revenueCents) * 100 : 0} color={marketplaceColor(r.channelId)} />
              <Num label={`${r.label} unique customers ${formatInt(r.customers!)}, view source rows`} onClick={() => onCellClick(r.channelId, "customers")}>{formatInt(r.customers!)}</Num>
              <Num label={`${r.label} orders ${formatInt(r.orders!)}, view source rows`} onClick={() => onCellClick(r.channelId, "orders")}>{formatInt(r.orders!)}</Num>
            </div>
          ))}
          {missing.map(r => (
            <div role="row" key={r.channelId}
              className="grid min-h-[58px] grid-cols-[minmax(180px,1fr)_auto] items-center gap-x-5 border-b border-line-2 bg-[repeating-linear-gradient(135deg,transparent_0_7px,var(--line2)_7px_8px)] px-4 py-2 sm:px-5.5">
              <Label row={r} missing />
              <button type="button" onClick={() => onMissingClick(r.channelId)}
                className="flex items-center gap-2.5 justify-self-end rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-warn-icon focus-visible:outline-2 focus-visible:outline-accent">
                <span className="flex items-center gap-1.5 font-semibold text-warn"><WarnIcon className="size-3.5 text-warn-icon" />Awaiting data</span>
                No file received for {dateLabel}, not counted
              </button>
            </div>
          ))}
          <div role="row" className={`${cols} min-h-[60px] border-t-[1.5px] border-ink py-2`}>
            <div className="flex flex-col"><span className="font-bold">Total e-commerce</span>
              <span className="text-xs text-ink-3">{ok.length} of {rows.length} marketplaces reporting</span></div>
            <Num bold label={`Total revenue ${formatMoney(totals.revenueCents)}, view source rows`} onClick={() => onCellClick("total", "revenue")}>{formatMoney(totals.revenueCents)}</Num>
            <span />
            <Num bold label={`Total unique customers ${formatInt(totals.customers)}, view source rows`} onClick={() => onCellClick("total", "customers")}>{formatInt(totals.customers)}</Num>
            <Num bold label={`Total orders ${formatInt(totals.orders)}, view source rows`} onClick={() => onCellClick("total", "orders")}>{formatInt(totals.orders)}</Num>
          </div>
        </div>
      </div>
    </section>
  );
}

function Label({ row, missing }: { row: PulseRow; missing?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`size-3 shrink-0 rounded-[3px] ${missing ? "border-[1.5px] border-dashed border-ink-4" : ""}`}
        style={missing ? undefined : { background: marketplaceColor(row.channelId) }} />
      <span className={`text-[14px] font-medium text-pretty ${missing ? "text-ink-2" : "text-ink"}`}>{row.label}</span>
    </div>
  );
}

function Share({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2.5 pl-3">
      <span className="w-9 shrink-0 text-[12.5px] text-ink-2 tabular-nums">{Math.round(pct)}%</span>
      <div className="h-1 flex-1"><div className="h-full rounded-[1px]" style={{ width: `${Math.max(0, pct)}%`, background: color }} /></div>
    </div>
  );
}
