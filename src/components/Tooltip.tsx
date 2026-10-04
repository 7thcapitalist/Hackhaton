import type { ReactNode } from "react";

type TooltipProps = {
  text: string;
  children: ReactNode;          // the trigger; it carries its own accessible name
  align?: "start" | "center" | "end";
  className?: string;
};

const ALIGN = { start: "left-0", center: "left-1/2 -translate-x-1/2", end: "right-0" };

/**
 * Small hint above its trigger, on hover and on keyboard focus (a native title never shows on focus).
 * Visual only: the trigger's aria-label already says the same thing to screen readers.
 */
export function Tooltip({ text, children, align = "center", className = "" }: TooltipProps) {
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span aria-hidden
        className={`pointer-events-none absolute bottom-full z-20 mb-1.5 w-max max-w-[220px] rounded-md bg-ink px-2 py-1 text-[11.5px] leading-snug font-medium text-surface opacity-0 shadow-pop transition-opacity duration-100 group-hover/tip:opacity-100 group-has-[:focus-visible]/tip:opacity-100 ${ALIGN[align]}`}>
        {text}
      </span>
    </span>
  );
}
