"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BarsIcon, CheckIcon, DatabaseIcon, GridIcon, PulseIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

type SidebarProps = {
  pulseLabel: string;     // "Oct 2"
  scorecardLabel: string; // "Sep"
  sourcesLabel: string;   // "Sep 7/9": sources that sent data for the Scorecard month
  sourcesHint?: string;   // "7 of 9 data sources sent September data"
  importLabel: string | null; // newest file of any day, "Sat, Oct 3 · 11:56 AM ET"; null before the first import
};

type NavItem = { href: string; label: string; icon: ReactNode; meta?: ReactNode };

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg px-2 py-1 text-ink">
      <span className="grid size-[26px] shrink-0 place-items-center rounded-[7px] bg-ink"><span className="size-2 rounded-full border-2 border-surface" /></span>
      <span className="flex flex-col gap-px">
        <span className="text-sm font-semibold tracking-[-0.01em]">Mission Control</span>
        <span className="text-[11.5px] text-ink-3">Michiana e-commerce</span>
      </span>
    </Link>
  );
}

export function Sidebar({ pulseLabel, scorecardLabel, sourcesLabel, sourcesHint, importLabel }: SidebarProps) {
  const pathname = usePathname();
  const items: NavItem[] = [
    { href: "/", label: "Overview", icon: <GridIcon /> },
    { href: "/pulse", label: "Daily Pulse", icon: <PulseIcon />, meta: <span className="text-[11px] text-ink-3">{pulseLabel}</span> },
    { href: "/scorecard", label: "Scorecard", icon: <BarsIcon />, meta: <span className="text-[11px] text-ink-3">{scorecardLabel}</span> },
    {
      href: "/sources", label: "Sources", icon: <DatabaseIcon />,
      meta: (
        <span title={sourcesHint} className="rounded-[5px] border border-line bg-surface-2 px-[5px] text-[11px] leading-[17px] font-medium text-ink-2">
          {sourcesLabel}{sourcesHint && <span className="sr-only"> ({sourcesHint})</span>}
        </span>
      ),
    },
  ];
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* Desktop */}
      <aside data-print-hide className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col gap-[22px] border-r border-line bg-surface px-3.5 py-[18px] lg:flex">
        <Brand />
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {items.map(it => {
            const active = isActive(it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                className={`flex h-[34px] items-center gap-2.5 rounded-[7px] px-2.5 text-[13.5px] transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent ${active ? "bg-surface-2 font-semibold text-ink" : "font-[450] text-ink-2"}`}>
                {it.icon}
                <span className="flex-1">{it.label}</span>
                {it.meta}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          {importLabel && (
            <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface-2 p-3">
              <p className="flex items-center gap-[7px] text-xs font-medium text-ink"><CheckIcon className="size-3.5 text-ok" />Newest file received</p>
              <p className="text-[11.5px] leading-normal text-ink-3">{importLabel}</p>
            </div>
          )}
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile and tablet */}
      <header data-print-hide className="sticky top-0 z-30 flex flex-col gap-2 border-b border-line bg-surface px-4 pt-3 pb-2 lg:hidden">
        <div className="flex items-center justify-between gap-3"><Brand /><ThemeToggle compact /></div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto" aria-label="Main">
          {items.map(it => {
            const active = isActive(it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                className={`flex h-8 shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-[13px] ${active ? "bg-surface-2 font-semibold text-ink" : "text-ink-2"}`}>
                {it.icon}{it.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
