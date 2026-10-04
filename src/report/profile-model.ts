import { addDays, previousPeriod, businessDateOf } from "../lib/views/dates";
import { dateName, formatReportNumber, formatReportValue, growthBasis, kpiMeaning, monthName, pillarNames, type ReportKpi } from "./monthly-content";
import { friendlyNote } from "./monthly-data";
import { workbookMoney, workbookNumberFormat, workbookPercent } from "./monthly-xlsx";
import type { WorkbookValue } from "./branded-workbook";
import { authorizeReport, channelNames, scopeName, type Tab, type OrderField } from "./profiles";
import type { ProfileSnapshot, SalesDay } from "./profile-source";

export interface Fact { label: string; value: number | null; unit: "cents" | "count"; note: string }
export interface Comparison { label: string; currentLabel: string; current: number | null; baselineLabel: string; baseline: number | null; delta: number | null; percent: number | null; note: string }
export interface SheetSpec { name: Tab; title: string; note: string; columns: { name: string; width: number; format?: string }[]; rows: WorkbookValue[][] }
export interface ChannelResult { id: string; label: string; current: number | null; previous: number | null; change: number | null; share: number | null; customers: number | null; note: string }
export interface CategoryResult { category: string; revenueCents: number; marginCents: number | null; units: number | null; sellThroughPct: number | null; aspCents: number | null }
export interface ReportModel {
  snapshot: ProfileSnapshot; title: string; periodLabel: string; scopeLabel: string; notices: string[]; highlights: string[]; partialDay: boolean;
  facts: Fact[]; comparisons: Comparison[]; channels: ChannelResult[]; categories: CategoryResult[]; kpis: ReportKpi[];
  sourceRows: { name: string; frequency: string; status: string; dailyFiles: number | null; exceptions: number }[];
  reconciliation: { reference: number | null; records: number | null; difference: number | null; note: string };
  sheets: SheetSpec[];
}
const sumKnown = (rows: SalesDay[]) => rows.some(r => r.revenueCents !== null) ? rows.reduce((sum, r) => sum + (r.revenueCents ?? 0), 0) : null;
const money = (value: number | null) => value === null ? "unavailable" : `${formatReportValue(value, "cents")} USD`;
export function comparisonText(c: Comparison): string {
  if (c.delta === null) return `${c.label}: comparison with ${c.baselineLabel} is unavailable.`;
  return `${c.label} ${c.delta === 0 ? "was unchanged" : `${c.delta > 0 ? "increased" : "decreased"} by ${money(Math.abs(c.delta))}`} versus ${c.baselineLabel}.${c.note ? ` ${c.note}` : ""}`;
}
const statusName = (status: string) => ({ received: "Received", warnings: "Needs review", missing: "Missing", not_due: "Not due", parsed: "Parsed", parsed_with_warnings: "Parsed with warnings", failed: "Failed", open: "Open", resolved: "Resolved", waived: "Waived", collecting: "Collecting data", generated: "Generated", reconciled: "Reconciled", approved: "Approved", exported: "Exported" }[status] ?? status.replace(/_/g, " "));
export { statusName };
function currentRows(s: ProfileSnapshot) { return s.days.filter(d => s.plan.frequency === "daily" ? d.date === s.plan.period : d.date.startsWith(s.plan.period + "-")); }
const calc = (label: string, currentLabel: string, current: number | null, baselineLabel: string, baseline: number | null, note = ""): Comparison => ({ label, currentLabel, current, baselineLabel, baseline, delta: current === null || baseline === null ? null : current - baseline,
  percent: current === null || baseline === null || baseline <= 0 ? null : (current - baseline) / baseline * 100, note });

/** Only presentation arithmetic: source sums, differences, shares and an explicitly labeled daily mean. */
export function buildProfileModel(snapshot: ProfileSnapshot): ReportModel {
  const s = snapshot, plan = authorizeReport(s.plan.profile, s.plan.access, s.plan.frequency, s.plan.period);
  if (plan.signature !== s.plan.signature) throw new Error("Report plan changed after collection");
  const { profile, frequency, period, access } = plan, config = profile.reports[frequency], daily = frequency === "daily", scoped = access.scope.kind === "channel";
  const periodLabel = daily ? dateName(period) : monthName(period), label = scopeName(access.scope);
  // Match the frontend's file-timing caveat without asserting accounting completeness.
  const datedFiles = s.files.filter(f => f.businessDate === period && f.status !== "failed");
  const partialDay = daily && datedFiles.length > 0 && datedFiles.every(f => businessDateOf(f.uploadedAt) <= period);
  const scopeTotal = (prefix: string) => {
    if (scoped) return sumKnown(s.days.filter(d => d.date.startsWith(prefix)));
    const totals = s.dailyTotals.filter(d => d.date.startsWith(prefix));
    return totals.some(d => d.revenueCents !== null) ? totals.reduce((sum, d) => sum + (d.revenueCents ?? 0), 0) : null;
  };
  const nowRows = currentRows(s), revenueKpi = s.scorecard?.kpis.find(k => k.id === "total_revenue"), current = revenueKpi ? revenueKpi.value : scopeTotal(period);
  const missing = nowRows.filter(r => r.revenueCents === null).length;
  const notices = ["Synthetic demonstration. Proposed profiles and permissions have not been approved by Goodwill. Employee authentication is not implemented for these previews."];
  if (missing) notices.push(`${missing} channel-day values are unavailable. Available totals are partial; missing data is not zero.`);
  if (scoped) notices.push("Only the selected channel is included. Feed completeness is unconfirmed; customer and operating indicators are unavailable at this scope.");
  if (daily) notices.push("This is a daily report. Month-to-date figures are not a completed month or an approved accounting close.");
  const comparisons: Comparison[] = [];
  for (const comparison of config.comparisons) {
    if (comparison === "previous_day" || comparison === "previous_week") {
      const date = addDays(period, comparison === "previous_day" ? -1 : -7), rows = s.days.filter(r => r.date === date);
      const changedCoverage = missing > 0 || rows.some(r => r.revenueCents === null);
      comparisons.push(calc("Revenue", periodLabel, current, dateName(date), scopeTotal(date), changedCoverage ? "Coverage is partial; compare with caution." : ""));
    }
    if (comparison === "previous_7_days") {
      const from = addDays(period, -7), to = addDays(period, -1), rows = s.days.filter(r => r.date >= from && r.date <= to);
      const covered = rows.filter(r => r.revenueCents !== null).length;
      const average = covered === 7 && rows.length === 7 ? Math.round(rows.reduce((n, r) => n + r.revenueCents!, 0) / 7) : null;
      comparisons.push(calc("Revenue in supplied records", periodLabel, current, `the seven-day average (${dateName(from)}–${dateName(to)})`, average,
        `${covered}/7 days have records; the average is rounded to the nearest cent. Feed completeness is unconfirmed.`));
    }
    if (comparison === "previous_month") {
      const previous = previousPeriod(period), rows = s.days.filter(r => r.date.startsWith(previous + "-"));
      const baseline = revenueKpi ? revenueKpi.previous : scopeTotal(previous);
      comparisons.push(calc(scoped ? "Revenue in supplied records" : "Revenue", periodLabel, current, monthName(previous), baseline,
        scoped ? "Only returned channel records are compared; empty days are not treated as zero." : missing || rows.some(r => r.revenueCents === null) ? "Coverage is partial; compare with caution." : ""));
    }
  }
  if (partialDay) {
    notices.push("Partial day: available files arrived before the business day ended. Full-day comparisons are deferred.");
    for (const c of comparisons) { c.delta = null; c.percent = null; c.note = "Partial day: prior full-day amount is a reference only; no growth comparison is made."; }
  }
  const chosenKpis = s.scorecard?.kpis.filter(k => config.kpis === "core" ? k.group === "coo15" : config.kpis.includes(k.id)) ?? [];
  const categories: CategoryResult[] = [];
  if (config.datasets.includes("categories")) {
    if (scoped) {
      const grouped = new Map<string, number>();
      for (const o of s.orders.filter(o => o.businessDate.startsWith(period + "-"))) grouped.set(o.category ?? "Unassigned category", (grouped.get(o.category ?? "Unassigned category") ?? 0) + o.netCents);
      categories.push(...[...grouped].map(([category, revenueCents]) => ({ category, revenueCents, marginCents: null, units: null, sellThroughPct: null, aspCents: null })).sort((a, b) => b.revenueCents - a.revenueCents));
    } else categories.push(...(s.scorecard?.categories ?? []));
  }
  const channels: ChannelResult[] = [];
  const differingGroups = !scoped && current !== null && sumKnown(nowRows) !== null && sumKnown(nowRows) !== current;
  if (differingGroups) notices.push("The sum of reporting groups differs from the supplied total. Both are retained; group shares of total are unavailable until coverage is reconciled.");
  if (config.tabs.includes("Channels")) {
    const prior = daily ? addDays(period, -1) : previousPeriod(period);
    for (const id of new Set(nowRows.map(r => r.channel))) {
      const rows = nowRows.filter(r => r.channel === id), baseline = s.days.filter(r => r.channel === id && (daily ? r.date === prior : r.date.startsWith(prior + "-")));
      const revenue = sumKnown(rows), previous = sumKnown(baseline), incomplete = rows.some(r => r.revenueCents === null) || baseline.some(r => r.revenueCents === null);
      channels.push({ id, label: rows[0].label, current: revenue, previous, change: partialDay || revenue === null || previous === null ? null : revenue - previous,
        share: current !== null && current > 0 && revenue !== null && !missing && !differingGroups ? Number((revenue / current * 100).toFixed(6)) : null,
        customers: daily ? rows[0].customers : null, note: incomplete ? "Partial coverage; missing days are not zero." : daily ? "Customers are source-defined counts, not unique people across channels." : "Monthly revenue sums the supplied daily values; daily customer counts are not added into unique monthly buyers." });
    }
  }
  const sourceRows = s.sources.map(source => ({ name: source.name, frequency: source.cadence ?? "Unconfirmed", status: statusName(source.status),
    dailyFiles: daily ? s.files.filter(f => f.sourceId === source.sourceId && f.businessDate === period).length : null, exceptions: source.openExceptions }));
  const currentOrders = s.orders.filter(o => daily ? o.businessDate === period : o.businessDate.startsWith(period + "-"));
  const recordRevenue = config.datasets.includes("records") ? currentOrders.reduce((sum, r) => sum + r.netCents, 0) : null;
  const reference = scopeTotal(period);
  const reconciliation = { reference, records: recordRevenue, difference: recordRevenue === null || reference === null ? null : recordRevenue - reference,
    note: "Comparison of shared sales-view revenue with the sum of supplied net order lines for the same period. A zero difference is not accounting approval or proof of complete source coverage." };
  const finance = config.pages.flat().includes("reconciliation"), open = s.exceptions.filter(e => e.status === "open");
  const facts: Fact[] = finance ? [
    { label: "Sources received or under review", value: s.sources.filter(r => r.status === "received" || r.status === "warnings").length, unit: "count", note: `Of ${s.sources.length} source statuses for this month.` },
    { label: "Sources missing", value: s.sources.filter(r => r.status === "missing").length, unit: "count", note: "Sources marked not due are excluded." },
    { label: "Open exceptions", value: open.length, unit: "count", note: "Unresolved items in the supplied monthly exception register." },
  ] : [
    { label: scoped ? "Revenue in supplied channel records" : "Online sales revenue", value: current, unit: "cents", note: "Sales and customer shipping, after fees and refunds; excludes tax. Revenue is not profit." },
  ];
  if (!finance && daily) facts.push({ label: scoped ? "Normalized order lines" : "Source-defined customers", value: scoped ? currentOrders.length : s.pulses.find(p => p.businessDate === period)?.totals.customers ?? null, unit: "count", note: scoped ? "Line records are not unique buyers or necessarily unique orders." : "Buyer counts may use transaction-based fallbacks; not unique people across the organization." });
  if (config.showOrders && daily) facts.push({ label: "Orders", value: s.pulses.find(p => p.businessDate === period)?.totals.orders ?? null, unit: "count", note: "Order count from the shared Daily Pulse. Normalized line records can have a different count." });
  if (config.comparisons.includes("month_to_date")) facts.push({ label: "Month-to-date revenue", value: scopeTotal(period.slice(0, 7)), unit: "cents", note: `From ${dateName(period.slice(0, 7) + "-01")} through ${dateName(period)}. No forecast or approved target attainment is calculated.` });
  const highlights: string[] = [];
  if (finance) {
    highlights.push(`${s.sources.filter(r => r.status === "received" || r.status === "warnings").length} of ${s.sources.length} monthly source statuses show received files; ${s.sources.filter(r => r.status === "missing").length} are missing.`);
    highlights.push(`${open.length} exception${open.length === 1 ? " remains" : "s remain"} open in the supplied register.`);
    if (s.close) highlights.push(`Close state: ${statusName(s.close.status)}. Business Central posting is not evidenced by this API.`);
    else highlights.push(reconciliation.difference === 0 ? "Supplied sales-view revenue and order-line net revenue match for the report date." : reconciliation.difference === null ? "The revenue cross-check is unavailable." : `The sales-view versus order-line revenue difference is ${money(reconciliation.difference)}.`);
  } else {
    highlights.push(partialDay ? `Partial day: ${money(current)} reported so far. Comparison with a complete day is deferred.` : comparisons[0] ? comparisonText(comparisons[0]) : `${facts[0].label}: ${money(current)}.`);
    if (channels.length && config.channelView !== "changes") {
      const moved = [...channels].filter(c => c.change !== null).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))[0];
      if (moved && !partialDay) highlights.push(`${moved.label} has the largest absolute revenue change: ${money(moved.change)}. This is a mathematical contribution, not a confirmed cause.`);
    }
    if (chosenKpis.length) {
      const k = chosenKpis.find(k => k.id === "net_margin_pct") ?? chosenKpis.find(k => k.id === "sell_through_rate");
      if (k && k.value !== null && k.previous !== null) highlights.push(`${kpiMeaning(k).name}: ${formatReportValue(k.value, k.unit)}, ${k.value < k.previous ? "down" : "up"} ${formatReportNumber(Number(Math.abs(k.value - k.previous).toFixed(10)))} ${k.unit === "percent" ? Math.abs(k.value - k.previous) === 1 ? "percentage point" : "percentage points" : "source units"} from ${monthName(previousPeriod(period))}.`);
    }
    if (scoped) highlights.push("Customer counts and channel-specific operating indicators are unavailable; they are not replaced with company totals.");
    else if (daily && config.comparisons.includes("month_to_date")) highlights.push("An approved daily revenue target is unavailable, so on-track status cannot be concluded.");
    if (missing && highlights.length < config.maxHighlights) highlights.push("Some reporting groups or days are missing; available totals are partial.");
  }
  const sheets: SheetSpec[] = [];
  const add = (name: Tab, title: string, note: string, columns: SheetSpec["columns"], rows: WorkbookValue[][]) => { if (config.tabs.includes(name) && rows.length) sheets.push({ name, title, note, columns, rows }); };
  const column = (name: string, width: number, format?: string) => ({ name, width, format });
  const amountColumn = (name: string) => column(name, 21, "#,##0.00");
  const overviewRows: WorkbookValue[][] = facts.map(f => [f.label, f.unit === "cents" ? workbookMoney(f.value) : f.value, f.unit === "cents" ? "USD" : "count", f.note]);
  if (categories.length) overviewRows.push(["Revenue across supplied categories", workbookMoney(categories.reduce((sum, c) => sum + c.revenueCents, 0)), "USD", "Sum of Categories revenue; coverage may differ from total sales."], ["Total revenue less category revenue", current === null ? null : workbookMoney(current - categories.reduce((sum, c) => sum + c.revenueCents, 0)), "USD", "Coverage difference, not a change between months and not an accounting adjustment."]);
  comparisons.forEach(c => overviewRows.push([c.baselineLabel, workbookMoney(c.baseline), "USD", `Comparison base for ${c.label}. ${c.note}`], [`Change versus ${c.baselineLabel}`, workbookMoney(c.delta), "USD", partialDay ? "Not compared: current day is partial; blank is not zero." : "Current value minus comparison base; not a confirmed cause."]));
  if (finance) overviewRows.push(["Shared sales-view revenue", workbookMoney(reconciliation.reference), "USD", periodLabel], ["Net revenue in order lines", workbookMoney(reconciliation.records), "USD", periodLabel], ["Revenue cross-check difference", workbookMoney(reconciliation.difference), "USD", reconciliation.note]);
  if (s.close) overviewRows.push(["Accounting close state", statusName(s.close.status), "source state", "Exported does not establish posting in Business Central."], ["Close approval timestamp", s.close.approvedAt ? new Date(s.close.approvedAt) : null, "UTC", "Taken from the close API; separate from the calendar month ending."], ["Journal lines", s.close.journalLines, "lines", "Supplied by the close API."], ["Placeholder account lines", s.close.placeholderLines, "lines", "Supplied by the close API."], ["Journal document references", s.close.documents.length, "references", "Listed in Close."], ["Open exceptions in close summary", s.close.openExceptions, "items", "Close API summary; may differ from the latest exception register."]);
  if (s.close?.invoice) overviewRows.push(["Close invoice total", workbookMoney(s.close.invoice.totalCents), "USD", `Supplied invoice ${s.close.invoice.reference ?? "without reference"}; not proof of posting.`]);
  add("Overview", `${daily ? "Daily" : "Monthly"} overview`, notices.join(" "), [column("Measure", 46), column("Value", 27), column("Unit / basis", 21), column("Reading note", 90)], overviewRows);
  add("Indicators", "Selected performance indicators", "Calculated measures from the shared scorecard. Source targets are illustrative and unapproved. Blank means unavailable, not zero.", [column("Area", 24), column("Indicator and unit", 42), amountColumn("Current"), amountColumn("Previous month"), amountColumn("Source target (unapproved)"), column("Reading note", 80)], chosenKpis.map(k => [pillarNames[k.pillar], `${kpiMeaning(k).name}\n${k.unit === "cents" ? "USD" : k.unit === "cents_per_hour" ? "USD/hour" : k.unit === "percent" ? "%" : kpiMeaning(k).unit ?? k.unit}`, k.unit === "percent" ? workbookPercent(k.value) : ["cents", "cents_per_hour"].includes(k.unit) ? workbookMoney(k.value) : k.value,
    k.unit === "percent" ? workbookPercent(k.previous) : ["cents", "cents_per_hour"].includes(k.unit) ? workbookMoney(k.previous) : k.previous,
    k.unit === "percent" ? workbookPercent(k.target) : ["cents", "cents_per_hour"].includes(k.unit) ? workbookMoney(k.target) : k.target,
    `${k.anchor2027 ? "2027 priority. " : ""}${kpiMeaning(k).caution ?? ""} ${friendlyNote(k.note ?? "")}`.trim()]));
  add("Channels", "Channel performance", "Shared daily reporting groups; Other e-commerce can combine channels. Shares divide channel revenue by supplied total and retain six decimal percentage points. Daily customer counts are not added into unique monthly buyers.", [column("Channel / reporting group", 31), amountColumn("Current revenue (USD)"), amountColumn("Previous revenue (USD)"), amountColumn("Change (USD)"), column("Share of known total", 22, "0.0%"), column("Customers (daily only)", 23, "#,##0"), column("Coverage / definition", 80)], channels.map(c => [c.label, workbookMoney(c.current), workbookMoney(c.previous), workbookMoney(c.change), workbookPercent(c.share), c.customers, c.note]));
  const revenueRanking = s.scorecard?.topCategoriesByRevenue ?? [], marginRanking = s.scorecard?.topCategoriesByMargin ?? [];
  const categoryRows: WorkbookValue[][] = categories.map(c => scoped ? [c.category, workbookMoney(c.revenueCents)] : [c.category, workbookMoney(c.revenueCents), workbookMoney(c.marginCents), c.units, workbookPercent(c.sellThroughPct), workbookMoney(c.aspCents),
    revenueRanking.findIndex(r => r.category === c.category && r.revenueCents === c.revenueCents) + 1 || null,
    marginRanking.findIndex(r => r.category === c.category && r.marginCents === c.marginCents) + 1 || null, "Category detail"]);
  // Independent ranking values are retained when they cannot share a detail row.
  // Never overwrite category amounts just to force the datasets to agree.
  if (!scoped) {
    revenueRanking.forEach((r, i) => { if (!categories.some(c => c.category === r.category && c.revenueCents === r.revenueCents)) categoryRows.push([r.category, workbookMoney(r.revenueCents), null, null, null, null, i + 1, null, "Independent revenue ranking; exclude from category totals"]); });
    marginRanking.forEach((r, i) => { if (!categories.some(c => c.category === r.category && c.marginCents === r.marginCents)) categoryRows.push([r.category, null, workbookMoney(r.marginCents), null, null, null, null, i + 1, "Independent margin ranking; exclude from category totals"]); });
  }
  add("Categories", "Category detail", scoped ? "Net amounts grouped from the supplied channel records. Inventory, item quantities and category profit measures are not supplied at this scope." : "Category revenue covers categorized orders. Category margin excludes customer shipping. Source rankings are retained independently when their values differ; filter Record basis before summing amounts.",
    scoped ? [column("Category", 45), amountColumn("Revenue (USD)")] : [column("Category", 40), amountColumn("Revenue (USD)"), amountColumn("Margin amount (USD)"), column("Items sold", 18, "#,##0"), column("Share sold", 18, "0.0%"), amountColumn("Average price (USD)"), column("Source revenue rank", 21, "0"), column("Source margin rank", 21, "0"), column("Record basis", 53)], categoryRows);
  const aggregatedDays = new Map<string, SalesDay[]>();
  s.days.forEach(d => aggregatedDays.set(d.date, [...(aggregatedDays.get(d.date) ?? []), d]));
  const comparativeRows: WorkbookValue[][] = config.tabs.includes("Channels") ? s.days.map(d => [new Date(`${d.date}T12:00:00Z`), d.label, workbookMoney(d.revenueCents), d.customers, d.coverage === "missing" ? "Unavailable" : partialDay && d.date === period ? "Partial day" : "Reported"]) : [...aggregatedDays].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => [new Date(`${date}T12:00:00Z`), label, workbookMoney(scopeTotal(date)), null, rows.some(r => r.coverage === "missing") ? "Partial / unavailable" : scoped ? "Records available; completeness unconfirmed" : "Reported"]);
  add("Comparisons", "Daily comparison inputs", "Source values used in charts and comparisons. A seven-day mean is used only with seven non-missing days and rounded to the nearest cent. Monthly differences use the labeled months, not an annual growth rate.", [column("Business date", 20, "yyyy-mm-dd"), column("Scope / reporting group", 34), amountColumn("Net revenue (USD)"), column("Source-defined customers", 25, "#,##0"), column("Coverage", 49)], comparativeRows);
  const orderColumns: Record<OrderField, ReturnType<typeof column>> = { date: column("Business date", 18, "yyyy-mm-dd"), channel: column("Marketplace", 23), category: column("Category", 34), gross: amountColumn("Gross (USD)"), net: amountColumn("Net (USD)"), status: column("Record status", 18), id: column("Record ID", 42), orderReference: column("Order reference", 33), source: column("Source ID", 33), ingest: column("Ingest reference", 42), sourceRow: column("Source row", 16, "#,##0") };
  add("Transactions", "Normalized order lines", "Complete supplied records within the authorized report and comparison windows. Gross = item sales; net includes customer shipping, less refunds and fees. Revenue is not profit. Buyer data excluded.", config.orderFields.map(f => orderColumns[f]), s.orders.map(o => {
    const values: Record<OrderField, WorkbookValue> = { date: new Date(`${o.businessDate}T12:00:00Z`), channel: channelNames[o.channel], category: o.category, gross: workbookMoney(o.grossCents), net: workbookMoney(o.netCents), status: o.status, id: o.id, orderReference: o.externalOrderId, source: o.sourceId, ingest: o.ingestRunId, sourceRow: o.sourceRow }; return config.orderFields.map(f => values[f]);
  }));
  add("Sources", "Data sources and files", `Source availability for ${monthName(period.slice(0, 7))}${s.sourceAsOf ? ` as of ${s.sourceAsOf}` : ""}. File row counts are ingestion counts, not unique buyers or monthly orders. All supplied files are retained.`,
    [column("Reference type", 22), column("Source", 33), column("Status", 24), column("Frequency", 18), column("File name", 56), column("Ingest reference", 42), column("File business date", 22), column("Rows", 17, "#,##0"), column("Uploaded / last ingest (UTC)", 29, "yyyy-mm-dd hh:mm:ss"), column("Open exceptions", 18, "#,##0"), column("Origin", 21)],
    [...s.sources.map(r => ["Source status", r.name, statusName(r.status), r.cadence ?? null, null, null, null, r.rowCount, r.lastIngestAt ? new Date(r.lastIngestAt) : null, r.openExceptions, null] as WorkbookValue[]), ...s.files.map(f => ["Ingested file", f.sourceName, statusName(f.status), null, f.fileName, f.id, f.businessDate ? new Date(`${f.businessDate}T12:00:00Z`) : null, f.rowCount, new Date(f.uploadedAt), null, f.isSynthetic ? "Simulated" : "Unconfirmed"] as WorkbookValue[])]);
  add("Exceptions", "Exception register", "All supplied exceptions for the reporting month. Owners are source-provided; no assignments are invented. Expected and actual amounts are not silently reconciled.", [column("Reference", 42), column("Source", 32), column("Type", 28), column("Status", 17), column("Responsible", 29), column("Message", 92), amountColumn("Expected (USD)"), amountColumn("Actual (USD)"), column("Ingest reference", 42)], s.exceptions.map(e => [e.id, e.sourceName, e.kind.replace(/_/g, " "), statusName(e.status), e.owner, friendlyNote(e.message), workbookMoney(e.expectedCents), workbookMoney(e.actualCents), e.ingestRunId]));
  if (s.close) add("Close", "Close document references", `API state: ${statusName(s.close.status)}. Approval: ${s.close.approvedAt ?? "not supplied"}. These references do not prove that Business Central received or posted an entry.`, [column("Document type", 24), column("Reference", 39), column("Source", 34), column("Date", 21), amountColumn("Debit / invoice (USD)"), amountColumn("Credit (USD)"), amountColumn("Document balance (USD)"), column("Status / reading note", 62)],
    [...s.close.documents.map(d => ["Journal", d.reference, d.source, new Date(`${d.date}T12:00:00Z`), workbookMoney(d.debitCents), workbookMoney(d.creditCents), workbookMoney(d.balanceCents), d.balanced ? "Balanced according to close API" : "Unbalanced according to close API"] as WorkbookValue[]), ...(s.close.invoice ? [["Invoice", s.close.invoice.reference, "Supplied close invoice", s.close.invoice.date ? new Date(`${s.close.invoice.date}T12:00:00Z`) : null, workbookMoney(s.close.invoice.totalCents), null, null, `${s.close.invoice.lineCount} supplied invoice lines; no posting confirmation`] as WorkbookValue[]] : [])]);
  sheets.sort((a, b) => config.tabs.indexOf(a.name) - config.tabs.indexOf(b.name));
  return { snapshot: s, title: finance ? `${daily ? "Daily" : "Monthly"} data readiness` : daily ? "Daily Pulse" : "Monthly report", periodLabel, scopeLabel: label, notices: [...notices, ...s.collectionNotes], highlights: highlights.slice(0, config.maxHighlights), partialDay, facts, comparisons, channels, categories, kpis: chosenKpis, sourceRows, reconciliation, sheets };
}

export function metricReadingNote(k: ReportKpi, period: string): string {
  return k.id === "revenue_growth_pct" ? growthBasis(k, previousPeriod(period)) : kpiMeaning(k).caution ?? "";
}
export { workbookNumberFormat };
