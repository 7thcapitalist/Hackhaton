"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buttonClass } from "@/components/Button";
import { DrillDownDrawer, type DrawerContent } from "@/components/DrillDownDrawer";
import { HeroStat } from "@/components/HeroStat";
import { ClockIcon, DownloadIcon, MailIcon, WarnIcon } from "@/components/icons";
import { DatePicker, type DayStatus } from "@/components/DatePicker";
import { PeriodStepper } from "@/components/PeriodStepper";
import { PrintButton } from "@/components/PrintButton";
import { PulseChart } from "@/components/PulseChart";
import { CategoryMixCard } from "@/components/CategoryMixCard";
import { MonthPaceCard } from "@/components/MonthPaceCard";
import { RevenueSplit } from "@/components/RevenueSplit";
import { NO_BUYER_ID, PulseTable, type PulseField } from "@/components/PulseTable";
import type { CategoryMix, MonthPace, PulseScreenData } from "../_lib/data";
import { formatDay, formatDayLong, formatInt, formatMoney, formatMoneyWhole, formatStamp } from "../_lib/format";
import { baselineLabel, buildPulseSummary, significance, weekdayOf, type PulseBaseline, type PulseMetric } from "./summary";
import type { ChannelId, PulseSeries, PulseView, SourceOrder } from "../_lib/types";

type PulseScreenProps = PulseScreenData & {
  baseline: PulseBaseline | null; pace: MonthPace; categoryMix: CategoryMix;
  latestDate: string; firstDate: string; days: DayStatus[]; today: string; // latestDate = latest completed close; the picker offers firstDate..latestDate
};

type DrawerState = { channel: ChannelId | "total"; field: PulseField } | { channel: ChannelId; missing: true } | null;

const FIELD_NAME: Record<PulseField, string> = { revenue: "Revenue", customers: "Unique customers", orders: "Orders" };
const href = (date: string) => `/pulse?date=${date}`;
const ADVANCED_KEY = "pulse-advanced"; // per-viewer preference, so the simple view stays the default

/** Simple view by default; "Advanced" adds exports, provenance, the full table and the charts. */
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

export function PulseScreen({ view, orders, ordersTotal, baseline, pace, categoryMix, series, prevDate, nextDate, isPartial, latestDate, firstDate, days, today }: PulseScreenProps) {
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
    <div className={`flex flex-col px-4 pt-7 pb-12 sm:px-8 ${advanced ? "gap-5" : "gap-6"}`}>
      <div className="flex flex-col gap-3">
        {/* Advanced is pinned top-right on the title row; nothing it toggles sits on that row, so it never moves. */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-[12.5px] font-medium text-ink-3">
              Nightly close · all marketplaces
              {advanced && <> · Eastern Time{dataAsOf && <> · Data as of {formatStamp(dataAsOf, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET ({files} file{files === 1 ? "" : "s"})</>}</>}
            </p>
            <h1 className="font-display text-[34px] leading-[1.05] font-semibold sm:text-[38px]">Daily Pulse</h1>
          </div>
          <label data-print-hide className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-ink-2 select-none hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
            <input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)} aria-describedby="advanced-hint"
              className="size-4 cursor-pointer accent-[var(--accent)] focus-visible:outline-none" />
            Advanced
            <span id="advanced-hint" className="sr-only">Show exports, data sources, the full marketplace table and the charts</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodStepper label={dateLong} minWidth="200px"
            center={<DatePicker label={dateLong} value={date} min={firstDate} max={latestDate} today={today} days={days} href={href} />}
            prevHref={prevDate && href(prevDate)} nextHref={nextDate && nextDate <= latestDate ? href(nextDate) : null}
            prevLabel="Previous day" nextLabel="Next day" />
          {date < latestDate && <Link href={href(latestDate)} className="text-[12.5px] font-medium text-accent hover:text-ink">Jump to latest</Link>}
          <div data-print-hide className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={emailPulse} className={buttonClass("primary", "px-[15px]")}><MailIcon />Email this pulse</button>
            {advanced && <>
              {/* 2026-10-04 (Ryan): Monthly report has a PDF download (PrintButton, src/components —
                  shared, not Gabriel- or Denis-exclusive) and Daily Pulse didn't. Same component
                  here. Round 2 (Ryan): grouped with the other downloads behind Advanced instead of
                  always visible — same reasoning as CSV/XLSX below. It's currently a plain
                  window.print() ("a generic PDF", per Ryan) — Denis is planning to swap this
                  mechanism so Print/PDF instead downloads the same PDF the daily email already
                  sends. Reusing the shared PrintButton rather than building a one-off here means
                  that fix lands for both Daily Pulse and Monthly at once, with no further change
                  needed on this end. */}
              <PrintButton />
              {/* Export routes are Denis's lane (docs/interfaces.md §3). */}
              <a href={`/api/export/pulse?date=${date}&format=csv`} className={buttonClass("secondary")}><DownloadIcon />Export CSV</a>
              <a href={`/api/export/pulse?date=${date}&format=xlsx`} className={buttonClass("secondary")}><DownloadIcon />Export XLSX</a>
            </>}
          </div>
        </div>
      </div>

      <p className={`max-w-[920px] leading-[1.5] font-medium text-pretty text-ink ${advanced ? "text-[17px]" : "text-[19px] sm:text-[21px]"}`}>{summary}</p>

      <div className={`grid grid-cols-1 md:grid-cols-3 ${advanced ? "gap-4" : "gap-5"}`}>
        <HeroStat label="E-commerce revenue" value={formatMoneyWhole(T.revenueCents)}
          change={change("revenue", T.revenueCents)} comparedTo={comparedTo("revenue", formatMoneyWhole)} onOpen={() => openCell("total", "revenue")} large={!advanced} />
        <HeroStat label="Unique customers" value={formatInt(T.customers)}
          change={change("customers", T.customers)} comparedTo={comparedTo("customers", formatInt)} onOpen={() => openCell("total", "customers")} large={!advanced} />
        <HeroStat label="Orders" value={formatInt(T.orders)}
          change={change("orders", T.orders)} comparedTo={comparedTo("orders", formatInt)} onOpen={() => openCell("total", "orders")} large={!advanced} />
      </div>

      {isPartial && (
        <div role="status" className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-2">
          <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-muted-soft text-muted"><ClockIcon className="size-3.5" /></span>
          <span><strong className="font-semibold text-ink">Partial day.</strong> These files arrived before the day ended, so the numbers will grow after tonight&apos;s import.</span>
        </div>
      )}

      {missing.length > 0 && (
        <div role="status" className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-2">
          <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-warn-soft text-warn-icon"><WarnIcon /></span>
          <span>
            <strong className="font-semibold text-ink">Totals cover {reporting.length} of {view.rows.length} marketplaces.</strong>{" "}
            {missing.map(r => r.label).join(", ")} {missing.length > 1 ? "are" : "is"} awaiting data and {missing.length > 1 ? "are" : "is"} not counted as $0. Comparisons use the same marketplaces.
          </span>
        </div>
      )}

      {advanced
        ? <PulseTable rows={view.rows} totals={T} dateLabel={dateShort} onCellClick={openCell} onMissingClick={channel => setDrawer({ channel, missing: true })} />
        : <RevenueSplit rows={view.rows} totalCents={T.revenueCents} />}

      {advanced && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <MonthPaceCard pace={pace} />
          <CategoryMixCard mix={categoryMix} dateLabel={dateShort} />
        </div>
      )}

      {advanced && <PulseChart data={series} selectedDate={date} lastCompleteDate={latestDate} onSelectDate={d => router.push(href(d), { scroll: false })} />}

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
