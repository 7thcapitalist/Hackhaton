import type { ReactNode } from "react";

type TooltipProps = {
  text: string;
  children: ReactNode;          // the trigger; it carries its own accessible name
  align?: "start" | "center" | "end";
  className?: string;
  maxWidth?: number;            // px; longer text wraps
};

const ALIGN = { start: "left-0", center: "left-1/2 -translate-x-1/2", end: "right-0" };

/**
 * Hidden with display:none (not just transparent) so off-screen hints never widen the page.
 * Small hint above its trigger, on hover and on keyboard focus (a native title never shows on focus).
 * Visual only: the trigger's aria-label already says the same thing to screen readers.
 */
export function Tooltip({ text, children, align = "center", className = "", maxWidth = 220 }: TooltipProps) {
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span aria-hidden style={{ maxWidth: `min(${maxWidth}px, calc(100vw - 32px))` }}
        className={`pointer-events-none absolute bottom-full z-20 mb-1.5 w-max rounded-md bg-ink px-2 py-1 text-[11.5px] leading-snug font-medium text-surface shadow-pop hidden group-hover/tip:block group-has-[:focus-visible]/tip:block ${ALIGN[align]}`}>
        {text}
      </span>
    </span>
  );
}
