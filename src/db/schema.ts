/**
 * Database schema: the single source of truth for the shared data layer.
 *
 * Implements docs/data-contract.md including the changes proposed in
 * docs/research.md §6 (decision D1 in docs/weekend-plan.md).
 *
 * Conventions (see data-contract.md "Conventions"):
 * - Money: integer cents (`*_cents`). Facts: + = money in.
 *   journal_lines.amount_cents uses BC's rule: + = debit to Account No., - = credit.
 * - Timestamps: ISO-8601 UTC text. business_date: `YYYY-MM-DD` in
 *   America/Indiana/Indianapolis. Period: `YYYY-MM`.
 * - IDs: text. Fact rows carry ingest_run_id + source_row for traceability.
 * - Privacy: no buyer names/emails/addresses. Buyers are `buyer_key` =
 *   salted SHA-256 of the marketplace buyer ID (salt: BUYER_KEY_SALT).
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** One row per source workflow. Adding a marketplace = a row + a parser. */
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(), // shopgoodwill, amazon, ebay, cashmonkey, upright, jewelry, shipping_osm_pb_easypost, fedex, goodwill_books
  name: text("name").notNull(),
  /** internal = Goodwill's own systems (production tracking, Upright inventory, timekeeping, marketplace ratings). */
  kind: text("kind", { enum: ["marketplace", "shipping", "statement", "internal"] }).notNull(),
  /** Legacy pulse row label. Prefer orders.channel -> channels.pulse_group (research §6.1). */
  channelGroup: text("channel_group"),
  acquisition: text("acquisition"),
  owner: text("owner"),
  active: integer("active").notNull().default(1),
  /** 1 = this source wins when two sources report the same order (research §6.2). */
  revenueAuthority: integer("revenue_authority").notNull().default(0),
  configJson: text("config_json"),
});

/**
 * Sales channels (ShopGoodwill, Amazon, eBay, GoodwillBooks, Other) and the
 * pulse row each maps to. Separate from sources because one source (e.g.
 * Upright) can span channels (research §6.1).
 */
export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(), // shopgoodwill, amazon, ebay, goodwill_books, other
  name: text("name").notNull(),
  /** Row label on the nightly pulse: ShopGoodwill | Amazon | eBay | Other e-commerce */
  pulseGroup: text("pulse_group").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Maps source amounts to Business Central journal lines. */
export const glRules = sqliteTable(
  "gl_rules",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    amountType: text("amount_type").notNull(),
    accountType: text("account_type").notNull(), // G/L Account | Vendor | Customer | Bank Account
    accountNo: text("account_no").notNull(),
    deptCode: text("dept_code"),
    vendorNo: text("vendor_no"),
    balAccountType: text("bal_account_type"),
    balAccountNo: text("bal_account_no"),
    /** Multiplier from fact sign (+ = money in) to BC debit sign (+ = debit). Research §6.4. */
    journalSign: integer("journal_sign").notNull().default(1),
    descriptionTemplate: text("description_template"),
    /** 1 = placeholder code not yet confirmed by Goodwill. */
    isPlaceholder: integer("is_placeholder").notNull().default(1),
  },
  (t) => [index("gl_rules_source_amount_idx").on(t.sourceId, t.amountType)],
);

export const kpiTargets = sqliteTable(
  "kpi_targets",
  {
    id: text("id").primaryKey(),
    kpiKey: text("kpi_key").notNull(),
    period: text("period").notNull(),
    targetValue: real("target_value").notNull(),
  },
  (t) => [uniqueIndex("kpi_targets_key_period_uq").on(t.kpiKey, t.period)],
);

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/** One row per uploaded file. */
export const ingestRuns = sqliteTable(
  "ingest_runs",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    period: text("period"), // YYYY-MM, null for nightly feeds
    businessDate: text("business_date"), // YYYY-MM-DD for nightly feeds
    periodLabel: text("period_label"), // e.g. ShopGoodwill "Period 1" / "Period 3"
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    headerRowIndex: integer("header_row_index"),
    headerSignature: text("header_signature"), // hash of normalized header; detects renamed columns
    parserVersion: text("parser_version"),
    status: text("status", {
      enum: ["parsed", "parsed_with_warnings", "failed"],
    }).notNull(),
    warningsJson: text("warnings_json"),
    /** 1 = synthetic data (item pipeline, labor hours); scorecard shows "simulated". */
    isSynthetic: integer("is_synthetic").notNull().default(0),
    uploadedAt: text("uploaded_at").notNull(),
    /**
     * Raw file archive (slide 40 step 02): `Month End/<YYYY>/<MM>/<source_id>/<file>`
     * in Vercel Blob ("blob"), data/archive/ ("local"), the versioned fixture path
     * ("repo", seed), or null with "none" when archiving was skipped or failed.
     */
    archiveKey: text("archive_key"),
    archiveUrl: text("archive_url"),
    archiveBackend: text("archive_backend", { enum: ["blob", "local", "repo", "none"] }),
  },
  (t) => [
    index("ingest_runs_source_idx").on(t.sourceId),
    index("ingest_runs_sha_idx").on(t.fileSha256),
    index("ingest_runs_period_idx").on(t.period),
    index("ingest_runs_business_date_idx").on(t.businessDate),
  ],
);

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/** One row per order line from marketplace sources. */
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    ingestRunId: text("ingest_run_id")
      .notNull()
      .references(() => ingestRuns.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    externalOrderId: text("external_order_id").notNull(),
    externalItemId: text("external_item_id"),
    /** `${channel}:${external_order_id}:${external_item_id}` (research §6.2). */
    dedupeKey: text("dedupe_key").notNull(),
    orderTs: text("order_ts").notNull(), // UTC
    businessDate: text("business_date").notNull(),
    buyerKey: text("buyer_key"), // salted SHA-256, never the raw buyer ID
    itemId: text("item_id").references(() => items.id),
    category: text("category"),
    quantity: integer("quantity").notNull().default(1),
    currency: text("currency").notNull().default("USD"),
    grossCents: integer("gross_cents").notNull().default(0),
    refundCents: integer("refund_cents").notNull().default(0),
    feeCents: integer("fee_cents").notNull().default(0),
    shippingCents: integer("shipping_cents").notNull().default(0),
    /** Marketplace-collected tax; excluded from revenue. */
    taxCents: integer("tax_cents").notNull().default(0),
    /** gross + shipping - refund - fee (research §6.3). */
    netCents: integer("net_cents").notNull().default(0),
    status: text("status", { enum: ["paid", "refunded", "cancelled"] }).notNull(),
    /** Who sourced the item (store / consignor / vendor): Jewelry Report or an Upright Supplier column (slide 40 step 03). */
    supplier: text("supplier"),
  },
  (t) => [
    uniqueIndex("orders_dedupe_key_uq").on(t.dedupeKey),
    index("orders_business_date_channel_idx").on(t.businessDate, t.channel),
    index("orders_source_idx").on(t.sourceId),
    index("orders_ingest_run_idx").on(t.ingestRunId),
    index("orders_item_idx").on(t.itemId),
  ],
);

/** Non-order amounts: shipping, statements, payouts, deposits. */
export const moneyLines = sqliteTable(
  "money_lines",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    ingestRunId: text("ingest_run_id")
      .notNull()
      .references(() => ingestRuns.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    channel: text("channel").references(() => channels.id),
    lineDate: text("line_date").notNull(),
    period: text("period").notNull(),
    /**
     * Matches gl_rules.amount_type. Known values (research §6.7): sale, refund,
     * marketplace_fee, fulfillment_fee, shipping_label, shipping_refund,
     * postage_topup, payout, tax_withheld, adjustment, statement_payment.
     */
    amountType: text("amount_type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    payoutId: text("payout_id"),
    settlementId: text("settlement_id"),
    bankAccountNo: text("bank_account_no"), // e.g. 1st Source "0101"
    reference: text("reference"),
    memo: text("memo"),
  },
  (t) => [
    index("money_lines_period_source_idx").on(t.period, t.sourceId),
    index("money_lines_ingest_run_idx").on(t.ingestRunId),
    index("money_lines_amount_type_idx").on(t.amountType),
  ],
);

/** Item lifecycle, for productivity/inventory/sales KPIs. Synthetic only (research §6.11). */
export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    ingestRunId: text("ingest_run_id").references(() => ingestRuns.id, {
      onDelete: "cascade",
    }),
    category: text("category"),
    donatedAt: text("donated_at"),
    identifiedAt: text("identified_at"),
    sentToEcomAt: text("sent_to_ecom_at"),
    listedAt: text("listed_at"),
    soldAt: text("sold_at"),
    listedBy: text("listed_by"), // employee pseudonym
    channelSourceId: text("channel_source_id").references(() => sources.id),
    listPriceCents: integer("list_price_cents"),
    salePriceCents: integer("sale_price_cents"),
    relistCount: integer("relist_count").notNull().default(0),
  },
  (t) => [
    index("items_listed_at_idx").on(t.listedAt),
    index("items_sold_at_idx").on(t.soldAt),
  ],
);

/** Labor hours per employee pseudonym. Synthetic only (research §6.11). */
export const laborHours = sqliteTable(
  "labor_hours",
  {
    id: text("id").primaryKey(),
    ingestRunId: text("ingest_run_id").references(() => ingestRuns.id, {
      onDelete: "cascade",
    }),
    employee: text("employee").notNull(), // pseudonym
    team: text("team"),
    workDate: text("work_date").notNull(),
    hours: real("hours").notNull(),
  },
  (t) => [index("labor_hours_work_date_idx").on(t.workDate)],
);

/**
 * Monthly marketplace health metrics per channel (CSAT, NPS, conversion,
 * seller rating), for the customer & marketplace KPIs of slide 34.
 * Units: csat on the marketplace's own scale (e.g. 4.8 of 5), nps -100..100,
 * conversion_rate in percent (2.4 = 2.4%), seller_rating as reported.
 * Empty for a period -> those KPIs show "awaiting data".
 */
export const marketplaceMetrics = sqliteTable(
  "marketplace_metrics",
  {
    id: text("id").primaryKey(),
    ingestRunId: text("ingest_run_id").references(() => ingestRuns.id, {
      onDelete: "cascade",
    }),
    channel: text("channel")
      .notNull()
      .references(() => channels.id),
    period: text("period").notNull(), // YYYY-MM
    metric: text("metric", {
      enum: ["csat", "nps", "conversion_rate", "seller_rating"],
    }).notNull(),
    value: real("value").notNull(),
    sampleSize: integer("sample_size"),
  },
  (t) => [index("marketplace_metrics_period_channel_idx").on(t.period, t.channel)],
);

// ---------------------------------------------------------------------------
// Month-end close
// ---------------------------------------------------------------------------

export const closes = sqliteTable(
  "closes",
  {
    id: text("id").primaryKey(),
    period: text("period").notNull(),
    status: text("status", {
      enum: ["collecting", "generated", "reconciled", "approved", "exported"],
    })
      .notNull()
      .default("collecting"),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    /**
     * Business Central posting (slide 40 step 06, slide 41 WS4). Independent of
     * `status`: an exported close is imported into BC, then posted there.
     * Today the BC side is SIMULATED (src/close/posting.ts) and the stored
     * response says so (`simulated: true`).
     */
    postingStatus: text("posting_status", { enum: ["not_posted", "imported", "posted", "failed"] })
      .notNull()
      .default("not_posted"),
    /** BC General Journal batch the lines were imported into. */
    bcBatch: text("bc_batch"),
    /** JSON string[]: BC document numbers (journal Document No.s + sales invoice No.). */
    bcDocumentNos: text("bc_document_nos"),
    importedAt: text("imported_at"),
    importedBy: text("imported_by"),
    postedAt: text("posted_at"),
    postedBy: text("posted_by"),
    /** JSON: last posting-adapter response (import, then post), incl. `simulated`. */
    postingResponseJson: text("posting_response_json"),
    /** JSON CloseEvent[]: audit trail (generated, reconciled, approved, exported, imported, posted, ...). */
    eventsJson: text("events_json"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("closes_period_uq").on(t.period)],
);

/** Generated BC General Journal lines. */
export const journalLines = sqliteTable(
  "journal_lines",
  {
    id: text("id").primaryKey(),
    closeId: text("close_id")
      .notNull()
      .references(() => closes.id, { onDelete: "cascade" }),
    journalTemplate: text("journal_template"),
    journalBatch: text("journal_batch"),
    lineNo: integer("line_no").notNull(),
    postingDate: text("posting_date").notNull(),
    documentType: text("document_type"),
    documentNo: text("document_no").notNull(), // <= 20 chars in BC
    externalDocumentNo: text("external_document_no"),
    accountType: text("account_type").notNull(),
    accountNo: text("account_no").notNull(),
    deptCode: text("dept_code"),
    balAccountType: text("bal_account_type"),
    balAccountNo: text("bal_account_no"),
    description: text("description"), // <= 50 chars in BC
    /** BC convention: + = debit to Account No., - = credit. */
    amountCents: integer("amount_cents").notNull(),
    sourceId: text("source_id").references(() => sources.id),
    glRuleId: text("gl_rule_id").references(() => glRules.id),
    /** Fact row IDs this line was computed from. */
    traceJson: text("trace_json"),
  },
  (t) => [
    index("journal_lines_close_idx").on(t.closeId, t.lineNo),
    index("journal_lines_document_idx").on(t.closeId, t.documentNo),
  ],
);

/** AR invoice (workbook "Invoices" tab), mirrors BC salesInvoices. Fields TBC. */
export const arInvoices = sqliteTable(
  "ar_invoices",
  {
    id: text("id").primaryKey(),
    closeId: text("close_id")
      .notNull()
      .references(() => closes.id, { onDelete: "cascade" }),
    customerNo: text("customer_no"),
    invoiceDate: text("invoice_date"),
    postingDate: text("posting_date"),
    externalDocumentNo: text("external_document_no"),
    currency: text("currency").notNull().default("USD"),
  },
  (t) => [index("ar_invoices_close_idx").on(t.closeId)],
);

export const arInvoiceLines = sqliteTable(
  "ar_invoice_lines",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => arInvoices.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    lineType: text("line_type", { enum: ["Account", "Item"] })
      .notNull()
      .default("Account"),
    accountNo: text("account_no"),
    description: text("description"),
    quantity: real("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull(),
    deptCode: text("dept_code"),
    traceJson: text("trace_json"),
  },
  (t) => [index("ar_invoice_lines_invoice_idx").on(t.invoiceId, t.lineNo)],
);

/** Existing workbook outputs for a period, to reconcile against. */
export const workbookBaseline = sqliteTable(
  "workbook_baseline",
  {
    id: text("id").primaryKey(),
    period: text("period").notNull(),
    sourceId: text("source_id").references(() => sources.id),
    accountNo: text("account_no").notNull(),
    deptCode: text("dept_code"),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [index("workbook_baseline_period_idx").on(t.period, t.sourceId)],
);

export const exceptions = sqliteTable(
  "exceptions",
  {
    id: text("id").primaryKey(),
    closeId: text("close_id").references(() => closes.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => sources.id),
    ingestRunId: text("ingest_run_id").references(() => ingestRuns.id, {
      onDelete: "set null",
    }),
    kind: text("kind", {
      enum: [
        "missing_source",
        "parse_warning",
        /** The file could not be read, recognized or parsed; nothing was inserted. */
        "parse_failed",
        "reconcile_mismatch",
        "unmapped_amount",
        "duplicate_file",
        "duplicate_order",
        "unbalanced_document",
      ],
    }).notNull(),
    message: text("message").notNull(),
    expectedCents: integer("expected_cents"),
    actualCents: integer("actual_cents"),
    owner: text("owner"),
    status: text("status", { enum: ["open", "resolved", "waived"] })
      .notNull()
      .default("open"),
    createdAt: createdAt(),
    resolvedAt: text("resolved_at"),
  },
  (t) => [
    index("exceptions_close_status_idx").on(t.closeId, t.status),
    index("exceptions_source_idx").on(t.sourceId),
  ],
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type GlRule = typeof glRules.$inferSelect;
export type NewGlRule = typeof glRules.$inferInsert;
export type KpiTarget = typeof kpiTargets.$inferSelect;
export type NewKpiTarget = typeof kpiTargets.$inferInsert;
export type IngestRun = typeof ingestRuns.$inferSelect;
export type NewIngestRun = typeof ingestRuns.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type MoneyLine = typeof moneyLines.$inferSelect;
export type NewMoneyLine = typeof moneyLines.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type LaborHour = typeof laborHours.$inferSelect;
export type NewLaborHour = typeof laborHours.$inferInsert;
export type Close = typeof closes.$inferSelect;
export type NewClose = typeof closes.$inferInsert;
export type JournalLine = typeof journalLines.$inferSelect;
export type NewJournalLine = typeof journalLines.$inferInsert;
export type ArInvoice = typeof arInvoices.$inferSelect;
export type NewArInvoice = typeof arInvoices.$inferInsert;
export type ArInvoiceLine = typeof arInvoiceLines.$inferSelect;
export type NewArInvoiceLine = typeof arInvoiceLines.$inferInsert;
export type WorkbookBaseline = typeof workbookBaseline.$inferSelect;
export type NewWorkbookBaseline = typeof workbookBaseline.$inferInsert;
export type MarketplaceMetric = typeof marketplaceMetrics.$inferSelect;
export type NewMarketplaceMetric = typeof marketplaceMetrics.$inferInsert;
export type DataException = typeof exceptions.$inferSelect;
export type NewDataException = typeof exceptions.$inferInsert;
