import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Barlow_Condensed, Figtree, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NoData } from "@/components/NoData";
import { Sidebar } from "@/components/Sidebar";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { themeInitScript } from "@/components/ThemeToggle";
import { getDataRange, getSourcesScreen, periodLabel, periodShort, summarizeSources } from "./_lib/data";
import { formatDay, formatStamp } from "./_lib/format";

// Every page reads the database, so render on request (never at build time).
export const dynamic = "force-dynamic";

// Free stand-ins for Goodwill's licensed faces: Figtree for Filson Pro (UI), Barlow Condensed
// for Atrament (page titles and hero numbers only). See docs/design/goodwill-theme.md.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-barlow-condensed" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Mission Control – Goodwill Michiana",
  description: "Nightly pulse, COO scorecard and month-end close for Goodwill Michiana e-commerce.",
};

// Mobile browser chrome matches the blue rail (light) / navy rail (dark).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#01529c" },
    { media: "(prefers-color-scheme: dark)", color: "#0f2b4a" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const range = await getDataRange();
  const sources = range ? summarizeSources((await getSourcesScreen(range, range.defaultPeriod)).sources) : null;
  return (
    <html lang="en" className={`${figtree.variable} ${barlowCondensed.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar
            pulseLabel={range ? formatDay(range.completeDate, { month: "short", day: "numeric" }) : ""}
            scorecardLabel={range ? periodShort(range.defaultPeriod) : ""}
            sourcesLabel={sources ? `${periodShort(range!.defaultPeriod)} ${sources.arrived}/${sources.total}` : "–"}
            sourcesHint={sources ? `${sources.arrived} of ${sources.total} data sources sent ${periodLabel(range!.defaultPeriod)} data` : undefined}
            importLabel={range ? `${formatStamp(range.lastImportAt, { weekday: "short", month: "short", day: "numeric" })} · ${formatStamp(range.lastImportAt, { hour: "numeric", minute: "2-digit" })} ET` : null}
          />
          <main className="flex min-w-0 flex-1 flex-col">
            <div data-print-hide className="flex min-h-[30px] items-center justify-center gap-2 border-b border-accent-line/60 bg-accent-soft px-4 py-1 text-center text-xs text-ink-2">
              <span className="size-1.5 shrink-0 rounded-full bg-warn-icon" />
              <span><strong className="font-semibold text-ink">Demo</strong> · synthetic data. No real customer data.</span>
            </div>
            {range ? children : <NoData />}
          </main>
        </div>
        <ChatBubble />
      </body>
    </html>
  );
}
