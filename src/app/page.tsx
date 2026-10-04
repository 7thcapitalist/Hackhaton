import { getOrders, ORDERS_MAX_LIMIT, type OrdersView } from "@/lib/views";
import { addDays } from "@/lib/views/dates";
import { ButtonLink } from "@/components/Button";
import { BarsIcon, CheckIcon, DatabaseIcon, PulseIcon } from "@/components/icons";
import { SourceStrip } from "@/components/SourceStrip";
import { customerKeyOf, getDataRange, getPulseScreen, getSourcesScreen, periodLabel, summarizeSources } from "./_lib/data";
import { formatStampFull } from "./_lib/format";
import { MARKET_ORDER, MARKET_THEME, type MarketKey } from "./_lib/overview-theme";
import { OverviewHero, type OrderLike } from "./OverviewHero";
import { weekdayOf } from "./pulse/summary";

/** Overview's own marketplace key, ungrouped and source-split — unlike Daily Pulse's
 * pre-grouped SourceOrder.channelLabel (_lib/data.ts's toSourceOrders folds Goodwill Books,
 * Cash Monkey and Upright all into "Other e-comm" for the pulse table), the filter here
 * needs every real source on its own so none of them hide inside a catch-all bucket.
 * channel="other" is itself a blend of two unrelated operations (Cash Monkey's own
 * storefront, Upright reselling across channels — see overview-theme.ts's MarketKey doc),
 * so it's split further by sourceId; the other four channels (which don't mix sources this
 * way) pass through unchanged. customerKeyOf is #33's shared unique-customer rule (buyer
 * per marketplace, else the transaction) — same definition Daily Pulse uses, applied here
 * so a filtered Overview slice never drifts from it. */
function marketKeyOf(o: OrdersView["rows"][number]): MarketKey {
  if (o.channel !== "other") return o.channel;
  return o.sourceId === "cashmonkey" ? "cashmonkey" : o.sourceId === "upright" ? "upright" : "other";
}

function rawOrderLike(o: OrdersView["rows"][number]): OrderLike {
  return {
    channelLabel: MARKET_THEME[marketKeyOf(o)].label,
    category: o.category ?? "Uncategorized",
    netCents: o.netCents,
    grossCents: o.grossCents,
    status: o.status,
    orderId: o.externalOrderId,
    customerKey: customerKeyOf(o),
  };
}

export default async function OverviewPage() {
  const range = (await getDataRange())!; // the layout shows NoData when null
  const latest = range.completeDate;
  const period = range.defaultPeriod;
  const [pulseData, sourcesData] = await Promise.all([
    getPulseScreen(range, latest), getSourcesScreen(range, period),
  ]);
  const pulse = pulseData.view;
  const cmpDate = pulseData.compare?.date ?? null;

  // For the hero's marketplace/category filter (Overview-only; see OverviewHero.tsx).
  // Fetched ungrouped — a second, cheap getOrders({date: latest}) call rather than reusing
  // pulseData.orders, because that one is pre-grouped for the pulse table (Goodwill Books
  // folded into "Other e-comm"; see rawOrderLike's comment above). The same weekday over the
  // previous 4 weeks feeds the "Biggest mover" card (like Daily Pulse's "vs a typical Friday");
  // the first of those is one week back, which cmpOrders reuses so a filtered view can still
  // show the hero's "vs last week" comparison.
  const weekdayDates = [1, 2, 3, 4].map(k => addDays(latest, -7 * k)).filter(d => d >= range.earliestDate);
  const [ordersRaw, ...earlierRaw] = await Promise.all([
    getOrders({ date: latest, limit: ORDERS_MAX_LIMIT }),
    ...weekdayDates.map(d => getOrders({ date: d, limit: ORDERS_MAX_LIMIT })),
  ]);
  const orders: OrderLike[] = ordersRaw.rows.map(rawOrderLike);
  const cmpOrdersRaw = cmpDate ? earlierRaw[weekdayDates.indexOf(cmpDate)] ?? null : null;
  const cmpOrders: OrderLike[] | null = cmpOrdersRaw ? cmpOrdersRaw.rows.map(rawOrderLike) : null;
  // A day with no orders at all is a day with no files (a missing day is not a $0 day), so it's left out of the average.
  const moverBaseline = earlierRaw.filter(v => v.rows.length > 0).map(v => v.rows.map(rawOrderLike));
  const presentKeys = new Set(ordersRaw.rows.map(marketKeyOf));
  const channelOptions = MARKET_ORDER.filter(id => presentKeys.has(id)).map(id => ({ id, label: MARKET_THEME[id].label }));

  const SOURCES = sourcesData.sources;
  const src = summarizeSources(SOURCES);
  const SCORECARD_PERIOD = { label: periodLabel(period) };

  return (
    <div className="flex flex-col gap-7 px-4 pt-8 pb-12 sm:px-8 sm:pt-10">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex max-w-[640px] flex-col gap-1.5">
          <p className="text-[12.5px] font-semibold text-ink-2">Goodwill Michiana · E-commerce operations</p>
          <h1 className="font-display text-[38px] leading-[1.02] font-semibold text-balance text-brand sm:text-[46px]">Goodwill Mission Control</h1>
          <p className="mt-1 text-[15px] text-pretty text-ink-2">{src.total} data sources (marketplaces, shipping, labor and bank), imported every night. One place to see the day, the month, and where each number came from.</p>
        </div>
        {/* Data freshness as one small panel, vertically centered on the title block (it used to
            wrap under the description and float there, aligned with nothing). */}
        <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3"><CheckIcon className="size-3.5 text-ok" />Last updated</span>
            <span className="text-[14px] font-semibold text-ink">{formatStampFull(range.lastImportAt)}</span>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-line pt-2.5 text-[12px] text-ink-3">
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
        orders={orders}
        cmpOrders={cmpOrders}
        moverBaseline={moverBaseline}
        weekday={weekdayOf(latest)}
      />

      <nav aria-label="More views" className="flex flex-col items-center gap-3 border-t border-line pt-6">
        <span className="text-[12px] font-medium text-ink-3">More detail</span>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <ButtonLink href="/pulse" variant="secondary" icon={<PulseIcon className="size-3.5" />}>Daily Pulse</ButtonLink>
          <ButtonLink href="/scorecard" variant="secondary" icon={<BarsIcon className="size-3.5" />}>Monthly report</ButtonLink>
          <ButtonLink href="/sources" variant="secondary" icon={<DatabaseIcon className="size-3.5" />}>Data Sources</ButtonLink>
        </div>
      </nav>
    </div>
  );
}
