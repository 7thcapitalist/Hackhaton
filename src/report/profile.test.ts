import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { authorizeReport, demoAccess, reportProfiles, type Frequency } from "./profiles";
import { collectProfileSnapshot, type ViewReader } from "./profile-source";
import { buildProfileModel } from "./profile-model";
import { profileReportHtml, profileWorkbook } from "./profile-render";
import { ceoDemoEmail, profileAttemptKey, profileEmailPreview } from "../emails/profile-preview";
import { prepareProfileDownload, type ProfilePackage } from "../export/profile";
import { addDays } from "../lib/views/dates";
import { KPI_DEFINITIONS } from "../kpis/definitions";
import { sampleScorecard } from "../export/testing/fixtures";
import { createProfileProvider, profileProvider } from "./profile-provider";
import { GET as pulseDownload } from "../app/api/export/pulse/route";
import { GET as monthlyDownload } from "../app/api/export/monthly/route";
import { GET as scorecardDownload } from "../app/api/export/scorecard/route";

const generated = "2026-10-04T12:00:00Z";
const order = (date: string, i = 0, net = 12345) => ({ id: `${date}-${i}`, businessDate: date, channel: "shopgoodwill", sourceId: "shopgoodwill", externalOrderId: `order-${i}`, category: i % 2 ? null : "Books", grossCents: 15000, netCents: net, status: "paid", ingestRunId: `file-${date}`, sourceRow: i + 1, currency: "USD", buyerKey: "PRIVATE_BUYER", customerEmail: "PRIVATE_EMAIL", archiveUrl: "PRIVATE_URL" });
function reader(options: { missing?: string; zero?: boolean; total?: number } = {}) {
  const calls: { path: string; query: Record<string, string | number> }[] = [];
  const read: ViewReader = async (path, query) => {
    calls.push({ path, query });
    if (path === "orders") {
      const date = String(query.date ?? `${query.period}-01`), total = date === options.missing ? 0 : options.total ?? 1;
      return { total, rows: Array.from({ length: Math.min(Number(query.limit), Math.max(0, total - Number(query.offset))) }, (_, j) => order(date, Number(query.offset) + j, options.zero ? 0 : 12345)) };
    }
    if (path === "pulse") return { businessDate: query.date, timezone: "America/Indiana/Indianapolis", isSynthetic: true, rows: [{ channelId: "shopgoodwill", label: "ShopGoodwill", revenueCents: 12345, customers: 7, orders: 9, status: "ok" }], totals: { revenueCents: 12345, customers: 7, orders: 9 }, missingChannels: [] };
    if (path === "pulse-series") {
      const dates: string[] = []; for (let d = String(query.from); d <= String(query.to); d = addDays(d, 1)) dates.push(d);
      return { from: query.from, to: query.to, dates, series: [{ channelId: "shopgoodwill", label: "ShopGoodwill", revenueCents: dates.map(() => 12345), customers: dates.map(() => 7) }], totals: { revenueCents: dates.map(() => 12345), customers: dates.map(() => 7) } };
    }
    if (path === "scorecard") return { ...structuredClone(sampleScorecard), period: query.period, kpis: KPI_DEFINITIONS.map(k => ({ ...k, value: k.unit === "cents" ? 123450 : 42.7, previous: k.unit === "cents" ? 123450 : 41.2, target: null, status: "simulated", note: "Synthetic test inputs." })) };
    if (path === "sources") return { period: query.period, asOf: "2026-10-03", sources: [{ sourceId: "shopgoodwill", name: "ShopGoodwill", status: "received", lastIngestAt: generated, rowCount: 1, openExceptions: 1, cadence: "daily", missingDates: [] }] };
    if (path === "ingest-runs") return { total: 1, rows: [{ id: "file-1", sourceId: "shopgoodwill", sourceName: "ShopGoodwill", fileName: "synthetic.csv", period: query.period, businessDate: `${query.period}-01`, periodLabel: null, status: "parsed", rowCount: 1, warnings: [], isSynthetic: true, uploadedAt: generated }] };
    if (path === "exceptions") return { total: 1, rows: [{ id: "issue-1", sourceId: "shopgoodwill", sourceName: "ShopGoodwill", kind: "duplicate_order", status: "open", owner: "Synthetic finance team", message: "Duplicate order requires review.", expectedCents: 10000, actualCents: 12000, ingestRunId: "file-1", createdAt: generated, resolvedAt: null }] };
    if (path.startsWith("/api/close/")) return { period: path.split("/").pop(), status: "exported", approvedAt: generated, closeId: "close-1", summary: { journalLines: 2, placeholderLines: 1, openExceptions: 1 }, documents: [{ documentNo: "journal-1", sourceName: "ShopGoodwill", postingDate: "2026-09-30", debitCents: 100, creditCents: 100, balanceCents: 0, balanced: true }], invoice: { externalDocumentNo: "invoice-1", invoiceDate: "2026-09-30", totalCents: 100, lines: [{}], customerName: "PRIVATE_CUSTOMER" } };
    throw new Error(`Unexpected read: ${path}`);
  };
  return { read, calls };
}
async function collect(id = "channel", frequency: Frequency = "daily", source = reader()) {
  return collectProfileSnapshot(authorizeReport(reportProfiles[id], demoAccess[id], frequency, frequency === "daily" ? "2026-10-03" : "2026-09"), source.read, generated);
}

test("presentation cannot grant datasets, fields, scope or real sending; rejection precedes reads", async () => {
  const profile = structuredClone(reportProfiles.channel), access = structuredClone(demoAccess.channel), source = reader();
  profile.label = "CEO"; profile.reports.daily.datasets.push("close");
  assert.throws(() => authorizeReport(profile, access, "daily", "2026-10-03"), /outside|scope/);
  assert.equal(source.calls.length, 0);
  const plan = authorizeReport(reportProfiles.channel, access, "daily", "2026-10-03"); plan.period = "2026-10-02";
  await assert.rejects(collectProfileSnapshot(plan, source.read, generated), /modified/);
  await assert.rejects(prepareProfileDownload(async () => null, source.read), /authorized/);
  assert.equal(source.calls.length, 0);
  assert.throws(() => authorizeReport(reportProfiles.coo, { ...demoAccess.coo, sendingEnabled: true } as never, "daily", "2026-10-03"), /demonstrations/);
});

test("channel collection only calls filtered orders, paginates completely and strips buyer data", async () => {
  const source = reader({ total: 1001 }), snapshot = await collect("channel", "daily", source);
  assert.equal(snapshot.orders.length, 8008);
  assert.ok(source.calls.every(c => c.path === "orders" && c.query.channel === "shopgoodwill"));
  assert.ok(source.calls.some(c => c.query.offset === 1000));
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_BUYER|PRIVATE_EMAIL|PRIVATE_URL/);
  assert.equal(snapshot.scorecard, null); assert.equal(snapshot.sources.length, 0); assert.equal(snapshot.exceptions.length, 0);
  assert.ok(Object.isFrozen(snapshot.orders));
  const wrong: ViewReader = async (p, q) => { const result = await source.read(p, q) as { rows: { channel: string }[] }; result.rows[0].channel = "amazon"; return result; };
  await assert.rejects(collectProfileSnapshot(snapshot.plan, wrong, generated), /outside/);
});

test("zero and missing remain distinct and seven-day comparison requires seven reported days", async () => {
  const zero = buildProfileModel(await collect("channel", "daily", reader({ zero: true })));
  assert.equal(zero.facts[0].value, 0); assert.equal(zero.comparisons[0].baseline, 0); assert.equal(zero.comparisons[0].percent, null);
  const absent = buildProfileModel(await collect("channel", "daily", reader({ missing: "2026-10-01" })));
  assert.equal(absent.comparisons[0].baseline, null); assert.equal(absent.comparisons[0].delta, null);
  assert.match(absent.comparisons[0].note, /6\/7/);
  const all = buildProfileModel(await collect()); assert.equal(all.comparisons[0].baseline, 12345); assert.equal(all.facts[1].value, 1);
  assert.equal(all.snapshot.days[0].customers, null);
});

test("all profile configs produce role-specific scoped data and reopenable workbooks in the approved style", async () => {
  for (const id of Object.keys(reportProfiles)) for (const frequency of ["daily", "monthly"] as Frequency[]) {
    const snapshot = await collect(id, frequency), model = buildProfileModel(snapshot), html = profileReportHtml(model), bytes = await profileWorkbook(model);
    assert.match(html, /Official Goodwill logo/); assert.match(html, /data:image/);
    assert.match(html, new RegExp(snapshot.version));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Uint8Array.from(bytes).buffer);
    assert.deepEqual(wb.worksheets.map(s => s.name), model.sheets.map(s => s.name));
    for (const sheet of wb.worksheets) {
      const expected = model.sheets.find(s => s.name === sheet.name)!;
      assert.equal(sheet.rowCount - 7, expected.rows.length); assert.ok(sheet.autoFilter);
      assert.equal(sheet.views[0].state, "frozen"); assert.equal((sheet.views[0] as { ySplit: number }).ySplit, 7); assert.equal((sheet.views[0] as { topLeftCell: string }).topLeftCell, "A8");
      assert.equal(sheet.state, "visible"); assert.ok(sheet.getImages().length);
      assert.ok(sheet.columns.every(c => !c.hidden));
    }
    if (id === "coo" && frequency === "monthly") { assert.equal(model.kpis.length, 15); const ws = wb.getWorksheet("Indicators")!; const row = model.kpis.findIndex(k => k.unit === "percent") + 8; assert.equal(ws.getCell(row, 3).value, 0.427); assert.match(ws.getCell(row, 3).numFmt, /%/); }
    if (id === "channel") {
      const zip = await JSZip.loadAsync(bytes); const contents = (await Promise.all(zip.file(/\.xml$/).map(f => f.async("string")))).join(" ");
      assert.doesNotMatch(contents + html, /Amazon|eBay|PRIVATE_|All e-commerce operations|profile=ceo/);
      assert.ok(!wb.getWorksheet("Channels") && !wb.getWorksheet("Close"));
    }
    if (id === "finance") { assert.equal(model.kpis.length, 0); assert.ok(model.sheets.some(s => s.name === "Exceptions")); assert.doesNotMatch(JSON.stringify(model), /PRIVATE_CUSTOMER/); }
  }
});

test("CEO demo has a separate grant, full core scorecard, traceable detail and weekly daily comparison", async () => {
  const daily = buildProfileModel(await collect("ceo", "daily"));
  const monthly = buildProfileModel(await collect("ceo", "monthly"));
  assert.match(daily.comparisons[0].baselineLabel, /September 26, 2026/);
  assert.ok(daily.facts.some(f => f.label === "Month-to-date revenue"));
  assert.equal(monthly.kpis.length, 15);
  assert.equal(monthly.kpis.filter(k => k.anchor2027).length, 3);
  assert.deepEqual(monthly.sheets.map(s => s.name), ["Overview", "Indicators", "Channels", "Categories", "Comparisons", "Transactions", "Sources"]);
  assert.notEqual(demoAccess.ceo.id, demoAccess.coo.id);
  const proposed = structuredClone(reportProfiles.ceo);
  proposed.reports.monthly.datasets.push("close");
  assert.throws(() => authorizeReport(proposed, demoAccess.ceo, "monthly", "2026-09"), /outside/);
});

test("email attaches the exact export bytes and remains a scoped preview with stable distinct send identities", async () => {
  const snapshot = await collect(), model = buildProfileModel(snapshot), xlsx = await profileWorkbook(model);
  const pack: ProfilePackage = { model, html: profileReportHtml(model), pdf: Buffer.from("%PDF-synthetic-unit-test"), xlsx, pdfName: "Daily-Report.pdf", xlsxName: "Daily-Data.xlsx", packageVersion: "test-version" };
  const preview = profileEmailPreview(pack);
  assert.equal(preview.sent, false); assert.equal(preview.payload.attachments.length, 2);
  assert.deepEqual(Buffer.from(preview.payload.attachments[1].content, "base64"), Buffer.from(xlsx));
  assert.ok(!("to" in preview.payload) && !("from" in preview.payload));
  assert.doesNotMatch(preview.html, /Amazon|eBay|profile=|PRIVATE_|https:\/\//);
  assert.match(preview.html, /Dashboard-Preview.html/); assert.match(preview.html, /not approved by Goodwill/);
  assert.equal(profileAttemptKey(pack, "demo-recipient"), profileAttemptKey(pack, "demo-recipient"));
  assert.notEqual(profileAttemptKey(pack, "other-recipient"), profileAttemptKey(pack, "demo-recipient"));
  assert.notEqual(profileAttemptKey({ ...pack, packageVersion: "updated" }, "demo-recipient"), profileAttemptKey(pack, "demo-recipient"));
  assert.throws(() => profileEmailPreview({ ...pack, pdf: new Uint8Array() }), /Both/);
});

test("CEO demo email uses matching attachments, dated dashboard and a Gmail-safe official logo", async () => {
  for (const frequency of ["daily", "monthly"] as Frequency[]) {
    const snapshot = await collect("ceo", frequency), model = buildProfileModel(snapshot), xlsx = await profileWorkbook(model);
    const pack: ProfilePackage = { model, html: "", pdf: Buffer.from("%PDF-test"), xlsx, pdfName: "Report.pdf", xlsxName: "Data.xlsx", packageVersion: "test" };
    const result = ceoDemoEmail(pack, "https://demo.example.com");
    assert.equal(result.dashboardUrl, frequency === "daily" ? "https://demo.example.com/pulse?date=2026-10-03" : "https://demo.example.com/scorecard?period=2026-09");
    assert.equal(result.payload.attachments.length, 2);
    assert.deepEqual(Buffer.from(result.payload.attachments[1].content, "base64"), Buffer.from(xlsx));
    assert.match(result.payload.html, /src="https:\/\/goodwill-ni.org\/wp-content\/uploads\/2016\/03\/776px-Goodwill_Industries_Logo.svg_.png"/);
    assert.doesNotMatch(result.payload.html, /cid:|data:image/);
    assert.match(result.payload.subject, /\[Demo\]/);
    assert.match(result.payload.html, /Dear Debie Coble/);
    assert.match(result.payload.html, /<td style="padding:30px 32px/);
    assert.doesNotMatch(result.payload.html, /<main/);
    assert.match(result.payload.html, /synthetic data/);
    assert.doesNotMatch(result.payload.html, /Dashboard-Preview.html|has not been sent|href="Report.pdf"/);
    assert.ok(!("to" in result.payload) && !("from" in result.payload));
    assert.throws(() => ceoDemoEmail(pack, "http://demo.example.com"), /HTTPS/);
    const linked = ceoDemoEmail(pack, "https://demo.example.com", { pdf: "https://files.example.com/report?version=1&access=private", xlsx: "https://files.example.com/data" });
    assert.match(linked.payload.html, /href="https:\/\/files.example.com\/report\?version=1&amp;access=private"/);
    assert.match(linked.payload.html, /href="https:\/\/files.example.com\/data"/);
    assert.match(linked.payload.text, /https:\/\/files.example.com\/data/);
    assert.deepEqual(linked.payload.attachments, result.payload.attachments);
    for (const invalid of ["file:///local.pdf", "Report.pdf", "javascript:alert(1)", "https://user:password@example.com/file"]) {
      assert.throws(() => ceoDemoEmail(pack, "https://demo.example.com", { pdf: invalid, xlsx: "https://files.example.com/data" }), /HTTPS/);
    }
  }
  const model = buildProfileModel(await collect("channel"));
  assert.throws(() => ceoDemoEmail({ model } as ProfilePackage, "https://demo.example.com"), /Only the CEO/);
});

test("daily recap follows the requested date and uses the completed previous-week comparison", async () => {
  const snapshot = structuredClone(await collectProfileSnapshot(authorizeReport(reportProfiles.ceo, demoAccess.ceo, "daily", "2026-10-02"), reader().read, generated));
  snapshot.files.forEach(f => { f.businessDate = "2026-10-02"; f.uploadedAt = "2026-10-03T11:00:00Z"; });
  const model = buildProfileModel(snapshot);
  assert.equal(model.periodLabel, "October 2, 2026");
  assert.equal(model.partialDay, false);
  assert.equal(model.comparisons[0].baselineLabel, "September 25, 2026");
  assert.notEqual(model.comparisons[0].delta, null);
  assert.doesNotMatch(model.highlights.join(" "), /Partial day|deferred/);
});

test("partial-day file timing defers complete-day comparisons in all outputs", async () => {
  const snapshot = structuredClone(await collect("ceo", "daily"));
  snapshot.files.forEach(f => { f.businessDate = snapshot.plan.period; f.uploadedAt = "2026-10-03T15:00:00Z"; });
  assert.ok(snapshot.files.length);
  const model = buildProfileModel(snapshot);
  assert.equal(model.partialDay, true);
  assert.equal(model.comparisons[0].delta, null);
  assert.equal(model.comparisons[0].percent, null);
  assert.ok(model.channels.every(c => c.change === null));
  assert.match(model.highlights[0], /Partial day/);
  assert.doesNotMatch(model.highlights.join(" "), /Revenue decreased|Revenue increased/);
  assert.match(profileReportHtml(model), /Where the money came from/);
  const change = model.sheets.find(s => s.name === "Overview")!.rows.find(r => String(r[0]).startsWith("Change versus"))!;
  assert.equal(change[1], null);
  assert.match(String(change[3]), /partial/);
});

test("authorized presentation changes reuse components without granting new scope", async () => {
  const profile = structuredClone(reportProfiles.channel); profile.id = "custom-review"; profile.label = "Illustrative custom role";
  profile.email.opening = "Selected observations for review."; profile.reports.daily.pages[0] = ["overview", "readiness"]; profile.reports.daily.maxHighlights = 1;
  const s = await collectProfileSnapshot(authorizeReport(profile, demoAccess.channel, "daily", "2026-10-03"), reader().read, generated);
  const model = buildProfileModel(s), html = profileReportHtml(model);
  assert.doesNotMatch(html, /<svg class="bar-chart"/); assert.equal(model.highlights.length, 1); assert.equal(model.scopeLabel, "ShopGoodwill only");
});

test("changed pagination and changed source values stop a package; future periods are rejected", async () => {
  let count = 0; const unstable: ViewReader = async (_p, q) => ({ total: 1, rows: [order(String(q.date), 0, ++count)] });
  await assert.rejects(collectProfileSnapshot(authorizeReport(reportProfiles.channel, demoAccess.channel, "daily", "2026-10-03"), unstable, generated), /changed/);
  const source = reader();
  await assert.rejects(collectProfileSnapshot(authorizeReport(reportProfiles.channel, demoAccess.channel, "monthly", "2026-10"), source.read, generated), /unfinished/);
  assert.equal(source.calls.length, 0);
});

test("daily source totals remain authoritative even when reporting groups have different coverage", async () => {
  const base = reader();
  const read: ViewReader = async (p, q) => {
    const data = await base.read(p, q);
    if (p === "pulse") (data as { totals: { revenueCents: number } }).totals.revenueCents = 9000;
    return data;
  };
  const snapshot = await collectProfileSnapshot(authorizeReport(reportProfiles.director, demoAccess.director, "daily", "2026-10-03"), read, generated);
  const m = buildProfileModel(snapshot);
  assert.equal(m.facts[0].value, 9000); assert.equal(m.channels[0].current, 12345);
  assert.equal(m.comparisons[0].baseline, 9000);
});

test("every PDF/XLSX download returns the exact bytes used by the email, with the selected period", async t => {
  const previous = process.env.DEMO_REPORT_EXPORTS_ENABLED;
  process.env.DEMO_REPORT_EXPORTS_ENABLED = "true";
  t.after(() => { if (previous === undefined) delete process.env.DEMO_REPORT_EXPORTS_ENABLED; else process.env.DEMO_REPORT_EXPORTS_ENABLED = previous; });
  const packages = new Map<Frequency, ProfilePackage>();
  for (const frequency of ["daily", "monthly"] as Frequency[]) {
    const model = buildProfileModel(await collect("ceo", frequency));
    packages.set(frequency, { model, html: profileReportHtml(model), pdf: Buffer.from("%PDF-isolated-route-fixture"), xlsx: await profileWorkbook(model), pdfName: `${frequency}-Report.pdf`, xlsxName: `${frequency}-Data.xlsx`, packageVersion: frequency });
  }
  let loads = 0;
  t.mock.method(profileProvider, "load", async (frequency: Frequency, period: string) => {
    loads++;
    const pack = packages.get(frequency)!;
    assert.equal(period, pack.model.snapshot.plan.period);
    return pack;
  });
  for (const [get, route, frequency, query] of [
    [pulseDownload, "pulse", "daily", "date=2026-10-03"],
    [monthlyDownload, "monthly", "monthly", "period=2026-09"],
    [scorecardDownload, "scorecard", "monthly", "period=2026-09"],
  ] as const) {
    const pack = packages.get(frequency)!, email = ceoDemoEmail(pack, "https://demo.example.com");
    for (const [format, i] of [["pdf", 0], ["xlsx", 1]] as const) {
      const response = await get(new Request(`https://demo.example/api/export/${route}?${query}&format=${format}`));
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(email.payload.attachments[i].content, "base64"));
      assert.equal(response.headers.get("X-Report-Version"), pack.model.snapshot.version);
      assert.match(response.headers.get("Content-Disposition")!, new RegExp(email.payload.attachments[i].filename));
    }
    const before = loads;
    for (const filter of ["channel=amazon", "profile=finance", "date=invalid&period=2026-09"]) {
      const response = await get(new Request(`https://demo.example/api/export/${route}?${query}&format=xlsx&${filter}`));
      assert.equal(response.status, 400);
    }
    assert.equal(loads, before);
  }
  process.env.DEMO_REPORT_EXPORTS_ENABLED = "false";
  const before = loads;
  const denied = await monthlyDownload(new Request("https://demo.example/api/export/monthly?period=2026-09&format=pdf"));
  assert.ok([401, 503].includes(denied.status));
  assert.equal(loads, before);
});

test("public demo provider rejects unverified or real source records before rendering", async () => {
  for (const kind of ["missing", "real", "different-source"] as const) {
    const base = reader(); let rendered = false;
    const read: ViewReader = async (path, query) => {
      const result = await base.read(path, query);
      if (path === "ingest-runs") {
        const data = result as { total: number; rows: { isSynthetic: boolean; id: string; sourceId: string }[] };
        if (kind === "missing") { data.rows = []; data.total = 0; }
        if (kind === "real") data.rows[0].isSynthetic = false;
        if (kind === "different-source") { data.rows[0].id = "file-2026-10-03"; data.rows[0].sourceId = "amazon"; }
      }
      return result;
    };
    await assert.rejects(createProfileProvider(read, async () => { rendered = true; return {} as ProfilePackage; })("daily", "2026-10-03"));
    assert.equal(rendered, false);
  }
  const base = reader();
  const read: ViewReader = async (path, query) => {
    const result = await base.read(path, query);
    if (path === "orders") for (const r of (result as { rows: Record<string, unknown>[] }).rows) { r.ingestRunId = "file-1"; delete r.currency; }
    return result;
  };
  let rendered = false;
  await createProfileProvider(read, async snapshot => {
    rendered = true;
    assert.ok(snapshot.collectionNotes.some(note => note.includes("Joao Carvalho")));
    assert.ok(snapshot.orders.every(row => !("customerEmail" in row) && !("buyerKey" in row)));
    return {} as ProfilePackage;
  })("daily", "2026-10-03");
  assert.equal(rendered, true);
});
