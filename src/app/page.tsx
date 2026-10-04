import { getOrders, ORDERS_MAX_LIMIT, type OrdersView } from "@/lib/views";
import { ButtonLink } from "@/components/Button";
import { BarsIcon, CheckIcon, DatabaseIcon, PulseIcon } from "@/components/icons";
import { SourceStrip } from "@/components/SourceStrip";
import { CHANNEL_LABEL } from "./_lib/channels";
import { customerKeyOf, getDataRange, getPulseScreen, getSourcesScreen, periodLabel, summarizeSources } from "./_lib/data";
import { formatStampFull } from "./_lib/format";
import { MARKET_ORDER } from "./_lib/overview-theme";
import { OverviewHero, type OrderLike } from "./OverviewHero";

/** Overview's own marketplace label, ungrouped — unlike Daily Pulse's pre-grouped
 * SourceOrder.channelLabel (_lib/data.ts's toSourceOrders folds Goodwill Books into "Other
 * e-comm" for the pulse table), the filter here needs every real source on its own so none
 * of them hide inside a catch-all bucket. CHANNEL_LABEL is the shared, already-ungrouped
 * export _lib/channels.ts provides for exactly this. customerKeyOf is #33's shared
 * unique-customer rule (buyer per marketplace, else the transaction) — same definition
 * Daily Pulse uses, applied here so a filtered Overview slice never drifts from it. */
function rawOrderLike(o: OrdersView["rows"][number]): OrderLike {
  return { channelLabel: CHANNEL_LABEL[o.channel], category: o.category ?? "Uncategorized", netCents: o.netCents, status: o.status, orderId: o.externalOrderId, customerKey: customerKeyOf(o) };
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
  // folded into "Other e-comm"; see rawOrderLike's comment above). cmpOrders is the same
  // query one week back, needed only so a filtered view can still show a "vs last week"
  // comparison.
  const [ordersRaw, cmpOrdersRaw] = await Promise.all([
    getOrders({ date: latest, limit: ORDERS_MAX_LIMIT }),
    cmpDate ? getOrders({ date: cmpDate, limit: ORDERS_MAX_LIMIT }) : Promise.resolve(null),
  ]);
  const orders: OrderLike[] = ordersRaw.rows.map(rawOrderLike);
  const cmpOrders: OrderLike[] | null = cmpOrdersRaw ? cmpOrdersRaw.rows.map(rawOrderLike) : null;
  const presentChannels = new Set(ordersRaw.rows.map(o => o.channel));
  const channelOptions = MARKET_ORDER.filter(id => presentChannels.has(id)).map(id => ({ id, label: CHANNEL_LABEL[id] }));

  const SOURCES = sourcesData.sources;
  const src = summarizeSources(SOURCES);
  const SCORECARD_PERIOD = { label: periodLabel(period) };

  return (
    <div className="flex flex-col gap-7 px-4 pt-8 pb-12 sm:px-8 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-[640px] flex-col gap-1.5">
          <p className="text-[12.5px] font-semibold text-ink-2">Goodwill Michiana · E-commerce operations</p>
          <h1 className="font-display text-[38px] leading-[1.02] font-semibold text-balance text-brand sm:text-[46px]">Goodwill Mission Control</h1>
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
        orders={orders}
        cmpOrders={cmpOrders}
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
