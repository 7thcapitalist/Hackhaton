// Overview-only presentation data: a color per real source (so the filter and the
// rankings carry each one's own identity) and an icon per product category (shape-only
// identity, not color — see note below). Nothing here is shared with Daily Pulse or any
// other screen; it only feeds OverviewHero.tsx / OverviewGlance.tsx.
//
// 2026-10-04: switched shopgoodwill/amazon/ebay/other/"all" from this file's own hardcoded
// hex to the shared --mk-* tokens + --accent that landed in globals.css meanwhile (read-only
// here — that file and src/components/marketplaceColors.ts are Gabriel's lane). Picking them
// up means these colors now (a) match the dots Daily Pulse's own chart already uses for the
// same marketplaces, and (b) get real dark-mode values for free, instead of this file's old
// flat hex pair that only looked right in light mode — the caveat flagged in the previous
// round. "soft"/"line" (the active-pill tint/border, and now the whole page's reactive
// theming — see MarketKey below) are derived from the same var with color-mix() rather than
// hand-picked, so they stay correct in both themes too.
//
// Goodwill Books, Cash Monkey and Upright have no shared token yet (the shared --mk-* system
// still files all three under --mk-other, same as Daily Pulse's "Other e-comm" row) — Ryan
// asked the filter to give each real source its own identity rather than fold them together,
// so they keep one-off hex values here, picked to sit clearly apart from eBay's teal and
// Amazon's tan now that those are the shared colors. Promoting them to real --mk-* tokens
// (Gabriel's lane) would be the cleaner long-term fix.
//
// Categories don't get colors: the app's token system only has one accent hue stepped by
// lightness (--s1..--s4) plus the new marketplace set above, neither a categorical palette,
// so color-per-category would still need new shared tokens. Icon-per-category gives each one
// a distinct identity without touching any shared file.
import type { ChannelId } from "./types";

/** 2026-10-04: "Other e-comm" was a real blend of two very different operations (Cash
 * Monkey's own storefront, and Upright reselling items across several channels) with no way
 * to tell them apart — Ryan asked to split it open rather than fold it. channel="other"
 * orders are regrouped by their real source id (page.tsx's marketKeyOf); cashmonkey/upright
 * aren't ChannelId values in the schema (they're sources, not pulse channels), so the
 * Overview-only filter key is its own union, one wider than ChannelId. "other" survives as a
 * small residual bucket for any future source that lands under that channel without a name
 * of its own here yet. */
export type MarketKey = ChannelId | "cashmonkey" | "upright";

export type MarketTheme = { label: string; accent: string; soft: string; line: string };

/** `soft`/`line` are derived from `accent` with color-mix() against the surface color, so
 * an active filter pill's tint/border — and the reactive page theming below — stay correct
 * in both themes without a second hardcoded pair per source. */
function tint(accent: string): Pick<MarketTheme, "soft" | "line"> {
  return { soft: `color-mix(in srgb, ${accent} 14%, var(--surface))`, line: `color-mix(in srgb, ${accent} 38%, var(--surface))` };
}

export const MARKET_THEME: Record<MarketKey | "all", MarketTheme> = {
  all: { label: "All marketplaces", accent: "var(--accent)", ...tint("var(--accent)") },
  shopgoodwill: { label: "ShopGoodwill", accent: "var(--mk-shopgoodwill)", ...tint("var(--mk-shopgoodwill)") },
  amazon: { label: "Amazon", accent: "var(--mk-amazon)", ...tint("var(--mk-amazon)") },
  ebay: { label: "eBay", accent: "var(--mk-ebay)", ...tint("var(--mk-ebay)") },
  goodwill_books: { label: "Goodwill Books", accent: "#9b5a7a", ...tint("#9b5a7a") },
  cashmonkey: { label: "Cash Monkey", accent: "#93721c", ...tint("#93721c") },
  upright: { label: "Upright", accent: "#5f7a6b", ...tint("#5f7a6b") },
  other: { label: "Other e-comm", accent: "var(--mk-other)", ...tint("var(--mk-other)") },
};

/** Fixed, sensible display order for the marketplace list (not raw-data insertion order). */
export const MARKET_ORDER: MarketKey[] = ["shopgoodwill", "amazon", "ebay", "goodwill_books", "cashmonkey", "upright", "other"];

/** Single-path (viewBox 0 0 16 16) line icons, matching src/components/icons.tsx's style
 * (stroke="currentColor", round caps/joins). A category not listed here falls back to
 * DEFAULT_CATEGORY_ICON, so an unexpected category never breaks the UI. */
const CATEGORY_ICON: Record<string, string> = {
  Watches: "M8 2.2a5.8 5.8 0 1 0 0.01 0z M8 5.4v2.9l2 1.4",
  Electronics: "M4 4h8v8H4z M6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2",
  Jewelry: "M3 6 8 2l5 4-5 8z M3 6h10M8 2v12",
  Shoes: "M2 11.5c0-2 1.5-3 3-3.5l3.5-2c1-.6 2 .1 2 1.2v1.3c2 .2 3.5 1.2 3.5 3v1H2.5c-.3 0-.5-.2-.5-.5z",
  Kitchen: "M3 6h10v2a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z M1.5 6.5h1.5M13 6.5h1.5M8 4V2",
  Collectibles: "M8 2l1.6 3.3 3.6.5-2.6 2.6.6 3.6L8 10.3 4.8 12l.6-3.6L2.8 5.8l3.6-.5z",
  Books: "M8 3C6.5 2.3 4.5 2 2.5 2.3V12c2-.3 4 0 5.5.7 1.5-.7 3.5-1 5.5-.7V2.3C11.5 2 9.5 2.3 8 3z",
  Clothing: "M5 2 2 4.5 3.5 7 5 6V14h6V6l1.5 1L14 4.5 11 2 9.5 3.5h-3z",
  Furniture: "M2.5 9.5h11v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z M3.5 9.5V6a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 12.5 6v3.5",
  Art: "M8 2.3a5.8 5.8 0 1 0 1.4 11.4c.6-.1.9-.7.6-1.2-.2-.4 0-.9.5-1a4.3 4.3 0 0 0 3.4-4.2c0-2.7-2.7-5-5.9-5z M5.8 7a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8zM9 5.6a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z",
  Handbags: "M4.5 6V4.5a3.5 3.5 0 0 1 7 0V6M2.5 6h11l-.8 7.5a1 1 0 0 1-1 .9H4.3a1 1 0 0 1-1-.9z",
  "Home Decor": "M2 8.5 8 3l6 5.5M4 7.5V13h8V7.5",
  "Sporting Goods": "M8 2.3a5.7 5.7 0 1 0 0 11.4 5.7 5.7 0 0 0 0-11.4z M8 2.3v11.4M2.3 8h11.4M3.5 4.5c2.5 2 6.5 2 9 0M3.5 11.5c2.5-2 6.5-2 9 0",
  Toys: "M3 9.5h4v4H3z M9 9.5h4v4H9z M6 2.5h4v4H6z",
};

export const DEFAULT_CATEGORY_ICON = "M2 8.5 8.5 2H13v4.5L6.5 13 2 8.5z M10 5.5h.01";
export const ALL_CATEGORIES_ICON = "M2 4.5h12M4.5 8h7M7 11.5h2";

export function categoryIcon(category: string): string {
  return CATEGORY_ICON[category] ?? DEFAULT_CATEGORY_ICON;
}

/** A generic storefront glyph for the marketplace pill — color (not shape) carries which
 * marketplace is active; see MARKET_THEME. */
export const MARKET_ICON = "M2 5.5 3 2h10l1 3.5M2 5.5v7.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5.5M2 5.5h12M6 8.5v2.5a2 2 0 0 0 4 0V8.5";
