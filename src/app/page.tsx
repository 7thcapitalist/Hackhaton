import Link from "next/link";
import type { ReactNode } from "react";
import { CheckIcon, ClockIcon, WarnIcon } from "@/components/icons";
import { Sparkline } from "@/components/Sparkline";
import { SourceStrip } from "@/components/SourceStrip";
import {
  CHANNELS, LAST_IMPORT_AT, LATEST_DATE, SCORECARD_PERIOD, SOURCES, SOURCES_DUE,
  getPulse, getPulseSeries, getPulseTotalsFor, getScorecard, getSourceSummary,
} from "./_lib/demo-data";
import { formatDay, formatInt, formatKpiShort, formatMoneyCompact, formatStampFull, pctChange, shiftDay, TRACK, trackStatus } from "./_lib/format";

export default function OverviewPage() {
  const pulse = getPulse(LATEST_DATE);
  const reporting = pulse.rows.filter(r => r.status === "ok").map(r => r.channelId);
  const cmpDate = shiftDay(LATEST_DATE, -7);
  const cmp = getPulseTotalsFor(cmpDate, reporting);
  const change = cmp ? pctChange(pulse.totals.revenueCents, cmp.revenueCents) : null;
  const series = getPulseSeries();
  const dailyTotals = series.dates.map((_, i) => series.series.reduce((a, s) => a + (s.revenueCents[i] ?? 0), 0));
  const missingLabels = pulse.rows.filter(r => r.status === "missing").map(r => r.label);

  const { kpis } = getScorecard();
  const tracks = kpis.map(k => trackStatus(k));
  const count = (t: string) => tracks.filter(x => x === t).length;
  const anchors = kpis.filter(k => k.anchor2027);
  const awaitingKpis = kpis.filter(k => k.value == null);

  const src = getSourceSummary();

  return (
    <div className="flex flex-col gap-7 px-4 pt-8 pb-12 sm:px-8 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-[640px] flex-col gap-1.5">
          <p className="text-[12.5px] font-medium text-ink-3">Goodwill Michiana · e-commerce</p>
          <h1 className="text-[28px] leading-[1.12] font-semibold tracking-[-0.025em] text-balance sm:text-[34px]">A month at Goodwill, without the spreadsheets.</h1>
          <p className="mt-1 text-[15px] text-pretty text-ink-2">Nine marketplace reports, imported every night. One place to see the day, the month, and where each number came from.</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <p className="flex items-center gap-[7px] text-[13px] text-ink-2"><CheckIcon className="size-3.5 text-ok" />Last updated <strong className="font-semibold text-ink">{formatStampFull(LAST_IMPORT_AT)}</strong></p>
          <div className="flex items-center gap-2.5 text-[12.5px] text-ink-3">
            <SourceStrip sources={SOURCES} size="sm" />
            <span>{src.arrived} of {src.total} sources received for {SCORECARD_PERIOD.label.split(" ")[0]}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <OverviewCard href="/pulse" title="Daily Pulse" meta={formatDay(LATEST_DATE)}
          value={formatMoneyCompact(pulse.totals.revenueCents)} caption="e-commerce revenue yesterday"
          footerLeft={missingLabels.length
            ? <span className="flex items-center gap-1.5 text-warn"><WarnIcon className="size-[13px] text-warn-icon" />{missingLabels.join(", ")} awaiting data</span>
            : <span className="text-ink-3">All {CHANNELS.length} marketplaces reporting</span>}>
          <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
            {change != null && (
              <span className={`rounded-full px-[7px] py-0.5 font-semibold ${change >= 0 ? "bg-ok-soft text-ok" : "bg-muted-soft text-ink-2"}`}>{change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(1)}%</span>
            )}
            vs {formatDay(cmpDate)} · {formatInt(pulse.totals.customers)} customers · {formatInt(pulse.totals.orders)} orders
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
            <div className="flex justify-between gap-3"><dt className="text-ink-2">With warnings</dt><dd className="text-right font-medium">{src.warnings.map(s => s.name).join(", ") || "None"}</dd></div>
          </dl>
        </OverviewCard>
      </div>

      <section className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-xs" aria-labelledby="attention">
        <h2 id="attention" className="border-b border-line px-[22px] py-3.5 text-sm font-semibold">Needs attention</h2>
        <ul>
          {missingLabels.map(label => (
            <AttentionRow key={label} href="/pulse" where="Daily Pulse" icon={<WarnIcon className="size-[15px] text-warn-icon" />}>
              <strong className="font-semibold">{label}</strong> file for {formatDay(LATEST_DATE)} hasn&apos;t arrived. Totals exclude it.
            </AttentionRow>
          ))}
          {src.warnings.map(s => (
            <AttentionRow key={s.id} href="/sources#issues" where="Data Sources" icon={<WarnIcon className="size-[15px] text-warn-icon" />}>
              <strong className="font-semibold">{s.name}</strong> has {s.openIssues} open warning{s.openIssues > 1 ? "s" : ""}.{s.impact && ` ${s.impact}`}
            </AttentionRow>
          ))}
          {awaitingKpis.map(k => (
            <AttentionRow key={k.id} href="/scorecard" where="Scorecard" icon={<ClockIcon className="size-[15px] text-muted" />}>
              <strong className="font-semibold">{k.label}</strong> is awaiting data.{k.note && ` ${k.note}`}
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
