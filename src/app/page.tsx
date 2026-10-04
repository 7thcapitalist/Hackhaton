import { getOrders, ORDERS_MAX_LIMIT, type OrdersView } from "@/lib/views";
import { ButtonLink } from "@/components/Button";
import { CheckIcon } from "@/components/icons";
import { SourceStrip } from "@/components/SourceStrip";
import { customerKeyOf, getDataRange, getPulseScreen, getSourcesScreen, periodLabel, summarizeSources } from "./_lib/data";
import { formatStampFull } from "./_lib/format";
import { MARKET_ORDER, MARKET_THEME, type MarketKey } from "./_lib/overview-theme";
import { OverviewHero, type OrderLike } from "./OverviewHero";

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
  // folded into "Other e-comm"; see rawOrderLike's comment above). cmpOrders is the same
  // query one week back, needed only so a filtered view can still show a "vs last week"
  // comparison.
  const [ordersRaw, cmpOrdersRaw] = await Promise.all([
    getOrders({ date: latest, limit: ORDERS_MAX_LIMIT }),
    cmpDate ? getOrders({ date: cmpDate, limit: ORDERS_MAX_LIMIT }) : Promise.resolve(null),
  ]);
  const orders: OrderLike[] = ordersRaw.rows.map(rawOrderLike);
  const cmpOrders: OrderLike[] | null = cmpOrdersRaw ? cmpOrdersRaw.rows.map(rawOrderLike) : null;
  const presentKeys = new Set(ordersRaw.rows.map(marketKeyOf));
  const channelOptions = MARKET_ORDER.filter(id => presentKeys.has(id)).map(id => ({ id, label: MARKET_THEME[id].label }));

  const SOURCES = sourcesData.sources;
  const src = summarizeSources(SOURCES);
  const SCORECARD_PERIOD = { label: periodLabel(period) };

  return (
    <div className="flex flex-col gap-5 px-4 pt-5 pb-6 sm:px-8 sm:pt-6">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="flex max-w-[62ch] flex-col gap-1">
          <h1 className="text-[22px] leading-tight text-ink sm:text-[24px]">Goodwill Mission Control</h1>
          <p className="text-[13.5px] text-pretty text-ink-3">{src.total} sources, imported nightly — the day, the month, and the number behind it.</p>
        </div>
        <div className="flex flex-col gap-1.5 text-[12.5px] sm:items-end">
          <p className="flex items-center gap-1.5 text-ink-3">
            <CheckIcon className="size-3.5 text-ok" />Last updated <span className="font-medium text-ink">{formatStampFull(range.lastImportAt)}</span>
          </p>
          <div className="flex items-center gap-2.5 text-ink-3">
            <SourceStrip sources={SOURCES} size="sm" />
            <span>{src.arrived} of {src.total} sources received for {SCORECARD_PERIOD.label.split(" ")[0]}</span>
          </div>
        </div>
      </header>

      <OverviewHero
        date={latest}
        cmpDate={cmpDate}
        channelOptions={channelOptions}
        totals={pulse.totals}
        compareChanges={pulseData.compare?.changes ?? null}
        orders={orders}
        cmpOrders={cmpOrders}
      />

      <nav aria-label="More views" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
        <span className="mr-1 text-[12.5px] text-ink-3">More detail</span>
        <ButtonLink href="/pulse" variant="secondary">Daily Pulse</ButtonLink>
        <ButtonLink href="/scorecard" variant="secondary">Monthly report</ButtonLink>
        <ButtonLink href="/sources" variant="secondary">Data Sources</ButtonLink>
      </nav>
    </div>
  );
}
