import Link from "next/link";
import { CalendarIcon, ChevronIcon } from "./icons";

type PeriodStepperProps = {
  label: string;
  prevHref: string | null; // null = no earlier period
  nextHref: string | null; // null = no later period
  prevLabel: string;       // "Previous day"
  nextLabel: string;
  minWidth?: string;
};

const arrow = "grid w-9 place-items-center text-ink-2 transition-colors";

/** ‹ [calendar] Friday, Oct 2, 2026 › — links, so every period has a shareable URL. */
export function PeriodStepper({ label, prevHref, nextHref, prevLabel, nextLabel, minWidth }: PeriodStepperProps) {
  return (
    <div className="flex h-9 items-stretch rounded-lg border border-line bg-surface shadow-xs">
      {prevHref ? (
        <Link href={prevHref} aria-label={prevLabel} className={`${arrow} rounded-l-lg hover:bg-surface-2`}><ChevronIcon dir="left" /></Link>
      ) : (
        <span aria-disabled="true" aria-label={prevLabel} className={`${arrow} opacity-35`}><ChevronIcon dir="left" /></span>
      )}
      <div className="flex items-center gap-2 border-x border-line px-3.5 text-sm font-semibold whitespace-nowrap" style={{ minWidth }}>
        <CalendarIcon className="size-[15px] text-ink-3" />
        <span>{label}</span>
      </div>
      {nextHref ? (
        <Link href={nextHref} aria-label={nextLabel} className={`${arrow} rounded-r-lg hover:bg-surface-2`}><ChevronIcon dir="right" /></Link>
      ) : (
        <span aria-disabled="true" aria-label={nextLabel} className={`${arrow} opacity-35`}><ChevronIcon dir="right" /></span>
      )}
    </div>
  );
}
