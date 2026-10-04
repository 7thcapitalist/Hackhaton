"use client";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Tooltip } from "../Tooltip";
import { clamp, formatDayLabel, monthOf, monthWeeks, moveByKey } from "./dates";

export type DayInfo = { reported: number; total: number };

type DayGridProps = {
  month: string;                 // YYYY-MM shown
  selected: string;
  focused: string;               // roving focus (may be a disabled day)
  today: string;
  min: string;                   // first day with data
  max: string;                   // latest completed close
  info: (date: string) => DayInfo | undefined;
  takeFocus: boolean;            // move DOM focus to `focused` (on open and while navigating)
  onFocusDate: (date: string) => void;
  onSelect: (date: string) => void;
  labelledBy: string;
};

const WEEKDAYS = [["S", "Sunday"], ["M", "Monday"], ["T", "Tuesday"], ["W", "Wednesday"], ["T", "Thursday"], ["F", "Friday"], ["S", "Saturday"]];

/** Why a day can or cannot be picked; drives the label, tooltip, dot and disabled state. */
export function dayState(date: string, min: string, max: string, today: string, info: DayInfo | undefined) {
  if (date > max) return { selectable: false, note: date === today ? "not closed yet" : date > today ? "in the future" : "nightly close not run yet", tip: date >= today ? null : "Close not run yet", partial: false };
  if (date < min) return { selectable: false, note: "before the first day with data", tip: null, partial: false };
  if (!info || info.reported === 0) return { selectable: false, note: "no data imported", tip: "No data imported", partial: false };
  const partial = info.reported < info.total;
  const text = `${info.reported} of ${info.total} marketplaces reported`;
  return { selectable: true, note: partial ? `partial data, ${text}` : null, tip: partial ? text : null, partial };
}

/** A month of days as an ARIA grid with roving focus. Only the month's own days are interactive. */
export function DayGrid({ month, selected, focused, today, min, max, info, takeFocus, onFocusDate, onSelect, labelledBy }: DayGridProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (takeFocus) buttons.current.get(focused)?.focus();
  }, [focused, month, takeFocus]);

  const onKey = (e: KeyboardEvent) => {
    const next = moveByKey(focused, e.key);
    if (!next) return;
    e.preventDefault();
    onFocusDate(clamp(next, min, max)); // keyboard focus stays within the days that have data
  };

  return (
    <table role="grid" aria-labelledby={labelledBy} onKeyDown={onKey} className="w-full table-fixed border-separate border-spacing-y-0.5">
      <thead>
        <tr>
          {WEEKDAYS.map(([short, long], i) => (
            <th key={i} scope="col" abbr={long} className="h-7 text-center text-[11.5px] font-medium text-ink-3">{short}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthWeeks(month).map(week => (
          <tr key={week[0]}>
            {week.map(d => {
              const day = Number(d.slice(8, 10));
              if (monthOf(d) !== month) {
                return <td key={d} role="gridcell" aria-hidden className="h-11 text-center text-[13px] text-ink-4/60 sm:h-9">{day}</td>;
              }
              const s = dayState(d, min, max, today, info(d));
              const isSel = d === selected, isToday = d === today;
              const label = [formatDayLabel(d), isToday && "today", isSel && "selected", s.note].filter(Boolean).join(", ");
              const btn = (
                <button
                  ref={el => { if (el) buttons.current.set(d, el); else buttons.current.delete(d); }}
                  type="button" tabIndex={d === focused ? 0 : -1} aria-label={label} aria-disabled={!s.selectable || undefined}
                  onClick={() => (s.selectable ? onSelect(d) : onFocusDate(d))}
                  className={`relative mx-auto grid size-11 place-items-center rounded-lg text-[13.5px] tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent sm:size-9 pointer-coarse:size-11
                    ${isSel ? "bg-accent font-semibold text-accent-ink" : s.selectable ? "text-ink hover:bg-surface-2" : "cursor-not-allowed text-ink-4"}
                    ${isToday && !isSel ? "ring-1 ring-ink-3 ring-inset" : ""}`}>
                  {day}
                  {s.partial && <span aria-hidden className={`absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full ${isSel ? "bg-accent-ink" : "bg-warn-icon"}`} />}
                </button>
              );
              return (
                <td key={d} role="gridcell" aria-selected={isSel} className="p-0 text-center">
                  {s.tip ? <Tooltip text={s.tip}>{btn}</Tooltip> : btn}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
