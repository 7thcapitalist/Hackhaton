import type { PulseExportData, ScorecardExportData } from "../types";

// Explicitly synthetic test inputs. They are not a production fallback or seed.
export const samplePulse: PulseExportData = {
  businessDate: "2026-10-02", timezone: "America/Indiana/Indianapolis", isSynthetic: true,
  rows: [
    { channelId: "ebay", label: 'eBay, "Livros"\nMichiana', status: "ok", revenueCents: 123456, customers: 12, orders: 15 },
    { channelId: "amazon", label: "Amazon", status: "ok", revenueCents: -105, customers: 0, orders: 0 },
    { channelId: "other", label: "Other", status: "missing", revenueCents: null, customers: null, orders: null },
  ],
  totals: { revenueCents: 90000, customers: 11, orders: 14 },
  missingChannels: ["other"],
};

export const sampleScorecard: ScorecardExportData = {
  period: "2026-09",
  kpis: [
    { group: "coo15", id: "revenue", label: "Total E-Commerce Revenue", pillar: "financial", unit: "cents",
      value: 123456, previous: 100000, target: 140000, status: "simulated", anchor2027: false },
    { group: "coo15", id: "growth", label: "Revenue Growth", pillar: "financial", unit: "percent",
      value: 25.5, previous: 20, target: 30, status: "simulated", anchor2027: false },
    { group: "coo15", id: "net_margin", label: "Net Margin", pillar: "financial", unit: "percent",
      value: 0.15, previous: 0.1, target: 0.2, status: "simulated", anchor2027: true,
      note: "Percent values are percentage points; this test must not multiply them." },
    { group: "coo15", id: "listings", label: "Listings Created", pillar: "productivity", unit: "count",
      value: 99, previous: 75, target: 100, status: "simulated", anchor2027: false },
    { group: "coo15", id: "revenue_per_hour", label: "Revenue per Labor Hour", pillar: "productivity", unit: "cents_per_hour",
      value: 1234.5, previous: 1100, target: 1500, status: "simulated", anchor2027: true },
    { group: "coo15", id: "listings_per_employee", label: "Listings per Employee", pillar: "productivity", unit: "ratio",
      value: 12.5, previous: 10, target: 15, status: "simulated", anchor2027: false },
    { group: "coo15", id: "donation_to_listing", label: "Days from Donation to Listing", pillar: "inventory", unit: "days",
      value: 2.5, previous: 3, target: 2, status: "simulated", anchor2027: false },
    { group: "coo15", id: "backlog", label: "Unlisted Inventory Backlog", pillar: "inventory", unit: "count",
      value: null, previous: null, target: null, status: "awaiting_data", anchor2027: false },
    { group: "coo15", id: "unsold", label: "Unsold Inventory", pillar: "inventory", unit: "percent",
      value: 0, previous: 1, target: 0, status: "simulated", anchor2027: false },
    { group: "coo15", id: "asp", label: "Average Selling Price", pillar: "sales", unit: "cents",
      value: 2500, previous: 2400, target: 2600, status: "simulated", anchor2027: false },
    { group: "coo15", id: "sell_through", label: "Sell-Through Rate", pillar: "sales", unit: "percent",
      value: 0.2, previous: 0.19, target: 0.25, status: "simulated", anchor2027: true },
    { group: "coo15", id: "sales_per_employee", label: "Sales per Employee", pillar: "sales", unit: "cents",
      value: 500000, previous: 450000, target: 550000, status: "simulated", anchor2027: false },
    { group: "coo15", id: "top_revenue", label: "Top Categories by Revenue", pillar: "category_customer", unit: "count",
      value: 10, previous: 10, target: null, status: "simulated", anchor2027: false },
    { group: "coo15", id: "top_margin", label: "Top Categories by Margin", pillar: "category_customer", unit: "count",
      value: 10, previous: 10, target: null, status: "simulated", anchor2027: false },
    { group: "coo15", id: "repeat_buyers", label: "Repeat Buyer Rate", pillar: "category_customer", unit: "percent",
      value: 0.12, previous: 0.11, target: 0.15, status: "simulated", anchor2027: false },
  ],
  topCategoriesByRevenue: [{ category: "Books & Media", revenueCents: 50000 }, { category: "=Not a formula", revenueCents: 25000 }],
  topCategoriesByMargin: [{ category: "Jewelry", marginCents: -105 }, { category: "Books & Media", marginCents: 20000 }],
  categories: [
    { category: "Books & Media", revenueCents: 12345, marginCents: -105, units: 4, sellThroughPct: 50, aspCents: 2000 },
    { category: "Other", revenueCents: 0, marginCents: 0, units: 0, sellThroughPct: null, aspCents: null },
  ],
  marketplaceMetrics: [
    { channel: "ebay", csat: 4.8, nps: -15, conversionRate: 2.4, sellerRating: 4.9 },
    { channel: "amazon", csat: null, nps: null, conversionRate: null, sellerRating: null },
  ],
};
