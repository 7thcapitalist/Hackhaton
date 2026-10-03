import Link from "next/link";
import type { ReactNode } from "react";
import { getOrders, ORDERS_MAX_LIMIT } from "@/lib/views";
import { CheckIcon, ClockIcon, WarnIcon } from "@/components/icons";
import { Sparkline } from "@/components/Sparkline";
import { SourceStrip } from "@/components/SourceStrip";
import { CHANNELS, GROUP_MEMBERS } from "./_lib/channels";
import { getDataRange, getPulseScreen, getScorecardScreen, getSourcesScreen, periodLabel, summarizeSources } from "./_lib/data";
import { formatDay, formatInt, formatKpiShort, formatMoneyCompact, formatStampFull, TRACK, trackStatus } from "./_lib/format";
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
  const change = pulseData.compare?.changes.revenue ?? null;
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

  const tracks = kpis.map(k => trackStatus(k));
  const count = (t: string) => tracks.filter(x => x === t).length;
  const anchors = kpis.filter(k => k.anchor2027);
  const anchorsBehind = anchors.filter(k => ["near", "off"].includes(trackStatus(k)));
  const awaitingKpis = kpis.filter(k => k.value == null);

  const SOURCES = sourcesData.sources;
  const src = { ...summarizeSources(SOURCES), openIssues: sourcesData.openIssues };
  const SOURCES_DUE = sourcesData.dueLabel;
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <OverviewCard href="/pulse" title="Daily Pulse" meta={formatDay(latest)}
          value={formatMoneyCompact(pulse.totals.revenueCents)} caption={`e-commerce revenue on ${formatDay(latest, { month: "short", day: "numeric" })}`}
          footerLeft={missingLabels.length
            ? <span className="flex items-center gap-1.5 text-warn"><WarnIcon className="size-[13px] text-warn-icon" />{missingLabels.join(", ")} awaiting data</span>
            : <span className="text-ink-3">All {pulse.rows.length} marketplaces reporting</span>}>
          <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
            {change != null && (
              <span className={`rounded-full px-[7px] py-0.5 font-semibold ${change >= 0 ? "bg-ok-soft text-ok" : "bg-muted-soft text-ink-2"}`}>{change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(1)}%</span>
            )}
            {cmpDate && `vs ${formatDay(cmpDate)} · `}{formatInt(pulse.totals.customers)} customers · {formatInt(pulse.totals.orders)} orders
          </p>
          <Sparkline values={dailyTotals} height={56} />
        </OverviewCard>

        <OverviewCard href="/scorecard" title="COO Scorecard" meta={SCORECARD_PERIOD.label}
          value={`${count("on")} of ${kpis.length}`} caption="KPIs on track"
          footerLeft={<span className="text-ink-3">2027 plan anchors</span>}>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
            <span>{count("near")} near target</span><span aria-hidden>·</span><span>{count("off")} off track</span><span aria-hidden>·</span>
            <span>{count("awaiting")} awaiting</span><span aria-hidden>·</span><span>{count("none")} unscored</span>
          </p>
          <ul className="flex flex-col gap-[7px]">
            {anchors.map(k => {
              const t = TRACK[trackStatus(k)];
              return (
                <li key={k.id} className="flex justify-between gap-3 text-[13px]">
                  <span className="text-ink-2">{k.label}</span>
                  <span className="whitespace-nowrap"><strong className="font-semibold">{formatKpiShort(k.unit, k.value).replace("/hr", "")}</strong> <span className={`font-medium ${t.fg}`}>· {t.short}</span></span>
                </li>
              );
            })}
          </ul>
        </OverviewCard>

        <OverviewCard href="/sources" title="Data Sources" meta={SCORECARD_PERIOD.label}
          value={`${src.arrived} of ${src.total}`} caption="sources received"
          footerLeft={<span className="text-ink-3">{src.openIssues} open issues</span>}>
          <SourceStrip sources={SOURCES} size="lg" />
          <dl className="flex flex-col gap-[7px] text-[13px]">
            <div className="flex justify-between gap-3"><dt className="text-ink-2">Missing</dt><dd className="text-right font-medium">{src.missing.map(s => s.name).join(", ") || "None"}{src.missing.length > 0 && ` · due ${SOURCES_DUE}`}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-2">With warnings</dt><dd className="text-right font-medium">{src.warnings.length > 3 ? `${src.warnings.length} sources` : src.warnings.map(s => s.name).join(", ") || "None"}</dd></div>
          </dl>
        </OverviewCard>
      </div>

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

function OverviewCard({ href, title, meta, value, caption, footerLeft, children }: {
  href: string; title: string; meta: string; value: string; caption: string; footerLeft: ReactNode; children: ReactNode;
}) {
  return (
    <Link href={href} className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-surface px-6 py-[22px] text-ink shadow-xs transition-colors hover:border-accent-line focus-visible:outline-2 focus-visible:outline-accent">
      <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-semibold text-ink-2">{title}</span><span className="text-[12.5px] text-ink-3">{meta}</span></div>
      <div className="flex flex-col gap-1">
        <span className="text-[52px] leading-none font-semibold tracking-[-0.04em]">{value}</span>
        <span className="text-sm text-ink-2">{caption}</span>
      </div>
      {children}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line-2 pt-3 text-[13px]">
        {footerLeft}
        <span className="font-semibold text-accent">Open →</span>
      </div>
    </Link>
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
