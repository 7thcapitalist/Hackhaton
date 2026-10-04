import type { Significance } from "@/app/pulse/summary";

type HeroStatProps = {
  label: string;
  value: string;                  // pre-formatted, e.g. formatMoneyWhole(cents)
  change: Significance | null;    // vs the same weekday over recent weeks; null = not compared
  comparedTo: string;             // shown after the change, e.g. "vs last 4 Fridays ($4,800)"
  onOpen?: () => void;            // opens DrillDownDrawer
  large?: boolean;                // the simple view: fewer cards, so each one gets more room
};

// Muted red/green only when the change is beyond the significance threshold; the arrow always shows.
const PILL = { up: "bg-ok-soft text-ok", down: "bg-bad-soft text-bad", neutral: "bg-muted-soft text-ink-2" };

export function HeroStat({ label, value, change, comparedTo, onOpen, large }: HeroStatProps) {
  const pct = change?.pct ?? null;
  const pctText = pct == null ? null : `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct).toFixed(1)}%`;
  const spoken = pct == null ? comparedTo : `${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% ${comparedTo}. ${change!.note}`;
  return (
    <button type="button" onClick={onOpen} aria-label={`${label}: ${value}, ${spoken}. Show source rows`}
      className={`group/card flex min-w-0 flex-col rounded-xl border border-line bg-surface text-left shadow-xs transition-colors hover:border-accent-line focus-visible:outline-2 focus-visible:outline-accent ${large ? "gap-4 px-7 py-8 sm:min-h-[220px] sm:justify-between" : "gap-2.5 px-5.5 py-5"}`}>
      <span className={`font-medium text-ink-2 ${large ? "text-[15px]" : "text-[13px]"}`}>{label}</span>
      <span className={`leading-none font-semibold tracking-[-0.035em] tabular-nums ${large ? "text-[52px] sm:text-[64px]" : "text-[40px] sm:text-[44px]"}`}>{value}</span>
      <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3 ${large ? "text-[14px]" : "text-[12.5px]"}`}>
        {pctText == null ? <span className="rounded-full bg-muted-soft px-[7px] py-0.5 font-semibold">—</span> : (
          <span className="group/pill relative">
            <span className={`rounded-full px-[7px] py-0.5 font-semibold whitespace-nowrap ${PILL[change!.level]}`}>{pctText}</span>
            <span aria-hidden
              className="pointer-events-none absolute top-full left-0 z-20 mt-2 w-max max-w-[220px] rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-surface opacity-0 shadow-[0_4px_12px_rgba(0,0,0,.15)] transition-opacity duration-100 group-hover/pill:opacity-100 group-focus-visible/card:opacity-100">
              {change!.note}
            </span>
          </span>
        )}
        <span>{comparedTo}</span>
      </span>
    </button>
  );
}
