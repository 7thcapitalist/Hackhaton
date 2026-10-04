"use client";
// The CEO's three numbers (Mission Control kickoff, 2026-10-03; orders promoted to its
// own number 2026-10-03 evening): daily sales, daily unique customers, daily orders —
// switchable by marketplace and category. Default (no filter) renders the exact figures
// the Overview page already fetched — zero extra work. Any filter switches to
// order-level math over `orders`/`cmpOrders`, fetched ungrouped (page.tsx) so every real
// marketplace — including Goodwill Books, previously folded into "Other e-comm" — is its
// own option.
//
// 2026-10-03, three passes: (1) native <select>s replaced by an editable-word sentence;
// (2) sparkline cut, orders promoted to a full number, filter wrapped in a pill;
// (3) filter rebuilt as two colored/iconed dropdown pills (one per real marketplace, one
// per category) after Ryan picked that style over a segmented control and reference-checked
// it against Stripe/Linear/GitHub's own filter-chip patterns — see OverviewGlance.tsx for
// how the same identity (marketplace color, category icon) carries into the data below.
//
// 2026-10-04: merged in #33's unique-customer fix from main (customerKey, carried on
// OrderLike via page.tsx) — a filtered slice now counts real unique buyers, the same rule
// Daily Pulse uses, instead of this file's own transaction-count dedup. Label follows
// Pulse's rename to "Unique customers"; the old "1 per transaction" trace is dropped since
// that was never universally true once a real buyer id is available.
import { useEffect, useRef, useState } from "react";
import { OverviewGlance } from "./OverviewGlance";
import { matches, type OrderLike } from "./_lib/overview-filters";
import { ALL_CATEGORIES_ICON, categoryIcon, MARKET_ICON, MARKET_ORDER, MARKET_THEME } from "./_lib/overview-theme";
import { formatDay, formatInt, formatMoneyCompact, pctChange } from "./_lib/format";
import type { ChannelId, PulseTotals } from "./_lib/types";

export type { OrderLike };
type Changes = { revenue: number | null; customers: number | null; orders: number | null };

type OverviewHeroProps = {
  date: string;
  cmpDate: string | null;
  channelOptions: { id: ChannelId; label: string }[];
  totals: PulseTotals;
  compareChanges: Changes | null;
  orders: OrderLike[];
  cmpOrders: OrderLike[] | null;
};

function aggregateTotals(rows: OrderLike[], channelLabel: string | "all", category: string | "all"): PulseTotals {
  const filtered = rows.filter(o => matches(o, channelLabel, category));
  const live = filtered.filter(o => o.status !== "cancelled"); // revenue sums every row (net already reflects refunds); orders/customers exclude cancellations, same as the pulse view
  return {
    revenueCents: filtered.reduce((a, o) => a + o.netCents, 0),
    customers: new Set(live.map(o => o.customerKey)).size,
    orders: live.length,
  };
}

export function OverviewHero({ date, cmpDate, channelOptions, totals, compareChanges, orders, cmpOrders }: OverviewHeroProps) {
  const [channel, setChannel] = useState<ChannelId | "all">("all");
  const [category, setCategory] = useState<string>("all");

  const categories = [...new Set(orders.map(o => o.category))].sort();
  const channelLabel = channel === "all" ? "all" : channelOptions.find(c => c.id === channel)?.label ?? "all";
  const filtered = channel !== "all" || category !== "all";

  const current = filtered ? aggregateTotals(orders, channelLabel, category) : totals;
  const matchedCount = filtered ? orders.filter(o => matches(o, channelLabel, category)).length : null;
  const noData = matchedCount === 0;

  const changes: Changes | null = !filtered
    ? compareChanges
    : !cmpOrders
      ? null
      : (() => {
          const base = aggregateTotals(cmpOrders, channelLabel, category);
          return { revenue: pctChange(current.revenueCents, base.revenueCents), customers: pctChange(current.customers, base.customers), orders: pctChange(current.orders, base.orders) };
        })();

  const comparedTo = cmpDate ? formatDay(cmpDate) : "prior week";
  const suffix = [channel !== "all" ? channelLabel : null, category !== "all" ? category : null].filter(Boolean).join(", ");
  const marketTheme = MARKET_THEME[channel];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <DropdownPill
            ariaLabel="Filter by marketplace"
            iconD={MARKET_ICON}
            label={`Marketplace: ${marketTheme.label}`}
            active={channel !== "all"}
            fg={marketTheme.accent}
            bg={channel === "all" ? undefined : marketTheme.soft}
            border={channel === "all" ? undefined : marketTheme.line}
          >
            {(close) => (
              <>
                <DropdownOption onClick={() => { setChannel("all"); close(); }} selected={channel === "all"} dot={MARKET_THEME.all.accent}>
                  {MARKET_THEME.all.label}
                </DropdownOption>
                {MARKET_ORDER.filter(id => channelOptions.some(c => c.id === id)).map(id => (
                  <DropdownOption key={id} onClick={() => { setChannel(id); close(); }} selected={channel === id} dot={MARKET_THEME[id].accent}>
                    {MARKET_THEME[id].label}
                  </DropdownOption>
                ))}
              </>
            )}
          </DropdownPill>

          <DropdownPill ariaLabel="Filter by category" iconD={category === "all" ? ALL_CATEGORIES_ICON : categoryIcon(category)} label={`Category: ${category === "all" ? "All categories" : category}`} active={category !== "all"}>
            {(close) => (
              <>
                <DropdownOption onClick={() => { setCategory("all"); close(); }} selected={category === "all"} iconD={ALL_CATEGORIES_ICON}>
                  All categories
                </DropdownOption>
                {categories.map(c => (
                  <DropdownOption key={c} onClick={() => { setCategory(c); close(); }} selected={category === c} iconD={categoryIcon(c)}>
                    {c}
                  </DropdownOption>
                ))}
              </>
            )}
          </DropdownPill>
        </div>

        <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <HeroNumber label={suffix ? `Daily sales — ${suffix}` : "Daily sales"} value={formatMoneyCompact(current.revenueCents)}
            changePct={changes?.revenue ?? null} comparedTo={comparedTo} side="first" />
          <HeroNumber label={suffix ? `Daily unique customers — ${suffix}` : "Daily unique customers"} value={formatInt(current.customers)}
            changePct={changes?.customers ?? null} comparedTo={comparedTo} side="middle" />
          <HeroNumber label={suffix ? `Daily orders — ${suffix}` : "Daily orders"} value={formatInt(current.orders)}
            changePct={changes?.orders ?? null} comparedTo={comparedTo} side="last" />
        </div>
      </div>

      {noData
        ? <p className="text-[12.5px] text-ink-3">No orders in this slice on {formatDay(date)}.</p>
        : <OverviewGlance orders={orders} cmpOrders={cmpOrders} channel={channel} channelLabel={channelLabel} category={category} comparedTo={comparedTo} />}
    </div>
  );
}

function HeroNumber({ label, value, changePct, comparedTo, side }: {
  label: string; value: string; changePct: number | null; comparedTo: string; side: "first" | "middle" | "last";
}) {
  const up = (changePct ?? 0) >= 0;
  const padding = side === "first" ? "pb-4 sm:pb-0 sm:pr-7" : side === "last" ? "pt-4 sm:pt-0 sm:pl-7" : "py-4 sm:py-0 sm:px-7";
  return (
    <div className={`flex flex-col gap-1.5 ${padding}`}>
      <span className="text-[13px] font-medium text-ink-3">{label}</span>
      <span className="font-display text-[52px] leading-none font-semibold text-ink">{value}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
        {changePct == null ? <span className="rounded-full bg-muted-soft px-[7px] py-0.5 font-semibold">—</span> : (
          <span className={`rounded-full px-[7px] py-0.5 font-semibold ${up ? "bg-ok-soft text-ok" : "bg-muted-soft text-ink-2"}`}>
            {up ? "↑" : "↓"} {Math.abs(changePct).toFixed(1)}%
          </span>
        )}
        <span>vs {comparedTo}</span>
      </span>
    </div>
  );
}

/** A filter rendered as a bordered, icon-led pill button that opens a small listbox below
 * it — replacing the earlier dotted-underline sentence style, which tested as too easy to
 * miss as interactive. `fg`/`bg`/`border` let the marketplace pill carry that marketplace's
 * own color once one is selected (see MARKET_THEME); the category pill stays neutral and
 * differentiates by icon instead (categories have no brand color to borrow). */
function DropdownPill({ ariaLabel, iconD, label, active, fg, bg, border, children }: {
  ariaLabel: string; iconD: string; label: string; active: boolean;
  fg?: string; bg?: string; border?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={active ? { color: fg, backgroundColor: bg, borderColor: border } : undefined}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-[13.5px] font-semibold text-ink-2 shadow-xs transition-colors hover:border-accent-line">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-[15px] shrink-0" aria-hidden><path d={iconD} /></svg>
        {label}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-2.5 shrink-0 text-ink-3" aria-hidden><path d="M4 6l4 4 4-4" /></svg>
      </button>
      {open && (
        <ul role="listbox" aria-label={ariaLabel} className="absolute left-0 top-[calc(100%+6px)] z-10 min-w-[200px] overflow-hidden rounded-[10px] border border-line bg-surface py-1 shadow-md">
          {children(() => setOpen(false))}
        </ul>
      )}
    </span>
  );
}

function DropdownOption({ onClick, selected, dot, iconD, children }: {
  onClick: () => void; selected: boolean; dot?: string; iconD?: string; children: React.ReactNode;
}) {
  return (
    <li>
      <button type="button" role="option" aria-selected={selected} onClick={onClick}
        className={`flex w-full items-center gap-2.5 px-3 py-[7px] text-left text-[13.5px] transition-colors hover:bg-surface-2 ${selected ? "font-semibold text-ink" : "text-ink-2"}`}>
        {dot && <span className="size-[7px] shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
        {iconD && (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0 text-ink-3" aria-hidden><path d={iconD} /></svg>
        )}
        <span className="flex-1">{children}</span>
        {selected && <span aria-hidden className="text-accent">✓</span>}
      </button>
    </li>
  );
}
