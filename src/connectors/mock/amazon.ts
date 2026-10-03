/**
 * Mock Amazon report bytes in the Seller Central "Date Range Transaction"
 * CSV layout that src/sources/amazon.ts reads (preamble lines, header,
 * Order / Refund / Service Fee / Transfer rows, "Oct 1, 2026 6:02:11 AM PDT"
 * timestamps in Pacific time). Deterministic per day. Fake order ids and SKUs.
 *
 * Note for a real rollout: SP-API does not offer this exact report (the MWS
 * GET_DATE_RANGE_FINANCIAL_TRANSACTION_DATA type was not carried over); see
 * src/connectors/amazon.ts.
 */
import { dec, eventTimes, rng } from "../util";

const HEADER = [
  "date time", "settlement id", "type", "amazon order id", "sku", "description", "quantity", "marketplace",
  "fulfillment", "order city", "order state", "order postal", "tax collection model", "product sales",
  "product sales tax", "shipping credits", "shipping credits tax", "gift wrap credits", "giftwrap credits tax",
  "Regulatory Fee", "promotional rebates", "promotional rebates tax", "marketplace withheld tax", "referral fees",
  "fba fees", "other transaction fees", "other", "total amount",
];

const PREAMBLE = [
  '"Includes Amazon Marketplace, Fulfillment by Amazon (FBA), and Amazon Webstore transactions"',
  '"All amounts in USD, unless specified"',
  '"Definitions:"',
  '"Sales tax collected: Includes sales tax collected from buyers for product sales, shipping, and gift wrap."',
  '"Selling fees: Includes variable closing fees and referral fees."',
  '"Other transaction fees: Includes sales tax collection fees."',
  '"Other: Includes non-order transaction amounts. For more details, see the ""Type"" and ""Description"" columns for each order ID."',
];

const ITEMS: [string, string][] = [
  ["BK", "Poetry Anthology"], ["HM", "Glass Pitcher"], ["TY", "Puzzle 1000pc"], ["EL", "Portable Radio"],
  ["BK", "Cook's Atlas"], ["JW", "Silver Tone Bracelet"], ["BK", "Sci-Fi Paperback Lot"], ["HM", "Wool Blanket"],
  ["TY", "Plush Bear"], ["BK", "Dictionary"], ["HM", "Cast Iron Pan"], ["EL", "Film Camera"],
];

/** "Oct 1, 2026 6:02:11 AM PDT" in America/Los_Angeles. */
function pacific(d: Date): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZoneName: "short",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("month")} ${g("day")}, ${g("year")} ${g("hour")}:${g("minute")}:${g("second")} ${g("dayPeriod")} ${g("timeZoneName")}`;
}

const q = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function dateRangeCsv(day: string): string {
  const r = rng(`amazon:${day}`);
  const settlement = `188${day.replace(/-/g, "").slice(2)}${r.digits(3)}`;
  const n = r.int(5, 9);
  const times = eventTimes(r, day, n + 3);
  const rows: string[][] = [];
  const zero = "0.00";
  const orders: { id: string; sku: string; desc: string; price: number; ship: number; time: Date }[] = [];

  for (let i = 0; i < n; i++) {
    const [prefix, desc] = r.pick(ITEMS);
    const price = r.int(8, 30) * 100;
    const ship = r.pick([0, 399, 499, 500, 650, 700, 900]);
    const o = { id: `112-${r.digits(7)}-${r.digits(7)}`, sku: `${prefix}-${r.digits(4)}`, desc, price, ship, time: times[i] };
    orders.push(o);
    const pTax = Math.round(price * 0.07);
    const sTax = Math.round(ship * 0.07);
    const referral = -Math.round((price + ship) * 0.15);
    const total = price + ship + referral;
    rows.push([
      pacific(o.time), settlement, "Order", o.id, o.sku, desc, "1", "amazon.com", "Seller", "", "", "",
      "MarketplaceFacilitator", dec(price), dec(pTax), dec(ship), dec(sTax), "0", "0", "0", zero, "0",
      dec(-(pTax + sTax)), dec(referral), zero, zero, zero, dec(total),
    ]);
  }
  // One refund (sometimes), one service fee, one transfer to the bank.
  if (r.chance(0.5) && orders.length > 1) {
    const o = orders[r.int(0, orders.length - 1)];
    const pTax = Math.round(o.price * 0.07);
    const back = Math.round(o.price * 0.15 * 0.8); // Amazon keeps 20% of the referral fee
    rows.push([
      pacific(times[n]), settlement, "Refund", o.id, o.sku, o.desc, "1", "amazon.com", "Seller", "", "", "",
      "MarketplaceFacilitator", dec(-o.price), dec(-pTax), zero, zero, "0", "0", "0", zero, "0",
      dec(pTax), dec(back), zero, zero, zero, dec(-o.price + back),
    ]);
  }
  rows.push([
    pacific(times[n + 1]), settlement, "Service Fee", "", "", "Cost of Advertising", "", "", "", "", "", "", "",
    zero, zero, zero, zero, "0", "0", "0", zero, "0", zero, zero, zero, zero, dec(-r.int(150, 600)), "",
  ]);
  rows[rows.length - 1][27] = rows[rows.length - 1][26];
  rows.push([
    pacific(times[n + 2]), settlement, "Transfer", "", "", "To account ending in: 0000", "", "", "", "", "", "", "",
    zero, zero, zero, zero, "0", "0", "0", zero, "0", zero, zero, zero, zero, zero, dec(-r.int(80, 250) * 100),
  ]);
  return [...PREAMBLE, HEADER.join(","), ...rows.map((row) => row.map(q).join(","))].join("\n") + "\n";
}
