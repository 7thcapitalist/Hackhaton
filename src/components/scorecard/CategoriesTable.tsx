"use client";
import { useMemo, useState } from "react";
import type { CategoryRow } from "@/app/_lib/types";
import { CollapsibleCard } from "./CollapsibleCard";
import { formatMoneyWhole } from "@/app/_lib/format";

type SortKey = "category" | "revenue" | "share" | "margin" | "marginPct";
type CategoriesTableProps = { rows: CategoryRow[]; totalRevenueCents: number | null; monthLabel: string };

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "category", label: "Category", numeric: false },
  { key: "revenue", label: "Revenue", numeric: true },
  { key: "share", label: "Share of revenue", numeric: true },
  { key: "margin", label: "Margin $", numeric: true },
  { key: "marginPct", label: "Margin %", numeric: true },
];

/** The categories behind the two Top-10 KPIs, in one sortable table (default: revenue, high to low). */
export function CategoriesTable({ rows, totalRevenueCents, monthLabel }: CategoriesTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "revenue", desc: true });
  const listsDiffer = rows.some(r => r.inRevenueTop10 !== r.inMarginTop10);
  const data = useMemo(() => rows.map(r => ({
    ...r,
    share: totalRevenueCents ? (r.revenueCents / totalRevenueCents) * 100 : null,
    marginPct: r.revenueCents ? (r.marginCents / r.revenueCents) * 100 : null,
  })), [rows, totalRevenueCents]);
  const sorted = useMemo(() => {
    const val = (r: (typeof data)[number]) =>
      sort.key === "category" ? r.category : sort.key === "revenue" ? r.revenueCents : sort.key === "margin" ? r.marginCents : sort.key === "share" ? r.share ?? -1 : r.marginPct ?? -1;
    return [...data].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
  }, [data, sort]);
  const maxRev = Math.max(...rows.map(r => r.revenueCents), 1);
  const maxMargin = Math.max(...rows.map(r => r.marginCents), 1);
  const toggle = (key: SortKey) => setSort(s => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "category" }));

  return (
    <CollapsibleCard id="categories" title={`Categories, ${monthLabel}`}
      meta={<span>{listsDiffer ? "Top-10 lists differ; tags show which list" : `Same ${rows.length} lead by revenue and margin`}</span>}>
      <div className="overflow-x-auto px-2 pb-1 sm:px-2.5">
        <table className="w-full min-w-[620px] border-collapse text-[13.5px]">
          <thead>
            <tr className="text-[12px] text-ink-3">
              {COLUMNS.map(c => {
                const active = sort.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                    className={`px-2.5 py-2 font-normal ${c.numeric ? "text-right" : "text-left"}`}>
                    <button type="button" onClick={() => toggle(c.key)}
                      className={`inline-flex items-center gap-1 rounded-sm hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${active ? "font-medium text-ink" : ""}`}>
                      {c.label}<span aria-hidden className="w-2.5 text-[10px]">{active ? (sort.desc ? "▼" : "▲") : ""}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.category} className="border-t border-line-2">
                <th scope="row" className="px-2.5 py-2 text-left font-medium text-ink">
                  <span className="inline-flex flex-wrap items-center gap-x-2">
                    {r.category}
                    {listsDiffer && r.inRevenueTop10 && <Tag>Revenue top 10</Tag>}
                    {listsDiffer && r.inMarginTop10 && <Tag>Margin top 10</Tag>}
                  </span>
                </th>
                <td className="px-2.5 py-2"><BarValue value={r.revenueCents} max={maxRev} /></td>
                <td className="px-2.5 py-2 text-right text-ink-2 tabular-nums">{r.share == null ? "—" : `${r.share.toFixed(1)}%`}</td>
                <td className="px-2.5 py-2"><BarValue value={r.marginCents} max={maxMargin} /></td>
                <td className="px-2.5 py-2 text-right text-ink-2 tabular-nums">{r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}

function BarValue({ value, max }: { value: number; max: number }) {
  return (
    <span className="flex items-center justify-end gap-2.5">
      <span aria-hidden className="h-1.5 w-[clamp(48px,10vw,120px)] overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-ink-4" style={{ width: `${Math.max(0, (value / max) * 100)}%` }} />
      </span>
      <span className="w-[72px] text-right font-medium text-ink tabular-nums">{formatMoneyWhole(value)}</span>
    </span>
  );
}

const Tag = ({ children }: { children: string }) => (
  <span className="rounded-[4px] bg-surface-2 px-1.5 text-[11px] leading-[17px] font-normal whitespace-nowrap text-ink-2">{children}</span>
);
