import { FileIcon } from "./icons";

type HeroStatProps = {
  label: string;
  value: string;              // pre-formatted, e.g. formatMoneyCompact(cents)
  changePct: number | null;   // vs same weekday last week, same channel set
  comparedTo: string;         // "Fri, Sep 25"
  traceLabel?: string;        // "3 files"
  onOpen?: () => void;        // opens DrillDownDrawer
};

export function HeroStat({ label, value, changePct, comparedTo, traceLabel, onOpen }: HeroStatProps) {
  const up = (changePct ?? 0) >= 0;
  return (
    <button type="button" onClick={onOpen} aria-label={`${label}: ${value}. Show source rows`}
      className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface px-5.5 py-5 text-left shadow-xs transition-colors hover:border-accent-line focus-visible:outline-2 focus-visible:outline-accent">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-2">{label}</span>
        {traceLabel && <span className="flex items-center gap-[5px] text-[11.5px] text-ink-3"><FileIcon className="size-3" />{traceLabel}</span>}
      </span>
      <span className="text-[44px] leading-none font-semibold tracking-[-0.035em]">{value}</span>
      <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
        {changePct == null ? <span className="rounded-full bg-muted-soft px-[7px] py-0.5 font-semibold">—</span> : (
          <span className={`rounded-full px-[7px] py-0.5 font-semibold ${up ? "bg-ok-soft text-ok" : "bg-muted-soft text-ink-2"}`}>
            {up ? "↑" : "↓"} {Math.abs(changePct).toFixed(1)}%
          </span>
        )}
        <span>vs {comparedTo}</span>
      </span>
    </button>
  );
}
