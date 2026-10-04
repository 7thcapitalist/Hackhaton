// "At a glance" row below the Overview hero. Adapts to the same marketplace/category
// filter OverviewHero owns: the first two cards are always "what this slice breaks down
// into" (a ranking when there's more than one thing to rank, a plain stat when the filter
// has already narrowed to one), the third is always "what changed the most" — explained in
// a sentence, not a bare number. 2026-10-03, three redesign passes — see OverviewHero.tsx's
// header for the full history. Round 4 (2026-10-04, Ryan: cards still reading as too white,
// no icons, no reaction to the marketplace filter):
//
// - Every card's title icon now sits in a colored badge (MARKET_THEME's soft/accent pair,
//   same tokens the hero cards use) instead of a flat gray glyph, and the card's border picks
//   up that marketplace's own color once one is filtered — the same reactive identity
//   OverviewHero.tsx now carries, so the whole page recolors together, not just the top.
// - Marketplace rankings carry each marketplace's own color (MARKET_THEME) in their bars;
//   category rankings carry each category's own icon (overview-theme.ts) — the same identity
//   the filter pills use, so selecting something and seeing it ranked feel like the same
//   language.
// - The single-marketplace/single-category stat cards no longer just restate the hero's
//   order count a third time (filtering to one marketplace makes "customers" and "orders"
//   numerically identical by construction — OverviewHero.tsx now swaps that hero slot for
//   fees & refunds instead) — they lead with average order value, add a total-revenue line
//   so there's a second real number in the card, and surface cancelled orders.
// - The mover card leads with the number, then one plain-language sentence explaining it,
//   instead of a label line and a caption line.
//
// 2026-10-04, round 5 (Ryan, pointing at this exact card: most of it was blank). The grid
// row stretches every card to match its tallest sibling (CSS grid's default
// align-items:stretch) — the mover card's content (an icon, one big number, one sentence)
// is much shorter than "Top marketplaces today"'s 6-row ranking next to it, so the gap was
// genuine empty space below real content, not a color/icon problem. Fixed at the source: the
// mover card now shows its runners-up too (rankMovers' full ranked list, not just index 0),
// the same "more real numbers" fix as everywhere else on this page — it fills the card
// because there's more to say, not because of padding or decoration.
//
// 2026-10-04, round 6: a category-ranking bar still fell back to the flat global accent
// instead of the active marketplace color (RankCard's bar now falls back to `theme.accent`,
// so it recolors with everything else in the row). Also added a short, fixed "what this is"
// explainer at the bottom of the mover card only — it's the one insight card calling out the
// day's main point of attention, so it's the one that benefits from a sentence of context;
// the ranking/stat cards next to it stay as-is rather than getting the same treatment
// everywhere.
//
// 2026-10-04, round 6b (Ryan: the empty-card fix hadn't reached every case, be more precise
// this time): a Playwright measurement of actual content height vs. the grid-stretched card
// height across all 7 marketplace filters showed the "not empty" fix from round 5 only
// reached the mover/stat cards — RankCard ("Top categories in X") was still left with up to
// 105px of blank space whenever a filtered marketplace has fewer categories than its
// row-mates have content for (e.g. Amazon's shorter category list next to a full-height
// stat card). Anchored a real aggregate to the bottom with mt-auto, same principle as
// StatCard's stats grid. Re-measured after this fix: blank space is at most 1px across every
// one of the 7 marketplace states (previously up to 105px) for every card in this file.
//
// 2026-10-04, round 7 (Ryan, two issues): (1) RankCard's round-6b footer used the slice's
// grand total revenue/orders — identical across every RankCard in the same row by
// construction, since they all bucket the same underlying rows, just along a different
// dimension, and Ryan correctly called that out as repeating what the hero numbers above
// already show, not real new content. Replaced with a per-breakdown count and average
// (N marketplaces vs N categories, avg revenue per marketplace vs per category) — these
// actually differ row to row because the denominator (how many buckets this dimension has)
// differs. (2) The mover card's bottom box was a fixed methodology sentence ("compares X to
// Y") instead of explaining the specific number above it — Ryan's example: "Books sales fell
// 22% — this was mainly caused by a reduction in sales in Amazon." Replaced with
// moverExplanation() below: when the active filters leave a second dimension free (the
// all/all case), names the real sub-bucket (marketplace or category) that moved the most in
// dollar terms; otherwise decomposes the swing into order-volume vs. order-value and names
// whichever one actually drove it — always computed from that mover's own numbers, never a
// static caption. Also: down arrows/badges are now `text-bad`/`bg-bad-soft` (red) everywhere
// on this page, not muted gray — an icon should say which direction things moved.
import type { ReactNode } from "react";
import { FileIcon, PulseIcon } from "@/components/icons";
import { averageBuckets, biggestDriver, bucketBy, matches, rankMovers, sliceStats, type Bucket, type Driver, type Mover, type OrderLike } from "./_lib/overview-filters";
import { categoryIcon, MARKET_ICON, MARKET_THEME, type MarketKey, type MarketTheme } from "./_lib/overview-theme";
import { formatInt, formatMoney, formatMoneyCompact, pctChange } from "./_lib/format";

type OverviewGlanceProps = {
  orders: OrderLike[];
  cmpOrders: OrderLike[] | null;
  moverBaseline: OrderLike[][];
  weekday: string;
  channel: MarketKey | "all";
  channelLabel: string;
  category: string;
  comparedTo: string;
};

export function OverviewGlance({ orders, cmpOrders, moverBaseline, weekday, channel, channelLabel, category, comparedTo }: OverviewGlanceProps) {
  const current = orders.filter(o => matches(o, channelLabel, category));
  const previous = cmpOrders?.filter(o => matches(o, channelLabel, category)) ?? null;
  // The mover cards compare against the same weekday over the last 4 weeks, averaged (like
  // Daily Pulse's "vs a typical Friday"), not one day a week back — one odd week can't make
  // something look like it jumped. The stat cards keep the hero's week-over-week comparison.
  const base = moverBaseline.map(day => day.filter(o => matches(o, channelLabel, category)));
  const vs: MoverVs = {
    weekday,
    short: base.length > 1 ? `the average of the last ${base.length} ${weekday}s` : `the last ${weekday}`,
    typical: base.length > 1 ? `a typical ${weekday}` : `the last ${weekday}`,
  };
  const theme = MARKET_THEME[channel];
  const active = channel !== "all"; // categories carry no brand color, so only a marketplace filter recolors cards

  if (channel === "all" && category === "all") {
    const byChannel = bucketBy(current, o => o.channelLabel);
    const byCategory = bucketBy(current, o => o.category);
    const movers = base.length
      ? rankMovers(
          [...tag(byChannel, "m:"), ...tag(byCategory, "c:")],
          [...tag(averageBuckets(base, o => o.channelLabel), "m:"), ...tag(averageBuckets(base, o => o.category), "c:")],
        )
      : [];
    // Neither dimension is pinned here, so the headline mover's own dimension (tagged "m:" or
    // "c:") still has a second dimension free to break down by — a category mover's revenue by
    // marketplace, or a marketplace mover's revenue by category — giving a real "caused by X".
    const headline = movers[0] ?? null;
    const driver = headline
      ? headline.key.startsWith("c:")
        ? biggestDriver(current, base, o => o.category, headline.key.slice(2), o => o.channelLabel, headline.pct < 0 ? -1 : 1)
        : biggestDriver(current, base, o => o.channelLabel, headline.key.slice(2), o => o.category, headline.pct < 0 ? -1 : 1)
      : null;
    return (
      <Row>
        <RankCard icon={<MarketIcon />} title="Top marketplaces today" rows={byChannel} barColor={marketBarColor} rowIcon={undefined}
          nounSingular="marketplace" nounPlural="marketplaces" theme={theme} active={active} />
        <RankCard icon={<CategoryGlyph category="" />} title="Top categories today" rows={byCategory} limit={4} rowIcon={r => <CategoryGlyph category={r.key} />}
          nounSingular="category" nounPlural="categories" theme={theme} active={active} />
        <MoverCard title="Biggest mover" movers={movers} vs={vs} describeKey={describeTaggedKey} driver={driver} theme={theme} active={active} />
      </Row>
    );
  }

  if (channel !== "all" && category === "all") {
    const byCategory = bucketBy(current, o => o.category);
    const stats = sliceStats(current);
    const prevStats = previous ? sliceStats(previous) : null;
    const movers = base.length ? rankMovers(bucketBy(current, o => o.category), averageBuckets(base, o => o.category)) : [];
    return (
      <Row>
        <RankCard icon={<CategoryGlyph category="" />} title={`Top categories in ${channelLabel}`} rows={byCategory} limit={4} rowIcon={r => <CategoryGlyph category={r.key} />}
          nounSingular="category" nounPlural="categories" theme={theme} active={active} />
        <StatCard icon={<FileIcon className="size-3.5" />} title={`Average order in ${channelLabel}`} value={formatMoney(stats.avgCents)}
          changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
          secondary={`${formatMoneyCompact(stats.revenueCents)} total revenue`}
          stats={[{ label: "Unique customers", value: formatInt(stats.customers) }, { label: "Largest order", value: formatMoney(stats.maxCents) }]}
          caption={`${formatInt(stats.orders)} orders${stats.cancelled ? ` · ${formatInt(stats.cancelled)} cancelled` : ""}`} theme={theme} active={active} />
        <MoverCard title={`Biggest mover in ${channelLabel}`} movers={movers} vs={vs} describeKey={k => k} theme={theme} active={active} />
      </Row>
    );
  }

  if (channel === "all" && category !== "all") {
    const byChannel = bucketBy(current, o => o.channelLabel);
    const stats = sliceStats(current);
    const prevStats = previous ? sliceStats(previous) : null;
    const movers = base.length ? rankMovers(bucketBy(current, o => o.channelLabel), averageBuckets(base, o => o.channelLabel)) : [];
    return (
      <Row>
        <RankCard icon={<MarketIcon />} title={`Top marketplaces selling ${category}`} rows={byChannel} barColor={marketBarColor} rowIcon={undefined}
          nounSingular="marketplace" nounPlural="marketplaces" theme={theme} active={active} />
        <StatCard icon={<FileIcon className="size-3.5" />} title={`Average order in ${category}`} value={formatMoney(stats.avgCents)}
          changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
          secondary={`${formatMoneyCompact(stats.revenueCents)} total revenue`}
          stats={[{ label: "Unique customers", value: formatInt(stats.customers) }, { label: "Largest order", value: formatMoney(stats.maxCents) }]}
          caption={`${formatInt(stats.orders)} orders${stats.cancelled ? ` · ${formatInt(stats.cancelled)} cancelled` : ""}`} theme={theme} active={active} />
        <MoverCard title={`Biggest mover for ${category}`} movers={movers} vs={vs} describeKey={k => k} theme={theme} active={active} />
      </Row>
    );
  }

  // Both filters set: a single slice, nothing left to rank — the mover card can only ever
  // show the one number (no runners-up exist when there's nothing left to compare against).
  const stats = sliceStats(current);
  const prevStats = previous ? sliceStats(previous) : null;
  const typicalSlice = base.length ? averageBuckets(base, () => "slice")[0] ?? null : null;
  const revenueChangePct = pctChange(stats.revenueCents, typicalSlice?.revenueCents ?? null);
  return (
    <Row>
      <StatCard icon={<FileIcon className="size-3.5" />} title="Average order value" value={formatMoney(stats.avgCents)}
        changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
        secondary={`${formatMoneyCompact(stats.revenueCents)} total revenue`}
        stats={[{ label: "Unique customers", value: formatInt(stats.customers) }, { label: "Largest order", value: formatMoney(stats.maxCents) }]}
        caption={`${formatInt(stats.orders)} orders · ${channelLabel} · ${category}`} theme={theme} active={active} />
      <StatCard icon={<CategoryGlyph category={category} className="size-3.5" />} title="Cancelled orders" value={formatInt(stats.cancelled)}
        changePct={null} comparedTo={comparedTo}
        stats={[{ label: "Live orders", value: formatInt(stats.orders) }, { label: "Unique customers", value: formatInt(stats.customers) }]}
        caption={stats.cancelled ? `${(stats.cancelRate * 100).toFixed(1)}% of this slice` : "none in this slice"} theme={theme} active={active} />
      <MoverCard title={`Change vs ${vs.typical}`} vs={vs} describeKey={() => `${channelLabel} · ${category}`}
        movers={revenueChangePct == null || !typicalSlice ? [] : [{
          key: "slice", pct: revenueChangePct, currentCents: stats.revenueCents,
          previousCents: typicalSlice.revenueCents, currentOrders: stats.orders, previousOrders: typicalSlice.orders,
        }]} theme={theme} active={active} />
    </Row>
  );
}

function marketBarColor(key: string): string {
  const entry = Object.values(MARKET_THEME).find(m => m.label === key);
  return entry?.accent ?? MARKET_THEME.all.accent;
}

function MarketIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden><path d={MARKET_ICON} /></svg>;
}

function CategoryGlyph({ category, className = "size-3.5" }: { category: string; className?: string }) {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden><path d={categoryIcon(category)} /></svg>;
}

function tag(buckets: Bucket[], prefix: string): Bucket[] {
  return buckets.map(b => ({ ...b, key: `${prefix}${b.key}` }));
}

function describeTaggedKey(key: string): { label: string; hint: string } {
  if (key.startsWith("m:")) return { label: key.slice(2), hint: "marketplace" };
  if (key.startsWith("c:")) return { label: key.slice(2), hint: "category" };
  return { label: key, hint: "" };
}

function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{children}</div>;
}

/** The icon sits in a colored badge (theme.soft/theme.accent) rather than a flat gray glyph —
 * the same visual language OverviewHero's hero cards use, so a card never reads as plain
 * white-on-white even before any filter picks a marketplace (theme defaults to the neutral
 * brand accent via MARKET_THEME.all). */
function CardTitle({ icon, children, theme }: { icon: ReactNode; children: ReactNode; theme: MarketTheme }) {
  return (
    <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: theme.soft, color: theme.accent }}>{icon}</span>
      {children}
    </h3>
  );
}

function RankCard({ icon, title, rows, limit = 4, barColor, rowIcon, nounSingular, nounPlural, theme, active }: {
  icon: ReactNode; title: string; rows: Bucket[]; limit?: number; barColor?: (key: string) => string; rowIcon?: (r: Bucket) => ReactNode;
  nounSingular: string; nounPlural: string; theme: MarketTheme; active: boolean;
}) {
  const shown = rows.slice(0, limit);
  const max = shown[0]?.revenueCents || 1;
  const rest = rows.length - shown.length;
  const totalCents = rows.reduce((a, r) => a + r.revenueCents, 0);
  const avgCents = rows.length ? Math.round(totalCents / rows.length) : 0;
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3.5" style={active ? { borderColor: theme.line } : undefined}>
      <CardTitle icon={icon} theme={theme}>{title}</CardTitle>
      {shown.length === 0 ? <p className="text-[13px] text-ink-3">No orders in this slice.</p> : (
        <>
          <ol className="flex flex-col gap-1.5">
            {shown.map((r, i) => (
              <li key={r.key} className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-[12px] font-semibold text-ink-3">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-medium text-ink">
                      {rowIcon && <span className="shrink-0 text-ink-3">{rowIcon(r)}</span>}
                      <span className="truncate">{r.key}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold text-ink">{formatMoneyCompact(r.revenueCents)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="block h-[5px] flex-1 overflow-hidden rounded-full bg-muted-soft">
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, (r.revenueCents / max) * 100))}%`, backgroundColor: barColor ? barColor(r.key) : theme.accent }} />
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {formatInt(r.orders)} orders{totalCents > 0 ? ` · ${Math.round((r.revenueCents / totalCents) * 100)}%` : ""}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {shown.length === 1 && (
            <p className="text-[12px] text-ink-3">100% of revenue in this slice.</p>
          )}
        </>
      )}
      {rest > 0 && <p className="text-[12px] text-ink-3">+{rest} more</p>}
      {shown.length > 0 && (
        <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-3">{nounPlural[0].toUpperCase()}{nounPlural.slice(1)} tracked</span>
            <span className="text-[15px] font-semibold text-ink">{formatInt(rows.length)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-3">Avg per {nounSingular}</span>
            <span className="text-[15px] font-semibold text-ink">{formatMoneyCompact(avgCents)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** `stats` are two more real numbers already available on the slice (unique customers,
 * largest order, live orders — whichever pair fits the card) — round 6: this card's fixed
 * ~4 lines left it visibly emptier than its row-mates in every filtered marketplace state,
 * not just one (the ranking/mover cards next to it grow with the day's data; this one
 * didn't). More real numbers, not decoration — same principle as the rest of this file. */
function StatCard({ icon, title, value, changePct, comparedTo, caption, secondary, stats, theme, active }: {
  icon: ReactNode; title: string; value: string; changePct: number | null; comparedTo: string; caption: string; secondary?: string;
  stats?: { label: string; value: string }[]; theme: MarketTheme; active: boolean;
}) {
  const up = (changePct ?? 0) >= 0;
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3.5" style={active ? { borderColor: theme.line } : undefined}>
      <CardTitle icon={icon} theme={theme}>{title}</CardTitle>
      <span className="font-display text-[36px] leading-none font-semibold text-ink" style={active ? { color: theme.accent } : undefined}>{value}</span>
      {secondary && <span className="text-[12.5px] font-medium text-ink-2">{secondary}</span>}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        {changePct != null && (
          <span className={`rounded-full px-[7px] py-0.5 font-semibold ${up ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{up ? "↑" : "↓"} {Math.abs(changePct).toFixed(1)}%</span>
        )}
        <span>{changePct != null ? `vs ${comparedTo} · ` : ""}{caption}</span>
      </div>
      {stats && stats.length > 0 && (
        <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-2.5">
          {stats.map(s => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <span className="text-[11px] text-ink-3">{s.label}</span>
              <span className="text-[15px] font-semibold text-ink">{s.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const WHY_ICON = "M8 2.3a5.7 5.7 0 1 0 0 11.4 5.7 5.7 0 0 0 0-11.4z M8 7.3v3.4M8 5.3h.01";

/** round 7 (Ryan: the box was reciting its own methodology — "compares X to Y" — instead of
 * saying what actually happened, and asked for something like "Books sales fell 22% — this
 * was mainly caused by a reduction in sales in Amazon"). Two tiers of real explanation,
 * depending on what the active filters leave to explain *with*:
 * - `driver` (only possible when neither filter pins the mover's own dimension — see the
 *   "all/all" call site): the single sub-bucket along the *other* dimension (a category
 *   mover's revenue broken down by marketplace, or vice versa) that moved the most in dollar
 *   terms — names the actual cause, not just the percentage.
 * - Otherwise (a marketplace or category filter already pins the dimension the mover lives
 *   on, so there's no second dimension left to break down by): decomposes the swing into
 *   order-volume vs. order-value, using the real order counts/averages on the mover itself,
 *   and names whichever one actually accounts for most of the dollar change.
 * Never a static sentence — every branch is computed from this mover's own numbers.
 *
 * Round 7b (Ryan: still didn't understand it, make it bigger and easier to read): rewritten
 * as a full plain-language sentence or two — names what happened, then explains the "why" in
 * words a non-technical reader parses on one pass (no bare arrows, no colon-separated
 * shorthand), instead of a terse data-label sentence.
 *
 * Round 8 (Ryan: trim it to 5-6 lines): one sentence per branch, still naming the real cause and
 * the real numbers. Baseline is the typical same weekday (#64). The "barely changed" clauses are
 * only added when the other factor really moved less than 10%. */
function moverExplanation(mover: Mover, driver: Driver | null, label: string, vs: MoverVs): string {
  const upWord = mover.pct >= 0 ? "grew" : "dropped";
  if (driver) {
    const driverVerb = driver.deltaCents >= 0 ? "rose" : "fell";
    return `${label} ${upWord} mainly because of ${driver.label}: its sales ${driverVerb} ${formatMoneyCompact(Math.abs(driver.deltaCents))} compared to ${vs.typical}, the biggest swing in the same direction.`;
  }
  if (mover.previousOrders === 0) {
    const isOne = mover.currentOrders === 1;
    return `${label} had no orders on ${vs.typical}, so all ${formatInt(mover.currentOrders)} order${isOne ? "" : "s"} today ${isOne ? "is" : "are"} new activity.`;
  }
  const avgPrev = mover.previousCents / mover.previousOrders;
  const avgCur = mover.currentOrders ? mover.currentCents / mover.currentOrders : 0;
  const ordersEffect = (mover.currentOrders - mover.previousOrders) * avgPrev;
  const avgEffect = (avgCur - avgPrev) * mover.currentOrders;
  const steady = (a: number, b: number) => b > 0 && Math.abs(a - b) / b < 0.1; // the other factor barely moved
  if (Math.abs(ordersEffect) >= Math.abs(avgEffect)) {
    const more = mover.currentOrders >= mover.previousOrders ? "more" : "fewer";
    return `${label} ${upWord} mainly because ${more} orders came in: ${formatAvg(mover.previousOrders)} on ${vs.typical}, ${formatInt(mover.currentOrders)} today${steady(avgCur, avgPrev) ? ", while the typical order size barely changed" : ""}.`;
  }
  return `${label} ${upWord} mainly because of order size: the typical order went from ${formatMoney(avgPrev)} on ${vs.typical} to ${formatMoney(avgCur)} today${steady(mover.currentOrders, mover.previousOrders) ? ", while order volume held steady" : ""}.`;
}

/** How the mover cards name their baseline: `short` in the headline sentence, `typical` inside the "why" text. */
type MoverVs = { weekday: string; short: string; typical: string };

/** An average order count (e.g. 12.75 across 4 Fridays) to one decimal; whole numbers stay whole. */
const formatAvg = (n: number) => (Number.isInteger(n) ? formatInt(n) : n.toFixed(1));

/** Headline mover (movers[0]) — a number, then a sentence — with up to 3 runners-up listed
 * below as compact rows (mirroring RankCard's row style) so the card earns its height with
 * more real swings instead of sitting mostly blank next to a taller ranking card in the same
 * grid row (see this file's header note, round 5). Up is green, down is red (`text-bad`) —
 * round 7, Ryan: icons should reflect the data, a down arrow has to read as a down arrow, not
 * neutral gray — applied to the headline number and every runner row.
 *
 * The box at the bottom is this card's own "why" — the one card on the page that calls out
 * the day's main point of attention, so it's the one that gets a causal explanation computed
 * from this mover's real numbers (moverExplanation above), not a fixed caption. Styled with
 * this card's own theme (soft background, accent badge, themed border) instead of a flat gray
 * box, so it reads as part of this page's design instead of a bolted-on tooltip. */
function MoverCard({ title, movers, vs, describeKey, driver = null, theme, active }: {
  title: string;
  movers: Mover[];
  vs: MoverVs;
  describeKey: (key: string) => string | { label: string; hint: string };
  driver?: Driver | null;
  theme: MarketTheme;
  active: boolean;
}) {
  const mover = movers[0] ?? null;
  // Round 8 (Ryan: fit the Overview page without scrolling): 1 runner-up instead of 3 — one
  // fewer row's worth of height on the tallest card in the row, which is what sets how tall
  // every card in the row gets stretched to. Safe to cut now that the why-box below fills the
  // card structurally (flex-1, round 7b) rather than needing extra rows to avoid blank space.
  const runners = movers.slice(1, 2);
  const described = mover ? describeKey(mover.key) : null;
  const label = described == null ? null : typeof described === "string" ? described : described.label;
  const hint = described == null || typeof described === "string" ? null : described.hint;
  const up = (mover?.pct ?? 0) >= 0;
  const verb = up ? "jumped" : "fell";
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3.5" style={active ? { borderColor: theme.line } : undefined}>
      <CardTitle icon={<PulseIcon className="size-3.5" />} theme={theme}>{title}</CardTitle>
      {!mover ? (
        <div className="flex flex-1 items-center gap-2 rounded-[10px] border border-line bg-muted-soft p-2.5 text-[13.5px] text-ink-2">
          <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-ink-3">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden><path d={WHY_ICON} /></svg>
          </span>
          <p>Not enough data yet to compare — there&apos;s no earlier {vs.weekday} to measure this slice against.</p>
        </div>
      ) : (
        <>
          <span className={`font-display text-[36px] leading-none font-semibold ${up ? "text-ok" : "text-bad"}`}>
            {up ? "↑" : "↓"} {Math.abs(mover.pct).toFixed(1)}%
          </span>
          <p className="text-[13px] text-ink-2">
            <strong className="font-semibold text-ink">{label}</strong>{hint && <span className="text-ink-3"> ({hint})</span>} {verb} {Math.abs(mover.pct).toFixed(1)}% vs {vs.short} — {formatMoneyCompact(mover.currentCents)} today.
          </p>
          {runners.length > 0 && (
            <ul className="flex flex-col gap-1.5 border-t border-line pt-2.5">
              {runners.map(m => {
                const d = describeKey(m.key);
                const l = typeof d === "string" ? d : d.label;
                const h = typeof d === "string" ? null : d.hint;
                const rowUp = m.pct >= 0;
                return (
                  <li key={m.key} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate font-medium text-ink">{l}</span>
                      {h && <span className="shrink-0 text-ink-3">({h})</span>}
                    </span>
                    <span className={`shrink-0 font-semibold ${rowUp ? "text-ok" : "text-bad"}`}>{rowUp ? "↑" : "↓"} {Math.abs(m.pct).toFixed(1)}%</span>
                  </li>
                );
              })}
            </ul>
          )}
          {/* Round 9 (Ryan: the box, not the text, reads too big): tighter padding and a
              smaller icon badge — same text size as before, just less box around it. flex-1
              still does the structural no-blank-space work (round 7b/8); it just has less
              leftover row-height to fill now that RankCard/StatCard are trimmed down near
              MoverCard's own natural height (round 8), so it rarely has to grow far past this
              tighter natural size in the first place. */}
          <div className="flex flex-1 items-center gap-2 rounded-[10px] border p-2.5" style={{ backgroundColor: theme.soft, borderColor: theme.line }}>
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: theme.accent, color: "var(--surface)" }}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden><path d={WHY_ICON} /></svg>
            </span>
            <p className="text-[13.5px] leading-snug text-ink-2">
              <span className="block text-[12px] font-semibold tracking-wide text-ink">Why this happened</span>
              {moverExplanation(mover, driver, label ?? String(mover.key), vs)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
