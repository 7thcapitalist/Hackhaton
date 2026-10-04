"use client";
import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { MonthGrid } from "./calendar/MonthGrid";
import { Popover } from "./calendar/Popover";
import { CalendarIcon, ChevronIcon } from "./icons";

type MonthPickerProps = {
  label: string;      // "September 2026"
  value: string;      // YYYY-MM
  months: string[];   // months with data, oldest first
  latest: string;     // the latest closed month (the page default)
  hrefPrefix: string; // e.g. "/scorecard?period=" (a string: server pages can't pass functions to client components)
};

const navBtn = "grid size-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-35 aria-disabled:hover:bg-transparent";

/** The month stepper's middle: opens a 12-month grid (same look as the Daily Pulse calendar). */
export function MonthPicker({ label, value, months, latest, hrefPrefix }: MonthPickerProps) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const [focused, setFocused] = useState(value);
  const minYear = Number(months[0].slice(0, 4)), maxYear = Number(months[months.length - 1].slice(0, 4));
  const close = useCallback(() => setOpen(false), []);
  const select = (m: string) => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
    if (m !== value) router.push(`${hrefPrefix}${m}`);
  };
  return (
    <div className="relative flex">
      <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}. Choose a month`}
        onClick={() => { if (open) return setOpen(false); setYear(Number(value.slice(0, 4))); setFocused(value); setOpen(true); }}
        className="flex w-full items-center gap-2 px-3.5 text-sm font-semibold whitespace-nowrap hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        <CalendarIcon className="size-[15px] text-ink-3" />
        <span>{label}</span>
      </button>
      <Popover open={open} onClose={close} anchorRef={trigger} label="Choose a month">
        <div className="flex flex-col gap-2 sm:w-[280px]">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className={navBtn} aria-label="Previous year" aria-disabled={year <= minYear || undefined}
              onClick={() => year > minYear && setYear(year - 1)}><ChevronIcon dir="left" /></button>
            <span id={titleId} className="text-[14px] font-semibold">{year}</span>
            <button type="button" className={navBtn} aria-label="Next year" aria-disabled={year >= maxYear || undefined}
              onClick={() => year < maxYear && setYear(year + 1)}><ChevronIcon dir="right" /></button>
          </div>
          <MonthGrid year={year} selected={value} focused={focused} takeFocus labelledBy={titleId}
            isEnabled={m => months.includes(m)} onSelect={select}
            onFocusMonth={m => { setFocused(m); if (Number(m.slice(0, 4)) !== year) setYear(Number(m.slice(0, 4))); }} />
          <div className="flex min-h-8 items-center justify-end border-t border-line-2 pt-2.5">
            <button type="button" onClick={() => value !== latest && select(latest)} aria-disabled={value === latest || undefined}
              className="h-8 rounded-lg px-2.5 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:text-ink-4 aria-disabled:hover:bg-transparent">
              Latest closed · {new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${latest}-01T00:00:00Z`))}
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
