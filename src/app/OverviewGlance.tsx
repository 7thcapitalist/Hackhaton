// "At a glance" row below the Overview hero. Adapts to the same marketplace/category
// filter OverviewHero owns: the first two panels are always "what this slice breaks down
// into" (a ranking when there's more than one thing to rank, a plain stat when the filter
// has already narrowed to one), the third is always "what changed the most", explained in
// a sentence, not a bare number. See OverviewHero.tsx's header for the redesign history.
//
// White-and-blue redesign (docs/design/goodwill-theme.md): the three panels are columns of
// one hairline-divided surface instead of three cards with colored icon badges. Rankings are
// small tables (name, orders, revenue, share) with a trackless bar under each name;
// marketplaces keep their series color as the bar and a swatch, categories stay plain ink.
// Numbers are set in the UI face with tabular figures, sized for reading, not for show.
import type { ReactNode } from "react";
import { biggestDriver, bucketBy, matches, rankMovers, sliceStats, type Bucket, type Driver, type Mover, type OrderLike } from "./_lib/overview-filters";
import { MARKET_THEME, type MarketKey } from "./_lib/overview-theme";
import { formatInt, formatMoney, formatMoneyCompact, pctChange } from "./_lib/format";

/** Change vs the comparison day as plain text: up in green, down in red (#53). */
export function ChangeText({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-ink-4">–</span>;
  const up = pct >= 0;
  return <span className={`font-medium ${up ? "text-ok" : "text-bad"}`}>{up ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%</span>;
}

type OverviewGlanceProps = {
  orders: OrderLike[];
  cmpOrders: OrderLike[] | null;
  channel: MarketKey | "all";
  channelLabel: string;
  category: string;
  comparedTo: string;
};

export function OverviewGlance({ orders, cmpOrders, channel, channelLabel, category, comparedTo }: OverviewGlanceProps) {
  const current = orders.filter(o => matches(o, channelLabel, category));
  const previous = cmpOrders?.filter(o => matches(o, channelLabel, category)) ?? null;

  if (channel === "all" && category === "all") {
    const byChannel = bucketBy(current, o => o.channelLabel);
    const byCategory = bucketBy(current, o => o.category);
    const movers = previous
      ? rankMovers(
          [...tag(byChannel, "m:"), ...tag(byCategory, "c:")],
          [...tag(bucketBy(previous, o => o.channelLabel), "m:"), ...tag(bucketBy(previous, o => o.category), "c:")],
        )
      : [];
    const headline = movers[0] ?? null;
    const dir = (headline && headline.pct < 0 ? -1 : 1) as 1 | -1;
    const driver = headline
      ? headline.key.startsWith("c:")
        ? biggestDriver(current, previous, o => o.category, headline.key.slice(2), o => o.channelLabel, dir)
        : biggestDriver(current, previous, o => o.channelLabel, headline.key.slice(2), o => o.category, dir)
      : null;
    return (
      <Row>
        <RankPanel title="Top marketplaces today" keyLabel="Marketplace" rows={byChannel} barColor={marketBarColor} />
        <RankPanel title="Top categories today" keyLabel="Category" rows={byCategory} limit={4} />
        <MoverPanel title="Biggest mover" movers={movers} comparedTo={comparedTo} describeKey={describeTaggedKey} driver={driver} />
      </Row>
    );
  }

  if (channel !== "all" && category === "all") {
    const byCategory = bucketBy(current, o => o.category);
    const stats = sliceStats(current);
    const prevStats = previous ? sliceStats(previous) : null;
    const movers = previous ? rankMovers(bucketBy(current, o => o.category), bucketBy(previous, o => o.category)) : [];
    return (
      <Row>
        <RankPanel title={`Top categories in ${channelLabel}`} keyLabel="Category" rows={byCategory} limit={4} barColor={() => MARKET_THEME[channel].accent} />
        <StatPanel title={`Average order in ${channelLabel}`} value={formatMoney(stats.avgCents)}
          changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
          secondary={`${formatMoneyCompact(stats.revenueCents)} total revenue`}
          caption={`${formatInt(stats.orders)} orders${stats.cancelled ? `, ${formatInt(stats.cancelled)} cancelled` : ""}`}
          stats={[{ label: "Unique customers", value: formatInt(stats.customers) }, { label: "Largest order", value: formatMoney(stats.maxCents) }]} />
        <MoverPanel title={`Biggest mover in ${channelLabel}`} movers={movers} comparedTo={comparedTo} describeKey={k => k} />
      </Row>
    );
  }

  if (channel === "all" && category !== "all") {
    const byChannel = bucketBy(current, o => o.channelLabel);
    const stats = sliceStats(current);
    const prevStats = previous ? sliceStats(previous) : null;
    const movers = previous ? rankMovers(bucketBy(current, o => o.channelLabel), bucketBy(previous, o => o.channelLabel)) : [];
    return (
      <Row>
        <RankPanel title={`Top marketplaces selling ${category}`} keyLabel="Marketplace" rows={byChannel} barColor={marketBarColor} />
        <StatPanel title={`Average order in ${category}`} value={formatMoney(stats.avgCents)}
          changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
          secondary={`${formatMoneyCompact(stats.revenueCents)} total revenue`}
          caption={`${formatInt(stats.orders)} orders${stats.cancelled ? `, ${formatInt(stats.cancelled)} cancelled` : ""}`}
          stats={[{ label: "Unique customers", value: formatInt(stats.customers) }, { label: "Largest order", value: formatMoney(stats.maxCents) }]} />
        <MoverPanel title={`Biggest mover for ${category}`} movers={movers} comparedTo={comparedTo} describeKey={k => k} />
      </Row>
    );
  }

  // Both filters set: a single slice, nothing left to rank.
  const stats = sliceStats(current);
  const prevStats = previous ? sliceStats(previous) : null;
  const revenueChangePct = pctChange(stats.revenueCents, prevStats?.revenueCents ?? null);
  return (
    <Row>
      <StatPanel title="Average order value" value={formatMoney(stats.avgCents)}
        changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
        secondary={`${formatMoneyCompact(stats.revenueCents)} total revenue`}
        caption={`${formatInt(stats.orders)} orders in ${channelLabel}, ${category}`}
        stats={[{ label: "Unique customers", value: formatInt(stats.customers) }, { label: "Largest order", value: formatMoney(stats.maxCents) }]} />
      <StatPanel title="Cancelled orders" value={formatInt(stats.cancelled)}
        changePct={null} comparedTo={comparedTo} caption={stats.cancelled ? `${(stats.cancelRate * 100).toFixed(1)}% of this slice` : "none in this slice"}
        stats={[{ label: "Live orders", value: formatInt(stats.orders) }, { label: "Unique customers", value: formatInt(stats.customers) }]} />
      <MoverPanel title="Change vs comparison day" comparedTo={comparedTo} describeKey={() => `${channelLabel}, ${category}`}
        movers={revenueChangePct == null || !prevStats ? [] : [{
          key: "slice", pct: revenueChangePct, currentCents: stats.revenueCents,
          previousCents: prevStats.revenueCents, currentOrders: stats.orders, previousOrders: prevStats.orders,
        }]} />
    </Row>
  );
}

function marketBarColor(key: string): string {
  const entry = Object.values(MARKET_THEME).find(m => m.label === key);
  return entry?.accent ?? MARKET_THEME.all.accent;
}

function tag(buckets: Bucket[], prefix: string): Bucket[] {
  return buckets.map(b => ({ ...b, key: `${prefix}${b.key}` }));
}

function describeTaggedKey(key: string): { label: string; hint: string } {
  if (key.startsWith("m:")) return { label: key.slice(2), hint: "marketplace" };
  if (key.startsWith("c:")) return { label: key.slice(2), hint: "category" };
  return { label: key, hint: "" };
}

/** One surface, three columns split by hairlines (stacked on phones). */
function Row({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-line rounded-lg border border-line bg-surface lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)] lg:divide-x lg:divide-y-0">
      {children}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 px-5 py-4">
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function RankPanel({ title, keyLabel, rows, limit = 6, barColor }: {
  title: string; keyLabel: string; rows: Bucket[]; limit?: number; barColor?: (key: string) => string;
}) {
  const shown = rows.slice(0, limit);
  const max = shown[0]?.revenueCents || 1;
  const rest = rows.length - shown.length;
  const totalCents = rows.reduce((a, r) => a + r.revenueCents, 0);
  const noun = keyLabel === "Category" ? ["category", "categories"] : ["marketplace", "marketplaces"];
  const avgCents = rows.length ? Math.round(totalCents / rows.length) : 0;
  return (
    <Panel title={title}>
      {shown.length === 0 ? <p className="text-[13px] text-ink-3">No orders in this slice.</p> : (
        <table className="w-full table-fixed border-collapse text-[13px]">
          <colgroup><col /><col className="w-[56px]" /><col className="w-[64px]" /><col className="w-[44px]" /></colgroup>
          <thead>
            <tr className="text-[11.5px] text-ink-3">
              <th scope="col" className="pb-1.5 text-left font-normal">{keyLabel}</th>
              <th scope="col" className="pb-1.5 text-right font-normal">Orders</th>
              <th scope="col" className="pb-1.5 text-right font-normal">Revenue</th>
              <th scope="col" className="pb-1.5 text-right font-normal">Share</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.key} className="border-t border-line-2 align-top">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="block truncate text-ink">{r.key}</span>
                  {/* Magnitude only: no background track, the column of bars is the comparison. */}
                  <span aria-hidden className="mt-1.5 block h-[3px] rounded-[1px]"
                    style={{ width: `${Math.max(3, Math.min(100, (r.revenueCents / max) * 100))}%`, backgroundColor: barColor ? barColor(r.key) : "var(--s2)" }} />
                </th>
                <td className="py-2 text-right text-ink-3">{formatInt(r.orders)}</td>
                <td className="py-2 text-right font-medium text-ink">{formatMoneyCompact(r.revenueCents)}</td>
                <td className="py-2 text-right text-ink-3">{totalCents > 0 ? `${Math.round((r.revenueCents / totalCents) * 100)}%` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {shown.length === 1 && <p className="text-[12px] text-ink-3">100% of revenue in this slice.</p>}
      {rest > 0 && <p className="text-[12px] text-ink-3">+{rest} more</p>}
      {shown.length > 0 && (
        <p className="mt-auto border-t border-line-2 pt-2 text-[12px] text-ink-3">
          <span className="font-medium text-ink">{formatInt(rows.length)}</span> {rows.length === 1 ? noun[0] : noun[1]}, average <span className="font-medium text-ink">{formatMoneyCompact(avgCents)}</span> per {noun[0]}
        </p>
      )}
    </Panel>
  );
}

function StatPanel({ title, value, changePct, comparedTo, caption, secondary, stats }: {
  title: string; value: string; changePct: number | null; comparedTo: string; caption: string; secondary?: string;
  stats?: { label: string; value: string }[]; // two more real numbers on the slice (#51)
}) {
  return (
    <Panel title={title}>
      <div className="flex flex-col gap-1">
        <span className="text-[24px] leading-none font-semibold tracking-[-0.02em] text-ink">{value}</span>
        {secondary && <span className="text-[13px] text-ink-2">{secondary}</span>}
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-3">
        {changePct != null && <><ChangeText pct={changePct} /><span>vs {comparedTo}.</span></>}
        <span>{caption}</span>
      </p>
      {stats && stats.length > 0 && (
        <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-line-2 pt-3">
          {stats.map(x => (
            <div key={x.label} className="flex flex-col gap-0.5">
              <dt className="text-[12px] text-ink-3">{x.label}</dt>
              <dd className="text-[15px] font-semibold text-ink">{x.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

/** Why the headline moved, from its own numbers (#53): the sub-bucket that drove it in the same
 * direction when one exists, else whether order volume or order value accounts for most of it. */
function moverExplanation(mover: Mover, driver: Driver | null, comparedTo: string): string {
  if (driver) {
    const sign = driver.deltaCents >= 0 ? "+" : "−";
    return `Mainly ${driver.deltaCents >= 0 ? "a jump" : "a drop"} in ${driver.label} (${sign}${formatMoneyCompact(Math.abs(driver.deltaCents))} vs ${comparedTo}).`;
  }
  if (mover.previousOrders === 0) return `New vs ${comparedTo}: ${formatInt(mover.currentOrders)} order${mover.currentOrders === 1 ? "" : "s"}, nothing to compare against.`;
  const avgPrev = mover.previousCents / mover.previousOrders;
  const avgCur = mover.currentOrders ? mover.currentCents / mover.currentOrders : 0;
  const ordersEffect = (mover.currentOrders - mover.previousOrders) * avgPrev;
  const avgEffect = (avgCur - avgPrev) * mover.currentOrders;
  return Math.abs(ordersEffect) >= Math.abs(avgEffect)
    ? `Mainly order volume: ${formatInt(mover.previousOrders)} to ${formatInt(mover.currentOrders)} orders vs ${comparedTo}.`
    : `Mainly order value: average order ${formatMoney(avgPrev)} to ${formatMoney(avgCur)} vs ${comparedTo}.`;
}

/** The biggest swing, explained in a sentence, then up to 3 runners-up (rankMovers order; #47). */
function MoverPanel({ title, movers, comparedTo, describeKey, driver = null }: {
  title: string;
  movers: Mover[];
  driver?: Driver | null; // what caused the headline swing, when a second dimension is free (#53)
  comparedTo: string;
  describeKey: (key: string) => string | { label: string; hint: string };
}) {
  const mover = movers[0] ?? null;
  const others = movers.slice(1, 4);
  const nameOf = (key: string) => { const d = describeKey(key); return typeof d === "string" ? d : d.label; };
  const described = mover ? describeKey(mover.key) : null;
  const label = described == null ? null : typeof described === "string" ? described : described.label;
  const hint = described == null || typeof described === "string" ? null : described.hint;
  const up = (mover?.pct ?? 0) >= 0;
  const verb = up ? "jumped" : "fell";
  return (
    <Panel title={title}>
      {!mover ? <p className="text-[13px] text-ink-3">Not enough data yet to compare.</p> : (
        <>
          <span className={`text-[24px] leading-none font-semibold tracking-[-0.02em] ${up ? "text-ok" : "text-bad"}`}>
            {up ? "↑" : "↓"} {Math.abs(mover.pct).toFixed(1)}%
          </span>
          <p className="text-[13px] text-pretty text-ink-2">
            <span className="font-medium text-ink">{label}</span>{hint && <span className="text-ink-3"> ({hint})</span>} {verb} {Math.abs(mover.pct).toFixed(1)}% vs {comparedTo}, to {formatMoneyCompact(mover.currentCents)} today.
          </p>
          {others.length > 0 && (
            <ul className="flex flex-col text-[13px]">
              {others.map(m => (
                <li key={m.key} className="flex items-baseline justify-between gap-3 border-t border-line-2 py-1.5">
                  <span className="truncate text-ink-2">{nameOf(m.key)}</span>
                  <ChangeText pct={m.pct} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {mover && <p className="mt-auto border-t border-line-2 pt-2 text-[12px] text-pretty text-ink-3">{moverExplanation(mover, driver, comparedTo)}</p>}
    </Panel>
  );
}
