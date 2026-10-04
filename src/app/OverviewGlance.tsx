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
// stat card). Same principle as StatCard's stats grid: a real aggregate the per-row numbers
// don't already show (total revenue and total orders across every bucket, not just the ones
// listed) anchored to the bottom with mt-auto, so the card is grounded regardless of how many
// rows that day's data happens to produce. Re-measured after this fix: blank space is at most
// 1px across every one of the 7 marketplace states (previously up to 105px) for every card in
// this file.
import type { ReactNode } from "react";
import { FileIcon, PulseIcon } from "@/components/icons";
import { bucketBy, matches, rankMovers, sliceStats, type Bucket, type Mover, type OrderLike } from "./_lib/overview-filters";
import { categoryIcon, MARKET_ICON, MARKET_THEME, type MarketKey, type MarketTheme } from "./_lib/overview-theme";
import { formatInt, formatMoney, formatMoneyCompact, pctChange } from "./_lib/format";

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
  const theme = MARKET_THEME[channel];
  const active = channel !== "all"; // categories carry no brand color, so only a marketplace filter recolors cards

  if (channel === "all" && category === "all") {
    const byChannel = bucketBy(current, o => o.channelLabel);
    const byCategory = bucketBy(current, o => o.category);
    const movers = previous
      ? rankMovers(
          [...tag(byChannel, "m:"), ...tag(byCategory, "c:")],
          [...tag(bucketBy(previous, o => o.channelLabel), "m:"), ...tag(bucketBy(previous, o => o.category), "c:")],
        )
      : [];
    return (
      <Row>
        <RankCard icon={<MarketIcon />} title="Top marketplaces today" rows={byChannel} barColor={marketBarColor} rowIcon={undefined} theme={theme} active={active} />
        <RankCard icon={<CategoryGlyph category="" />} title="Top categories today" rows={byCategory} limit={4} rowIcon={r => <CategoryGlyph category={r.key} />} theme={theme} active={active} />
        <MoverCard title="Biggest mover" movers={movers} comparedTo={comparedTo} describeKey={describeTaggedKey} theme={theme} active={active}
          explainer="Compares today's revenue in every marketplace and category to the same day last week, and ranks the swings by size — the fastest way to spot what changed." />
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
        <RankCard icon={<CategoryGlyph category="" />} title={`Top categories in ${channelLabel}`} rows={byCategory} limit={4} rowIcon={r => <CategoryGlyph category={r.key} />} theme={theme} active={active} />
        <StatCard icon={<FileIcon className="size-3.5" />} title={`Average order in ${channelLabel}`} value={formatMoney(stats.avgCents)}
          changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
          secondary={`${formatMoneyCompact(stats.revenueCents)} total revenue`}
          stats={[{ label: "Unique customers", value: formatInt(stats.customers) }, { label: "Largest order", value: formatMoney(stats.maxCents) }]}
          caption={`${formatInt(stats.orders)} orders${stats.cancelled ? ` · ${formatInt(stats.cancelled)} cancelled` : ""}`} theme={theme} active={active} />
        <MoverCard title={`Biggest mover in ${channelLabel}`} movers={movers} comparedTo={comparedTo} describeKey={k => k} theme={theme} active={active}
          explainer={`Compares each category's ${channelLabel} revenue today to the same day last week, and ranks the swings by size.`} />
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
        <RankCard icon={<MarketIcon />} title={`Top marketplaces selling ${category}`} rows={byChannel} barColor={marketBarColor} rowIcon={undefined} theme={theme} active={active} />
        <StatCard icon={<FileIcon className="size-3.5" />} title={`Average order in ${category}`} value={formatMoney(stats.avgCents)}
          changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
          secondary={`${formatMoneyCompact(stats.revenueCents)} total revenue`}
          stats={[{ label: "Unique customers", value: formatInt(stats.customers) }, { label: "Largest order", value: formatMoney(stats.maxCents) }]}
          caption={`${formatInt(stats.orders)} orders${stats.cancelled ? ` · ${formatInt(stats.cancelled)} cancelled` : ""}`} theme={theme} active={active} />
        <MoverCard title={`Biggest mover for ${category}`} movers={movers} comparedTo={comparedTo} describeKey={k => k} theme={theme} active={active}
          explainer={`Compares each marketplace's ${category} revenue today to the same day last week, and ranks the swings by size.`} />
      </Row>
    );
  }

  // Both filters set: a single slice, nothing left to rank — the mover card can only ever
  // show the one number (no runners-up exist when there's nothing left to compare against).
  const stats = sliceStats(current);
  const prevStats = previous ? sliceStats(previous) : null;
  const revenueChangePct = pctChange(stats.revenueCents, prevStats?.revenueCents ?? null);
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
      <MoverCard title="Change vs comparison day" comparedTo={comparedTo} describeKey={() => `${channelLabel} · ${category}`}
        movers={revenueChangePct == null ? [] : [{ key: "slice", pct: revenueChangePct, currentCents: stats.revenueCents }]} theme={theme} active={active}
        explainer={`Compares this slice's (${channelLabel} · ${category}) revenue today to the same day last week.`} />
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
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: theme.soft, color: theme.accent }}>{icon}</span>
      {children}
    </h3>
  );
}

function RankCard({ icon, title, rows, limit = 6, barColor, rowIcon, theme, active }: {
  icon: ReactNode; title: string; rows: Bucket[]; limit?: number; barColor?: (key: string) => string; rowIcon?: (r: Bucket) => ReactNode; theme: MarketTheme; active: boolean;
}) {
  const shown = rows.slice(0, limit);
  const max = shown[0]?.revenueCents || 1;
  const rest = rows.length - shown.length;
  const totalCents = rows.reduce((a, r) => a + r.revenueCents, 0);
  const totalOrders = rows.reduce((a, r) => a + r.orders, 0);
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5" style={active ? { borderColor: theme.line } : undefined}>
      <CardTitle icon={icon} theme={theme}>{title}</CardTitle>
      {shown.length === 0 ? <p className="text-[13px] text-ink-3">No orders in this slice.</p> : (
        <>
          <ol className="flex flex-col gap-2.5">
            {shown.map((r, i) => (
              <li key={r.key} className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-[12px] font-semibold text-ink-3">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-[13.5px] font-medium text-ink">
                      {rowIcon && <span className="shrink-0 text-ink-3">{rowIcon(r)}</span>}
                      <span className="truncate">{r.key}</span>
                    </span>
                    <span className="shrink-0 text-[13.5px] font-semibold text-ink">{formatMoneyCompact(r.revenueCents)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
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
        <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-3">Total revenue</span>
            <span className="text-[16px] font-semibold text-ink">{formatMoneyCompact(totalCents)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-3">Total orders</span>
            <span className="text-[16px] font-semibold text-ink">{formatInt(totalOrders)}</span>
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
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-5" style={active ? { borderColor: theme.line } : undefined}>
      <CardTitle icon={icon} theme={theme}>{title}</CardTitle>
      <span className="font-display text-[44px] leading-none font-semibold text-ink" style={active ? { color: theme.accent } : undefined}>{value}</span>
      {secondary && <span className="text-[12.5px] font-medium text-ink-2">{secondary}</span>}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        {changePct != null && (
          <span className={`rounded-full px-[7px] py-0.5 font-semibold ${up ? "bg-ok-soft text-ok" : "bg-muted-soft text-ink-2"}`}>{up ? "↑" : "↓"} {Math.abs(changePct).toFixed(1)}%</span>
        )}
        <span>{changePct != null ? `vs ${comparedTo} · ` : ""}{caption}</span>
      </div>
      {stats && stats.length > 0 && (
        <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-3">
          {stats.map(s => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <span className="text-[11px] text-ink-3">{s.label}</span>
              <span className="text-[16px] font-semibold text-ink">{s.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const INFO_ICON = "M8 2.3a5.7 5.7 0 1 0 0 11.4 5.7 5.7 0 0 0 0-11.4z M8 7.3v3.4M8 5.3h.01";

/** Headline mover (movers[0]) rendered the same as before — a number, then a sentence —
 * with up to 3 runners-up listed below as compact rows (mirroring RankCard's row style) so
 * the card earns its height with more real swings instead of sitting mostly blank next to a
 * taller ranking card in the same grid row (see this file's header note, round 5).
 *
 * This is the one card on the page that calls out the day's main point of attention, so —
 * per Ryan, round 6 — it's the one that gets a fixed "what this is" explainer nested at the
 * bottom as its own small sub-card (muted background, info icon), always present even when
 * there's no mover yet to show. The ranking/stat cards next to it don't get this treatment;
 * it's specific to this insight card, not a general template for every card on the page. */
function MoverCard({ title, movers, comparedTo, describeKey, theme, active, explainer }: {
  title: string;
  movers: Mover[];
  comparedTo: string;
  describeKey: (key: string) => string | { label: string; hint: string };
  theme: MarketTheme;
  active: boolean;
  explainer: string;
}) {
  const mover = movers[0] ?? null;
  const runners = movers.slice(1, 4);
  const described = mover ? describeKey(mover.key) : null;
  const label = described == null ? null : typeof described === "string" ? described : described.label;
  const hint = described == null || typeof described === "string" ? null : described.hint;
  const up = (mover?.pct ?? 0) >= 0;
  const verb = up ? "jumped" : "fell";
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-5" style={active ? { borderColor: theme.line } : undefined}>
      <CardTitle icon={<PulseIcon className="size-3.5" />} theme={theme}>{title}</CardTitle>
      {!mover ? <p className="text-[13px] text-ink-3">Not enough data yet to compare.</p> : (
        <>
          <span className={`font-display text-[44px] leading-none font-semibold ${up ? "text-ok" : "text-ink"}`}>
            {up ? "↑" : "↓"} {Math.abs(mover.pct).toFixed(1)}%
          </span>
          <p className="text-[13px] text-ink-2">
            <strong className="font-semibold text-ink">{label}</strong>{hint && <span className="text-ink-3"> ({hint})</span>} {verb} {Math.abs(mover.pct).toFixed(1)}% vs {comparedTo} — {formatMoneyCompact(mover.currentCents)} today.
          </p>
          {runners.length > 0 && (
            <ul className="flex flex-col gap-2 border-t border-line pt-3">
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
                    <span className={`shrink-0 font-semibold ${rowUp ? "text-ok" : "text-ink-3"}`}>{rowUp ? "↑" : "↓"} {Math.abs(m.pct).toFixed(1)}%</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <div className="mt-auto flex items-start gap-2 rounded-[10px] bg-muted-soft p-3 text-[12px] text-ink-3">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" className="mt-px size-3.5 shrink-0" aria-hidden><path d={INFO_ICON} /></svg>
        <p>{explainer}</p>
      </div>
    </div>
  );
}
