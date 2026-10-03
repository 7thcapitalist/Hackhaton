/**
 * Default GL rules: how each (source, amount_type) becomes a Business Central
 * General Journal line. `ensureGlRules(db)` inserts any rule that is missing
 * and NEVER overwrites a row that exists (finance may have edited it).
 *
 * Sign convention (research.md §6.4)
 *   Facts: + = money in to Goodwill.  BC: + = debit to Account No., - = credit.
 *   journal amount = fact amount × journal_sign.
 *   - Revenue, refunds, fees, shipping costs, adjustments: journal_sign = -1
 *     (sale +$10 → credit revenue -$10; fee -$2 → debit expense +$2).
 *   - Cash arriving in the bank (payout): journal_sign = +1 (debit bank).
 *
 * Balancing
 *   Each source is one journal document (Document No. ECOM-2609-AMZ). Lines
 *   with no Bal. Account No. must net to zero inside the document, so the
 *   engine adds ONE balancing line per document using the source's
 *   `clearing` rule (amount_type "clearing"): marketplace receivable for the
 *   marketplaces, bank 0101 for postage, vendor V00122 for FedEx. If a rule
 *   carries its own bal_account_no, that line is self-balancing (BC style) and
 *   is left out of the balancing amount. No clearing rule → the document is
 *   left unbalanced and reconcile raises `unbalanced_document`.
 *
 * Order-derived amount types (orders table, per order line; cancelled orders skipped)
 *   sale            = +gross_cents
 *   shipping_income = +shipping_cents (shipping charged to the buyer)
 *   refund          = -refund_cents
 *   marketplace_fee = -fee_cents
 *   tax_cents is marketplace-facilitator tax: collected AND remitted by the
 *   marketplace, never Goodwill's money, so it is NOT journaled (the view
 *   reports it as excluded). A money line of type `tax_withheld` (if a
 *   statement ever reports one separately) still has a rule below.
 *
 * Goodwill Books is billed through the AR invoice (slide 39 step 6), not the
 * General Journal; its rules give the invoice-line G/L accounts. Its
 * `statement_payment` line is a control total (never revenue): no rule.
 *
 * Mapping table (FACT = slide 38 text; everything else is a placeholder,
 * is_placeholder = 1, account numbers start with "TBC-")
 *
 * | source                    | amount_type     | account (type)              | dept | sign | status |
 * |---------------------------|-----------------|-----------------------------|------|------|--------|
 * | fedex                     | shipping_label  | 40356 (G/L)                 | 180  | -1   | FACT   |
 * | fedex                     | shipping_refund | 40356 (G/L), nets refunds   | 180  | -1   | FACT acct, refund mechanics guess |
 * | fedex                     | adjustment      | 40356 (G/L)                 | 180  | -1   | guess  |
 * | fedex                     | clearing        | V00122 (Vendor)             |      |  —   | FACT   |
 * | shipping_osm_pb_easypost  | shipping_label  | 10009 (G/L)                 | 180  | -1   | FACT acct (meaning of 10009 TBC) |
 * | shipping_osm_pb_easypost  | shipping_refund | 10009 (G/L)                 | 180  | -1   | guess  |
 * | shipping_osm_pb_easypost  | postage_topup   | 10009 (G/L)                 |      | -1   | guess  |
 * | shipping_osm_pb_easypost  | adjustment      | 10009 (G/L)                 | 180  | -1   | guess  |
 * | shipping_osm_pb_easypost  | clearing        | 0101 (Bank Account, 1st Source) |  |  —   | FACT   |
 * | each marketplace (*)      | sale            | TBC-4010-<SRC> (G/L) revenue | 180 | -1   | placeholder |
 * | each marketplace          | shipping_income | TBC-4020-<SRC> (G/L)        | 180  | -1   | placeholder |
 * | each marketplace          | refund          | TBC-4030-<SRC> (G/L) contra-revenue | 180 | -1 | placeholder |
 * | each marketplace          | marketplace_fee | TBC-6010-<SRC> (G/L) fees   | 180  | -1   | placeholder |
 * | each marketplace          | fulfillment_fee | TBC-6020-<SRC> (G/L)        | 180  | -1   | placeholder |
 * | each marketplace          | adjustment      | TBC-6090-<SRC> (G/L)        | 180  | -1   | placeholder |
 * | each marketplace          | tax_withheld    | TBC-2310 (G/L) facilitator tax | |  -1   | placeholder |
 * | each marketplace          | payout          | 0101 (Bank Account)         |      | +1   | placeholder (bank is a guess) |
 * | each marketplace          | clearing        | TBC-1210-<SRC> (G/L) receivable |  |  —   | placeholder |
 * | goodwill_books (invoice)  | sale / shipping_income / refund / marketplace_fee / adjustment | TBC-40xx-GWB / TBC-60xx-GWB | 180 | n/a | placeholder |
 *
 * (*) shopgoodwill, amazon, ebay, cashmonkey, upright, jewelry.
 */
import { glRules, type NewGlRule } from "@/db/schema";
import type { Db } from "@/db/client";
import { ensureConfig } from "@/ingest";

/** Short source codes used in Document No. and placeholder accounts. */
export const SOURCE_CODES: Record<string, string> = {
  shopgoodwill: "SGW",
  amazon: "AMZ",
  ebay: "EBY",
  cashmonkey: "CMK",
  upright: "UPR",
  jewelry: "JWL",
  shipping_osm_pb_easypost: "SHP",
  fedex: "FDX",
  goodwill_books: "GWB",
};

export const MARKETPLACE_SOURCES = ["shopgoodwill", "amazon", "ebay", "cashmonkey", "upright", "jewelry"];

/** Source billed through the AR invoice instead of the General Journal. */
export const INVOICE_SOURCE = "goodwill_books";

/** Amount type of the per-document balancing rule. */
export const CLEARING = "clearing";

/** Display order of amount types inside a document. */
export const AMOUNT_TYPE_ORDER = [
  "sale",
  "shipping_income",
  "refund",
  "marketplace_fee",
  "fulfillment_fee",
  "shipping_label",
  "shipping_refund",
  "postage_topup",
  "tax_withheld",
  "adjustment",
  "payout",
  CLEARING,
];

const LABELS: Record<string, string> = {
  sale: "sales",
  shipping_income: "shipping income",
  refund: "refunds",
  marketplace_fee: "marketplace fees",
  fulfillment_fee: "fulfillment fees",
  shipping_label: "shipping labels",
  shipping_refund: "shipping refunds",
  postage_topup: "postage top-ups",
  tax_withheld: "facilitator tax",
  adjustment: "adjustments",
  payout: "payouts to bank",
  clearing: "clearing",
};

export function amountTypeLabel(t: string): string {
  return LABELS[t] ?? t.replace(/_/g, " ");
}

export const glRuleId = (sourceId: string, amountType: string) => `gl-${sourceId}-${amountType}`;

/** Description template tokens: {source} {channel} {period} {type}. */
const TPL = "{source} {type}{channel} {period}";

function rule(r: Omit<NewGlRule, "id" | "descriptionTemplate"> & { descriptionTemplate?: string }): NewGlRule {
  return { id: glRuleId(r.sourceId, r.amountType), descriptionTemplate: TPL, ...r };
}

export function defaultGlRules(): NewGlRule[] {
  const rules: NewGlRule[] = [];

  // FedEx (slide 38: BC GL 40356 · Dept 180 · V00122 · net BNKDEPOSIT refunds)
  rules.push(
    rule({ sourceId: "fedex", amountType: "shipping_label", accountType: "G/L Account", accountNo: "40356", deptCode: "180", vendorNo: "V00122", journalSign: -1, isPlaceholder: 0 }),
    rule({ sourceId: "fedex", amountType: "shipping_refund", accountType: "G/L Account", accountNo: "40356", deptCode: "180", vendorNo: "V00122", journalSign: -1, isPlaceholder: 1 }),
    rule({ sourceId: "fedex", amountType: "adjustment", accountType: "G/L Account", accountNo: "40356", deptCode: "180", vendorNo: "V00122", journalSign: -1, isPlaceholder: 1 }),
    rule({ sourceId: "fedex", amountType: CLEARING, accountType: "Vendor", accountNo: "V00122", vendorNo: "V00122", journalSign: 1, isPlaceholder: 0, descriptionTemplate: "FedEx invoices {period}" }),
  );

  // OSM / Pitney Bowes / EasyPost (slide 38: 1st Source acct 0101 · GL 10009)
  const shp = "shipping_osm_pb_easypost";
  rules.push(
    rule({ sourceId: shp, amountType: "shipping_label", accountType: "G/L Account", accountNo: "10009", deptCode: "180", journalSign: -1, isPlaceholder: 0 }),
    rule({ sourceId: shp, amountType: "shipping_refund", accountType: "G/L Account", accountNo: "10009", deptCode: "180", journalSign: -1, isPlaceholder: 1 }),
    rule({ sourceId: shp, amountType: "postage_topup", accountType: "G/L Account", accountNo: "10009", journalSign: -1, isPlaceholder: 1 }),
    rule({ sourceId: shp, amountType: "adjustment", accountType: "G/L Account", accountNo: "10009", deptCode: "180", journalSign: -1, isPlaceholder: 1 }),
    rule({ sourceId: shp, amountType: CLEARING, accountType: "Bank Account", accountNo: "0101", journalSign: 1, isPlaceholder: 0, descriptionTemplate: "1st Source 0101 postage {period}" }),
  );

  // Marketplaces: every account is a placeholder until Goodwill's chart of accounts is known.
  for (const s of MARKETPLACE_SOURCES) {
    const c = SOURCE_CODES[s];
    const gl = (amountType: string, accountNo: string, deptCode: string | null = "180", journalSign = -1) =>
      rule({ sourceId: s, amountType, accountType: "G/L Account", accountNo, deptCode, journalSign, isPlaceholder: 1 });
    rules.push(
      gl("sale", `TBC-4010-${c}`),
      gl("shipping_income", `TBC-4020-${c}`),
      gl("refund", `TBC-4030-${c}`),
      gl("marketplace_fee", `TBC-6010-${c}`),
      gl("fulfillment_fee", `TBC-6020-${c}`),
      gl("adjustment", `TBC-6090-${c}`),
      gl("tax_withheld", "TBC-2310", null),
      rule({ sourceId: s, amountType: "payout", accountType: "Bank Account", accountNo: "0101", journalSign: 1, isPlaceholder: 1 }),
      rule({ sourceId: s, amountType: CLEARING, accountType: "G/L Account", accountNo: `TBC-1210-${c}`, journalSign: 1, isPlaceholder: 1, descriptionTemplate: "{source} receivable {period}" }),
    );
  }

  // Goodwill Books: accounts for the AR invoice lines (not journaled).
  const gwb = (amountType: string, accountNo: string) =>
    rule({ sourceId: INVOICE_SOURCE, amountType, accountType: "G/L Account", accountNo, deptCode: "180", journalSign: -1, isPlaceholder: 1 });
  rules.push(
    gwb("sale", "TBC-4010-GWB"),
    gwb("shipping_income", "TBC-4020-GWB"),
    gwb("refund", "TBC-4030-GWB"),
    gwb("marketplace_fee", "TBC-6010-GWB"),
    gwb("adjustment", "TBC-6090-GWB"),
  );

  return rules;
}

/** Insert missing default rules. Idempotent; never overwrites an edited rule. */
export async function ensureGlRules(db: Db): Promise<number> {
  await ensureConfig(db);
  const rows = defaultGlRules();
  const res = await db.insert(glRules).values(rows).onConflictDoNothing().returning({ id: glRules.id });
  return res.length;
}
