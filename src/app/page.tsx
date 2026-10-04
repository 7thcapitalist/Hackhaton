import Link from "next/link";
import type { ReactNode } from "react";
import { getOrders, ORDERS_MAX_LIMIT } from "@/lib/views";
import { CheckIcon, ClockIcon, WarnIcon } from "@/components/icons";
import { SourceStrip } from "@/components/SourceStrip";
import { CHANNELS, GROUP_MEMBERS } from "./_lib/channels";
import { getDataRange, getPulseScreen, getScorecardScreen, getSourcesScreen, periodLabel, summarizeSources } from "./_lib/data";
import { formatDay, formatKpiShort, formatStampFull, TRACK, trackStatus } from "./_lib/format";
import { OverviewHero, type OrderLike } from "./OverviewHero";
import type { ChannelId } from "./_lib/types";

/** The pulse-row label for a raw order channel (e.g. "goodwill_books" -> "Other e-comm"),
 * mirroring _lib/data.ts's own grouping (not exported from there, so kept local — this file
 * only reads CHANNELS/GROUP_MEMBERS, shared read-only metadata, not Gabriel's data.ts). */
function groupLabel(raw: ChannelId): string {
  return CHANNELS.find(c => (GROUP_MEMBERS[c.id] ?? [c.id]).includes(raw))?.label ?? raw;
}

export default async function OverviewPage() {
  const range = (await getDataRange())!; // the layout shows NoData when null
  const latest = range.completeDate;
  const period = range.defaultPeriod;
  const [pulseData, { kpis }, sourcesData] = await Promise.all([
    getPulseScreen(range, latest), getScorecardScreen(period), getSourcesScreen(range, period),
  ]);
  const pulse = pulseData.view;
  const cmpDate = pulseData.compare?.date ?? null;
  const series = pulseData.series;
  const dailyTotals = series.dates.map((_, i) => series.series.reduce((a, s) => a + (s.revenueCents[i] ?? 0), 0));
  const missingLabels = pulse.rows.filter(r => r.status === "missing").map(r => r.label);

  // For the hero's marketplace/category filter (Overview-only; see OverviewHero.tsx). Reuses
  // pulseData.orders already fetched above; the one extra fetch is cmpDate's orders, needed
  // only so a filtered view can still show a "vs last week" comparison.
  const channelOptions = pulse.rows.filter(r => r.status === "ok").map(r => ({ id: r.channelId, label: r.label }));
  const cmpOrdersRaw = cmpDate ? await getOrders({ date: cmpDate, limit: ORDERS_MAX_LIMIT }) : null;
  const cmpOrders: OrderLike[] | null = cmpOrdersRaw
    ? cmpOrdersRaw.rows.map(o => ({ channelLabel: groupLabel(o.channel), category: o.category ?? "Uncategorized", netCents: o.netCents, status: o.status, orderId: o.externalOrderId }))
    : null;

  // Missing marketplace files in the last 7 days (before the latest day, which is covered above).
  const recentGaps = series.dates.flatMap((d, i) => (d < latest && i >= series.dates.length - 8)
    ? series.series.filter(s => s.revenueCents[i] == null).map(s => ({ date: d, label: s.label })) : []);

  const anchors = kpis.filter(k => k.anchor2027);
  const anchorsBehind = anchors.filter(k => ["near", "off"].includes(trackStatus(k)));
  const awaitingKpis = kpis.filter(k => k.value == null);

  const SOURCES = sourcesData.sources;
  const src = summarizeSources(SOURCES);
  const SCORECARD_PERIOD = { label: periodLabel(period) };

  return (
    <div className="flex flex-col gap-7 px-4 pt-8 pb-12 sm:px-8 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-[640px] flex-col gap-1.5">
          <p className="text-[12.5px] font-medium text-ink-3">Goodwill Michiana · e-commerce</p>
          <h1 className="text-[28px] leading-[1.12] font-semibold tracking-[-0.025em] text-balance sm:text-[34px]">A month at Goodwill, without the spreadsheets.</h1>
          <p className="mt-1 text-[15px] text-pretty text-ink-2">{src.total} data sources (marketplaces, shipping, labor and bank), imported every night. One place to see the day, the month, and where each number came from.</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <p className="flex items-center gap-[7px] text-[13px] text-ink-2"><CheckIcon className="size-3.5 text-ok" />Last updated <strong className="font-semibold text-ink">{formatStampFull(range.lastImportAt)}</strong></p>
          <div className="flex items-center gap-2.5 text-[12.5px] text-ink-3">
            <SourceStrip sources={SOURCES} size="sm" />
            <span>{src.arrived} of {src.total} sources received for {SCORECARD_PERIOD.label.split(" ")[0]}</span>
          </div>
        </div>
      </div>

      <OverviewHero
        date={latest}
        cmpDate={cmpDate}
        channelOptions={channelOptions}
        totals={pulse.totals}
        compareChanges={pulseData.compare?.changes ?? null}
        orders={pulseData.orders}
        cmpOrders={cmpOrders}
        allDailyTotals={dailyTotals}
        channelSeries={series.series}
      />

      <nav aria-label="More views" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-[13px]">
        <span className="text-ink-3">More detail:</span>
        <Link href="/pulse" className="font-medium text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent">Daily Pulse →</Link>
        <Link href="/scorecard" className="font-medium text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent">COO Scorecard →</Link>
        <Link href="/sources" className="font-medium text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent">Data Sources →</Link>
      </nav>

      <section className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-xs" aria-labelledby="attention">
        <h2 id="attention" className="border-b border-line px-[22px] py-3.5 text-sm font-semibold">Needs attention</h2>
        <ul>
          {missingLabels.map(label => (
            <AttentionRow key={label} href="/pulse" where="Daily Pulse" icon={<WarnIcon className="size-[15px] text-warn-icon" />}>
              <strong className="font-semibold">{label}</strong> file for {formatDay(latest)} hasn&apos;t arrived. Totals exclude it.
            </AttentionRow>
          ))}
          {recentGaps.map(g => (
            <AttentionRow key={`${g.date}-${g.label}`} href={`/pulse?date=${g.date}`} where="Daily Pulse" icon={<WarnIcon className="size-[15px] text-warn-icon" />}>
              <strong className="font-semibold">{g.label}</strong> file for {formatDay(g.date)} never arrived. That day&apos;s totals exclude it.
            </AttentionRow>
          ))}
          {sourcesData.issues.slice(0, 4).map(i => (
            <AttentionRow key={`${i.source}-${i.text}`} href="/sources#issues" where="Data Sources" icon={<WarnIcon className="size-[15px] text-warn-icon" />}>
              <strong className="font-semibold">{i.source}</strong>: {i.text}
            </AttentionRow>
          ))}
          {sourcesData.issues.length > 4 && (
            <AttentionRow href="/sources#issues" where="Data Sources" icon={<WarnIcon className="size-[15px] text-warn-icon" />}>
              {sourcesData.issues.length - 4} more open issues on Data Sources.
            </AttentionRow>
          )}
          {anchorsBehind.map(k => (
            <AttentionRow key={k.id} href="/scorecard" where="Scorecard" icon={<ClockIcon className="size-[15px] text-muted" />}>
              <strong className="font-semibold">{k.label}</strong> is {formatKpiShort(k.unit, k.value)} vs a {formatKpiShort(k.unit, k.target)} target ({TRACK[trackStatus(k)].short}).
            </AttentionRow>
          ))}
          {awaitingKpis.map(k => (
            <AttentionRow key={k.id} href="/scorecard" where="Scorecard" icon={<ClockIcon className="size-[15px] text-muted" />}>
              <strong className="font-semibold">{k.label}</strong> is awaiting data.
            </AttentionRow>
          ))}
        </ul>
      </section>
    </div>
  );
}

function AttentionRow({ href, where, icon, children }: { href: string; where: string; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="border-b border-line-2 last:border-b-0">
      <Link href={href} className="grid grid-cols-[24px_1fr_auto] items-center gap-3 px-[22px] py-[13px] text-ink transition-colors hover:bg-surface-2">
        {icon}
        <span className="text-[13.5px]">{children}</span>
        <span className="hidden text-[12.5px] text-ink-3 sm:inline">{where}</span>
      </Link>
    </li>
  );
}
