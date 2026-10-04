"use client";
// Lets a page put an "Ask the data" button in its own header instead of the floating bubble.
// While an inline launcher is mounted, ChatBubble hides its floating button; both open the same panel.
import { useEffect, useSyncExternalStore } from "react";

export const CHAT_OPEN_EVENT = "mission-control:open-chat";

let inlineLaunchers = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** True while some page shows its own launcher (so the floating bubble steps aside). */
export function useHasInlineLauncher() {
  return useSyncExternalStore(subscribe, () => inlineLaunchers > 0, () => false);
}

/** Call from an inline launcher component: registers it for as long as it is mounted. */
export function useRegisterInlineLauncher() {
  useEffect(() => {
    inlineLaunchers++; emit();
    return () => { inlineLaunchers--; emit(); };
  }, []);
}

/** Opens the chat panel; focus returns to the element that was focused when it closes. */
export function openChat() {
  window.dispatchEvent(new Event(CHAT_OPEN_EVENT));
}
