"use client";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { CalendarIcon } from "./icons";

type DatePickerProps = {
  label: string;           // "Friday, Oct 2, 2026"
  value: string;           // YYYY-MM-DD
  min: string;             // first day with data
  max: string;             // last day with data
  href: (date: string) => string;
};

/** The stepper's middle: click the date to open the browser's calendar and jump to any day with data. */
export function DatePicker({ label, value, min, max, href }: DatePickerProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = input.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); }
  };
  return (
    <div className="relative flex">
      <button type="button" onClick={open} aria-label={`${label}. Choose a date`}
        className="flex w-full items-center gap-2 px-3 text-[13px] font-medium whitespace-nowrap hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        <CalendarIcon className="size-[15px] text-ink-3" />
        <span>{label}</span>
      </button>
      <input ref={input} type="date" value={value} min={min} max={max} tabIndex={-1} aria-hidden
        onChange={e => { const d = e.target.value; if (d && d >= min && d <= max && d !== value) router.push(href(d), { scroll: false }); }}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0" />
    </div>
  );
}
