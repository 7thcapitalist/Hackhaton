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
// 2026-10-04, Daily/Monthly toggle (Ryan: keep Daily exactly as it is, add a way to switch
// to the same cards for the month): a small segmented control next to the marketplace/
// category filters. Monthly reuses every card below unchanged — OverviewGlance never
// learns about the toggle, it just gets handed the month's orders instead of today's, with
// `weekday="month"` so its "vs a typical X" / "no earlier X" copy reads correctly without
// any branching on its end. Monthly's hero numbers always come from aggregateTotals over the
// month's raw rows (there's no monthly equivalent of the pulse view's precomputed `totals`),
// compared against the prior calendar month — simpler than Daily's weekday-matched baseline,
// since there's no real "same month 4 times" history to average over yet.
//
// 2026-10-04, load Monthly on demand (code review on #67, Joao): the first version had
// page.tsx fetch both full months up front and ship every row to the client on every Overview
// visit — ~11k rows, 320KB -> 2.9MB, 0.17s -> ~1s locally, ~12 extra Turso round-trips in
// production, paid whether or not anyone ever opens Monthly. Now page.tsx only passes the
// period strings; this component fetches the rows itself, through the existing
// GET /api/views/orders?period=... route, the first time `view` becomes "monthly", and caches
// the result so switching back and forth doesn't refetch. Daily's cost on every load is back
// to exactly what it was before this toggle existed.
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
  monthPeriod: string; // "YYYY-MM" — fetched client-side on demand, see the 2026-10-04 note above
  monthPrevPeriod: string;
  monthLabel: string; // e.g. "September 2026"
  monthPrevLabel: string; // e.g. "August 2026"
};

const ORDERS_API_LIMIT = 1000; // mirrors ORDERS_MAX_LIMIT (src/lib/views/orders.ts) — the API route enforces the same cap

/** The handful of fields GET /api/views/orders returns that building an OrderLike needs. */
type RawOrderRow = {
  channel: string;
  sourceId: string;
  externalOrderId: string;
  buyerKey: string | null;
  category: string | null;
  grossCents: number;
  netCents: number;
  status: string;
};

/** Client-side mirrors of page.tsx's marketKeyOf/rawOrderLike and _lib/data.ts's
 * customerKeyOf. Duplicated rather than imported: those live in (or pull in, via _lib/data.ts)
 * server-only DB-backed modules that can't be bundled into this "use client" file. Pure
 * one-liners — keep in sync with page.tsx / _lib/data.ts if the real definitions change. */
function clientMarketKeyOf(o: RawOrderRow): MarketKey {
  if (o.channel !== "other") return o.channel as MarketKey;
  return o.sourceId === "cashmonkey" ? "cashmonkey" : o.sourceId === "upright" ? "upright" : "other";
}
function clientRawOrderLike(o: RawOrderRow): OrderLike {
  return {
    channelLabel: MARKET_THEME[clientMarketKeyOf(o)].label,
    category: o.category ?? "Uncategorized",
    netCents: o.netCents,
    grossCents: o.grossCents,
    status: o.status,
    orderId: o.externalOrderId,
    customerKey: o.buyerKey ? `b:${o.channel}:${o.buyerKey}` : `t:${o.channel}:${o.externalOrderId}`,
  };
}

/** Every order in a period, ungrouped — paginated the same way page.tsx's daily fetches never
 * needed to (a full month runs several thousand rows, well over the API's 1000-row cap):
 * fetch page 1, read the real total off it, then fetch whatever's left in parallel. */
async function fetchAllOrdersForPeriod(period: string): Promise<OrderLike[]> {
  const page = async (offset: number) => {
    const res = await fetch(`/api/views/orders?period=${period}&limit=${ORDERS_API_LIMIT}&offset=${offset}`);
    if (!res.ok) throw new Error(`GET /api/views/orders?period=${period} failed: ${res.status}`);
    return res.json() as Promise<{ rows: RawOrderRow[]; total: number }>;
  };
  const first = await page(0);
  const offsets: number[] = [];
  for (let offset = ORDERS_API_LIMIT; offset < first.total; offset += ORDERS_API_LIMIT) offsets.push(offset);
  const rest = offsets.length ? await Promise.all(offsets.map(page)) : [];
  return [first.rows, ...rest.map(r => r.rows)].flat().map(clientRawOrderLike);
}

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

export function OverviewHero({ date, cmpDate, channelOptions, totals, compareChanges, orders, cmpOrders, moverBaseline, weekday, monthPeriod, monthPrevPeriod, monthLabel, monthPrevLabel }: OverviewHeroProps) {
  const [channel, setChannel] = useState<MarketKey | "all">("all");
  const [category, setCategory] = useState<string>("all");
  const [view, setView] = useState<"daily" | "monthly">("daily");

  // null = not fetched yet (or in flight); loads once, the first time Monthly is opened, and
  // is kept around so switching back and forth doesn't refetch ~11k rows every time.
  const [monthData, setMonthData] = useState<{ orders: OrderLike[]; prevOrders: OrderLike[] } | null>(null);
  const [monthLoadError, setMonthLoadError] = useState(false);
  useEffect(() => {
    if (view !== "monthly" || monthData || monthLoadError) return;
    let cancelled = false;
    Promise.all([fetchAllOrdersForPeriod(monthPeriod), fetchAllOrdersForPeriod(monthPrevPeriod)])
      .then(([curOrders, prevOrders]) => { if (!cancelled) setMonthData({ orders: curOrders, prevOrders }); })
      .catch(() => { if (!cancelled) setMonthLoadError(true); });
    return () => { cancelled = true; };
  }, [view, monthData, monthLoadError, monthPeriod, monthPrevPeriod]);
  const monthOrders = monthData?.orders ?? [];
  const monthPrevOrders = monthData?.prevOrders ?? [];

  // Union of today's and this month's categories/marketplaces, so switching to Monthly never
  // hides an option that only shows up over the month, not today — before Monthly loads, this
  // is just today's categories, same as it's always been.
  const categories = [...new Set([...orders, ...monthOrders].map(o => o.category))].sort();
  const channelLabel = channel === "all" ? "all" : channelOptions.find(c => c.id === channel)?.label ?? "all";
  const filtered = channel !== "all" || category !== "all";
  const marketActive = channel !== "all";
  const theme: MarketTheme = MARKET_THEME[channel];
  const labelPrefix = view === "daily" ? "Daily" : "Monthly";

  const dailyTotals = filtered ? aggregateTotals(orders, channelLabel, category) : null;
  const dailyCurrent: PulseTotals = dailyTotals ?? totals;
  const dailyMatchedCount = filtered ? orders.filter(o => matches(o, channelLabel, category)).length : null;
  const dailyNoData = dailyMatchedCount === 0;
  // Filtering to one marketplace makes "unique customers" and "orders" the same count by
  // construction (one buyer per order within a single marketplace) — swap in fees & refunds,
  // an equally-real number for the slice, instead of repeating the orders figure.
  const dailyShowFees = dailyTotals != null && dailyTotals.orders > 0 && dailyTotals.customers === dailyTotals.orders;
  const dailyChanges: Changes | null = !filtered
    ? (compareChanges ? { ...compareChanges, fees: null } : null)
    : !cmpOrders
      ? null
      : (() => {
          const base = aggregateTotals(cmpOrders, channelLabel, category);
          return {
            revenue: pctChange(dailyCurrent.revenueCents, base.revenueCents),
            customers: pctChange(dailyCurrent.customers, base.customers),
            orders: pctChange(dailyCurrent.orders, base.orders),
            fees: dailyTotals ? pctChange(dailyTotals.feesCents, base.feesCents) : null,
          };
        })();

  // Monthly mirrors Daily's filtered math exactly, but there's no monthly equivalent of the
  // pulse view's precomputed `totals` — every monthly number comes from aggregateTotals over
  // the month's own raw rows, filtered or not.
  const monthTotals = aggregateTotals(monthOrders, channelLabel, category);
  const monthMatchedCount = monthOrders.filter(o => matches(o, channelLabel, category)).length;
  const monthNoData = monthMatchedCount === 0;
  const monthShowFees = monthTotals.orders > 0 && monthTotals.customers === monthTotals.orders;
  const monthPrevTotals = monthPrevOrders.length ? aggregateTotals(monthPrevOrders, channelLabel, category) : null;
  const monthChanges: Changes | null = !monthPrevTotals ? null : {
    revenue: pctChange(monthTotals.revenueCents, monthPrevTotals.revenueCents),
    customers: pctChange(monthTotals.customers, monthPrevTotals.customers),
    orders: pctChange(monthTotals.orders, monthPrevTotals.orders),
    fees: pctChange(monthTotals.feesCents, monthPrevTotals.feesCents),
  };

  const current: PulseTotals = view === "daily" ? dailyCurrent : monthTotals;
  const filteredTotals = view === "daily" ? dailyTotals : monthTotals;
  const changes = view === "daily" ? dailyChanges : monthChanges;
  const showFees = view === "daily" ? dailyShowFees : monthShowFees;
  // monthOrders is [] both while Monthly hasn't loaded yet *and* in the (rare) case a month
  // genuinely has zero orders — monthLoading disambiguates so a fetch in flight never reads
  // as "no orders this month" for a moment.
  const monthLoading = view === "monthly" && !monthData && !monthLoadError;
  const noData = view === "daily" ? dailyNoData : monthNoData;

  const comparedTo = view === "daily" ? (cmpDate ? formatDay(cmpDate) : "prior week") : monthPrevLabel;
  const suffix = [channel !== "all" ? channelLabel : null, category !== "all" ? category : null].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
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

          <ViewToggle view={view} onChange={setView} />
        </div>

        {!monthLoading && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HeroNumber icon={SALES_ICON} label={suffix ? `${labelPrefix} sales — ${suffix}` : `${labelPrefix} sales`} value={formatMoneyCompact(current.revenueCents)}
              changePct={changes?.revenue ?? null} comparedTo={comparedTo} theme={theme} active={marketActive} />
            {showFees ? (
              <HeroNumber icon={FEES_ICON} label={suffix ? `${labelPrefix} fees & refunds — ${suffix}` : `${labelPrefix} fees & refunds`} value={formatMoneyCompact(filteredTotals!.feesCents)}
                changePct={changes?.fees ?? null} comparedTo={comparedTo} theme={theme} active={marketActive} />
            ) : (
              <HeroNumber icon={CUSTOMERS_ICON} label={suffix ? `${labelPrefix} unique customers — ${suffix}` : `${labelPrefix} unique customers`} value={formatInt(current.customers)}
                changePct={changes?.customers ?? null} comparedTo={comparedTo} theme={theme} active={marketActive} />
            )}
            <HeroNumber icon={ORDERS_ICON} label={suffix ? `${labelPrefix} orders — ${suffix}` : `${labelPrefix} orders`} value={formatInt(current.orders)}
              changePct={changes?.orders ?? null} comparedTo={comparedTo} theme={theme} active={marketActive} />
          </div>
        )}
      </div>

      {monthLoading ? (
        <div className="flex items-center justify-center gap-2.5 rounded-[14px] border border-line bg-surface px-4 py-10 text-[13px] text-ink-3">
          <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />
          Loading {monthLabel}…
        </div>
      ) : view === "monthly" && monthLoadError ? (
        <p className="text-[12.5px] text-bad">Couldn&apos;t load {monthLabel}&apos;s data — try switching back to Daily and reopening Monthly.</p>
      ) : noData ? (
        <p className="text-[12.5px] text-ink-3">No orders in this slice {view === "daily" ? `on ${formatDay(date)}` : `in ${monthLabel}`}.</p>
      ) : view === "daily" ? (
        <OverviewGlance orders={orders} cmpOrders={cmpOrders} moverBaseline={moverBaseline} weekday={weekday} now="today" channel={channel} channelLabel={channelLabel} category={category} comparedTo={comparedTo} />
      ) : (
        // Monthly reuses OverviewGlance unchanged: monthPrevOrders doubles as both the
        // "vs last month" comparison and the (single-entry) mover baseline, and
        // weekday="month" makes its "vs a typical X" / "no earlier X" copy read correctly
        // with no branching on OverviewGlance's end (base.length === 1 takes the same
        // "the last X" phrasing the daily card uses when there's only one prior day).
        <OverviewGlance orders={monthOrders} cmpOrders={monthPrevOrders.length ? monthPrevOrders : null} moverBaseline={monthPrevOrders.length ? [monthPrevOrders] : []} weekday="month" now="this month" channel={channel} channelLabel={channelLabel} category={category} comparedTo={comparedTo} />
      )}
    </div>
  );
}

function HeroNumber({ icon, label, value, changePct, comparedTo, theme, active }: {
  icon: string; label: string; value: string; changePct: number | null; comparedTo: string; theme: MarketTheme; active: boolean;
}) {
  const up = (changePct ?? 0) >= 0;
  return (
    <div className="relative flex flex-col gap-1.5 overflow-hidden rounded-[16px] border border-line bg-surface p-3.5 pt-3" style={active ? { borderColor: theme.line } : undefined}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: theme.accent }} />
      <div className="flex items-center gap-2">
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: theme.soft, color: theme.accent }}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden><path d={icon} /></svg>
        </span>
        <span className="text-[13px] font-medium text-ink-3">{label}</span>
      </div>
      <span className="font-display text-[34px] leading-none font-semibold text-ink" style={active ? { color: theme.accent } : undefined}>{value}</span>
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

/** Daily/Monthly switch for the whole hero + "at a glance" row below it — a two-segment
 * control matching Button.tsx's primary-button tokens (bg-accent/text-accent-ink) for the
 * selected side, sized to sit flush with the filter pills beside it. */
function ViewToggle({ view, onChange }: { view: "daily" | "monthly"; onChange: (v: "daily" | "monthly") => void }) {
  return (
    <div role="tablist" aria-label="Time range" className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface p-[3px] shadow-xs">
      {(["daily", "monthly"] as const).map(v => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3.5 py-[7px] text-[13.5px] font-semibold capitalize transition-colors ${
            view === v ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          {v}
        </button>
      ))}
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
