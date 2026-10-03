/**
 * eBay connector (mode api_json).
 *
 * Real path (runs only when EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and
 * EBAY_REFRESH_TOKEN are set):
 *  1. OAuth: POST /identity/v1/oauth2/token, grant_type=refresh_token, HTTP
 *     Basic auth with client id:secret, scopes sell.fulfillment.readonly and
 *     sell.finances. The refresh token comes from a one-time user consent
 *     (authorization-code grant) by Goodwill's eBay seller account; it lasts
 *     ~18 months.  https://developer.ebay.com/api-docs/static/oauth-refresh-token-request.html
 *  2. Per Indianapolis business day (UTC window [00:00, 24:00) local):
 *     - Sell Fulfillment getOrders  GET /sell/fulfillment/v1/order
 *       ?filter=creationdate:[start..end]&limit=200, following `next`.
 *       https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders
 *     - Sell Finances getTransactions  GET https://apiz.ebay.com/sell/finances/v1/transaction
 *       ?filter=transactionDate:[start..end]&limit=1000 (offset paging)
 *     - Sell Finances getPayouts  GET https://apiz.ebay.com/sell/finances/v1/payout
 *       ?filter=payoutDate:[start..end]&limit=200
 *       (Finances calls need the X-EBAY-C-MARKETPLACE-ID header.)
 *     Each response page is saved verbatim as one .json file and read by
 *     src/sources/ebay_api.ts.
 *  EBAY_ENV=sandbox switches to the sandbox hosts.
 *
 * Mock path: the same three responses, generated per day (src/connectors/mock/ebay.ts),
 * built from data/fixtures/ebay/ when a fixture covers the day.
 */
import { ebayParser } from "@/sources/ebay";
import { fixtureOrders, fixturesOnly } from "./fixtures";
import { generateOrders, ordersFromParsed, ordersPage, payoutsPage, transactionsPage, type MockOrder } from "./mock/ebay";
import type { Connector, PulledFile, PullRequest } from "./types";
import { assertRange, dayWindow, daysIn, env, hasEnv, httpJson, jsonFile } from "./util";

const ENV_VARS = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_REFRESH_TOKEN"];
const SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
].join(" ");
const MAX_PAGES = 50;

function hosts() {
  const sandbox = env("EBAY_ENV") === "sandbox";
  return {
    api: sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com",
    apiz: sandbox ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com",
  };
}

async function accessToken(): Promise<string> {
  const basic = Buffer.from(`${env("EBAY_CLIENT_ID")}:${env("EBAY_CLIENT_SECRET")}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env("EBAY_REFRESH_TOKEN")!,
    scope: SCOPES,
  });
  const res = await httpJson<{ access_token: string }>("ebay", `${hosts().api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return res.access_token;
}

/** eBay date-range filter value: field:[start..end] with the brackets URL-encoded. */
function rangeFilter(field: string, day: string): string {
  const { start, end } = dayWindow(day);
  return `${field}:%5B${start.toISOString()}..${end.toISOString()}%5D`;
}

async function pages(
  firstUrl: string,
  headers: Record<string, string>,
  fileBase: string,
): Promise<PulledFile[]> {
  const out: PulledFile[] = [];
  let url: string | undefined = firstUrl;
  for (let page = 1; url && page <= MAX_PAGES; page++) {
    const body: Record<string, unknown> = await httpJson("ebay", url, { headers });
    out.push(jsonFile(`${fileBase}_p${page}.json`, body));
    url = typeof body.next === "string" && body.next ? body.next : undefined;
  }
  return out;
}

async function pullReal(req: PullRequest): Promise<PulledFile[]> {
  const token = await accessToken();
  const { api, apiz } = hosts();
  const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const fin = { ...auth, "X-EBAY-C-MARKETPLACE-ID": env("EBAY_MARKETPLACE_ID") ?? "EBAY_US" };
  const out: PulledFile[] = [];
  for (const day of daysIn(req)) {
    out.push(
      ...(await pages(
        `${api}/sell/fulfillment/v1/order?filter=${rangeFilter("creationdate", day)}&limit=200`,
        auth,
        `pull_ebay_api_orders_${day}`,
      )),
      ...(await pages(
        `${apiz}/sell/finances/v1/transaction?filter=${rangeFilter("transactionDate", day)}&limit=1000`,
        fin,
        `pull_ebay_api_transactions_${day}`,
      )),
      ...(await pages(
        `${apiz}/sell/finances/v1/payout?filter=${rangeFilter("payoutDate", day)}&limit=200`,
        fin,
        `pull_ebay_api_payouts_${day}`,
      )),
    );
  }
  return out;
}

async function mockOrders(day: string): Promise<MockOrder[]> {
  const fromFixture = await fixtureOrders("ebay", ebayParser, day);
  if (fromFixture.length || fixturesOnly()) return ordersFromParsed(fromFixture);
  return generateOrders(day);
}

async function pullMock(req: PullRequest): Promise<PulledFile[]> {
  const out: PulledFile[] = [];
  for (const day of daysIn(req)) {
    const orders = await mockOrders(day);
    const prev = new Date(`${day}T12:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    const previous = await mockOrders(prev.toISOString().slice(0, 10));
    out.push(
      jsonFile(`pull_ebay_api_orders_${day}_p1.json`, ordersPage(day, orders)),
      jsonFile(`pull_ebay_api_transactions_${day}_p1.json`, transactionsPage(day, orders)),
      jsonFile(`pull_ebay_api_payouts_${day}_p1.json`, payoutsPage(day, previous)),
    );
  }
  return out;
}

export const ebayConnector: Connector = {
  sourceId: "ebay",
  label: "eBay (Sell Fulfillment + Finances APIs)",
  mode: "api_json",
  describe: "REST JSON: getOrders, getTransactions, getPayouts per business day (OAuth refresh token).",
  requiredEnvVars: ENV_VARS,
  envVars: [...ENV_VARS, "EBAY_ENV", "EBAY_MARKETPLACE_ID"],
  hasCredentials: () => hasEnv(ENV_VARS),
  async pull(req) {
    assertRange(req);
    return req.mock ? pullMock(req) : pullReal(req);
  },
};
