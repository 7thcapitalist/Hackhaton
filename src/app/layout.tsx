import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { themeInitScript } from "@/components/ThemeToggle";
import { LAST_IMPORT_AT, LATEST_DATE, SCORECARD_PERIOD, getSourceSummary } from "./_lib/demo-data";
import { formatDay, formatStamp } from "./_lib/format";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Mission Control – Goodwill Michiana",
  description: "Nightly pulse, COO scorecard and month-end close for Goodwill Michiana e-commerce.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const sources = getSourceSummary();
  const importLabel = `${formatStamp(LAST_IMPORT_AT, { weekday: "short", month: "short", day: "numeric" })} · ${formatStamp(LAST_IMPORT_AT, { hour: "numeric", minute: "2-digit" })} ET`;
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar
            pulseLabel={formatDay(LATEST_DATE, { month: "short", day: "numeric" })}
            scorecardLabel={SCORECARD_PERIOD.short}
            sourcesLabel={`${sources.arrived}/${sources.total}`}
            importLabel={importLabel}
          />
          <main className="flex min-w-0 flex-1 flex-col">
            <div data-print-hide className="flex min-h-[30px] items-center justify-center gap-2 border-b border-line bg-surface-2 px-4 py-1 text-center text-xs text-ink-2">
              <span className="size-1.5 shrink-0 rounded-full bg-warn-icon" />
              <span><strong className="font-semibold text-ink">Demo</strong> · synthetic data. No real customer data.</span>
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
