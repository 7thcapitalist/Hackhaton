"use client";
// The CEO's three numbers (Mission Control kickoff, 2026-10-03; orders promoted to its
// own number 2026-10-03 evening): daily sales, daily unique customers, daily orders —
// switchable by marketplace and category. Default (no filter) renders the exact figures
// the Overview page already fetched — zero extra work. Any filter switches to
// order-level math over `orders`/`cmpOrders`, fetched ungrouped (page.tsx) so every real
// marketplace — including Goodwill Books, Cash Monkey and Upright, previously folded into
// "Other e-comm" — is its own option.
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
//
// 2026-10-04, round 4 (Ryan: cards still reading as empty/white, hero numbers lacked card
// chrome, marketplace filter didn't carry a visual identity onto the page, and a
// single-marketplace filter still showed the exact same count twice — unique customers and
// orders are numerically identical once you've narrowed to one marketplace, since each buyer
// there is counted once per order by construction):
// - Every hero number is now its own bordered, rounded card (bigger radius and a colored top
//   accent strip than OverviewGlance's cards below, plus the larger 44px number it already
//   had) so the three CEO numbers read as the most important thing on the page, not three
//   numbers floating in a row.
// - Picking a marketplace now recolors the page: the top accent strip, card border and the
//   number itself switch from the neutral brand accent to that marketplace's own color
//   (MARKET_THEME), carrying the same identity the filter pill and the rankings below already
//   use. Category-only filtering stays neutral — categories have no brand color to borrow.
// - When a single-marketplace filter makes unique customers and orders the same count, the
//   customers slot swaps to "Daily fees & refunds" (gross minus net — the only other
//   already-fetched number for that slice) instead of repeating the orders figure.
//
// White-and-blue redesign (docs/design/goodwill-theme.md): same numbers and filters, quieter
// form. The three numbers share one hairline-divided surface (no accent strips, no icon
// badges, no recolored numbers); a selected marketplace shows up as its series-color swatch
// next to the filter value and each label, so the identity carries without painting the page.
import { useEffect, useRef, useState } from "react";
import { ChangeText, OverviewGlance } from "./OverviewGlance";
import { matches, type OrderLike } from "./_lib/overview-filters";
import { MARKET_ORDER, MARKET_THEME, type MarketKey, type MarketTheme } from "./_lib/overview-theme";
import { formatDay, formatInt, formatMoneyCompact, pctChange } from "./_lib/format";
import type { PulseTotals } from "./_lib/types";

export type { OrderLike };
// The unfiltered default has no gross data to derive fees from (totals/compareChanges come
// straight from the pulse view, see page.tsx) — only a filtered slice (order-level math over
// `orders`) can ever populate `fees`.
type BaseChanges = { revenue: number | null; customers: number | null; orders: number | null };
type Changes = BaseChanges & { fees: number | null };

type OverviewHeroProps = {
  date: string;
  cmpDate: string | null;
  channelOptions: { id: MarketKey; label: string }[];
  totals: PulseTotals;
  compareChanges: BaseChanges | null;
  orders: OrderLike[];
  cmpOrders: OrderLike[] | null;
};

/** feesCents is gross minus net (fees + refunds + any other deduction already reflected in
 * net) — the only other number available for a slice without Joao's view layer exposing the
 * DB's own feeCents/refundCents columns. Floored at 0 since a slice with no gross data yet
 * (grossCents === netCents) would otherwise show a confusing negative. */
function aggregateTotals(rows: OrderLike[], channelLabel: string | "all", category: string | "all"): PulseTotals & { feesCents: number } {
  const filtered = rows.filter(o => matches(o, channelLabel, category));
  const live = filtered.filter(o => o.status !== "cancelled"); // revenue sums every row (net already reflects refunds); orders/customers exclude cancellations, same as the pulse view
  const revenueCents = filtered.reduce((a, o) => a + o.netCents, 0);
  const grossCents = filtered.reduce((a, o) => a + o.grossCents, 0);
  return {
    revenueCents,
    customers: new Set(live.map(o => o.customerKey)).size,
    orders: live.length,
    feesCents: Math.max(0, grossCents - revenueCents),
  };
}

export function OverviewHero({ date, cmpDate, channelOptions, totals, compareChanges, orders, cmpOrders }: OverviewHeroProps) {
  const [channel, setChannel] = useState<MarketKey | "all">("all");
  const [category, setCategory] = useState<string>("all");

  const categories = [...new Set(orders.map(o => o.category))].sort();
  const channelLabel = channel === "all" ? "all" : channelOptions.find(c => c.id === channel)?.label ?? "all";
  const filtered = channel !== "all" || category !== "all";
  const marketActive = channel !== "all";
  const theme: MarketTheme = MARKET_THEME[channel];

  const filteredTotals = filtered ? aggregateTotals(orders, channelLabel, category) : null;
  const current: PulseTotals = filteredTotals ?? totals;
  const matchedCount = filtered ? orders.filter(o => matches(o, channelLabel, category)).length : null;
  const noData = matchedCount === 0;
  // Filtering to one marketplace makes "unique customers" and "orders" the same count by
  // construction (one buyer per order within a single marketplace) — swap in fees & refunds,
  // an equally-real number for the slice, instead of repeating the orders figure.
  const showFees = filteredTotals != null && filteredTotals.orders > 0 && filteredTotals.customers === filteredTotals.orders;

  const changes: Changes | null = !filtered
    ? (compareChanges ? { ...compareChanges, fees: null } : null)
    : !cmpOrders
      ? null
      : (() => {
          const base = aggregateTotals(cmpOrders, channelLabel, category);
          return {
            revenue: pctChange(current.revenueCents, base.revenueCents),
            customers: pctChange(current.customers, base.customers),
            orders: pctChange(current.orders, base.orders),
            fees: filteredTotals ? pctChange(filteredTotals.feesCents, base.feesCents) : null,
          };
        })();

  const comparedTo = cmpDate ? formatDay(cmpDate) : "prior week";
  const suffix = [channel !== "all" ? channelLabel : null, category !== "all" ? category : null].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterButton
            ariaLabel="Filter by marketplace"
            name="Marketplace"
            value={theme.label}
            swatch={marketActive ? theme.accent : undefined}
            active={marketActive}
          >
            {(close) => (
              <>
                <FilterOption onClick={() => { setChannel("all"); close(); }} selected={channel === "all"}>
                  {MARKET_THEME.all.label}
                </FilterOption>
                {MARKET_ORDER.filter(id => channelOptions.some(c => c.id === id)).map(id => (
                  <FilterOption key={id} onClick={() => { setChannel(id); close(); }} selected={channel === id} swatch={MARKET_THEME[id].accent}>
                    {MARKET_THEME[id].label}
                  </FilterOption>
                ))}
              </>
            )}
          </FilterButton>

          <FilterButton ariaLabel="Filter by category" name="Category" value={category === "all" ? "All categories" : category} active={category !== "all"}>
            {(close) => (
              <>
                <FilterOption onClick={() => { setCategory("all"); close(); }} selected={category === "all"}>
                  All categories
                </FilterOption>
                {categories.map(c => (
                  <FilterOption key={c} onClick={() => { setCategory(c); close(); }} selected={category === c}>
                    {c}
                  </FilterOption>
                ))}
              </>
            )}
          </FilterButton>
        </div>

        {/* One surface split by hairlines, not three floating cards. */}
        <div className="grid grid-cols-1 divide-y divide-line rounded-lg border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <HeroNumber label={suffix ? `Daily sales (${suffix})` : "Daily sales"} value={formatMoneyCompact(current.revenueCents)}
            changePct={changes?.revenue ?? null} comparedTo={comparedTo} swatch={marketActive ? theme.accent : undefined} />
          {showFees ? (
            <HeroNumber label={suffix ? `Daily fees & refunds (${suffix})` : "Daily fees & refunds"} value={formatMoneyCompact(filteredTotals!.feesCents)}
              changePct={changes?.fees ?? null} comparedTo={comparedTo} swatch={marketActive ? theme.accent : undefined} />
          ) : (
            <HeroNumber label={suffix ? `Daily unique customers (${suffix})` : "Daily unique customers"} value={formatInt(current.customers)}
              changePct={changes?.customers ?? null} comparedTo={comparedTo} swatch={marketActive ? theme.accent : undefined} />
          )}
          <HeroNumber label={suffix ? `Daily orders (${suffix})` : "Daily orders"} value={formatInt(current.orders)}
            changePct={changes?.orders ?? null} comparedTo={comparedTo} swatch={marketActive ? theme.accent : undefined} />
        </div>
      </div>

      {noData
        ? <p className="text-[13px] text-ink-3">No orders in this slice on {formatDay(date)}.</p>
        : <OverviewGlance orders={orders} cmpOrders={cmpOrders} channel={channel} channelLabel={channelLabel} category={category} comparedTo={comparedTo} />}
    </div>
  );
}

function HeroNumber({ label, value, changePct, comparedTo, swatch }: {
  label: string; value: string; changePct: number | null; comparedTo: string; swatch?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 py-3 sm:px-5 sm:py-4">
      <span className="flex items-center gap-2 text-[13px] text-ink-2">
        {swatch && <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: swatch }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink sm:text-[30px]">{value}</span>
      <span className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-3">
        <ChangeText pct={changePct} />
        <span>vs {comparedTo}</span>
      </span>
    </div>
  );
}

/** A filter as a quiet bordered button ("Marketplace  All marketplaces") that opens a small
 * listbox below it. A selected marketplace shows its series color as a small swatch, the same
 * color its bar uses in the breakdown below; categories have no color and show text only. */
function FilterButton({ ariaLabel, name, value, swatch, active, children }: {
  ariaLabel: string; name: string; value: string; swatch?: string; active: boolean;
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
    <span ref={ref} className="relative inline-block max-w-full">
      <button type="button" aria-label={`${ariaLabel}: ${value}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={`inline-flex h-8 max-w-full items-center gap-2 rounded-md border bg-surface px-2.5 text-[13px] transition-colors hover:border-ink-4 focus-visible:outline-2 focus-visible:outline-accent ${active ? "border-accent-line" : "border-line"}`}>
        <span className="text-ink-3">{name}</span>
        {swatch && <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: swatch }} />}
        <span className="truncate font-medium text-ink">{value}</span>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="size-3 shrink-0 text-ink-3" aria-hidden><path d="M4 6l4 4 4-4" /></svg>
      </button>
      {open && (
        <ul role="listbox" aria-label={ariaLabel} className="absolute left-0 top-[calc(100%+4px)] z-10 max-h-[320px] min-w-[200px] overflow-auto rounded-md border border-line bg-surface py-1 shadow-pop">
          {children(() => setOpen(false))}
        </ul>
      )}
    </span>
  );
}

function FilterOption({ onClick, selected, swatch, children }: {
  onClick: () => void; selected: boolean; swatch?: string; children: React.ReactNode;
}) {
  return (
    <li>
      <button type="button" role="option" aria-selected={selected} onClick={onClick}
        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2 ${selected ? "font-medium text-accent" : "text-ink-2"}`}>
        <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: swatch ?? "transparent" }} />
        <span className="flex-1">{children}</span>
        {selected && <span aria-hidden className="text-accent">✓</span>}
      </button>
    </li>
  );
}
