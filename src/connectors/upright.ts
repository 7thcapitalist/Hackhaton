/**
 * Upright Labs connector (mode api_json): Lister Public API.
 * docs/sources/upright.md §2.
 *
 * Real path (runs when UPRIGHT_API_TOKEN is set; the token is self-service in
 * Lister → Admin → Settings → Developer → "Generate API Access Token"):
 *   GET https://app.uprightlabs.com/api/reports/order_items?time_start=…&time_end=…
 *   header X-Authorization: <token>
 *   "All ordered items paid within a timeframe" = the Paid Order Items report.
 *   Up to 365 days per call (longer ranges are split into 365-day windows);
 *   calls may fail above ~10k records. time_start / time_end are sent as ISO
 *   8601 UTC instants of the Indianapolis business-day window [from 00:00, to+1 00:00)
 *   [guess: the accepted format is not public; override with
 *   UPRIGHT_API_TIME_FORMAT=date to send YYYY-MM-DD]. Pagination is not
 *   documented: if a response is an object carrying a `next` / `next_page_url`
 *   link we follow it. Each response is saved verbatim as one .json file and
 *   read by src/sources/upright_api.ts.
 *   UPRIGHT_API_BASE overrides https://app.uprightlabs.com/api.
 *
 * Without a token (real pull), it falls back to the email drop folder
 * data/inbox/upright/ (scheduled "Paid order items" report by email), read by
 * the CSV parser, exactly as before.
 *
 * Mock path: one `/reports/order_items` response per business day, built from
 * the orders the CSV parser reads in data/fixtures/upright/ for that day
 * (./mock/upright.ts), so the JSON and the CSV twin share dedupe keys.
 */
import { uprightParser } from "@/sources/upright";
import { uprightConnector as uprightDropFolder } from "./dropfolder";
import { fixtureOrders } from "./fixtures";
import { orderItemsFromParsed } from "./mock/upright";
import type { Connector, PulledFile, PullRequest } from "./types";
import { assertRange, daysIn, env, hasEnv, httpJson, jsonFile, localTime, nextDay } from "./util";

const ENV_VARS = ["UPRIGHT_API_TOKEN"];
const WINDOW_DAYS = 365;
const MAX_PAGES = 50;

const base = () => (env("UPRIGHT_API_BASE") ?? "https://app.uprightlabs.com/api").replace(/\/$/, "");

/** Split an inclusive day range into ≤ 365-day windows. */
function windows(req: PullRequest): { from: string; to: string }[] {
  const days = daysIn(req);
  const out: { from: string; to: string }[] = [];
  for (let i = 0; i < days.length; i += WINDOW_DAYS) {
    const chunk = days.slice(i, i + WINDOW_DAYS);
    out.push({ from: chunk[0], to: chunk[chunk.length - 1] });
  }
  return out;
}

function nextLink(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  for (const k of ["next", "next_page_url", "nextPageUrl", "next_url"]) {
    const v = b[k];
    if (typeof v === "string" && v) return v.startsWith("http") ? v : `${base()}${v.startsWith("/") ? "" : "/"}${v}`;
  }
  return undefined;
}

async function pullReal(req: PullRequest): Promise<PulledFile[]> {
  const headers = { "X-Authorization": env("UPRIGHT_API_TOKEN")!, Accept: "application/json" };
  const dateOnly = env("UPRIGHT_API_TIME_FORMAT") === "date";
  const out: PulledFile[] = [];
  for (const w of windows(req)) {
    const qs = new URLSearchParams(
      dateOnly
        ? { time_start: w.from, time_end: nextDay(w.to) }
        : { time_start: localTime(w.from).toISOString(), time_end: localTime(nextDay(w.to)).toISOString() },
    );
    let url: string | undefined = `${base()}/reports/order_items?${qs}`;
    const tag = w.from === w.to ? w.from : `${w.from}_${w.to}`;
    for (let page = 1; url && page <= MAX_PAGES; page++) {
      const body: unknown = await httpJson("upright", url, { headers, timeoutMs: 120_000 });
      out.push(jsonFile(`pull_upright_api_order_items_${tag}_p${page}.json`, body));
      url = nextLink(body);
    }
  }
  return out;
}

async function pullMock(req: PullRequest): Promise<PulledFile[]> {
  const out: PulledFile[] = [];
  for (const day of daysIn(req)) {
    const orders = await fixtureOrders("upright", uprightParser, day);
    if (!orders.length) continue; // no fixture for the day: no page
    out.push(jsonFile(`pull_upright_api_order_items_${day}_p1.json`, orderItemsFromParsed(orders)));
  }
  return out;
}

export const uprightConnector: Connector = {
  sourceId: "upright",
  label: "Upright (Lister Public API: Paid Order Items)",
  // "api_json" once a token is set; until then the real pull is the email drop
  // folder, so report "email" (run.ts would otherwise skip it as uncredentialed).
  get mode() {
    return hasEnv(ENV_VARS) ? "api_json" : "email";
  },
  describe: "Lister Public API /reports/order_items JSON (X-Authorization token); without a token, the emailed report in inbox/upright/.",
  requiredEnvVars: ENV_VARS,
  envVars: [...ENV_VARS, "UPRIGHT_API_BASE", "UPRIGHT_API_TIME_FORMAT"],
  // Same meaning as before when there is no token: the drop folder has files.
  hasCredentials: () => hasEnv(ENV_VARS) || uprightDropFolder.hasCredentials(),
  async pull(req) {
    assertRange(req);
    if (req.mock) return pullMock(req);
    return hasEnv(ENV_VARS) ? pullReal(req) : uprightDropFolder.pull(req);
  },
};
