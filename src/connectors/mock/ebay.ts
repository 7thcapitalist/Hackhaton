/**
 * Mock eBay REST responses, in the exact shapes of:
 *  - Sell Fulfillment getOrders → OrderSearchPagedCollection
 *    https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders
 *  - Sell Finances getTransactions → TransactionsPagedCollection
 *    https://developer.ebay.com/api-docs/sell/finances/resources/transaction/methods/getTransactions
 *  - Sell Finances getPayouts → Payouts
 *    https://developer.ebay.com/api-docs/sell/finances/resources/payout/methods/getPayouts
 *
 * Orders come from data/fixtures/ebay/ when a fixture file covers the day
 * (so the API mock and the CSV fixture describe the SAME sales), otherwise
 * they are generated deterministically from the date. All buyers, addresses
 * and ids are fake.
 */
import type { ParsedOrder } from "@/sources/types";
import { dayWindow, dec, eventTimes, rng, type Rng } from "../util";

export interface MockLine {
  itemId: string;
  title: string;
  quantity: number;
  /** lineItemCost: unit price × quantity */
  costCents: number;
  shippingCents: number;
  /** eBay Collect and Remit sales tax */
  taxCents: number;
  refundCents: number;
}

export interface MockOrder {
  orderId: string;
  createdAt: Date;
  buyer: string;
  lines: MockLine[];
  status: "paid" | "refunded" | "cancelled";
  /** totalMarketplaceFee */
  feeCents: number;
}

const TITLES = [
  "Vintage Desk Lamp", "Denim Jacket", "Board Book Lot", "Camera Strap", "Fondue Set", "Golf Balls (24)",
  "Picture Frame Set", "Cookie Jar", "Sewing Pattern Lot", "Brass Lantern", "Wool Scarf", "Vinyl Record Lot",
  "Cast Iron Skillet", "Hardcover Atlas", "Ceramic Vase", "Leather Belt", "Puzzle 1000pc", "Silver Tone Bracelet",
];
const SELLER = "goodwill_mock_seller";
const usd = (cents: number) => ({ value: dec(cents), currency: "USD" });
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, ".000Z");

/**
 * eBay final value fee, as the mock charges it: 13.6% of the item price
 * (lineItemCost) per line + $0.40 per order (eBay's most-categories rate for
 * sales up to $7,500; the per-order fee is $0.40 above $10). Shared with the
 * mock truth model (scripts/mock/model.ts) so the Upright fee column and the
 * eBay API mock charge the same fee for the same sale.
 */
export const EBAY_FVF_RATE = 0.136;
export const EBAY_PER_ORDER_FEE_CENTS = 40;
export function ebayLineFeeCents(itemCents: number, firstLine: boolean): number {
  return Math.round(itemCents * EBAY_FVF_RATE) + (firstLine ? EBAY_PER_ORDER_FEE_CENTS : 0);
}
/** Fee per line; a repeated item id (the same CSV row from a re-uploaded file) is charged once. */
const lineFees = (m: MockOrder) =>
  m.lines.map((l, j) => (m.lines.findIndex((x) => x.itemId === l.itemId) < j ? 0 : ebayLineFeeCents(l.costCents, j === 0)));

export function generateOrders(day: string): MockOrder[] {
  const r: Rng = rng(`ebay:${day}`);
  const n = r.int(6, 10);
  const times = eventTimes(r, day, n);
  const [, mm, dd] = day.split("-");
  return times.map((createdAt, i) => {
    const lines: MockLine[] = [];
    const lineCount = r.chance(0.15) ? 2 : 1;
    for (let j = 0; j < lineCount; j++) {
      const quantity = r.chance(0.1) ? 2 : 1;
      const cost = r.int(8, 45) * 100 * quantity;
      const shipping = j === 0 ? r.int(4, 11) * 100 + r.pick([0, 50]) : 0;
      lines.push({
        itemId: `318${mm}${dd}${String(i).padStart(2, "0")}${j}${r.digits(2)}`, // 12 digits, like a legacy item id
        title: r.pick(TITLES),
        quantity,
        costCents: cost,
        shippingCents: shipping,
        taxCents: Math.round((cost + shipping) * 0.07), // Indiana 7%, collected and remitted by eBay
        refundCents: 0,
      });
    }
    let status: MockOrder["status"] = "paid";
    if (r.chance(0.1)) {
      status = "refunded";
      lines[0].refundCents = Math.min(lines[0].costCents, r.int(5, 15) * 100);
    }
    return {
      orderId: `27-${mm}${dd}${i}-${r.digits(5)}`,
      createdAt,
      buyer: `mock_buyer_${r.hex(6)}`,
      lines,
      status,
      feeCents: lines.reduce((a, l, j) => a + ebayLineFeeCents(l.costCents, j === 0), 0),
    };
  });
}

/**
 * ParsedOrder rows (e.g. from a CSV fixture) → mock orders with the same ids and amounts.
 * The Seller Hub Orders CSV has no fee column, so when the rows carry no fee the
 * final value fee is computed (ebayLineFeeCents) and the API mock reports it
 * in getOrders totalMarketplaceFee and in the getTransactions SALE fees.
 * Cancelled orders are charged no fee.
 */
export function ordersFromParsed(rows: ParsedOrder[]): MockOrder[] {
  const byId = new Map<string, MockOrder>();
  for (const o of rows) {
    let m = byId.get(o.externalOrderId);
    if (!m) {
      m = {
        orderId: o.externalOrderId,
        createdAt: new Date(o.orderTs),
        buyer: o.buyerId ?? "mock_buyer",
        lines: [],
        status: o.status,
        feeCents: 0,
      };
      byId.set(o.externalOrderId, m);
    }
    m.lines.push({
      itemId: o.externalItemId ?? "",
      title: "Item",
      quantity: o.quantity ?? 1,
      costCents: o.grossCents ?? 0,
      shippingCents: o.shippingCents ?? 0,
      taxCents: o.taxCents ?? 0,
      refundCents: o.refundCents ?? 0,
    });
    m.feeCents += o.feeCents ?? 0;
    if (o.status !== "paid") m.status = o.status;
  }
  const out = [...byId.values()];
  for (const m of out) {
    if (m.feeCents === 0 && m.status !== "cancelled") m.feeCents = lineFees(m).reduce((a, b) => a + b, 0);
  }
  return out;
}

/** One Order object as getOrders returns it. */
export function toEbayOrder(m: MockOrder, seq: number): Record<string, unknown> {
  const r = rng(`ebay-order:${m.orderId}`);
  const created = iso(m.createdAt);
  const sum = (f: (l: MockLine) => number) => m.lines.reduce((a, l) => a + f(l), 0);
  const subtotal = sum((l) => l.costCents);
  const delivery = sum((l) => l.shippingCents);
  const tax = sum((l) => l.taxCents);
  const total = subtotal + delivery + tax;
  const refunds = sum((l) => l.refundCents);
  const cancelled = m.status === "cancelled";
  const paymentStatus = refunds > 0 ? (refunds >= total ? "FULLY_REFUNDED" : "PARTIALLY_REFUNDED") : "PAID";
  const refundDate = iso(new Date(m.createdAt.getTime() + 6 * 3600_000));
  return {
    orderId: m.orderId,
    legacyOrderId: m.orderId,
    creationDate: created,
    lastModifiedDate: refunds > 0 ? refundDate : created,
    orderFulfillmentStatus: cancelled ? "NOT_STARTED" : "FULFILLED",
    orderPaymentStatus: paymentStatus,
    sellerId: SELLER,
    buyer: {
      username: m.buyer,
      taxAddress: { stateOrProvince: "IN", postalCode: "46601", countryCode: "US" },
    },
    pricingSummary: {
      priceSubtotal: usd(subtotal),
      deliveryCost: usd(delivery),
      tax: usd(tax),
      total: usd(total),
    },
    cancelStatus: cancelled
      ? { cancelState: "CANCELED", cancelRequests: [{ cancelInitiator: "SELLER", cancelReason: "OUT_OF_STOCK_OR_CANNOT_FULFILL", cancelRequestedDate: created, cancelRequestState: "COMPLETED" }] }
      : { cancelState: "NONE_REQUESTED", cancelRequests: [] },
    paymentSummary: {
      totalDueSeller: usd(total - tax - refunds),
      refunds: refunds > 0
        ? [{ refundId: `5${r.digits(11)}`, refundStatus: "REFUNDED", amount: usd(refunds), refundDate, refundReferenceId: r.digits(17) }]
        : [],
      payments: [{
        paymentMethod: "EBAY",
        paymentReferenceId: r.hex(12).toUpperCase(),
        paymentDate: created,
        amount: usd(total),
        paymentStatus: "PAID",
      }],
    },
    fulfillmentStartInstructions: [{
      fulfillmentInstructionsType: "SHIP_TO",
      minEstimatedDeliveryDate: iso(new Date(m.createdAt.getTime() + 3 * 86400_000)),
      maxEstimatedDeliveryDate: iso(new Date(m.createdAt.getTime() + 6 * 86400_000)),
      ebaySupportedFulfillment: false,
      shippingStep: {
        shipTo: {
          fullName: "Mock Buyer",
          contactAddress: { addressLine1: "100 Test St", city: "South Bend", stateOrProvince: "IN", postalCode: "46601", countryCode: "US" },
        },
        shippingCarrierCode: "USPS",
        shippingServiceCode: "USPSGroundAdvantage",
      },
    }],
    fulfillmentHrefs: [],
    lineItems: m.lines.map((l, j) => ({
      lineItemId: `10${r.digits(11)}${j}`,
      legacyItemId: l.itemId,
      sku: "",
      title: l.title,
      lineItemCost: usd(l.costCents),
      quantity: l.quantity,
      soldFormat: "FIXED_PRICE",
      listingMarketplaceId: "EBAY_US",
      purchaseMarketplaceId: "EBAY_US",
      lineItemFulfillmentStatus: cancelled ? "NOT_STARTED" : "FULFILLED",
      total: usd(l.costCents + l.shippingCents + l.taxCents),
      deliveryCost: { shippingCost: usd(l.shippingCents) },
      appliedPromotions: [],
      taxes: [],
      ebayCollectAndRemitTaxes: l.taxCents
        ? [{ taxType: "STATE_SALES_TAX", amount: usd(l.taxCents), collectionMethod: "NET" }]
        : [],
      properties: { buyerProtection: true },
      refunds: l.refundCents ? [{ amount: usd(l.refundCents), refundDate, refundId: `5${r.digits(11)}`, refundReferenceId: r.digits(17) }] : [],
      lineItemFulfillmentInstructions: {
        minEstimatedDeliveryDate: iso(new Date(m.createdAt.getTime() + 3 * 86400_000)),
        maxEstimatedDeliveryDate: iso(new Date(m.createdAt.getTime() + 6 * 86400_000)),
        shipByDate: iso(new Date(m.createdAt.getTime() + 2 * 86400_000)),
        guaranteedDelivery: false,
      },
      itemLocation: { location: "South Bend, Indiana", countryCode: "US", postalCode: "46601" },
    })),
    salesRecordReference: String(7000 + seq),
    totalFeeBasisAmount: usd(total),
    totalMarketplaceFee: usd(m.feeCents),
  };
}

/** getOrders response page for one business day. */
export function ordersPage(day: string, orders: MockOrder[]): Record<string, unknown> {
  const { start, end } = dayWindow(day);
  const filter = `creationdate:%5B${iso(start)}..${iso(end)}%5D`;
  return {
    href: `https://api.ebay.com/sell/fulfillment/v1/order?filter=${filter}&limit=200&offset=0`,
    total: orders.length,
    limit: 200,
    offset: 0,
    orders: orders.map((o, i) => toEbayOrder(o, i + 1)),
  };
}

/**
 * getTransactions response for one day: a SALE per order and one ad fee.
 * The final value fee rides on the SALE (totalFeeAmount, orderLineItems[].marketplaceFees
 * FINAL_VALUE_FEE), as eBay reports it. The parser skips SALE transactions: the
 * same fee already reaches orders.fee_cents through getOrders totalMarketplaceFee,
 * so it is counted once. Only NON_SALE_CHARGE (the ad fee) becomes a
 * "marketplace_fee" money line.
 */
export function transactionsPage(day: string, orders: MockOrder[]): Record<string, unknown> {
  const r = rng(`ebay-tx:${day}`);
  const { start, end } = dayWindow(day);
  const transactions: Record<string, unknown>[] = orders.map((o) => {
    const amount = o.lines.reduce((a, l) => a + l.costCents + l.shippingCents, 0) - o.feeCents;
    // Split the order fee over the lines (formula share; the remainder goes on the first line).
    const shares = lineFees(o);
    const scale = shares.reduce((a, b) => a + b, 0);
    const perLine = shares.map((f) => (scale > 0 ? Math.round((o.feeCents * f) / scale) : 0));
    if (perLine.length) perLine[0] += o.feeCents - perLine.reduce((a, b) => a + b, 0);
    return {
      transactionId: `${r.digits(2)}-${r.digits(5)}-${r.digits(5)}`,
      orderId: o.orderId,
      salesRecordReference: "0",
      buyer: { username: o.buyer },
      transactionType: "SALE",
      amount: usd(amount),
      totalFeeBasisAmount: usd(o.lines.reduce((a, l) => a + l.costCents + l.shippingCents + l.taxCents, 0)),
      totalFeeAmount: usd(o.feeCents),
      orderLineItems: o.lines.map((l, j) => ({
        lineItemId: l.itemId,
        feeBasisAmount: usd(l.costCents + l.shippingCents + l.taxCents),
        marketplaceFees: [{ feeType: "FINAL_VALUE_FEE", amount: usd(perLine[j]), feeMemo: "" }],
      })),
      bookingEntry: "CREDIT",
      transactionDate: iso(o.createdAt),
      transactionStatus: "FUNDS_AVAILABLE_FOR_PAYOUT",
      paymentsEntity: "eBay Commerce Inc.",
    };
  });
  const adTime = new Date(start.getTime() + 20 * 3600_000);
  transactions.push({
    transactionId: `FEE-${day.replace(/-/g, "")}-${r.digits(6)}`,
    transactionType: "NON_SALE_CHARGE",
    amount: usd(r.int(150, 650)),
    bookingEntry: "DEBIT",
    transactionDate: iso(adTime),
    transactionStatus: "FUNDS_AVAILABLE_FOR_PAYOUT",
    transactionMemo: "Promoted Listings - General fee",
    feeType: "AD_FEE",
    references: [],
    paymentsEntity: "eBay Commerce Inc.",
  });
  return {
    href: `https://apiz.ebay.com/sell/finances/v1/transaction?filter=transactionDate:%5B${iso(start)}..${iso(end)}%5D&limit=1000&offset=0`,
    limit: 1000,
    offset: 0,
    total: transactions.length,
    transactions,
  };
}

/** getPayouts response for one day: one succeeded payout of the previous day's sales. */
export function payoutsPage(day: string, previousDayOrders: MockOrder[]): Record<string, unknown> {
  const r = rng(`ebay-payout:${day}`);
  const { start, end } = dayWindow(day);
  const amount = previousDayOrders.reduce(
    (a, o) => a + o.lines.reduce((b, l) => b + l.costCents + l.shippingCents - l.refundCents, 0) - o.feeCents,
    0,
  );
  const payouts = amount > 0
    ? [{
        payoutId: r.digits(10),
        payoutStatus: "SUCCEEDED",
        payoutStatusDescription: "Funds sent",
        amount: usd(amount),
        payoutDate: iso(new Date(start.getTime() + 9 * 3600_000)),
        lastAttemptedPayoutDate: iso(new Date(start.getTime() + 9 * 3600_000)),
        transactionCount: previousDayOrders.length,
        payoutInstrument: { instrumentType: "BANK", nickname: "Checking (mock)", accountLastFourDigits: "0000" },
      }]
    : [];
  return {
    href: `https://apiz.ebay.com/sell/finances/v1/payout?filter=payoutDate:%5B${iso(start)}..${iso(end)}%5D&limit=200&offset=0`,
    limit: 200,
    offset: 0,
    total: payouts.length,
    payouts,
  };
}
