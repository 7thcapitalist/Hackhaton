import type { Significance } from "@/app/pulse/summary";

type HeroStatProps = {
  label: string;
  value: string;                  // pre-formatted, e.g. formatMoneyWhole(cents)
  change: Significance | null;    // vs the same weekday over recent weeks; null = not compared
  comparedTo: string;             // shown after the change, e.g. "vs last 4 Fridays ($4,800)"
  onOpen?: () => void;            // opens DrillDownDrawer
  large?: boolean;                // the simple view: fewer details, so the numbers get more room
};

// Muted red/green text only when the change is beyond the significance threshold; the arrow always shows.
const TONE = { up: "text-ok", down: "text-bad", neutral: "text-ink-2" };

/** One column of a hairline-divided stat strip (the parent draws the border and dividers). */
export function HeroStat({ label, value, change, comparedTo, onOpen, large }: HeroStatProps) {
  const pct = change?.pct ?? null;
  const pctText = pct == null ? null : `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct).toFixed(1)}%`;
  const spoken = pct == null ? comparedTo : `${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% ${comparedTo}. ${change!.note}`;
  return (
    <button type="button" onClick={onOpen} aria-label={`${label}: ${value}, ${spoken}. Show source rows`}
      className={`group/card flex min-w-0 flex-col text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${large ? "gap-2 px-5 py-5 sm:px-6" : "gap-1.5 px-5 py-4"}`}>
      <span className="flex items-center justify-between gap-2 text-[13px] text-ink-2">
        {label}
        <span aria-hidden className="text-[12px] text-accent opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-visible/card:opacity-100">View rows</span>
      </span>
      <span className={`leading-none font-semibold tracking-[-0.02em] tabular-nums ${large ? "text-[34px] sm:text-[40px]" : "text-[30px]"}`}>{value}</span>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink-3">
        {pctText == null ? <span className="text-ink-4">–</span> : (
          <span className="group/pill relative">
            <span className={`font-medium whitespace-nowrap ${TONE[change!.level]}`}>{pctText}</span>
            <span aria-hidden
              className="pointer-events-none absolute top-full left-0 z-20 mt-2 w-max max-w-[220px] rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-surface opacity-0 shadow-pop transition-opacity duration-100 group-hover/pill:opacity-100 group-focus-visible/card:opacity-100">
              {change!.note}
            </span>
          </span>
        )}
        <span>{comparedTo}</span>
      </span>
    </button>
  );
}
