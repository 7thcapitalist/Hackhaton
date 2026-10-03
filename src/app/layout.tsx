import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { themeInitScript } from "@/components/ThemeToggle";
import { LATEST_DATE, SCORECARD_PERIOD_ID, getPeriodMeta, getPulse, getSourceSummary } from "./_lib/live-data";
import { formatDay, formatStamp } from "./_lib/format";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Mission Control – Goodwill Michiana",
  description: "Nightly pulse, COO scorecard and month-end close for Goodwill Michiana e-commerce.",
};

// This layout now hits the database on every request (sidebar counts, last-import
// time). Without this, `next build` tries to prerender it statically — which either
// fails outright against an unseeded DB, or bakes one build-time snapshot into static
// HTML forever against a seeded one, defeating the whole point of a "nightly" dashboard.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [pulse, period, sources] = await Promise.all([
    getPulse(LATEST_DATE),
    getPeriodMeta(SCORECARD_PERIOD_ID),
    getSourceSummary(SCORECARD_PERIOD_ID),
  ]);
  const importLabel = pulse.lastImportAt
    ? `${formatStamp(pulse.lastImportAt, { weekday: "short", month: "short", day: "numeric" })} · ${formatStamp(pulse.lastImportAt, { hour: "numeric", minute: "2-digit" })} ET`
    : "—";
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar
            pulseLabel={formatDay(LATEST_DATE, { month: "short", day: "numeric" })}
            scorecardLabel={period.short}
            sourcesLabel={`${sources.arrived}/${sources.total}`}
            importLabel={importLabel}
          />
          <main className="flex min-w-0 flex-1 flex-col">
            <div data-print-hide className="flex min-h-[30px] items-center justify-center gap-2 border-b border-line bg-surface-2 px-4 py-1 text-center text-xs text-ink-2">
              <span className="size-1.5 shrink-0 rounded-full bg-warn-icon" />
              <span><strong className="font-semibold text-ink">Demo</strong> · mock data run through the real parsers (README). No real customer data.</span>
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
