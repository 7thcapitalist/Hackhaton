"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buttonClass } from "@/components/Button";
import { DrillDownDrawer, type DrawerContent } from "@/components/DrillDownDrawer";
import { HeroStat } from "@/components/HeroStat";
import { ClockIcon, DownloadIcon, MailIcon, WarnIcon } from "@/components/icons";
import { PeriodStepper } from "@/components/PeriodStepper";
import { PulseChart } from "@/components/PulseChart";
import { RevenueSplit } from "@/components/RevenueSplit";
import { NO_BUYER_ID, PulseTable, type PulseField } from "@/components/PulseTable";
import type { PulseScreenData } from "../_lib/data";
import { formatDay, formatDayLong, formatInt, formatMoney, formatMoneyWhole, formatStamp } from "../_lib/format";
import { baselineLabel, buildPulseSummary, significance, weekdayOf, type PulseBaseline, type PulseMetric } from "./summary";
import type { ChannelId, PulseSeries, PulseView, SourceOrder } from "../_lib/types";

type PulseScreenProps = PulseScreenData & { baseline: PulseBaseline | null; latestDate: string }; // latestDate = last complete day

type DrawerState = { channel: ChannelId | "total"; field: PulseField } | { channel: ChannelId; missing: true } | null;

const FIELD_NAME: Record<PulseField, string> = { revenue: "Revenue", customers: "Unique customers", orders: "Orders" };
const href = (date: string) => `/pulse?date=${date}`;
const ADVANCED_KEY = "pulse-advanced"; // per-viewer preference, so the simple view stays the default

/** Simple view by default; "Advanced" adds exports, provenance, the full table and the chart. */
function useAdvanced() {
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    try { setAdvanced(localStorage.getItem(ADVANCED_KEY) === "1"); } catch {}
  }, []);
  const set = (on: boolean) => {
    setAdvanced(on);
    try { localStorage.setItem(ADVANCED_KEY, on ? "1" : "0"); } catch {}
  };
  return [advanced, set] as const;
}

export function PulseScreen({ view, orders, ordersTotal, baseline, series, prevDate, nextDate, isPartial, latestDate }: PulseScreenProps) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [advanced, setAdvanced] = useAdvanced();
  const close = useCallback(() => setDrawer(null), []);
  const date = view.businessDate;
  const dateLong = formatDayLong(date);
  const dateShort = formatDay(date);
  const reporting = view.rows.filter(r => r.status === "ok");
  const missing = view.rows.filter(r => r.status === "missing");
  const T = view.totals;
  const weekday = weekdayOf(date);
  // Compared with the same weekday over the previous 4 weeks (fewer near the start of the data).
  const compared = baseline && baseline.dates.length > 0 ? baseline : null;
  const change = (metric: PulseMetric, value: number) => (compared ? significance(value, compared.stats[metric], weekday) : null);
  const comparedTo = (metric: PulseMetric, fmt: (v: number) => string) =>
    compared ? (advanced ? `${baselineLabel(compared)} (avg ${fmt(compared.stats[metric].mean)})` : `vs a typical ${weekday}`)
      : isPartial ? "partial day, not compared" : `no earlier ${weekday}s to compare`;
  const summary = buildPulseSummary({ date, partial: isPartial, rows: view.rows, totals: T, baseline });
  // When this day's files were imported (not the newest file of any day, which the sidebar shows).
  const files = new Set(reporting.flatMap(r => r.sourceFiles)).size;
  const dataAsOf = reporting.map(r => r.importedAt).filter((x): x is string => !!x).sort().pop();

  const drawerContent = useMemo(() => drawer && buildDrawer(drawer, view, orders, ordersTotal, series), [drawer, view, orders, ordersTotal, series]);
  const openCell = (channel: ChannelId | "total", field: PulseField) => setDrawer({ channel, field });

  const emailPulse = () => {
    const subject = `Daily Pulse · ${dateShort}: ${formatMoneyWhole(T.revenueCents)} e-commerce revenue`;
    const body = `${summary}\n\nDaily Pulse for ${dateLong} (Eastern Time)\n\nRevenue: ${formatMoney(T.revenueCents)}\nUnique customers: ${formatInt(T.customers)}\nOrders: ${formatInt(T.orders)}\n${missing.length ? `Awaiting data: ${missing.map(r => r.label).join(", ")}\n` : ""}\n${window.location.origin}${href(date)}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className={`flex flex-col px-4 pt-6 pb-12 sm:px-8 sm:pt-8 ${advanced ? "gap-5" : "gap-6"}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-line pb-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-[22px] leading-tight sm:text-[24px]">Daily Pulse</h1>
            <p className="text-[13px] text-ink-3">Nightly close, all marketplaces</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PeriodStepper label={dateLong} minWidth="200px"
              prevHref={prevDate && href(prevDate)} nextHref={nextDate && href(nextDate)}
              prevLabel="Previous day" nextLabel="Next day" />
            {advanced && (
              <span className="text-[12.5px] text-ink-3">
                Eastern Time{dataAsOf && <>. Data as of {formatStamp(dataAsOf, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET ({files} file{files === 1 ? "" : "s"})</>}
              </span>
            )}
            {date < latestDate && <Link href={href(latestDate)} className="rounded-sm text-[13px] font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent">Jump to latest</Link>}
          </div>
        </div>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-ink-2 select-none hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
            <input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)} aria-describedby="advanced-hint"
              className="size-3.5 cursor-pointer accent-[var(--accent)] focus-visible:outline-none" />
            Advanced
            <span id="advanced-hint" className="sr-only">Show exports, data sources, the full marketplace table and the 30-day chart</span>
          </label>
          {advanced && <>
            {/* Export routes are Denis's lane (docs/interfaces.md §3). */}
            <a href={`/api/export/pulse?date=${date}&format=csv`} className={buttonClass("secondary")}><DownloadIcon />Export CSV</a>
            <a href={`/api/export/pulse?date=${date}&format=xlsx`} className={buttonClass("secondary")}><DownloadIcon />Export XLSX</a>
          </>}
          <button type="button" onClick={emailPulse} className={buttonClass("primary")}><MailIcon />Email this pulse</button>
        </div>
      </header>

      <p className={`max-w-[72ch] leading-[1.55] text-pretty text-ink ${advanced ? "text-[15px]" : "text-[16px]"}`}>{summary}</p>

      <div className="grid grid-cols-1 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface md:grid-cols-3 md:divide-x md:divide-y-0">
        <HeroStat label="E-commerce revenue" value={formatMoneyWhole(T.revenueCents)}
          change={change("revenue", T.revenueCents)} comparedTo={comparedTo("revenue", formatMoneyWhole)} onOpen={() => openCell("total", "revenue")} large={!advanced} />
        <HeroStat label="Unique customers" value={formatInt(T.customers)}
          change={change("customers", T.customers)} comparedTo={comparedTo("customers", formatInt)} onOpen={() => openCell("total", "customers")} large={!advanced} />
        <HeroStat label="Orders" value={formatInt(T.orders)}
          change={change("orders", T.orders)} comparedTo={comparedTo("orders", formatInt)} onOpen={() => openCell("total", "orders")} large={!advanced} />
      </div>

      {isPartial && (
        <div role="status" className="flex items-start gap-2.5 rounded-md border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
          <ClockIcon className="mt-px size-4 shrink-0 text-muted" />
          <span><strong className="font-semibold text-ink">Partial day.</strong> These files arrived before the day ended, so the numbers will grow after tonight&apos;s import.</span>
        </div>
      )}

      {missing.length > 0 && (
        <div role="status" className="flex items-start gap-2.5 rounded-md border border-warn-icon/30 bg-warn-soft px-3.5 py-2.5 text-[13px] text-ink-2">
          <WarnIcon className="mt-0.5 size-3.5 shrink-0 text-warn-icon" />
          <span>
            <strong className="font-semibold text-ink">Totals cover {reporting.length} of {view.rows.length} marketplaces.</strong>{" "}
            {missing.map(r => r.label).join(", ")} {missing.length > 1 ? "are" : "is"} awaiting data and {missing.length > 1 ? "are" : "is"} not counted as $0. Comparisons use the same marketplaces.
          </span>
        </div>
      )}

      {advanced ? (
        <>
          <PulseTable rows={view.rows} totals={T} dateLabel={dateShort} onCellClick={openCell} onMissingClick={channel => setDrawer({ channel, missing: true })} />
          <PulseChart data={series} selectedDate={date} lastCompleteDate={latestDate} onSelectDate={d => router.push(href(d), { scroll: false })} />
        </>
      ) : (
        <RevenueSplit rows={view.rows} totalCents={T.revenueCents} />
      )}

      <DrillDownDrawer content={drawerContent} dateLong={dateLong} dateShort={dateShort} onClose={close} />
    </div>
  );
}

function buildDrawer(state: NonNullable<DrawerState>, view: PulseView, orders: SourceOrder[], ordersTotal: number, series: PulseSeries): DrawerContent {
  if ("missing" in state) {
    const row = view.rows.find(r => r.channelId === state.channel)!;
    const s = series.series.find(x => x.channelId === state.channel);
    const i = series.dates.findLastIndex((d, k) => d < view.businessDate && s?.revenueCents[k] != null);
    return {
      kind: "missing", title: `${row.label} · no file yet`, expectedFile: row.expectedFile ?? "A file for this day", feeds: row.sublabel,
      lastReceived: i >= 0 ? formatDay(series.dates[i]) : "—",
    };
  }
  const rows = view.rows.filter(r => r.status === "ok" && (state.channel === "total" || r.channelId === state.channel));
  const labels = new Set(rows.map(r => r.label));
  const mine = orders.filter(o => labels.has(o.channelLabel));
  const rev = rows.reduce((a, r) => a + (r.revenueCents ?? 0), 0);
  const ords = rows.reduce((a, r) => a + (r.orders ?? 0), 0);
  const custs = rows.reduce((a, r) => a + (r.customers ?? 0), 0);
  const one = state.channel === "total" ? null : rows[0];
  const files = [...new Set(rows.flatMap(r => r.sourceFiles))];
  const imported = rows.map(r => r.importedAt).filter((x): x is string => !!x).sort().pop();
  return {
    kind: "rows",
    title: `${one ? one.label : "Total e-commerce"} · ${FIELD_NAME[state.field]}`,
    value: state.field === "revenue" ? formatMoney(rev) : state.field === "customers" ? formatInt(custs) : formatInt(ords),
    caption: state.field === "customers" ? customersCaption(rows, custs, ords) : `${formatInt(ords)} orders · net of marketplace fees`,
    files,
    fileMeta: imported ? `Imported ${formatStamp(imported, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET · ${formatInt(mine.length)} rows` : `${formatInt(mine.length)} rows`,
    orders: mine,
    totalNetCents: rev,
    complete: orders.length >= ordersTotal,
  };
}

/** Option A (2026-10-03): unique buyers where the marketplace sends a buyer ID, one per transaction where it doesn't. */
function customersCaption(rows: PulseView["rows"], custs: number, ords: number) {
  const head = `${formatInt(custs)} unique customers across ${formatInt(ords)} orders`;
  const fallback = rows.map(r => NO_BUYER_ID[r.channelId]).filter((x): x is string => !!x);
  if (fallback.length === 0) return `${head}, counted as unique buyers.`;
  return `${head}. Unique buyers per marketplace, except where there is no buyer ID: ${fallback.join("; ")}, so each transaction counts as one customer.`;
}
