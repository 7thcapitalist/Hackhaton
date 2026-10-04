"use client";
import { useMemo, useState } from "react";
import type { CategoryRow } from "@/app/_lib/types";
import { CollapsibleCard } from "./CollapsibleCard";
import { formatInt, formatMoney, formatMoneyWhole } from "@/app/_lib/format";

type SortKey = "category" | "revenue" | "share" | "margin" | "marginPct" | "units" | "sellThrough" | "asp";
type CategoriesTableProps = { rows: CategoryRow[]; totalRevenueCents: number | null; monthLabel: string };
type Row = CategoryRow & { share: number | null; marginPct: number | null };

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "category", label: "Category", numeric: false },
  { key: "revenue", label: "Revenue", numeric: true },
  { key: "share", label: "Share of revenue", numeric: true },
  { key: "margin", label: "Margin $", numeric: true },
  { key: "marginPct", label: "Margin %", numeric: true },
  { key: "units", label: "Units", numeric: true },
  { key: "sellThrough", label: "Sell-through", numeric: true },
  { key: "asp", label: "Avg price", numeric: true },
];
/** Wider screens only; on phones these move under their dollar value or the category name. */
const PHONE_HIDDEN = new Set<SortKey>(["share", "marginPct", "units", "sellThrough", "asp"]);
const SORT_VALUE: Record<Exclude<SortKey, "category">, (r: Row) => number> = {
  revenue: r => r.revenueCents, share: r => r.share ?? -1, margin: r => r.marginCents, marginPct: r => r.marginPct ?? -1,
  units: r => r.units, sellThrough: r => r.sellThroughPct ?? -1, asp: r => r.aspCents ?? -1,
};
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const price = (v: number | null) => (v == null ? "—" : formatMoney(v));

/** The categories behind the two Top-10 KPIs, in one sortable table (default: revenue, high to low). */
export function CategoriesTable({ rows, totalRevenueCents, monthLabel }: CategoriesTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "revenue", desc: true });
  const listsDiffer = rows.some(r => r.inRevenueTop10 !== r.inMarginTop10);
  const data = useMemo((): Row[] => rows.map(r => ({
    ...r,
    share: totalRevenueCents ? (r.revenueCents / totalRevenueCents) * 100 : null,
    marginPct: r.revenueCents ? (r.marginCents / r.revenueCents) * 100 : null,
  })), [rows, totalRevenueCents]);
  const sorted = useMemo(() => {
    const val = (r: Row) => (sort.key === "category" ? r.category : SORT_VALUE[sort.key](r));
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
      {/* Phones: three columns (share and margin % move under their dollar values; units,
          sell-through and average price under the category), so the table fits a 390px screen
          without sideways scrolling. Wider screens: all eight, scrolling inside the card when narrow. */}
      <div className="px-1 pb-1 sm:overflow-x-auto sm:px-2.5">
        <table className="w-full table-fixed border-collapse text-[13px] sm:table-auto sm:min-w-[860px] sm:text-[13.5px]">
          <colgroup className="sm:hidden"><col /><col className="w-[92px]" /><col className="w-[100px]" /></colgroup>
          <thead>
            <tr className="text-[12px] text-ink-3">
              {COLUMNS.map(c => {
                const active = sort.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                    className={`px-2.5 py-2 font-normal whitespace-nowrap ${c.numeric ? "text-right" : "text-left"} ${PHONE_HIDDEN.has(c.key) ? "max-sm:hidden" : ""}`}>
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
                  <span className="mt-0.5 block text-[12px] font-normal text-ink-3 tabular-nums sm:hidden">
                    {formatInt(r.units)} units · {pct(r.sellThroughPct)} sell-through · {price(r.aspCents)} avg
                  </span>
                </th>
                <td className="px-2.5 py-2">
                  <BarValue value={r.revenueCents} max={maxRev} />
                  <span className="block text-right text-[12px] whitespace-nowrap text-ink-3 tabular-nums sm:hidden">{r.share == null ? "—" : `${r.share.toFixed(1)}% share`}</span>
                </td>
                <td className="px-2.5 py-2 text-right text-ink-2 tabular-nums max-sm:hidden">{pct(r.share)}</td>
                <td className="px-2.5 py-2">
                  <BarValue value={r.marginCents} max={maxMargin} />
                  <span className="block text-right text-[12px] whitespace-nowrap text-ink-3 tabular-nums sm:hidden">{r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}% margin`}</span>
                </td>
                <td className="px-2.5 py-2 text-right text-ink-2 tabular-nums max-sm:hidden">{pct(r.marginPct)}</td>
                <td className="px-2.5 py-2 text-right text-ink-2 tabular-nums max-sm:hidden">{formatInt(r.units)}</td>
                <td className="px-2.5 py-2 text-right text-ink-2 tabular-nums max-sm:hidden">{pct(r.sellThroughPct)}</td>
                <td className="px-2.5 py-2 text-right whitespace-nowrap text-ink-2 tabular-nums max-sm:hidden">{price(r.aspCents)}</td>
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
        <span className="block h-full rounded-full bg-s2" style={{ width: `${Math.max(0, (value / max) * 100)}%` }} />
      </span>
      <span className="w-[72px] text-right font-medium text-ink tabular-nums">{formatMoneyWhole(value)}</span>
    </span>
  );
}

const Tag = ({ children }: { children: string }) => (
  <span className="rounded-[4px] bg-surface-2 px-1.5 text-[11px] leading-[17px] font-normal whitespace-nowrap text-ink-2">{children}</span>
);
