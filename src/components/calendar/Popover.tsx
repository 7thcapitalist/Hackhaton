"use client";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

type PopoverProps = {
  open: boolean;
  onClose: () => void;               // Esc, click outside, or focus leaving: nothing changes
  anchorRef: RefObject<HTMLElement | null>; // the trigger; focus returns here on close
  label: string;                     // dialog name, e.g. "Choose a date"
  children: ReactNode;
};

/**
 * Anchored below its trigger (left-aligned) on wider screens; a bottom sheet under 640px.
 * The parent of the trigger must be `relative`. One open animation (fade + slight scale),
 * which `prefers-reduced-motion` turns off (globals.css).
 */
export function Popover({ open, onClose, anchorRef, label, children }: PopoverProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (returnFocus: boolean) => {
      onClose();
      if (returnFocus) requestAnimationFrame(() => anchorRef.current?.focus());
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchorRef.current?.contains(t)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(true); }
    };
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && !panel.current?.contains(next) && !anchorRef.current?.contains(next)) close(false);
    };
    const el = panel.current;
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    el?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      el?.removeEventListener("focusout", onFocusOut);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return (
    <>
      <div aria-hidden className="fixed inset-0 z-40 bg-[var(--scrim)] sm:hidden" />
      <div ref={panel} role="dialog" aria-label={label}
        className="popover-in fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] origin-top-left overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(20,22,27,.18)]
          sm:absolute sm:inset-x-auto sm:top-full sm:bottom-auto sm:left-0 sm:mt-2 sm:max-h-none sm:w-max sm:overflow-visible sm:rounded-xl sm:p-3.5 sm:shadow-[0_12px_32px_rgba(20,22,27,.16)]">
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        {children}
      </div>
    </>
  );
}
