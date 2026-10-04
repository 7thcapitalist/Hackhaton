"use client";
import { useEffect, useState, type ReactNode } from "react";

const TOGGLE_ALL = "scorecard:toggle-all";

/** Opens (true) or closes (false) every CollapsibleCard on the page. */
export const setAllSections = (open: boolean) => window.dispatchEvent(new CustomEvent(TOGGLE_ALL, { detail: open }));

type CollapsibleCardProps = {
  id: string;
  title: ReactNode;
  meta?: ReactNode;     // shown in the header, so a closed card still says how it is doing
  children: ReactNode;
  defaultOpen?: boolean;
};

/** A bordered section whose header toggles the body. Print always shows the body. */
export function CollapsibleCard({ id, title, meta, children, defaultOpen = false }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const on = (e: Event) => setOpen((e as CustomEvent<boolean>).detail);
    // A link to this card (e.g. "#categories") opens it.
    const onHash = () => { if (window.location.hash === `#${id}`) setOpen(true); };
    onHash();
    window.addEventListener(TOGGLE_ALL, on);
    window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener(TOGGLE_ALL, on); window.removeEventListener("hashchange", onHash); };
  }, [id]);
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-xl border border-line bg-surface shadow-xs break-inside-avoid">
      <h2 id={`${id}-title`} className="m-0">
        <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(o => !o)}
          className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:px-5">
          <span className="flex items-center gap-2.5">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden data-print-hide
              className={`size-3.5 shrink-0 text-ink-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}>
              <path d="m6 3 5 5-5 5" />
            </svg>
            <span className="text-[15px] font-semibold text-ink">{title}</span>
          </span>
          {meta && <span className="ml-auto flex items-center gap-3 text-[12.5px] font-normal text-ink-3">{meta}</span>}
        </button>
      </h2>
      {/* A class, not the hidden attribute: Tailwind's base style for [hidden] is !important and would beat print:block. */}
      <div id={`${id}-body`} className={`border-t border-line ${open ? "" : "hidden"} print:block`}>{children}</div>
    </section>
  );
}

/** "Expand all · Collapse all" for every CollapsibleCard on the page. */
export function ToggleAllSections() {
  const btn = "rounded-sm text-[12.5px] font-medium text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <span data-print-hide className="flex items-center gap-2">
      <button type="button" className={btn} onClick={() => setAllSections(true)}>Expand all</button>
      <span aria-hidden className="text-ink-4">·</span>
      <button type="button" className={btn} onClick={() => setAllSections(false)}>Collapse all</button>
    </span>
  );
}
