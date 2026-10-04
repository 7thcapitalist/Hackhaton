"use client";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { formatMonthLabel, moveMonthByKey } from "./dates";

type MonthGridProps = {
  year: number;
  selected: string | null;          // YYYY-MM
  focused: string;                  // YYYY-MM with roving focus
  isEnabled: (month: string) => boolean;
  takeFocus: boolean;
  onFocusMonth: (month: string) => void; // may be in another year; the parent moves the view
  onSelect: (month: string) => void;
  labelledBy: string;
};

/** Twelve months as a 4×3 ARIA grid with roving focus; months without data are disabled. */
export function MonthGrid({ year, selected, focused, isEnabled, takeFocus, onFocusMonth, onSelect, labelledBy }: MonthGridProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (takeFocus) buttons.current.get(focused)?.focus();
  }, [focused, year, takeFocus]);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const onKey = (e: KeyboardEvent) => {
    const next = moveMonthByKey(focused, e.key);
    if (!next) return;
    e.preventDefault();
    onFocusMonth(next);
  };
  return (
    <table role="grid" aria-labelledby={labelledBy} onKeyDown={onKey} className="w-full border-separate border-spacing-1">
      <tbody>
        {[0, 1, 2, 3].map(r => (
          <tr key={r}>
            {months.slice(r * 3, r * 3 + 3).map(m => {
              const enabled = isEnabled(m), isSel = m === selected;
              return (
                <td key={m} role="gridcell" aria-selected={isSel} className="p-0">
                  <button
                    ref={el => { if (el) buttons.current.set(m, el); else buttons.current.delete(m); }}
                    type="button" tabIndex={m === focused ? 0 : -1} aria-disabled={!enabled || undefined}
                    aria-label={`${formatMonthLabel(m)}${isSel ? ", selected" : ""}${enabled ? "" : ", no data"}`}
                    onClick={() => (enabled ? onSelect(m) : onFocusMonth(m))}
                    className={`h-11 w-full min-w-[76px] rounded-lg text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent sm:h-10
                      ${isSel ? "bg-accent font-semibold text-accent-ink" : enabled ? "font-medium text-ink hover:bg-surface-2" : "cursor-not-allowed text-ink-4"}`}>
                    {formatMonthLabel(m, { month: "short" })}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
