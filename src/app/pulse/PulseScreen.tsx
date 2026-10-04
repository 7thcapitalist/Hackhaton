"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { buttonClass } from "@/components/Button";
import { DrillDownDrawer, type DrawerContent } from "@/components/DrillDownDrawer";
import { HeroStat } from "@/components/HeroStat";
import { ClockIcon, DownloadIcon, MailIcon, WarnIcon } from "@/components/icons";
import { PeriodStepper } from "@/components/PeriodStepper";
import { PulseChart } from "@/components/PulseChart";
import { PulseTable, type PulseField } from "@/components/PulseTable";
import type { PulseScreenData } from "../_lib/data";
import { formatDay, formatDayLong, formatInt, formatMoney, formatMoneyCompact, formatStamp } from "../_lib/format";
import type { ChannelId, PulseSeries, PulseView, SourceOrder } from "../_lib/types";

type PulseScreenProps = PulseScreenData & { latestDate: string }; // last complete day

type DrawerState = { channel: ChannelId | "total"; field: PulseField } | { channel: ChannelId; missing: true } | null;

const FIELD_NAME: Record<PulseField, string> = { revenue: "Revenue", customers: "Customers", orders: "Orders" };
const href = (date: string) => `/pulse?date=${date}`;

export function PulseScreen({ view, orders, ordersTotal, compare, series, prevDate, nextDate, isPartial, latestDate }: PulseScreenProps) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const close = useCallback(() => setDrawer(null), []);
  const date = view.businessDate;
  const dateLong = formatDayLong(date);
  const dateShort = formatDay(date);
  const reporting = view.rows.filter(r => r.status === "ok");
  const missing = view.rows.filter(r => r.status === "missing");
  const T = view.totals;
  const cmpLabel = compare ? formatDay(compare.date) : "prior week";
  const files = new Set(reporting.flatMap(r => r.sourceFiles)).size;

  const drawerContent = useMemo(() => drawer && buildDrawer(drawer, view, orders, ordersTotal, series), [drawer, view, orders, ordersTotal, series]);
  const openCell = (channel: ChannelId | "total", field: PulseField) => setDrawer({ channel, field });

  const emailPulse = () => {
    const subject = `Daily Pulse · ${dateShort}: ${formatMoneyCompact(T.revenueCents)} e-commerce revenue`;
    const body = `Daily Pulse for ${dateLong} (Eastern Time)\n\nRevenue: ${formatMoney(T.revenueCents)}\nCustomers: ${formatInt(T.customers)}\nOrders: ${formatInt(T.orders)}\n${missing.length ? `Awaiting data: ${missing.map(r => r.label).join(", ")}\n` : ""}\n${window.location.origin}${href(date)}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="flex flex-col gap-5 px-4 pt-7 pb-12 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-[12.5px] font-medium text-ink-3">Nightly close · all marketplaces</p>
            <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em]">Daily Pulse</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PeriodStepper label={dateLong} minWidth="200px"
              prevHref={prevDate && href(prevDate)} nextHref={nextDate && href(nextDate)}
              prevLabel="Previous day" nextLabel="Next day" />
            <span className="text-[12.5px] text-ink-3">Eastern Time (Indianapolis)</span>
            {date < latestDate && <Link href={href(latestDate)} className="text-[12.5px] font-medium text-accent hover:text-ink">Jump to latest →</Link>}
          </div>
        </div>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          {/* Export routes are Denis's lane (docs/interfaces.md §3). */}
          <a href={`/api/export/pulse?date=${date}&format=csv`} className={buttonClass("secondary")}><DownloadIcon />Export CSV</a>
          <a href={`/api/export/pulse?date=${date}&format=xlsx`} className={buttonClass("secondary")}><DownloadIcon />Export XLSX</a>
          <a href={`/api/export/pulse?date=${date}&format=pdf`} className={buttonClass("primary")}><DownloadIcon />Export PDF</a>
          <button type="button" onClick={emailPulse} className={buttonClass("primary", "px-[15px]")}><MailIcon />Email this pulse</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <HeroStat label="E-commerce revenue" value={formatMoneyCompact(T.revenueCents)} traceLabel={`${files} file${files === 1 ? "" : "s"}`}
          changePct={compare?.changes.revenue ?? null} comparedTo={cmpLabel} onOpen={() => openCell("total", "revenue")} />
        <HeroStat label="Customers" value={formatInt(T.customers)} traceLabel="1 per transaction"
          changePct={compare?.changes.customers ?? null} comparedTo={cmpLabel} onOpen={() => openCell("total", "customers")} />
        <HeroStat label="Orders" value={formatInt(T.orders)} traceLabel={`${formatInt(ordersTotal)} rows`}
          changePct={compare?.changes.orders ?? null} comparedTo={cmpLabel} onOpen={() => openCell("total", "orders")} />
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

      <PulseTable rows={view.rows} totals={T} dateLabel={dateShort} onCellClick={openCell} onMissingClick={channel => setDrawer({ channel, missing: true })} />

      <PulseChart data={series} selectedDate={date} onSelectDate={d => router.push(href(d), { scroll: false })} />

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
    caption: state.field === "customers" ? `${formatInt(custs)} customers (one per transaction) across ${formatInt(ords)} orders` : `${formatInt(ords)} orders · net of marketplace fees`,
    fileLabel: files.length === 1 ? files[0] : `${files.length} source files`,
    fileMeta: imported ? `Imported ${formatStamp(imported, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET · ${formatInt(mine.length)} rows` : `${formatInt(mine.length)} rows`,
    orders: mine,
    totalNetCents: rev,
    complete: orders.length >= ordersTotal,
  };
}
