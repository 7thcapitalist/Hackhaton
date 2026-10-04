/**
 * EasyPost connector (mode api_json + api_report). Source: shipping_osm_pb_easypost.
 * Covers EasyPost only; Pitney Bowes and OSM stay on the drop folder
 * (data/inbox/shipping_osm_pb_easypost/) until they get their own connector.
 *
 * Real path (runs only when EASYPOST_API_KEY is set; EasyPost test keys are
 * free and return test-mode shipments):
 *  - Auth: HTTP Basic, API key as the user name, empty password.
 *  - Shipments, per Indianapolis business day:
 *    GET https://api.easypost.com/v2/shipments?start_datetime=…&end_datetime=…&page_size=100&purchased=true
 *    paging with before_id=<last id> while has_more. Each page is saved as
 *    one .json file and read by src/sources/easypost_api.ts.
 *    https://docs.easypost.com/docs/shipments
 *  - Payment log (wallet recharges, refunds, fees), once for the range:
 *    Reports API  POST /v2/reports/payment_log {start_date, end_date}
 *    → poll GET /v2/reports/:id until status "available" → download `url`.
 *    That is the same CSV as the dashboard export, read by the existing
 *    shipping_osm_pb_easypost parser.  https://docs.easypost.com/docs/reports
 *
 * Mock path: shipments per day (from an EasyPost shipment CSV in
 * data/fixtures/shipping_osm_pb_easypost/ when one covers the day) plus the
 * payment-log fixtures. Days without a fixture return nothing (generated only
 * with CONNECTORS_MOCK_GENERATE=1, see fixturesOnly()).
 */
import { shippingOsmPbEasypostParser } from "@/sources/shipping_osm_pb_easypost";
import { businessDateOf } from "@/sources/_shared/table";
import { fixtureFiles, fixtureRows, fixturesOnly } from "./fixtures";
import { generateShipments, paymentLogCsv, shipmentsFromCsvRows, shipmentsPage, type MockShipment } from "./mock/easypost";
import { ConnectorError, type Connector, type PulledFile, type PullRequest } from "./types";
import { assertRange, dayWindow, daysIn, env, hasEnv, http, httpJson, jsonFile, readLocal, sleep } from "./util";

const BASE = "https://api.easypost.com/v2";
const SOURCE = "shipping_osm_pb_easypost";
const MAX_PAGES = 50;
const REPORT_POLL_MS = 2_000;
const REPORT_TIMEOUT_MS = 45_000;

function authHeader(): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${env("EASYPOST_API_KEY")}:`).toString("base64")}` };
}

async function pullShipments(day: string): Promise<PulledFile[]> {
  const { start, end } = dayWindow(day);
  const out: PulledFile[] = [];
  let beforeId: string | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      start_datetime: start.toISOString(),
      end_datetime: end.toISOString(),
      page_size: "100",
      purchased: "true",
    });
    if (beforeId) q.set("before_id", beforeId);
    const body = await httpJson<{ shipments?: { id: string }[]; has_more?: boolean }>(SOURCE, `${BASE}/shipments?${q}`, {
      headers: authHeader(),
    });
    const list = body.shipments ?? [];
    if (list.length === 0 && page > 1) break;
    out.push(jsonFile(`pull_easypost_api_shipments_${day}_p${page}.json`, body));
    if (!body.has_more || list.length === 0) break;
    beforeId = list[list.length - 1].id;
  }
  return out;
}

async function pullPaymentLog(from: string, to: string): Promise<PulledFile[]> {
  type Report = { id: string; status: string; url?: string | null };
  const created = await httpJson<Report>(SOURCE, `${BASE}/reports/payment_log`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ start_date: from, end_date: to }),
  });
  let report = created;
  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  while (report.status !== "available" && Date.now() < deadline) {
    if (report.status === "failed") throw new ConnectorError(SOURCE, `EasyPost payment_log report ${report.id} failed`);
    if (report.status === "empty") return [];
    await sleep(REPORT_POLL_MS);
    report = await httpJson<Report>(SOURCE, `${BASE}/reports/${report.id}`, { headers: authHeader() });
  }
  if (report.status !== "available") {
    throw new ConnectorError(SOURCE, `EasyPost payment_log report ${report.id} not ready after ${REPORT_TIMEOUT_MS / 1000}s; pull again later`);
  }
  if (!report.url) return [];
  const res = await http(SOURCE, report.url); // pre-signed URL: no auth header
  const bytes = Buffer.from(await res.arrayBuffer());
  // A date in the name marks a daily file; a range is named by report id so it is not taken for one day.
  const name = from === to ? `pull_easypost_payment_log_${from}.csv` : `pull_easypost_payment_log_${report.id}.csv`;
  return [{ fileName: name, bytes }];
}

async function mockShipments(day: string): Promise<MockShipment[]> {
  const rows = await fixtureRows(
    SOURCE,
    shippingOsmPbEasypostParser,
    day,
    ["created_at", "tracking_code", "carrier"],
    (r) => {
      const d = new Date(r.created_at);
      return isNaN(d.getTime()) ? null : businessDateOf(d);
    },
  );
  if (rows.length || fixturesOnly()) return shipmentsFromCsvRows(rows);
  return generateShipments(day);
}

async function pullMock(req: PullRequest): Promise<PulledFile[]> {
  const out: PulledFile[] = [];
  // Kind of a fixture file from the part of its name after the source id
  // (the source id itself contains "_osm_" and "_pb_").
  const kind = (name: string) => name.replace(/^shipping_osm_pb_easypost/i, "");
  const paylogFixtures = fixtureFiles(SOURCE, req).filter((f) => /pay.?log/i.test(kind(f.name)));
  for (const day of daysIn(req)) {
    const shipments = await mockShipments(day);
    if (!shipments.length) continue; // no fixture for the day: no page
    out.push(jsonFile(`pull_easypost_api_shipments_${day}_p1.json`, shipmentsPage(shipments)));
    if (!paylogFixtures.length && !fixturesOnly()) {
      out.push({ fileName: `pull_easypost_payment_log_${day}.csv`, bytes: Buffer.from(paymentLogCsv(day, shipments), "utf8") });
    }
  }
  out.push(...paylogFixtures.map((f) => readLocal(f, "pull_")));
  // Pitney Bowes and OSM are not EasyPost: their exports arrive by email/portal
  // (same source id). In mock mode their fixture files ride along with this pull.
  // Only those: the EasyPost shipment CSV is already in the JSON pages above and
  // the payment log was added once (matching "_osm_"/"_pb_" in the full name
  // used to re-ingest both, double-counting EasyPost labels).
  out.push(...fixtureFiles(SOURCE, req).filter((f) => /^_(pb|pb-refills|pb-refunds|osm)_/i.test(kind(f.name))).map((f) => readLocal(f, "pull_")));
  return out;
}

export const easypostConnector: Connector = {
  sourceId: SOURCE,
  label: "EasyPost (Shipments API + Reports API)",
  mode: "api_json",
  describe: "Shipments JSON per business day + payment_log CSV via the Reports API (API key).",
  envVars: ["EASYPOST_API_KEY"],
  requiredEnvVars: ["EASYPOST_API_KEY"],
  hasCredentials: () => hasEnv(["EASYPOST_API_KEY"]),
  async pull(req) {
    assertRange(req);
    if (req.mock) return pullMock(req);
    const out: PulledFile[] = [];
    for (const day of daysIn(req)) out.push(...(await pullShipments(day)));
    out.push(...(await pullPaymentLog(req.from, req.to)));
    return out;
  },
};
