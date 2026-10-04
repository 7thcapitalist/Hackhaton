"use client";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { DayGrid, dayState, type DayInfo } from "./calendar/DayGrid";
import { MonthGrid } from "./calendar/MonthGrid";
import { Popover } from "./calendar/Popover";
import { addMonths, clamp, formatMonthLabel, monthOf, monthWeeks } from "./calendar/dates";
import { CalendarIcon, ChevronIcon } from "./icons";

export type { DayStatus } from "@/app/_lib/types";
import type { DayStatus } from "@/app/_lib/types";

type DatePickerProps = {
  label: string;      // "Friday, Oct 2, 2026"
  value: string;      // YYYY-MM-DD
  min: string;        // first day with data
  max: string;        // latest completed nightly close
  today: string;      // today in business time (gets a ring, even when disabled)
  days: DayStatus[];  // marketplaces reporting per day, min..max
  href: (date: string) => string;
};

const navBtn = "grid size-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-35 aria-disabled:hover:bg-transparent";

/** The stepper's middle: opens a calendar of the days with a completed nightly close. */
export function DatePicker({ label, value, min, max, today, days, href }: DatePickerProps) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const byDate = useMemo(() => new Map<string, DayInfo>(days.map(d => [d.date, d])), [days]);
  const info = useCallback((d: string) => byDate.get(d), [byDate]);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months">("days");
  const [month, setMonth] = useState(monthOf(value));
  const [focused, setFocused] = useState(value);
  const [focusedMonth, setFocusedMonth] = useState(monthOf(value));
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const [kbd, setKbd] = useState(false); // move DOM focus with the roving focus (after open / keys)

  const minMonth = monthOf(min), maxMonth = monthOf(max);
  const close = useCallback(() => setOpen(false), []);
  const toggle = () => {
    if (open) return setOpen(false);
    setView("days"); setMonth(monthOf(value)); setFocused(value); setKbd(true); setOpen(true);
  };
  const select = (d: string) => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
    if (d !== value) router.push(href(d), { scroll: false });
  };
  const focusDate = (d: string) => { setFocused(d); setKbd(true); if (monthOf(d) !== month) setMonth(monthOf(d)); };
  const goMonth = (m: string) => { setMonth(m); setFocused(clamp(monthOf(focused) === m ? focused : `${m}-01`, min, max)); };
  const openMonths = () => { setView("months"); setYear(Number(month.slice(0, 4))); setFocusedMonth(month); setKbd(true); };
  const pickMonth = (m: string) => { setView("days"); goMonth(m); setKbd(true); };

  const partialShown = monthWeeks(month).flat().some(d => monthOf(d) === month && dayState(d, min, max, today, info(d)).partial);
  const latestSelected = value === max;

  return (
    <div className="relative flex">
      <button ref={trigger} type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}. Choose a date`}
        className="flex w-full items-center gap-2 px-3.5 text-sm font-semibold whitespace-nowrap hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        <CalendarIcon className="size-[15px] text-ink-3" />
        <span>{label}</span>
      </button>

      <Popover open={open} onClose={close} anchorRef={trigger} label="Choose a date">
        <div className="flex flex-col gap-2 sm:w-[300px]">
          <div className="flex items-center justify-between gap-2">
            {view === "days" ? <>
              <button type="button" className={navBtn} aria-label="Previous month" aria-disabled={month <= minMonth || undefined}
                onClick={() => month > minMonth && goMonth(addMonths(month, -1))}><ChevronIcon dir="left" /></button>
              <button type="button" id={titleId} onClick={openMonths} aria-label={`${formatMonthLabel(month)}. Choose a month`}
                className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[14px] font-semibold text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
                {formatMonthLabel(month)}<ChevronIcon dir="right" className="size-3 rotate-90 text-ink-3" />
              </button>
              <button type="button" className={navBtn} aria-label="Next month" aria-disabled={month >= maxMonth || undefined}
                onClick={() => month < maxMonth && goMonth(addMonths(month, 1))}><ChevronIcon dir="right" /></button>
            </> : <>
              <button type="button" className={navBtn} aria-label="Previous year" aria-disabled={year <= Number(minMonth.slice(0, 4)) || undefined}
                onClick={() => year > Number(minMonth.slice(0, 4)) && setYear(year - 1)}><ChevronIcon dir="left" /></button>
              <button type="button" id={titleId} onClick={() => { setView("days"); setKbd(true); }} aria-label={`${year}. Back to days`}
                className="h-8 rounded-lg px-2.5 text-[14px] font-semibold text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">{year}</button>
              <button type="button" className={navBtn} aria-label="Next year" aria-disabled={year >= Number(maxMonth.slice(0, 4)) || undefined}
                onClick={() => year < Number(maxMonth.slice(0, 4)) && setYear(year + 1)}><ChevronIcon dir="right" /></button>
            </>}
          </div>

          {view === "days" ? (
            <DayGrid month={month} selected={value} focused={focused} today={today} min={min} max={max} info={info}
              takeFocus={kbd} onFocusDate={focusDate} onSelect={select} labelledBy={titleId} />
          ) : (
            <MonthGrid year={year} selected={monthOf(value)} focused={focusedMonth} takeFocus={kbd} labelledBy={titleId}
              isEnabled={m => m >= minMonth && m <= maxMonth}
              onFocusMonth={m => { setFocusedMonth(m); setKbd(true); if (Number(m.slice(0, 4)) !== year) setYear(Number(m.slice(0, 4))); }}
              onSelect={pickMonth} />
          )}

          <div className="flex min-h-8 items-center justify-between gap-3 border-t border-line-2 pt-2.5">
            <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
              {view === "days" && partialShown && <><span aria-hidden className="size-1.5 rounded-full bg-warn-icon" />Partial data</>}
            </span>
            <button type="button" onClick={() => !latestSelected && select(max)} aria-disabled={latestSelected || undefined}
              className="h-8 rounded-lg px-2.5 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:text-ink-4 aria-disabled:hover:bg-transparent">
              Latest close · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${max}T00:00:00Z`))}
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
