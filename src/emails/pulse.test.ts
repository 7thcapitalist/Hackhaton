import assert from "node:assert/strict";
import test from "node:test";
import { isBusinessDate, previousBusinessDate } from "./dates";
import { handlePulseCronRequest, MAX_PULSE_ATTACHMENT_BYTES } from "./pulse";

const env = {
  CRON_SECRET: "fake-test-cron-secret",
  PULSE_EMAIL_ENABLED: "true",
  PULSE_FROM_EMAIL: "Mission Control <pulse@example.test>",
  PULSE_TO_EMAIL: "reviewer@example.test",
  RESEND_API_KEY: "re_fake_test_key",
  REPORTS_VIEW_ORIGIN: "https://mission-control.example.test",
  NODE_ENV: "production",
};
const csv = "\uFEFFBusiness date,Channel,Revenue,Status\r\n2026-10-03,Other e-commerce,123.45,ok\r\n";
const request = (query = "?date=2026-10-03", token = `Bearer ${env.CRON_SECRET}`) =>
  new Request(`https://untrusted-request-host.example.test/api/cron/pulse${query}`, {
    headers: token ? { Authorization: token } : {},
  });
const exportResponse = (headers: Record<string, string> = {}, content = csv) => new Response(content, {
  headers: { "Content-Type": "text/csv; charset=utf-8", ...headers },
});

function mockFetch(exportFactory: () => Response = () => exportResponse(), resendFactory: () => Response = () => Response.json({ id: "fake-provider-id" })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = async (url: string | URL, init: RequestInit = {}) => {
    const value = url.toString();
    calls.push({ url: value, init });
    if (value.startsWith(`${env.REPORTS_VIEW_ORIGIN}/api/export/pulse?`)) return exportFactory();
    assert.equal(value, "https://api.resend.com/emails", "no other network destination is allowed in tests");
    return resendFactory();
  };
  return { fetcher, calls };
}

test("auth fails closed, including with a missing cron secret, without fetching", async () => {
  const mock = mockFetch();
  const missing = await handlePulseCronRequest(request(), { env: { ...env, CRON_SECRET: "" }, fetch: mock.fetcher });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, "cron_not_configured");
  for (const token of ["", "Bearer wrong", "Basic fake-test-cron-secret", `Bearer ${env.CRON_SECRET}extra`]) {
    const result = await handlePulseCronRequest(request(undefined, token), { env, fetch: mock.fetcher });
    assert.equal(result.status, 401);
  }
  assert.equal(mock.calls.length, 0);
});

test("sending requires the explicit enable flag; dry-run cannot bypass authentication", async () => {
  const mock = mockFetch();
  for (const enabled of [undefined, "false", "TRUE", "1"]) {
    const result = await handlePulseCronRequest(request(), { env: { ...env, PULSE_EMAIL_ENABLED: enabled }, fetch: mock.fetcher });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error, "email_disabled");
  }
  assert.equal((await handlePulseCronRequest(request("?dryRun=true", ""), { env, fetch: mock.fetcher })).status, 401);
  assert.equal(mock.calls.length, 0);
});

test("calendar validation rejects rollover dates and ambiguous query values", async () => {
  assert.equal(isBusinessDate("2024-02-29"), true);
  assert.equal(isBusinessDate("2026-02-29"), false);
  assert.equal(isBusinessDate("2026-04-31"), false);
  assert.equal(isBusinessDate("2026-1-3"), false);
  const mock = mockFetch();
  for (const query of ["?date=2026-02-29", "?date=2026-04-31", "?date=2026-13-01", "?date=", "?date=2026-10-03&date=2026-10-04", "?dryRun=1", "?dryRun=true&dryRun=false"]) {
    assert.equal((await handlePulseCronRequest(request(query), { env, fetch: mock.fetcher })).status, 400);
  }
  assert.equal(mock.calls.length, 0);
});

test("default business date uses Indianapolis calendar days through both DST transitions", async () => {
  const examples = [
    ["2026-10-04T03:59:00Z", "2026-10-02"],
    ["2026-10-04T04:00:00Z", "2026-10-03"],
    ["2026-03-08T06:30:00Z", "2026-03-07"],
    ["2026-03-08T07:30:00Z", "2026-03-07"],
    ["2026-03-09T03:30:00Z", "2026-03-07"],
    ["2026-03-09T04:30:00Z", "2026-03-08"],
    ["2026-11-01T05:30:00Z", "2026-10-31"],
    ["2026-11-01T06:30:00Z", "2026-10-31"],
    ["2026-11-02T04:30:00Z", "2026-10-31"],
    ["2026-11-02T05:30:00Z", "2026-11-01"],
    ["2026-01-01T05:30:00Z", "2025-12-31"],
  ];
  for (const [now, expected] of examples) assert.equal(previousBusinessDate(new Date(now)), expected);
  const mock = mockFetch();
  const result = await handlePulseCronRequest(request("?dryRun=true"), { env, fetch: mock.fetcher, now: new Date("2026-10-04T11:00:00Z") });
  assert.equal((await result.json()).businessDate, "2026-10-03");
  assert.match(mock.calls[0].url, /date=2026-10-03&format=csv$/);
});

test("missing or invalid mail config fails before any fetch and never exposes addresses or keys", async () => {
  const mock = mockFetch();
  for (const key of ["PULSE_FROM_EMAIL", "PULSE_TO_EMAIL", "RESEND_API_KEY"] as const) {
    const result = await handlePulseCronRequest(request(), { env: { ...env, [key]: "" }, fetch: mock.fetcher });
    assert.equal(result.status, 503);
    const body = await result.text();
    assert.doesNotMatch(body, /reviewer@example\.test|re_fake_test_key/);
  }
  const invalid = await handlePulseCronRequest(request(), { env: { ...env, PULSE_TO_EMAIL: "one@example.test,two@example.test" }, fetch: mock.fetcher });
  assert.equal(invalid.status, 503);
  assert.equal(mock.calls.length, 0);
});

test("origins come from trusted env rather than request headers; redirects and cache are disabled", async () => {
  const mock = mockFetch();
  const result = await handlePulseCronRequest(request(), { env, fetch: mock.fetcher });
  assert.equal(result.status, 202);
  assert.equal(new URL(mock.calls[0].url).origin, env.REPORTS_VIEW_ORIGIN);
  assert.equal(mock.calls[0].init.redirect, "error");
  assert.equal(mock.calls[0].init.cache, "no-store");
  assert.equal(new Headers(mock.calls[0].init.headers).get("authorization"), null);
  assert.equal(mock.calls[1].init.redirect, "error");
});

test("production origin must be configured and use HTTPS; origin credentials or paths are rejected", async () => {
  const mock = mockFetch();
  for (const origin of [undefined, "http://mission-control.example.test", "http://localhost:3000", "https://user:secret@example.test", "https://example.test/path", "https://example.test?token=secret", "not-a-url"]) {
    const result = await handlePulseCronRequest(request(), { env: { ...env, REPORTS_VIEW_ORIGIN: origin }, fetch: mock.fetcher });
    assert.equal(result.status, 503);
  }
  assert.equal(mock.calls.length, 0);
});

test("VERCEL_URL is the fallback origin and localhost is only a development fallback", async () => {
  const destinations: string[] = [];
  const fetcher = async (url: string | URL) => { destinations.push(url.toString()); return exportResponse(); };
  const result = await handlePulseCronRequest(request("?date=2026-10-03&dryRun=true"), {
    env: { CRON_SECRET: env.CRON_SECRET, NODE_ENV: "production", VERCEL_URL: "preview.example.test" }, fetch: fetcher,
  });
  assert.equal(result.status, 200);
  assert.match(destinations[0], /^https:\/\/preview\.example\.test\/api\/export\/pulse\?/);
  const local = await handlePulseCronRequest(request("?date=2026-10-03&dryRun=true"), {
    env: { CRON_SECRET: env.CRON_SECRET, NODE_ENV: "development" }, fetch: fetcher,
  });
  assert.equal(local.status, 200);
  assert.match(destinations[1], /^http:\/\/localhost:3000\/api\/export\/pulse\?/);
});

test("missing export endpoint, HTML errors and wrong media types never reach Resend", async () => {
  for (const factory of [
    () => new Response("<html>Not found</html>", { status: 404, headers: { "Content-Type": "text/html" } }),
    () => new Response("{\"error\":\"view_not_ready\"}", { status: 503, headers: { "Content-Type": "application/json" } }),
    () => new Response("<html>Wrong file</html>", { headers: { "Content-Type": "text/html" } }),
    () => exportResponse({}, "<!DOCTYPE html><html>Wrong file</html>"),
  ]) {
    const mock = mockFetch(factory);
    const result = await handlePulseCronRequest(request(), { env, fetch: mock.fetcher });
    assert.ok([502, 503].includes(result.status));
    assert.equal(mock.calls.length, 1);
    assert.notEqual((await result.json()).status, "accepted");
  }
});

test("empty, invalid UTF-8 and oversized attachments are blocked before Resend", async () => {
  for (const factory of [
    () => exportResponse({}, ""),
    () => new Response(new Uint8Array([255]), { headers: { "Content-Type": "text/csv" } }),
    () => exportResponse({ "Content-Length": String(MAX_PULSE_ATTACHMENT_BYTES + 1) }),
    () => exportResponse({}, "x".repeat(MAX_PULSE_ATTACHMENT_BYTES + 1)),
  ]) {
    const mock = mockFetch(factory);
    const result = await handlePulseCronRequest(request(), { env, fetch: mock.fetcher });
    assert.equal(result.status, 502);
    assert.equal(mock.calls.length, 1);
  }
});

test("export timeout and provider timeout return failure without claiming delivery", async () => {
  const pending = (_url: string | URL, init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error("mock abort")), { once: true });
  });
  const exportTimeout = await handlePulseCronRequest(request(), { env, fetch: pending, timeoutMs: 5 });
  assert.equal(exportTimeout.status, 504);
  assert.equal((await exportTimeout.json()).error, "export_timeout");
  const resendTimeout = await handlePulseCronRequest(request(), {
    env, timeoutMs: 5,
    fetch: async (url, init) => url.toString().startsWith(env.REPORTS_VIEW_ORIGIN) ? exportResponse() : pending(url, init),
  });
  assert.equal(resendTimeout.status, 504);
  const body = await resendTimeout.text();
  assert.match(body, /resend_timeout/);
  assert.doesNotMatch(body, /"status":"accepted"/);
});

test("provider rejection and malformed acknowledgements never expose provider body or report success", async () => {
  for (const provider of [
    () => Response.json({ message: `Rejected ${env.PULSE_TO_EMAIL} ${env.RESEND_API_KEY}` }, { status: 422 }),
    () => Response.json({}),
    () => Response.json({ id: 123 }),
    () => new Response("not JSON"),
  ]) {
    const mock = mockFetch(() => exportResponse(), provider);
    const result = await handlePulseCronRequest(request(), { env, fetch: mock.fetcher });
    assert.equal(result.status, 502);
    const body = await result.text();
    assert.doesNotMatch(body, /reviewer@example\.test|re_fake_test_key|"status":"accepted"/);
  }
});

test("payload preserves CSV bytes, labels synthetic/partial, links to dated dashboard and reports accepted only", async () => {
  const mock = mockFetch(() => exportResponse({ "X-Report-Synthetic": "true", "X-Report-Status": "partial" }));
  const result = await handlePulseCronRequest(request(), { env, fetch: mock.fetcher });
  assert.equal(result.status, 202);
  const body = await result.json();
  assert.equal(body.status, "accepted");
  assert.equal(body.id, "fake-provider-id");
  assert.equal(body.synthetic, true);
  assert.equal(body.reportStatus, "partial");
  assert.match(body.message, /Inbox delivery is not confirmed/);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const payload = JSON.parse(mock.calls[1].init.body as string);
  assert.deepEqual(payload.to, [env.PULSE_TO_EMAIL]);
  assert.equal(payload.from, env.PULSE_FROM_EMAIL);
  assert.equal(payload.attachments[0].filename, "pulse-2026-10-03.csv");
  assert.equal(Buffer.from(payload.attachments[0].content, "base64").toString("utf8"), csv);
  assert.match(payload.subject, /\[Synthetic\].*\[Partial\]/);
  assert.match(payload.text, /Some channels or metrics are unavailable/);
  assert.match(payload.html, /https:\/\/mission-control\.example\.test\/pulse\?date=2026-10-03/);
  assert.equal(new Headers(mock.calls[1].init.headers).get("authorization"), `Bearer ${env.RESEND_API_KEY}`);
});

test("missing or invalid metadata remains unknown instead of claiming real or complete data", async () => {
  const examples: Record<string, string>[] = [{}, { "X-Report-Synthetic": "yes", "X-Report-Status": "ok" }];
  for (const headers of examples) {
    const mock = mockFetch(() => exportResponse(headers));
    const result = await handlePulseCronRequest(request(), { env, fetch: mock.fetcher });
    const body = await result.json();
    assert.equal(body.synthetic, null);
    assert.equal(body.reportStatus, "unknown");
    const payload = JSON.parse(mock.calls[1].init.body as string);
    assert.match(payload.text, /Data origin is unknown/);
    assert.match(payload.text, /Completeness has not been confirmed/);
    assert.doesNotMatch(payload.text, /Report coverage: complete|not marked synthetic/);
  }
});

test("authenticated dry-run checks CSV without provider credentials or sending", async () => {
  const mock = mockFetch();
  const result = await handlePulseCronRequest(request("?date=2026-10-03&dryRun=true"), {
    env: { CRON_SECRET: env.CRON_SECRET, REPORTS_VIEW_ORIGIN: env.REPORTS_VIEW_ORIGIN, PULSE_EMAIL_ENABLED: "false", NODE_ENV: "production" },
    fetch: mock.fetcher,
  });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.status, "dry_run");
  assert.equal(body.attachment.bytes, Buffer.byteLength(csv));
  assert.equal(mock.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(body), /reviewer@example\.test|re_fake_test_key|content.*base64/);
});

test("retries have the same payload-based idempotency key; changing the attachment changes the key", async () => {
  const mock = mockFetch(() => exportResponse({ "X-Report-Synthetic": "true", "X-Report-Status": "complete" }));
  await handlePulseCronRequest(request(), { env, fetch: mock.fetcher });
  await handlePulseCronRequest(request(), { env, fetch: mock.fetcher });
  const first = new Headers(mock.calls[1].init.headers).get("idempotency-key");
  const retry = new Headers(mock.calls[3].init.headers).get("idempotency-key");
  assert.equal(first, retry);
  assert.match(first!, /^pulse\/2026-10-03\/[a-f0-9]{64}$/);
  assert.equal(mock.calls[1].init.body, mock.calls[3].init.body);
  const changed = mockFetch(() => exportResponse({ "X-Report-Synthetic": "true", "X-Report-Status": "complete" }, `${csv}2026-10-03,eBay,1.00,ok\r\n`));
  await handlePulseCronRequest(request(), { env, fetch: changed.fetcher });
  assert.notEqual(new Headers(changed.calls[1].init.headers).get("idempotency-key"), first);
});
