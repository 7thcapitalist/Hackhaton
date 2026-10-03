"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { buttonClass } from "@/components/Button";
import { DrillDownDrawer, type DrawerContent } from "@/components/DrillDownDrawer";
import { HeroStat } from "@/components/HeroStat";
import { DownloadIcon, MailIcon, WarnIcon } from "@/components/icons";
import { PeriodStepper } from "@/components/PeriodStepper";
import { PulseChart } from "@/components/PulseChart";
import { PulseTable, type PulseField } from "@/components/PulseTable";
import { CHANNELS, getOrders, lastReceivedBefore } from "../_lib/demo-data";
import { formatDay, formatDayLong, formatInt, formatMoney, formatMoneyCompact, pctChange } from "../_lib/format";
import type { ChannelId, PulseSeries, PulseTotals, PulseView } from "../_lib/types";

type PulseScreenProps = {
  view: PulseView;
  compare: { date: string; totals: PulseTotals | null }; // same weekday last week, same channels
  series: PulseSeries;
  prevDate: string | null;
  nextDate: string | null;
  latestDate: string;
};

type DrawerState = { channel: ChannelId | "total"; field: PulseField } | { channel: ChannelId; missing: true } | null;

const FIELD_NAME: Record<PulseField, string> = { revenue: "Revenue", customers: "Customers", orders: "Orders" };
const href = (date: string) => `/pulse?date=${date}`;

export function PulseScreen({ view, compare, series, prevDate, nextDate, latestDate }: PulseScreenProps) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const close = useCallback(() => setDrawer(null), []);
  const date = view.businessDate;
  const dateLong = formatDayLong(date);
  const dateShort = formatDay(date);
  const reporting = view.rows.filter(r => r.status === "ok");
  const missing = view.rows.filter(r => r.status === "missing");
  const T = view.totals;
  const C = compare.totals;

  const drawerContent = useMemo(() => drawer && buildDrawer(drawer, view), [drawer, view]);

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
            {date !== latestDate && <Link href={href(latestDate)} className="text-[12.5px] font-medium text-accent hover:text-ink">Jump to latest →</Link>}
          </div>
        </div>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          {/* Export routes are Denis's lane (docs/interfaces.md §3). */}
          <a href={`/api/export/pulse?date=${date}&format=csv`} className={buttonClass("secondary")}><DownloadIcon />Export CSV</a>
          <a href={`/api/export/pulse?date=${date}&format=xlsx`} className={buttonClass("secondary")}><DownloadIcon />Export XLSX</a>
          <button type="button" onClick={emailPulse} className={buttonClass("primary", "px-[15px]")}><MailIcon />Email this pulse</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <HeroStat label="E-commerce revenue" value={formatMoneyCompact(T.revenueCents)} traceLabel={`${reporting.length} files`}
          changePct={C ? pctChange(T.revenueCents, C.revenueCents) : null} comparedTo={C ? formatDay(compare.date) : "prior week"} onOpen={() => openCell("total", "revenue")} />
        <HeroStat label="Customers" value={formatInt(T.customers)} traceLabel="unique buyers"
          changePct={C ? pctChange(T.customers, C.customers) : null} comparedTo={C ? formatDay(compare.date) : "prior week"} onOpen={() => openCell("total", "customers")} />
        <HeroStat label="Orders" value={formatInt(T.orders)} traceLabel={`${formatInt(T.orders)} rows`}
          changePct={C ? pctChange(T.orders, C.orders) : null} comparedTo={C ? formatDay(compare.date) : "prior week"} onOpen={() => openCell("total", "orders")} />
      </div>

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

function buildDrawer(state: NonNullable<DrawerState>, view: PulseView): DrawerContent {
  const date = view.businessDate;
  if ("missing" in state) {
    const c = CHANNELS.find(x => x.id === state.channel)!;
    const row = view.rows.find(r => r.channelId === state.channel)!;
    const last = lastReceivedBefore(state.channel, date);
    return {
      kind: "missing", title: `${c.label} · no file yet`, expectedFile: row.sourceFile, feeds: c.sublabel,
      lastReceived: last ? `${formatDay(last)} at ${c.importedAt} ET` : "—",
    };
  }
  const rows = view.rows.filter(r => r.status === "ok" && (state.channel === "total" || r.channelId === state.channel));
  const orders = rows.flatMap(r => getOrders(r.channelId, date)).sort((a, b) => a.minute - b.minute);
  const rev = rows.reduce((a, r) => a + r.revenueCents!, 0);
  const ords = rows.reduce((a, r) => a + r.orders!, 0);
  const custs = rows.reduce((a, r) => a + r.customers!, 0);
  const one = state.channel === "total" ? null : rows[0];
  return {
    kind: "rows",
    title: `${one ? one.label : "Total e-commerce"} · ${FIELD_NAME[state.field]}`,
    value: state.field === "revenue" ? formatMoney(rev) : state.field === "customers" ? formatInt(custs) : formatInt(ords),
    caption: state.field === "customers" ? `${formatInt(custs)} unique buyers across ${formatInt(ords)} orders` : `${formatInt(ords)} orders · net of marketplace fees`,
    fileLabel: one ? one.sourceFile : `${rows.length} source files`,
    fileMeta: one ? `Imported ${one.importedAt} ET · ${formatInt(ords)} rows` : rows.map(r => r.label).join(" · "),
    orders, totalNetCents: rev,
  };
}
