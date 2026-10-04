// "At a glance" row below the Overview hero. Adapts to the same marketplace/category
// filter OverviewHero owns, applying its state the same way across every case rather
// than inventing new content per combination: the first two cards are always "what
// this slice breaks down into" (a ranking when there's more than one thing to rank,
// a plain total when the filter has already narrowed to one), the third is always
// "what changed the most". 2026-10-03 redesign — Ryan wanted the page to show only
// essentials, personalized by the filter when one is active, general when none is.
//
// 2026-10-03 evening pass: the single-dimension and both-filtered states read as too
// sparse (one number, lots of empty space) — every card now carries an icon, a change
// badge where we have a comparison day, and the mover card leads with its percentage
// as the headline number instead of a small pill, so no card is just one line.
import type { ReactNode } from "react";
import { BarsIcon, FileIcon, GridIcon, PulseIcon } from "@/components/icons";
import { bucketBy, biggestMover, matches, sliceStats, type Bucket, type Mover, type OrderLike } from "./_lib/overview-filters";
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
        <RankCard icon={<BarsIcon className="size-3.5" />} title="Top marketplaces today" rows={byChannel} />
        <RankCard icon={<GridIcon className="size-3.5" />} title="Top categories today" rows={byCategory} limit={4} />
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
        <RankCard icon={<GridIcon className="size-3.5" />} title={`Top categories in ${channelLabel}`} rows={byCategory} limit={4} />
        <StatCard icon={<FileIcon className="size-3.5" />} title={`Orders in ${channelLabel}`} value={formatInt(stats.orders)}
          changePct={pctChange(stats.orders, prevStats?.orders ?? null)} comparedTo={comparedTo} caption={`${formatMoney(stats.avgCents)} average order`} />
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
        <RankCard icon={<BarsIcon className="size-3.5" />} title={`Top marketplaces selling ${category}`} rows={byChannel} />
        <StatCard icon={<FileIcon className="size-3.5" />} title={`Orders in ${category}`} value={formatInt(stats.orders)}
          changePct={pctChange(stats.orders, prevStats?.orders ?? null)} comparedTo={comparedTo} caption={`${formatMoney(stats.avgCents)} average order`} />
        <MoverCard title={`Biggest mover for ${category}`} mover={mover} comparedTo={comparedTo} describeKey={k => k} />
      </Row>
    );
  }

  // Both filters set: a single slice, nothing left to rank — show its own basics instead,
  // each with its own vs-comparison-day badge so neither card is just a bare number.
  const stats = sliceStats(current);
  const prevStats = previous ? sliceStats(previous) : null;
  const revenueChangePct = pctChange(stats.revenueCents, prevStats?.revenueCents ?? null);
  return (
    <Row>
      <StatCard icon={<FileIcon className="size-3.5" />} title="Orders in this slice" value={formatInt(stats.orders)}
        changePct={pctChange(stats.orders, prevStats?.orders ?? null)} comparedTo={comparedTo} caption={`${channelLabel} · ${category}`} />
      <StatCard icon={<BarsIcon className="size-3.5" />} title="Average order value" value={formatMoney(stats.avgCents)}
        changePct={pctChange(stats.avgCents, prevStats?.avgCents ?? null)} comparedTo={comparedTo} caption={`${formatInt(stats.orders)} orders`} />
      <MoverCard title="Change vs comparison day" comparedTo={comparedTo} describeKey={() => `${channelLabel} · ${category}`}
        mover={revenueChangePct == null ? null : { key: "slice", pct: revenueChangePct, currentCents: stats.revenueCents }} />
    </Row>
  );
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

function RankCard({ icon, title, rows, limit = 6 }: { icon: ReactNode; title: string; rows: Bucket[]; limit?: number }) {
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
                  <span className="truncate text-[13.5px] font-medium text-ink">{r.key}</span>
                  <span className="shrink-0 text-[13.5px] font-semibold text-ink">{formatMoneyCompact(r.revenueCents)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="block h-[5px] flex-1 overflow-hidden rounded-full bg-muted-soft">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.min(100, (r.revenueCents / max) * 100))}%` }} />
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
      <span className="text-[38px] leading-none font-semibold tracking-[-0.02em] text-ink">{value}</span>
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
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-5">
      <CardTitle icon={<PulseIcon className="size-3.5" />}>{title}</CardTitle>
      {!mover ? <p className="text-[13px] text-ink-3">Not enough data yet to compare.</p> : (
        <>
          <span className={`text-[38px] leading-none font-semibold tracking-[-0.02em] ${up ? "text-ok" : "text-ink"}`}>
            {up ? "↑" : "↓"} {Math.abs(mover.pct).toFixed(1)}%
          </span>
          <p className="text-[13.5px] font-medium text-ink">{label}{hint && <span className="ml-1.5 text-[12px] font-normal text-ink-3">{hint}</span>}</p>
          <p className="text-[12.5px] text-ink-3">{formatMoneyCompact(mover.currentCents)} today · vs {comparedTo}</p>
        </>
      )}
    </div>
  );
}
