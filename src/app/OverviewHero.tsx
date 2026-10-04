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
import { useEffect, useRef, useState } from "react";
import { OverviewGlance } from "./OverviewGlance";
import { matches, type OrderLike } from "./_lib/overview-filters";
import { ALL_CATEGORIES_ICON, categoryIcon, MARKET_ICON, MARKET_ORDER, MARKET_THEME, type MarketKey, type MarketTheme } from "./_lib/overview-theme";
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
  moverBaseline: OrderLike[][]; // the same weekday over the previous 4 weeks (days with data only), for the mover card
  weekday: string;
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

const SALES_ICON = "M8 2.3a5.7 5.7 0 1 0 0 11.4 5.7 5.7 0 0 0 0-11.4z M8 4.5v7M6.2 10.2c.3.5.9.8 1.8.8 1.1 0 1.8-.5 1.8-1.3 0-.9-.7-1.1-1.8-1.4-1.1-.3-1.8-.6-1.8-1.4 0-.8.7-1.3 1.8-1.3.8 0 1.4.3 1.7.7";
const CUSTOMERS_ICON = "M8 8a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 8 8z M3 13.3c0-2.4 2.2-3.9 5-3.9s5 1.5 5 3.9";
const ORDERS_ICON = "M2.5 5.3 8 2.8l5.5 2.5v6L8 13.8l-5.5-2.5z M2.5 5.3 8 7.8l5.5-2.5M8 7.8v6";
const FEES_ICON = "M4 2h8v12l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z M6 5h4M6 7.5h4M6 10h2";

export function OverviewHero({ date, cmpDate, channelOptions, totals, compareChanges, orders, cmpOrders, moverBaseline, weekday }: OverviewHeroProps) {
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
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <DropdownPill
            ariaLabel="Filter by marketplace"
            iconD={MARKET_ICON}
            label={`Marketplace: ${theme.label}`}
            active={marketActive}
            fg={theme.accent}
            bg={marketActive ? theme.soft : undefined}
            border={marketActive ? theme.line : undefined}
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <HeroNumber icon={SALES_ICON} label={suffix ? `Daily sales — ${suffix}` : "Daily sales"} value={formatMoneyCompact(current.revenueCents)}
            changePct={changes?.revenue ?? null} comparedTo={comparedTo} theme={theme} active={marketActive} />
          {showFees ? (
            <HeroNumber icon={FEES_ICON} label={suffix ? `Daily fees & refunds — ${suffix}` : "Daily fees & refunds"} value={formatMoneyCompact(filteredTotals!.feesCents)}
              changePct={changes?.fees ?? null} comparedTo={comparedTo} theme={theme} active={marketActive} />
          ) : (
            <HeroNumber icon={CUSTOMERS_ICON} label={suffix ? `Daily unique customers — ${suffix}` : "Daily unique customers"} value={formatInt(current.customers)}
              changePct={changes?.customers ?? null} comparedTo={comparedTo} theme={theme} active={marketActive} />
          )}
          <HeroNumber icon={ORDERS_ICON} label={suffix ? `Daily orders — ${suffix}` : "Daily orders"} value={formatInt(current.orders)}
            changePct={changes?.orders ?? null} comparedTo={comparedTo} theme={theme} active={marketActive} />
        </div>
      </div>

      {noData
        ? <p className="text-[12.5px] text-ink-3">No orders in this slice on {formatDay(date)}.</p>
        : <OverviewGlance orders={orders} cmpOrders={cmpOrders} moverBaseline={moverBaseline} weekday={weekday} channel={channel} channelLabel={channelLabel} category={category} comparedTo={comparedTo} />}
    </div>
  );
}

function HeroNumber({ icon, label, value, changePct, comparedTo, theme, active }: {
  icon: string; label: string; value: string; changePct: number | null; comparedTo: string; theme: MarketTheme; active: boolean;
}) {
  const up = (changePct ?? 0) >= 0;
  return (
    <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-[16px] border border-line bg-surface p-5 pt-[18px]" style={active ? { borderColor: theme.line } : undefined}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: theme.accent }} />
      <div className="flex items-center gap-2">
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: theme.soft, color: theme.accent }}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden><path d={icon} /></svg>
        </span>
        <span className="text-[13px] font-medium text-ink-3">{label}</span>
      </div>
      <span className="font-display text-[52px] leading-none font-semibold text-ink" style={active ? { color: theme.accent } : undefined}>{value}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
        {changePct == null ? <span className="rounded-full bg-muted-soft px-[7px] py-0.5 font-semibold">—</span> : (
          <span className={`rounded-full px-[7px] py-0.5 font-semibold ${up ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
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
