import type { CategoryMix, CategoryMixRow } from "@/app/_lib/data";
import { formatMoneyWhole } from "@/app/_lib/format";

/** Notable when today's share differs from the usual one by at least this many points. */
const NOTABLE_PTS = 5;

/** The day's revenue by category, each bar with a tick at its usual share for that weekday. */
export function CategoryMixCard({ mix, dateLabel }: { mix: CategoryMix; dateLabel: string }) {
  const shown = [...mix.rows, mix.uncategorized];
  const max = Math.max(...shown.flatMap(r => [r.sharePct, r.typicalSharePct ?? 0]), 1) * 1.1;
  const usual = mix.baselineDays > 0 ? `the last ${mix.baselineDays} ${mix.weekday}s` : null;
  return (
    <section aria-labelledby="mix-title" className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface px-5 py-4 sm:px-6">
      <header className="flex flex-col gap-0.5">
        <h2 id="mix-title" className="text-[15px] font-semibold">Category mix · {dateLabel}</h2>
        <p className="text-[12.5px] text-ink-3">
          Share of the day&apos;s {formatMoneyWhole(mix.totalCents)} revenue{usual ? <>; the tick marks the usual share over {usual}</> : ""}
          {!mix.complete && " (first rows only)"}
        </p>
      </header>
      {mix.totalCents <= 0 ? <p className="text-[13px] text-ink-3">No revenue this day.</p> : (
        <ul className="flex flex-col gap-2.5">
          {mix.rows.map(r => <MixRow key={r.category} row={r} max={max} />)}
          <li className="mt-1 border-t border-line-2 pt-3">
            <MixRow row={mix.uncategorized} max={max} muted as="div" />
            <p className="mt-1 text-[11.5px] text-ink-3">Amazon and most eBay orders arrive without a category.</p>
          </li>
        </ul>
      )}
    </section>
  );
}

function MixRow({ row: r, max, muted = false, as: Tag = "li" }: { row: CategoryMixRow; max: number; muted?: boolean; as?: "li" | "div" }) {
  const diff = r.typicalSharePct == null ? null : r.sharePct - r.typicalSharePct;
  const notable = diff != null && Math.abs(diff) >= NOTABLE_PTS;
  return (
    // Phones: name and numbers on one line, the bar full width under them. Wider: one line.
    <Tag className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-[13px] sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto]">
      <span className={`col-start-1 row-start-1 min-w-0 font-medium text-pretty ${muted ? "text-ink-2" : "text-ink"}`}>{r.category}</span>
      <span className="relative col-span-2 row-start-2 h-1.5 rounded-[1px] bg-surface-2 sm:col-span-1 sm:col-start-2 sm:row-start-1" role="img"
        aria-label={`${Math.round(r.sharePct)}% of revenue${r.typicalSharePct != null ? `, usually ${Math.round(r.typicalSharePct)}%` : ""}`}>
        <span className="absolute inset-y-0 left-0 rounded-[1px]" style={{ width: `${(Math.max(0, r.sharePct) / max) * 100}%`, background: muted ? "var(--ink4)" : "var(--accent)" }} />
        {r.typicalSharePct != null && (
          <span aria-hidden className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `calc(${(r.typicalSharePct / max) * 100}% - 1px)` }} />
        )}
      </span>
      <span className="col-start-2 row-start-1 flex items-baseline justify-end gap-2 whitespace-nowrap tabular-nums sm:col-start-3">
        <span className="font-semibold text-ink">{Math.round(r.sharePct)}%</span>
        <span className="w-[58px] text-right text-[12px] text-ink-3">{formatMoneyWhole(r.revenueCents)}</span>
        <span className={`w-[96px] text-right text-[12px] ${notable ? "font-medium text-ink-2" : "text-ink-3"}`}>
          {r.typicalSharePct == null ? "" : notable ? `${diff! > 0 ? "↑" : "↓"} usually ${Math.round(r.typicalSharePct)}%` : `usually ${Math.round(r.typicalSharePct)}%`}
        </span>
      </span>
    </Tag>
  );
}
