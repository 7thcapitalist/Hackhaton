/**
 * ShopGoodwill seller portal "periodic marketplace report" parser.
 *
 * Sources:
 *  - Seller program (Goodwill members only):
 *    https://shopgoodwill.com/help/faqdetail/can-i-become-a-seller-on-shopgoodwillcom
 *  - Listings report as seen through Upright:
 *    https://help.uprightlabs.com/en-us/lister/shopgoodwill-listings-report
 *  - Slide 38 (docs/goodwill-problem.md): "Filter year/month; Period 1 periodic
 *    only; Period 3 all reports". docs/research.md §2.
 *
 * Assumptions (there is NO public column list, so almost everything is a guess):
 *  - [fact] The report is filtered by year/month and has a "Period" notion
 *    (Period 1 / Period 3).
 *  - [guess] A preamble above the header names the report, seller, year/month
 *    and "Period N"; we capture "Period N" as periodLabel. If the preamble has
 *    none, we look for "period1"/"period-3"/"_p3" in the file name.
 *  - [guess] Columns: Order ID, Item ID, Title, Category, End Date, Winning Bid,
 *    Shipping, Handling, Buyer Premium, Seller Fee, Refund, Net, Buyer ID, Status.
 *    Buyer Premium is paid by the buyer to ShopGoodwill and is ignored.
 *  - [guess] A trailing "Total"/"Totals" row; skipped.
 *  - [guess] End Date has no zone → read as Indianapolis local. Open question:
 *    the ShopGoodwill site shows auction times in Pacific time; confirm the zone
 *    the report uses.
 *  - [guess] Status: Paid/Shipped/Completed/Picked Up → paid; Refunded → refunded;
 *    Cancelled/Unpaid → cancelled; anything else → warning, treated as paid.
 *  - [guess] No Order ID column → Item ID is used as the order id.
 *  - gross = Winning Bid; shipping = Shipping + Handling; fee = Seller Fee;
 *    our net is recomputed and compared with the file's Net column.
 */
import type { ParsedOrder, ParseResult, RawTable, SourceParser } from "./types";
import { columnIndex, isBlankRow, normalizeHeader, toCents } from "./_shared/table";
import {
  cell,
  cents,
  findHeaderRowByAliases,
  finishResult,
  headerNotFound,
  netOf,
  parseDateTime,
  stamp,
  warnMissingColumns,
} from "./_shared/marketplace";

const ALIASES = {
  orderId: ["order id", "order #", "order number"],
  itemId: ["item id", "item #", "auction id"],
  title: ["title", "item title"],
  category: ["category", "category name"],
  endDate: ["end date", "auction end date", "sold date", "end time"],
  winningBid: ["winning bid", "high bid", "final price"],
  shipping: ["shipping", "shipping charged", "shipping fee"],
  handling: ["handling", "handling fee"],
  sellerFee: ["seller fee", "commission", "marketplace fee"],
  refund: ["refund", "refund amount", "refunded"],
  net: ["net", "net amount", "net proceeds"],
  buyer: ["buyer id", "buyer", "bidder id"],
  status: ["status", "order status"],
};
type Key = keyof typeof ALIASES;
const REQUIRED: Key[] = ["itemId", "endDate", "winningBid"];

const TOTAL_ROW = /^totals?\b/i;

function statusOf(raw: string): ParsedOrder["status"] | null {
  const s = raw.trim().toLowerCase();
  if (s === "" || /paid|ship|complete|picked|deliver/.test(s)) return "paid";
  if (/refund|return/.test(s)) return "refunded";
  if (/cancel|unpaid|non-?pay/.test(s)) return "cancelled";
  return null;
}

/** "Period 1" / "Period 3" from the preamble rows, else from the file name. */
function periodLabelOf(table: RawTable, headerRow: number, fileName: string): string | undefined {
  for (let i = 0; i < headerRow; i++) {
    for (const c of table[i]) {
      const m = c.match(/period\s*(\d+)/i);
      if (m) return `Period ${m[1]}`;
    }
  }
  const f = fileName.match(/period[\s_-]*(\d+)/i) ?? fileName.match(/[_-]p(\d)(?=[._-]|$)/i);
  return f ? `Period ${f[1]}` : undefined;
}

export const shopgoodwillParser: SourceParser = {
  sourceId: "shopgoodwill",
  version: "1.0.0",

  accepts(table: RawTable): boolean {
    return findHeaderRowByAliases(table, ALIASES, REQUIRED) >= 0;
  },

  parse(table, ctx): ParseResult {
    const h = findHeaderRowByAliases(table, ALIASES, REQUIRED);
    if (h < 0) return headerNotFound("ShopGoodwill periodic marketplace");

    const header = table[h];
    const col = columnIndex(header, ALIASES);
    const result: ParseResult = {
      orders: [],
      moneyLines: [],
      warnings: [],
      headerRowIndex: h,
      header: header.map(normalizeHeader),
      periodLabel: periodLabelOf(table, h, ctx.fileName),
    };
    if (!result.periodLabel) result.warnings.push({ message: 'No "Period N" label found in the preamble or file name.' });
    warnMissingColumns(result, col, ["orderId", "sellerFee", "buyer", "status"]);

    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      const sourceRow = i + 1;
      if (isBlankRow(row) || TOTAL_ROW.test(row[0] ?? "")) continue;

      const itemId = cell(row, col.itemId);
      if (!itemId) {
        result.warnings.push({ row: sourceRow, message: "Row without an Item ID; skipped." });
        continue;
      }
      const when = parseDateTime(cell(row, col.endDate));
      if (!when) {
        result.warnings.push({ row: sourceRow, message: `Unreadable End Date "${cell(row, col.endDate)}"; row skipped.` });
        continue;
      }

      let status = statusOf(cell(row, col.status));
      if (!status) {
        result.warnings.push({ row: sourceRow, message: `Unknown status "${cell(row, col.status)}"; treated as paid.` });
        status = "paid";
      }

      const amounts = {
        grossCents: cents(row, col.winningBid),
        shippingCents: cents(row, col.shipping) + cents(row, col.handling),
        refundCents: Math.abs(cents(row, col.refund)),
        feeCents: Math.abs(cents(row, col.sellerFee)),
        taxCents: 0,
      };
      if (amounts.refundCents > 0 && status === "paid") status = "refunded";
      const net = netOf(amounts);
      const fileNet = toCents(cell(row, col.net));
      if (fileNet != null && Math.abs(fileNet - net) > 1) {
        result.warnings.push({ row: sourceRow, message: `Net ${fileNet / 100} in file differs from computed ${net / 100}.` });
      }

      let orderId = cell(row, col.orderId);
      if (!orderId) orderId = itemId;

      result.orders.push({
        sourceRow,
        channel: "shopgoodwill",
        externalOrderId: orderId,
        externalItemId: itemId,
        ...stamp(when),
        buyerId: cell(row, col.buyer) || null,
        category: cell(row, col.category) || null,
        quantity: 1,
        currency: "USD",
        ...amounts,
        netCents: net,
        status,
      });
    }

    return finishResult(result, ctx.fileName, ctx.period);
  },
};
