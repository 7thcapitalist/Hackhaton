// "At a glance" row below the Overview hero. Adapts to the same marketplace/category
// filter OverviewHero owns: the first two cards are always "what this slice breaks down
// into" (a ranking when there's more than one thing to rank, a plain stat when the filter
// has already narrowed to one), the third is always "what changed the most" — explained in
// a sentence, not a bare number. 2026-10-03, three redesign passes — see OverviewHero.tsx's
// header for the full history. This pass (evening, round 3):
//
// - Marketplace rankings now carry each marketplace's own color (MARKET_THEME) in their
//   bars; category rankings carry each category's own icon (overview-theme.ts) — the same
//   identity the filter pills use, so selecting something and seeing it ranked feel like
//   the same language.
// - The single-marketplace/single-category stat cards no longer just restate the hero's
//   order count a third time (filtering to one marketplace makes "customers" and "orders"
//   numerically identical by construction — see HeroNumber's "1 per transaction" trace, the
//   same convention Daily Pulse already uses) — they lead with average order value instead,
//   and surface cancelled orders, a number that was sitting unused in the data.
// - The mover card leads with the number, then one plain-language sentence explaining it,
//   instead of a label line and a caption line.
import type { ReactNode } from "react";
import { FileIcon, PulseIcon } from "@/components/icons";
import { bucketBy, biggestMover, matches, sliceStats, type Bucket, type Mover, type OrderLike } from "./_lib/overview-filters";
import { categoryIcon, MARKET_ICON, MARKET_THEME } from "./_lib/overview-theme";
import { formatInt, formatMoney, formatMoneyCompact, pctChange } from "./_lib/format";
import type { ChannelId } from "./_lib/types";

type OverviewGlanceProps = {
  orders: OrderLike[];
  cmpOrders: OrderLike[] | null;
  channel: ChannelId | "all";
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
    const mover = previous
      ? biggestMover(
          [...tag(byChannel, "m:"), ...tag(byCategory, "c:")],
          [...tag(bucketBy(previous, o => o.channelLabel), "m:"), ...tag(bucketBy(previous, o => o.category), "c:")],
        )
      : null;
    return (
      <Row>
        <RankCard icon={<MarketIcon />} title="Top marketplaces today" rows={byChannel} barColor={marketBarColor} rowIcon={undefined} />
        <RankCard icon={<CategoryGlyph category="" />} title="Top categories today" rows={byCategory} limit={4} rowIcon={r => <CategoryGlyph category={r.key} />} />
        <MoverCard title="Biggest mover" mover={mover} comparedTo={comparedTo} describeKey={describeTaggedKey} />
      </Row>
    );
  }

  if (channel !== "all" && category === "all") {
    const byCategory = bucketBy(current, o => o.category);
    const stats = sliceStats(current);
    const prevStats = previous ? sliceStats(previous) : null;
    const mover = previous ? biggestMover(bucketBy(current, o => o.category), bucketBy(previous, o => o.category)) : null;
    return (
      <Row>
        <RankCard icon={<CategoryGlyph category="" />} title={`Top categories in ${channelLabel}`} rows={byCategory} limit={4} rowIcon={r => <CategoryGlyph category={r.key} />} />
        <StatCard icon={<FileIcon className="size-3.5" />} title={`Average order in ${channelLabel}`} value={formatMoney(stats.avgCents)}
          changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
          caption={`${formatInt(stats.orders)} orders${stats.cancelled ? ` · ${formatInt(stats.cancelled)} cancelled` : ""}`} />
        <MoverCard title={`Biggest mover in ${channelLabel}`} mover={mover} comparedTo={comparedTo} describeKey={k => k} />
      </Row>
    );
  }

  if (channel === "all" && category !== "all") {
    const byChannel = bucketBy(current, o => o.channelLabel);
    const stats = sliceStats(current);
    const prevStats = previous ? sliceStats(previous) : null;
    const mover = previous ? biggestMover(bucketBy(current, o => o.channelLabel), bucketBy(previous, o => o.channelLabel)) : null;
    return (
      <Row>
        <RankCard icon={<MarketIcon />} title={`Top marketplaces selling ${category}`} rows={byChannel} barColor={marketBarColor} rowIcon={undefined} />
        <StatCard icon={<FileIcon className="size-3.5" />} title={`Average order in ${category}`} value={formatMoney(stats.avgCents)}
          changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo}
          caption={`${formatInt(stats.orders)} orders${stats.cancelled ? ` · ${formatInt(stats.cancelled)} cancelled` : ""}`} />
        <MoverCard title={`Biggest mover for ${category}`} mover={mover} comparedTo={comparedTo} describeKey={k => k} />
      </Row>
    );
  }

  // Both filters set: a single slice, nothing left to rank.
  const stats = sliceStats(current);
  const prevStats = previous ? sliceStats(previous) : null;
  const revenueChangePct = pctChange(stats.revenueCents, prevStats?.revenueCents ?? null);
  return (
    <Row>
      <StatCard icon={<FileIcon className="size-3.5" />} title="Average order value" value={formatMoney(stats.avgCents)}
        changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo} caption={`${formatInt(stats.orders)} orders · ${channelLabel} · ${category}`} />
      <StatCard icon={<CategoryGlyph category={category} className="size-3.5" />} title="Cancelled orders" value={formatInt(stats.cancelled)}
        changePct={null} comparedTo={comparedTo} caption={stats.cancelled ? `${(stats.cancelRate * 100).toFixed(1)}% of this slice` : "none in this slice"} />
      <MoverCard title="Change vs comparison day" comparedTo={comparedTo} describeKey={() => `${channelLabel} · ${category}`}
        mover={revenueChangePct == null ? null : { key: "slice", pct: revenueChangePct, currentCents: stats.revenueCents }} />
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

function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2"><span className="text-ink-3">{icon}</span>{children}</h3>;
}

function RankCard({ icon, title, rows, limit = 6, barColor, rowIcon }: {
  icon: ReactNode; title: string; rows: Bucket[]; limit?: number; barColor?: (key: string) => string; rowIcon?: (r: Bucket) => ReactNode;
}) {
  const shown = rows.slice(0, limit);
  const max = shown[0]?.revenueCents || 1;
  const rest = rows.length - shown.length;
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5">
      <CardTitle icon={icon}>{title}</CardTitle>
      {shown.length === 0 ? <p className="text-[13px] text-ink-3">No orders in this slice.</p> : (
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
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, (r.revenueCents / max) * 100))}%`, backgroundColor: barColor ? barColor(r.key) : "var(--accent)" }} />
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-3">{formatInt(r.orders)} orders</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {rest > 0 && <p className="text-[12px] text-ink-3">+{rest} more</p>}
    </div>
  );
}

function StatCard({ icon, title, value, changePct, comparedTo, caption }: {
  icon: ReactNode; title: string; value: string; changePct: number | null; comparedTo: string; caption: string;
}) {
  const up = (changePct ?? 0) >= 0;
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-5">
      <CardTitle icon={icon}>{title}</CardTitle>
      <span className="font-display text-[44px] leading-none font-semibold text-ink">{value}</span>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        {changePct != null && (
          <span className={`rounded-full px-[7px] py-0.5 font-semibold ${up ? "bg-ok-soft text-ok" : "bg-muted-soft text-ink-2"}`}>{up ? "↑" : "↓"} {Math.abs(changePct).toFixed(1)}%</span>
        )}
        <span>{changePct != null ? `vs ${comparedTo} · ` : ""}{caption}</span>
      </div>
    </div>
  );
}

function MoverCard({ title, mover, comparedTo, describeKey }: {
  title: string;
  mover: Mover | null;
  comparedTo: string;
  describeKey: (key: string) => string | { label: string; hint: string };
}) {
  const described = mover ? describeKey(mover.key) : null;
  const label = described == null ? null : typeof described === "string" ? described : described.label;
  const hint = described == null || typeof described === "string" ? null : described.hint;
  const up = (mover?.pct ?? 0) >= 0;
  const verb = up ? "jumped" : "fell";
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-5">
      <CardTitle icon={<PulseIcon className="size-3.5" />}>{title}</CardTitle>
      {!mover ? <p className="text-[13px] text-ink-3">Not enough data yet to compare.</p> : (
        <>
          <span className={`font-display text-[44px] leading-none font-semibold ${up ? "text-ok" : "text-ink"}`}>
            {up ? "↑" : "↓"} {Math.abs(mover.pct).toFixed(1)}%
          </span>
          <p className="text-[13px] text-ink-2">
            <strong className="font-semibold text-ink">{label}</strong>{hint && <span className="text-ink-3"> ({hint})</span>} {verb} {Math.abs(mover.pct).toFixed(1)}% vs {comparedTo} — {formatMoneyCompact(mover.currentCents)} today.
          </p>
        </>
      )}
    </div>
  );
}
