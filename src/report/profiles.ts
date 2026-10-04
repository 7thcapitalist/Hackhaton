import type { ChannelId } from "../lib/views/types";
import { createHash } from "node:crypto";

export type Frequency = "daily" | "monthly";
export type Scope = { kind: "organization" } | { kind: "channel"; channel: ChannelId };
export type Section = "overview" | "trend" | "priorities" | "channels" | "categories" | "operations" | "scorecard" | "readiness" | "exceptions" | "reconciliation" | "close";
export type Dataset = "sales" | "metrics" | "categories" | "quality" | "exceptions" | "close" | "records";
export type Tab = "Overview" | "Indicators" | "Channels" | "Categories" | "Comparisons" | "Transactions" | "Sources" | "Exceptions" | "Close";
export type OrderField = "date" | "channel" | "category" | "gross" | "net" | "status" | "id" | "orderReference" | "source" | "ingest" | "sourceRow";
export interface ReportProfile {
  id: string; label: string; hypothesis: true; scopeKind: Scope["kind"];
  purpose: Record<Frequency, string>;
  reports: Record<Frequency, {
    pages: Section[][]; datasets: Dataset[]; tabs: Tab[]; kpis: "core" | string[];
    comparisons: ("previous_day" | "previous_week" | "previous_7_days" | "previous_month" | "month_to_date")[];
    orderFields: OrderField[]; maxHighlights: number; subjectLabel: string; scorecardTitle?: string; categoryLimit?: number; channelView?: "changes" | "mix"; showOrders?: boolean;
  }>;
  email: { greeting: string; opening: string; optionalNote: string; signature: string };
}
/** Server-owned authority, separate from presentation. No real recipient or role is provisioned. */
export interface DemoAccess {
  mode: "synthetic-demo"; id: string; scope: Scope; datasets: Dataset[]; tabs: Tab[];
  orderFields: OrderField[]; approvedRecipients: readonly []; sendingEnabled: false;
}
const detailFields: OrderField[] = ["date", "channel", "category", "gross", "net", "status", "id", "orderReference", "source", "ingest", "sourceRow"];
const financeFields: OrderField[] = ["date", "channel", "gross", "net", "status", "id", "orderReference", "source", "ingest", "sourceRow"];
const operatingKpis = ["total_revenue", "listings_created", "revenue_per_labor_hour", "listings_per_employee", "days_donation_to_listing", "unlisted_backlog", "unsold_inventory_pct", "avg_selling_price", "sell_through_rate", "sales_per_employee", "repeat_buyer_rate", "days_to_sell"];

export const reportProfiles: Record<string, ReportProfile> = {
  ceo: {
    id: "ceo", label: "CEO", hypothesis: true, scopeKind: "organization",
    purpose: { daily: "How is e-commerce revenue progressing this month?", monthly: "How did e-commerce perform against the 2027 priorities?" },
    reports: {
      daily: { pages: [["overview", "channels"]], datasets: ["sales", "quality", "records"], tabs: ["Overview", "Channels", "Comparisons", "Transactions", "Sources"], kpis: [], comparisons: ["previous_week", "month_to_date"], orderFields: detailFields, maxHighlights: 2, subjectLabel: "Daily Pulse", channelView: "mix", showOrders: true },
      monthly: { pages: [["overview", "trend", "priorities"], ["channels", "categories"], ["scorecard"]], datasets: ["sales", "metrics", "categories", "quality", "records"], tabs: ["Overview", "Indicators", "Channels", "Categories", "Comparisons", "Transactions", "Sources"], kpis: "core", comparisons: ["previous_month"], orderFields: detailFields, maxHighlights: 2, subjectLabel: "Monthly leadership overview", scorecardTitle: "The 15 core indicators", categoryLimit: 4, channelView: "changes" },
    },
    // President/CEO confirmed at https://goodwill-ni.org/excel-center/ (2026-10-04).
    // Demonstration salutation only; this does not select a recipient or grant access.
    email: { greeting: "Debie Coble", opening: "Here is your e-commerce leadership overview.", optionalNote: "This demonstration covers e-commerce only, not all Goodwill programs.", signature: "Goodwill Michiana | Mission Control prototype" },
  },
  finance: {
    id: "finance", label: "Controller / Finance Lead", hypothesis: true, scopeKind: "organization",
    purpose: { daily: "Are the supplied records ready to support the close?", monthly: "What is reconciled, and what still needs approval?" },
    reports: {
      daily: { pages: [["readiness", "exceptions", "reconciliation"]], datasets: ["sales", "quality", "exceptions", "records"], tabs: ["Overview", "Sources", "Exceptions", "Transactions"], kpis: [], comparisons: ["month_to_date"], orderFields: financeFields, maxHighlights: 3, subjectLabel: "Daily data readiness" },
      monthly: { pages: [["readiness", "exceptions"], ["reconciliation", "close"]], datasets: ["sales", "quality", "exceptions", "records", "close"], tabs: ["Overview", "Sources", "Exceptions", "Transactions", "Close"], kpis: [], comparisons: [], orderFields: financeFields, maxHighlights: 4, subjectLabel: "Monthly close readiness" },
    },
    email: { greeting: "Finance review team", opening: "Here is the data-readiness review for your scope.", optionalNote: "Please review unresolved items before relying on these records for an accounting close.", signature: "Goodwill Michiana | Mission Control prototype" },
  },
  coo: {
    id: "coo", label: "COO", hypothesis: true, scopeKind: "organization",
    purpose: { daily: "Are we on track?", monthly: "How did the month perform against the operating priorities?" },
    reports: {
      daily: { pages: [["overview", "trend"]], datasets: ["sales"], tabs: ["Overview", "Comparisons"], kpis: [], comparisons: ["previous_day", "month_to_date"], orderFields: [], maxHighlights: 2, subjectLabel: "Daily overview" },
      monthly: { pages: [["overview", "trend", "priorities"], ["categories", "operations"], ["scorecard"]], datasets: ["sales", "metrics", "categories"], tabs: ["Overview", "Indicators", "Categories", "Comparisons"], kpis: "core", comparisons: ["previous_month"], orderFields: [], maxHighlights: 4, subjectLabel: "Monthly overview" },
    },
    email: { greeting: "Executive review team", opening: "Here is the consolidated performance overview.", optionalNote: "Targets shown in this demonstration are unapproved source examples.", signature: "Goodwill Michiana | Mission Control prototype" },
  },
  director: {
    id: "director", label: "E-commerce Director", hypothesis: true, scopeKind: "organization",
    purpose: { daily: "Which channels changed, and what do the data show?", monthly: "Where did sales, productivity and inventory change?" },
    reports: {
      daily: { pages: [["overview", "channels", "readiness"]], datasets: ["sales", "quality", "records"], tabs: ["Overview", "Channels", "Comparisons", "Transactions", "Sources"], kpis: [], comparisons: ["previous_day", "previous_week"], orderFields: detailFields, maxHighlights: 3, subjectLabel: "Daily channel performance" },
      monthly: { pages: [["overview", "channels"], ["categories", "operations"], ["scorecard"]], datasets: ["sales", "metrics", "categories", "quality", "records"], tabs: ["Overview", "Indicators", "Channels", "Categories", "Comparisons", "Transactions", "Sources"], kpis: operatingKpis, comparisons: ["previous_month"], orderFields: detailFields, maxHighlights: 4, subjectLabel: "Monthly operating performance" },
    },
    email: { greeting: "E-commerce review team", opening: "Here is the channel and operating performance review.", optionalNote: "Observed changes do not establish their causes.", signature: "Goodwill Michiana | Mission Control prototype" },
  },
  channel: {
    id: "channel", label: "Marketplace Channel Lead", hypothesis: true, scopeKind: "channel",
    purpose: { daily: "How did this channel perform?", monthly: "How did this channel change during the month?" },
    reports: {
      daily: { pages: [["overview", "trend", "readiness"]], datasets: ["sales", "records"], tabs: ["Overview", "Comparisons", "Transactions"], kpis: [], comparisons: ["previous_7_days"], orderFields: detailFields, maxHighlights: 3, subjectLabel: "Daily channel report" },
      monthly: { pages: [["overview", "trend"], ["categories", "readiness"]], datasets: ["sales", "categories", "records"], tabs: ["Overview", "Categories", "Comparisons", "Transactions"], kpis: [], comparisons: ["previous_month"], orderFields: detailFields, maxHighlights: 4, subjectLabel: "Monthly channel report" },
    },
    email: { greeting: "Channel review team", opening: "Here is the performance review for your channel only.", optionalNote: "Channel-specific customer and operating indicators await a scoped shared view.", signature: "Goodwill Michiana | Mission Control prototype" },
  },
};

// Illustrative permissions only. Presentation changes never modify these grants.
export const demoAccess: Record<string, DemoAccess> = {
  ceo: { mode: "synthetic-demo", id: "demo-ceo-ecommerce-review-v2", scope: { kind: "organization" }, datasets: ["sales", "metrics", "categories", "quality", "records"], tabs: ["Overview", "Indicators", "Channels", "Categories", "Comparisons", "Transactions", "Sources"], orderFields: detailFields, approvedRecipients: [], sendingEnabled: false },
  finance: { mode: "synthetic-demo", id: "demo-finance-organization-v1", scope: { kind: "organization" }, datasets: ["sales", "quality", "exceptions", "close", "records"], tabs: ["Overview", "Sources", "Exceptions", "Transactions", "Close"], orderFields: financeFields, approvedRecipients: [], sendingEnabled: false },
  coo: { mode: "synthetic-demo", id: "demo-executive-organization-v1", scope: { kind: "organization" }, datasets: ["sales", "metrics", "categories"], tabs: ["Overview", "Indicators", "Categories", "Comparisons"], orderFields: [], approvedRecipients: [], sendingEnabled: false },
  director: { mode: "synthetic-demo", id: "demo-director-organization-v1", scope: { kind: "organization" }, datasets: ["sales", "metrics", "categories", "quality", "records"], tabs: ["Overview", "Indicators", "Channels", "Categories", "Comparisons", "Transactions", "Sources"], orderFields: detailFields, approvedRecipients: [], sendingEnabled: false },
  channel: { mode: "synthetic-demo", id: "demo-shopgoodwill-only-v1", scope: { kind: "channel", channel: "shopgoodwill" }, datasets: ["sales", "categories", "records"], tabs: ["Overview", "Categories", "Comparisons", "Transactions"], orderFields: detailFields, approvedRecipients: [], sendingEnabled: false },
};
export const channelNames: Record<ChannelId, string> = { shopgoodwill: "ShopGoodwill", amazon: "Amazon", ebay: "eBay", goodwill_books: "GoodwillBooks", other: "Other e-commerce" };
export const scopeName = (scope: Scope) => scope.kind === "organization" ? "All e-commerce operations" : `${channelNames[scope.channel]} only`;
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
export interface ReportPlan { profile: ReportProfile; access: DemoAccess; frequency: Frequency; period: string; signature: string }
export function authorizeReport(profile: ReportProfile, access: DemoAccess, frequency: Frequency, period: string): ReportPlan {
  if (access.mode !== "synthetic-demo" || access.sendingEnabled !== false || access.approvedRecipients.length || !profile.hypothesis) throw new Error("Only synthetic, recipient-free report demonstrations are enabled");
  if (profile.scopeKind !== access.scope.kind) throw new Error("Presentation does not match the authorized scope");
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(profile.id)) throw new Error("Invalid presentation identifier");
  const config = profile.reports[frequency];
  if (!config || config.datasets.some(d => !access.datasets.includes(d)) || config.tabs.some(t => !access.tabs.includes(t)) || config.orderFields.some(f => !access.orderFields.includes(f))) throw new Error("Presentation requests data outside the authorized grant");
  if (!config.pages.length || config.pages.length > (frequency === "daily" ? 2 : 5) || config.pages.some(p => !p.length) || config.maxHighlights < 0 || config.maxHighlights > (frequency === "daily" ? 3 : 4)) throw new Error("Invalid report presentation limits");
  const tabDataset: Partial<Record<Tab, Dataset>> = { Indicators: "metrics", Categories: "categories", Channels: "sales", Comparisons: "sales", Transactions: "records", Sources: "quality", Exceptions: "exceptions", Close: "close" };
  for (const tab of config.tabs) if (tabDataset[tab] && !config.datasets.includes(tabDataset[tab]!)) throw new Error("Workbook tab requests an unselected dataset");
  if (access.scope.kind === "channel" && (config.datasets.some(d => ["metrics", "quality", "exceptions", "close"].includes(d)) || config.tabs.includes("Channels"))) throw new Error("The shared API cannot supply these datasets within channel-only scope");
  const sectionDataset: Partial<Record<Section, Dataset>> = { priorities: "metrics", scorecard: "metrics", operations: "metrics", categories: "categories", exceptions: "exceptions", reconciliation: "records", close: "close", channels: "sales", overview: "sales", trend: "sales" };
  for (const s of config.pages.flat()) if (sectionDataset[s] && !config.datasets.includes(sectionDataset[s]!)) throw new Error("Section data is not authorized by this configuration");
  const result = structuredClone({ profile, access, frequency, period });
  return { ...result, signature: digest(result) };
}
