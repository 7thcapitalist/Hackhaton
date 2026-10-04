"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BarsIcon, DatabaseIcon, FileIcon, GridIcon, PulseIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

type SidebarProps = {
  pulseLabel: string;     // "Oct 2"
  scorecardLabel: string; // "Sep"
  sourcesLabel: string;   // "Sep 7/9": sources that sent data for the Monthly report month
  sourcesHint?: string;   // "7 of 9 data sources sent September data"
  importLabel: string | null; // newest file of any day, "Sat, Oct 3, 11:56 AM ET"; null before the first import
};

type NavItem = { href: string; label: string; icon: ReactNode; meta?: ReactNode };

function Brand() {
  // Text wordmark only: the Goodwill "smiling G" is a trademark, so it is not reproduced here.
  return (
    <Link href="/" className="flex flex-col rounded-md px-2 py-1 text-ink focus-visible:outline-2 focus-visible:outline-accent">
      <span className="text-[14px] leading-tight font-semibold whitespace-nowrap">Goodwill Michiana</span>
      <span className="text-[12px] whitespace-nowrap text-ink-3">Mission Control</span>
    </Link>
  );
}

export function Sidebar({ pulseLabel, scorecardLabel, sourcesLabel, sourcesHint, importLabel }: SidebarProps) {
  const pathname = usePathname();
  const meta = (text: string) => <span className="text-[11.5px] text-ink-3 tabular-nums">{text}</span>;
  const items: NavItem[] = [
    { href: "/", label: "Overview", icon: <GridIcon /> },
    { href: "/pulse", label: "Daily Pulse", icon: <PulseIcon />, meta: meta(pulseLabel) },
    { href: "/scorecard", label: "Monthly report", icon: <BarsIcon />, meta: meta(scorecardLabel) },
    {
      href: "/sources", label: "Sources", icon: <DatabaseIcon />,
      meta: (
        <span title={sourcesHint} className="text-[11.5px] text-ink-3 tabular-nums">
          {sourcesLabel}{sourcesHint && <span className="sr-only"> ({sourcesHint})</span>}
        </span>
      ),
    },
    { href: "/close", label: "Month-end Close", icon: <FileIcon className="size-4" />, meta: meta(scorecardLabel) },
  ];
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* Desktop */}
      <aside data-print-hide className="rail sticky top-0 hidden h-screen w-[224px] shrink-0 flex-col gap-5 border-r border-line px-3 py-4 lg:flex">
        <div className="flex items-center justify-between gap-2"><Brand /><ThemeToggle compact /></div>
        <nav className="flex flex-col gap-px" aria-label="Main">
          {items.map(it => {
            const active = isActive(it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                className={`relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-accent ${active ? "bg-accent-soft font-medium text-accent before:absolute before:top-1.5 before:bottom-1.5 before:-left-3 before:w-[2px] before:bg-accent" : "text-ink-2 hover:bg-[var(--rail-hover)] hover:text-ink"}`}>
                <span className={active ? "text-accent" : "text-ink-3"}>{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.meta}
              </Link>
            );
          })}
        </nav>
        {importLabel && (
          <div className="mt-auto flex flex-col gap-0.5 border-t border-line px-2 pt-3">
            <p className="text-[11.5px] text-ink-3">Newest file received</p>
            <p className="text-[12px] text-ink-2 tabular-nums">{importLabel}</p>
          </div>
        )}
      </aside>

      {/* Mobile and tablet */}
      <header data-print-hide className="rail sticky top-0 z-30 flex flex-col gap-1 border-b border-line px-4 pt-2.5 lg:hidden">
        <div className="flex items-center justify-between gap-3"><Brand /><ThemeToggle compact /></div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Main">
          {items.map(it => {
            const active = isActive(it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                className={`relative flex h-9 shrink-0 items-center px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-accent ${active ? "font-medium text-accent after:absolute after:right-2 after:bottom-0 after:left-2 after:h-[2px] after:bg-accent" : "text-ink-2 hover:text-ink"}`}>
                {it.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
