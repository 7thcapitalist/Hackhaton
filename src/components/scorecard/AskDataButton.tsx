"use client";
import { buttonClass } from "../Button";
import { openChat, useRegisterInlineLauncher } from "../chat/launcher";

/** "Ask the data" in the page header; the floating chat bubble hides while this is on screen. */
export function AskDataButton() {
  useRegisterInlineLauncher();
  return (
    <button type="button" data-print-hide onClick={openChat} aria-haspopup="dialog" className={buttonClass("secondary")}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden className="size-3.5">
        <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
      </svg>
      Ask the data
    </button>
  );
}
