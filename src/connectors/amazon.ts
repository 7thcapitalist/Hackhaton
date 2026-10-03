/**
 * Amazon connector (mode api_report): Selling Partner API Reports API 2021-06-30.
 * https://developer-docs.amazon.com/sp-api/docs/reports-api-v2021-06-30-reference
 *
 * Real path (runs only when AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET and
 * AMAZON_SP_REFRESH_TOKEN are set):
 *  1. Login with Amazon token: POST https://api.amazon.com/auth/o2/token,
 *     grant_type=refresh_token. The refresh token comes from self-authorizing
 *     Goodwill's private SP-API app in Seller Central. Calls send it as
 *     `x-amz-access-token` (no AWS SigV4 needed since Oct 2023).
 *  2a. Requestable report types (AMAZON_SP_REPORT_TYPE set to one), per day:
 *      createReport  POST /reports/2021-06-30/reports {reportType, marketplaceIds, dataStartTime, dataEndTime}
 *      getReport     GET  /reports/2021-06-30/reports/{reportId}   until processingStatus DONE
 *      getReportDocument GET /reports/2021-06-30/documents/{reportDocumentId} → pre-signed url
 *      (+ compressionAlgorithm GZIP → gunzip).
 *  2b. Settlement reports (the default, GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2)
 *      cannot be requested; Amazon generates them every ~14 days. They are
 *      listed with getReports(reportTypes, createdSince, createdUntil,
 *      processingStatuses=DONE) and downloaded with getReportDocument.
 *  Files are saved verbatim (flat files are tab-delimited .txt).
 *
 * IMPORTANT gap for a real rollout: src/sources/amazon.ts parses the Seller
 * Central "Date Range Transaction" CSV. SP-API has no report with that exact
 * layout (MWS GET_DATE_RANGE_FINANCIAL_TRANSACTION_DATA was not carried over).
 * Real options: (a) a settlement flat-file parser, or (b) the Finances API
 * listTransactions (2024-06-19) JSON + a JSON parser like ebay_api.ts.
 * Until then real pulls produce files the current parser will not recognize.
 *
 * Mock path: the Date Range Transaction CSV the parser reads, from
 * data/fixtures/amazon/ when files cover the range, else generated per day.
 */
import { gunzipSync } from "node:zlib";
import { fixtureFiles } from "./fixtures";
import { dateRangeCsv } from "./mock/amazon";
import { ConnectorError, type Connector, type PulledFile, type PullRequest } from "./types";
import { assertRange, dayWindow, daysIn, env, hasEnv, http, httpJson, localTime, nextDay, readLocal, sleep } from "./util";

const ENV_VARS = ["AMAZON_SP_CLIENT_ID", "AMAZON_SP_CLIENT_SECRET", "AMAZON_SP_REFRESH_TOKEN"];
const PATH = "/reports/2021-06-30";
const POLL_MS = 5_000;
const POLL_TIMEOUT_MS = 50_000;

const endpoint = () => env("AMAZON_SP_ENDPOINT") ?? "https://sellingpartnerapi-na.amazon.com";
const marketplace = () => env("AMAZON_SP_MARKETPLACE_ID") ?? "ATVPDKIKX0DER"; // amazon.com (US)
const reportType = () => env("AMAZON_SP_REPORT_TYPE") ?? "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2";

async function accessToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env("AMAZON_SP_REFRESH_TOKEN")!,
    client_id: env("AMAZON_SP_CLIENT_ID")!,
    client_secret: env("AMAZON_SP_CLIENT_SECRET")!,
  });
  const res = await httpJson<{ access_token: string }>("amazon", "https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return res.access_token;
}

async function download(token: string, reportDocumentId: string): Promise<Buffer> {
  const doc = await httpJson<{ url: string; compressionAlgorithm?: string }>(
    "amazon",
    `${endpoint()}${PATH}/documents/${encodeURIComponent(reportDocumentId)}`,
    { headers: { "x-amz-access-token": token } },
  );
  const res = await http("amazon", doc.url); // pre-signed S3 URL: no auth header
  const raw = Buffer.from(await res.arrayBuffer());
  return doc.compressionAlgorithm === "GZIP" ? gunzipSync(raw) : raw;
}

async function requestReport(token: string, day: string): Promise<PulledFile[]> {
  const { start, end } = dayWindow(day);
  const headers = { "x-amz-access-token": token, "Content-Type": "application/json" };
  const { reportId } = await httpJson<{ reportId: string }>("amazon", `${endpoint()}${PATH}/reports`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      reportType: reportType(),
      marketplaceIds: [marketplace()],
      dataStartTime: start.toISOString(),
      dataEndTime: new Date(end.getTime() - 1000).toISOString(),
    }),
  });
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const rep = await httpJson<{ processingStatus: string; reportDocumentId?: string }>(
      "amazon",
      `${endpoint()}${PATH}/reports/${reportId}`,
      { headers },
    );
    if (rep.processingStatus === "DONE" && rep.reportDocumentId) {
      return [{ fileName: `pull_amazon_${reportType()}_${day}.txt`, bytes: await download(token, rep.reportDocumentId) }];
    }
    if (rep.processingStatus === "CANCELLED") return []; // no data for that window
    if (rep.processingStatus === "FATAL") throw new ConnectorError("amazon", `report ${reportId} FATAL`);
    if (Date.now() > deadline) throw new ConnectorError("amazon", `report ${reportId} still ${rep.processingStatus}; pull again later`);
    await sleep(POLL_MS);
  }
}

async function listSettlements(token: string, req: PullRequest): Promise<PulledFile[]> {
  const out: PulledFile[] = [];
  let url: string | undefined =
    `${endpoint()}${PATH}/reports?` +
    new URLSearchParams({
      reportTypes: reportType(),
      processingStatuses: "DONE",
      createdSince: localTime(req.from).toISOString(),
      createdUntil: localTime(nextDay(req.to)).toISOString(),
      pageSize: "100",
    });
  while (url) {
    const page: { reports?: { reportId: string; reportDocumentId?: string }[]; nextToken?: string } = await httpJson(
      "amazon",
      url,
      { headers: { "x-amz-access-token": token } },
    );
    for (const r of page.reports ?? []) {
      if (!r.reportDocumentId) continue;
      // Settlement files span ~14 days: named by report id, not by a single date.
      out.push({ fileName: `pull_amazon_settlement_${r.reportId}.txt`, bytes: await download(token, r.reportDocumentId) });
    }
    url = page.nextToken ? `${endpoint()}${PATH}/reports?nextToken=${encodeURIComponent(page.nextToken)}` : undefined;
  }
  return out;
}

async function pullReal(req: PullRequest): Promise<PulledFile[]> {
  const token = await accessToken();
  if (reportType().startsWith("GET_V2_SETTLEMENT_REPORT")) return listSettlements(token, req);
  const out: PulledFile[] = [];
  for (const day of daysIn(req)) out.push(...(await requestReport(token, day)));
  return out;
}

function pullMock(req: PullRequest): PulledFile[] {
  const fixtures = fixtureFiles("amazon", req);
  if (fixtures.length) return fixtures.map((f) => readLocal(f, "pull_"));
  return daysIn(req).map((day) => ({
    fileName: `pull_amazon_daterange_${day}.csv`,
    bytes: Buffer.from(dateRangeCsv(day), "utf8"),
  }));
}

export const amazonConnector: Connector = {
  sourceId: "amazon",
  label: "Amazon (SP-API Reports)",
  mode: "api_report",
  describe: "SP-API Reports: createReport → getReport → getReportDocument (or listed settlement reports).",
  requiredEnvVars: ENV_VARS,
  envVars: [...ENV_VARS, "AMAZON_SP_MARKETPLACE_ID", "AMAZON_SP_ENDPOINT", "AMAZON_SP_REPORT_TYPE"],
  hasCredentials: () => hasEnv(ENV_VARS),
  async pull(req) {
    assertRange(req);
    return req.mock ? pullMock(req) : pullReal(req);
  },
};
