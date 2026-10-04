import type { ChannelId } from "@/app/_lib/types";

/** Color follows the marketplace, never its rank, so sorting or a missing day can't repaint one. */
const COLOR: Partial<Record<ChannelId, string>> = {
  shopgoodwill: "var(--mk-shopgoodwill)",
  amazon: "var(--mk-amazon)",
  ebay: "var(--mk-ebay)",
  other: "var(--mk-other)",
  goodwill_books: "var(--mk-other)",
};

export const marketplaceColor = (id: ChannelId) => COLOR[id] ?? "var(--ink4)";
