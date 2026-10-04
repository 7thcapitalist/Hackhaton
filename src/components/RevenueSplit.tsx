import type { PulseRow } from "@/app/_lib/types";
import { formatMoneyWhole } from "@/app/_lib/format";
import { marketplaceColor } from "./marketplaceColors";

type RevenueSplitProps = { rows: PulseRow[]; totalCents: number };

/** The simple view's breakdown: one split bar, then each marketplace's dollars and share. */
export function RevenueSplit({ rows, totalCents }: RevenueSplitProps) {
  const ok = rows.filter(r => r.status === "ok").sort((a, b) => (b.revenueCents ?? 0) - (a.revenueCents ?? 0));
  const missing = rows.filter(r => r.status === "missing");
  const share = (r: PulseRow) => (totalCents > 0 ? Math.max(0, ((r.revenueCents ?? 0) / totalCents) * 100) : 0);
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface px-5 py-5 sm:px-6" aria-labelledby="split-title">
      <h2 id="split-title" className="text-[14px] font-semibold">Where the money came from</h2>
      {/* Segments separated by 2px surface gaps; square ends, the bar is a measure, not a pill. */}
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[2px]" aria-hidden>
        {ok.map(r => <span key={r.channelId} className="h-full" style={{ width: `${share(r)}%`, background: marketplaceColor(r.channelId) }} />)}
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
        {ok.map(r => (
          <li key={r.channelId} className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: marketplaceColor(r.channelId) }} />{r.label}
            </span>
            <span className="text-[20px] leading-none font-semibold tracking-[-0.01em] tabular-nums sm:text-[22px]">{formatMoneyWhole(r.revenueCents ?? 0)}</span>
            <span className="text-[12.5px] text-ink-3">{Math.round(share(r))}% of revenue</span>
          </li>
        ))}
        {missing.map(r => (
          <li key={r.channelId} className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="size-2 shrink-0 rounded-[2px] border border-dashed border-ink-4" />{r.label}
            </span>
            <span className="text-[15px] leading-[22px] font-semibold text-warn">Awaiting data</span>
            <span className="text-[12.5px] text-ink-3">Not counted yet</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
