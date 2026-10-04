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
    <section className="flex flex-col gap-6 rounded-xl border border-line bg-surface px-7 py-7 shadow-xs" aria-labelledby="split-title">
      <h2 id="split-title" className="text-[17px] font-semibold">Where the money came from</h2>
      <div className="flex h-5 gap-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {ok.map(r => <span key={r.channelId} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${share(r)}%`, background: marketplaceColor(r.channelId) }} />)}
      </div>
      <ul className="grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4">
        {ok.map(r => (
          <li key={r.channelId} className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[14px] text-ink-2">
              <span className="size-3 shrink-0 rounded-[3px]" style={{ background: marketplaceColor(r.channelId) }} />{r.label}
            </span>
            <span className="text-[26px] font-semibold tracking-[-0.025em] tabular-nums sm:text-[30px]">{formatMoneyWhole(r.revenueCents ?? 0)}</span>
            <span className="text-[13px] text-ink-3">{Math.round(share(r))}% of revenue</span>
          </li>
        ))}
        {missing.map(r => (
          <li key={r.channelId} className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[14px] text-ink-2">
              <span className="size-3 shrink-0 rounded-[3px] border-[1.5px] border-dashed border-ink-4" />{r.label}
            </span>
            <span className="text-[20px] font-semibold text-warn">Awaiting data</span>
            <span className="text-[13px] text-ink-3">Not counted yet</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
