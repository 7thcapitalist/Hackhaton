/**
 * Mock SP-API Finances v2024-06-19 listTransactions responses, in the exact
 * shape of ListTransactionsResponse { payload: { nextToken?, transactions[] } }
 * (see src/sources/amazon_api.ts for the model link).
 *
 * Built FROM the Date Range Transaction CSV (a data/fixtures/amazon/ file, or
 * the generated CSV of ./amazon.ts), one transaction per CSV row, so the JSON
 * and the CSV describe the SAME transactions: same order ids + SKUs (dedupe
 * keys), same amounts, same posting instants. breakdownType names are our
 * guess (the model does not enumerate them). All ids are fake.
 */
import { readTable } from "@/ingest/read";
import { parseDateTime } from "@/sources/_shared/marketplace";
import { toCents } from "@/sources/_shared/table";
import { seedOf } from "../util";

const COLS = {
  date: ["date/time", "date time", "posted date/time", "posted date"],
  settlement: ["settlement id", "settlement-id", "settlementid"],
  type: ["type", "transaction type"],
  orderId: ["order id", "amazon order id", "order-id"],
  sku: ["sku", "seller sku"],
  description: ["description"],
  quantity: ["quantity", "qty"],
  fulfillment: ["fulfillment"],
  productSales: ["product sales", "product sales amount", "item price"],
  productSalesTax: ["product sales tax"],
  shipping: ["shipping credits", "shipping credit"],
  shippingTax: ["shipping credits tax"],
  giftWrap: ["gift wrap credits", "giftwrap credits"],
  giftWrapTax: ["giftwrap credits tax", "gift wrap credits tax"],
  promo: ["promotional rebates", "promotional rebate"],
  promoTax: ["promotional rebates tax"],
  withheld: ["marketplace withheld tax", "marketplace facilitator tax"],
  sellingFees: ["selling fees", "referral fees", "selling fee"],
  fbaFees: ["fba fees", "fulfillment fees"],
  otherFees: ["other transaction fees"],
  total: ["total", "total amount"],
} as const;
type Col = keyof typeof COLS;

const money = (cents: number) => ({ currencyCode: "USD", currencyAmount: Math.round(cents) / 100 });

const TYPE_MAP: Record<string, { transactionType: string; description?: string }> = {
  order: { transactionType: "Shipment", description: "Order Payment" },
  refund: { transactionType: "Refund", description: "Refund Order" },
  "service fee": { transactionType: "ServiceFee" },
  transfer: { transactionType: "Transfer" },
  adjustment: { transactionType: "Adjustment" },
  "fba inventory fee": { transactionType: "FBAInventoryFee" },
  "fba customer return fee": { transactionType: "FBACustomerReturnFee" },
};

function leaf(type: string, cents: number) {
  return { breakdownType: type, breakdownAmount: money(cents), breakdowns: [] as unknown[] };
}
function group(type: string, kids: { breakdownAmount: { currencyAmount: number } }[]) {
  const sum = Math.round(kids.reduce((t, k) => t + k.breakdownAmount.currencyAmount * 100, 0));
  return { breakdownType: type, breakdownAmount: money(sum), breakdowns: kids };
}

/** Date Range Transaction CSV bytes → one listTransactions response (all rows, file order). */
export async function transactionsFromCsv(bytes: Uint8Array, fileName: string): Promise<unknown> {
  const table = await readTable(bytes, fileName);
  const h = table.findIndex((r) => {
    const low = r.map((c) => c.toLowerCase().trim());
    return COLS.type.some((a) => low.includes(a)) && COLS.date.some((a) => low.includes(a));
  });
  const transactions: unknown[] = [];
  if (h >= 0) {
    const header = table[h].map((c) => c.toLowerCase().trim());
    const idx = Object.fromEntries(
      (Object.keys(COLS) as Col[]).map((k) => [k, header.findIndex((x) => (COLS[k] as readonly string[]).includes(x))]),
    ) as Record<Col, number>;
    table.slice(h + 1).forEach((row, i) => {
      const get = (k: Col) => (idx[k] >= 0 ? (row[idx[k]] ?? "").trim() : "");
      const c = (k: Col) => toCents(get(k)) ?? 0;
      const type = get("type").toLowerCase();
      const when = parseDateTime(get("date"));
      if (!type || !when) return;
      const map = TYPE_MAP[type] ?? { transactionType: get("type").replace(/\s+/g, "") };
      const orderId = get("orderId");
      const settlement = get("settlement");
      const tId = `TX-${(seedOf(`${fileName}:${i}`) >>> 0).toString(16).padStart(8, "0")}`;
      const relatedIdentifiers = [
        ...(orderId ? [{ relatedIdentifierName: "ORDER_ID", relatedIdentifierValue: orderId }] : []),
        ...(settlement ? [{ relatedIdentifierName: "SETTLEMENT_ID", relatedIdentifierValue: settlement }] : []),
        ...(type === "transfer" ? [{ relatedIdentifierName: "DISBURSEMENT_ID", relatedIdentifierValue: `DSB-${settlement}` }] : []),
      ];
      const tx: Record<string, unknown> = {
        sellingPartnerMetadata: { sellingPartnerId: "AMOCKSELLER00", accountType: "PAYABLE", marketplaceId: "ATVPDKIKX0DER" },
        relatedIdentifiers,
        transactionType: map.transactionType,
        transactionId: tId,
        transactionStatus: "RELEASED",
        description: get("description") || map.description || get("type"),
        postedDate: when.toISOString(),
        totalAmount: money(c("total")),
        marketplaceDetails: { marketplaceId: "ATVPDKIKX0DER", marketplaceName: "Amazon.com" },
      };
      if (type === "order" || type === "refund") {
        const sales = [leaf("ProductCharges", c("productSales")), leaf("ShippingCharges", c("shipping"))];
        if (c("giftWrap")) sales.push(leaf("GiftWrapCharges", c("giftWrap")));
        if (c("promo")) sales.push(leaf("PromotionalRebates", c("promo")));
        const tax = [leaf("ProductTax", c("productSalesTax")), leaf("ShippingTax", c("shippingTax"))];
        if (c("giftWrapTax")) tax.push(leaf("GiftWrapTax", c("giftWrapTax")));
        if (c("promoTax")) tax.push(leaf("PromotionalRebatesTax", c("promoTax")));
        tax.push(leaf("MarketplaceFacilitatorTax", c("withheld")));
        const fees = [leaf("ReferralFee", c("sellingFees"))];
        if (c("fbaFees")) fees.push(leaf("FBAFees", c("fbaFees")));
        if (c("otherFees")) fees.push(leaf("OtherTransactionFees", c("otherFees")));
        tx.breakdowns = [group("Sales", sales), group("Tax", tax), group("AmazonFees", fees)];
        tx.items = [
          {
            description: get("description"),
            totalAmount: money(c("total")),
            relatedIdentifiers: [{ itemRelatedIdentifierName: "TRANSACTION_ID", itemRelatedIdentifierValue: tId }],
            contexts: [
              {
                contextType: "ProductContext",
                asin: `B0${(seedOf(get("sku")) % 1e8).toString().padStart(8, "0")}`,
                sku: get("sku"),
                quantityShipped: parseInt(get("quantity"), 10) || 1,
                fulfillmentNetwork: get("fulfillment").toLowerCase() === "amazon" ? "AFN" : "MFN",
              },
            ],
          },
        ];
      } else {
        tx.breakdowns = [leaf(type === "transfer" ? "Transfer" : "Expenses", c("total"))];
        tx.items = [];
      }
      transactions.push(tx);
    });
  }
  return { payload: { transactions } };
}
