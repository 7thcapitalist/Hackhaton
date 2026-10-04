import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Public_Sans } from "next/font/google";
import "./globals.css";
import { NoData } from "@/components/NoData";
import { Sidebar } from "@/components/Sidebar";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { themeInitScript } from "@/components/ThemeToggle";
import { getDataRange, getSourcesScreen, periodLabel, periodShort, summarizeSources } from "./_lib/data";
import { formatDay, formatStamp } from "./_lib/format";

// Every page reads the database, so render on request (never at build time).
export const dynamic = "force-dynamic";

// Public Sans for everything (UI, headings and numbers, tabular figures on); Geist Mono only for
// ids and file names. next/font self-hosts both at build time. See docs/design/goodwill-theme.md.
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Mission Control – Goodwill Michiana",
  description: "Nightly pulse, COO scorecard and month-end close for Goodwill Michiana e-commerce.",
};

// Mobile browser chrome matches the near-white header (light) / near-black header (dark).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#121418" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const range = await getDataRange();
  const sources = range ? summarizeSources((await getSourcesScreen(range, range.defaultPeriod)).sources) : null;
  return (
    <html lang="en" className={`${publicSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
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
            importLabel={range ? `${formatStamp(range.lastImportAt, { weekday: "short", month: "short", day: "numeric" })}, ${formatStamp(range.lastImportAt, { hour: "numeric", minute: "2-digit" })} ET` : null}
          />
          <main className="flex min-w-0 flex-1 flex-col">
            <p data-print-hide className="border-b border-line-2 px-4 py-1.5 text-[12px] text-ink-3 sm:px-8">
              <strong className="font-semibold text-ink-2">Demo:</strong> synthetic data. No real customer data.
            </p>
            <div className="mx-auto flex w-full max-w-[1320px] min-w-0 flex-1 flex-col">
              {range ? children : <NoData />}
            </div>
          </main>
        </div>
        <ChatBubble />
      </body>
    </html>
  );
}
