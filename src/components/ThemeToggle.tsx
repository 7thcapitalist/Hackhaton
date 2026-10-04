"use client";
import { SunMoonIcon } from "./icons";

/** Runs before paint (inlined in <head>) so the page never flashes the wrong theme. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
  };
  return (
    <button type="button" onClick={toggle} aria-label="Switch between light and dark theme"
      className={`flex items-center gap-2 rounded-[7px] text-xs text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${compact ? "size-8 justify-center" : "h-8 px-2.5"}`}>
      <SunMoonIcon />
      {!compact && <span>Light / dark</span>}
    </button>
  );
}
