/**
 * Email / manual connectors: sources with no usable API. They read a drop
 * folder, data/inbox/<source_id>/, and hand the files to the same ingest path.
 *
 * How the folder gets fed (the plan for a real rollout):
 *  - "email": the platform already emails the report on a schedule (Upright
 *    "email delivery", Goodwill Books monthly statement, FedEx Billing Online
 *    scheduled invoice reports). Point that email at a dedicated inbox
 *    (e.g. reports@<goodwill domain>) with an inbound-mail webhook
 *    (Resend / SendGrid / Postmark inbound parse, or a Microsoft 365 / Gmail
 *    rule + Graph/Gmail API poll). The webhook saves each attachment under
 *    inbox/<source_id>/ (local disk here; Vercel Blob or S3 in production,
 *    since Vercel functions have no persistent disk), routed by sender +
 *    subject. Then the daily pull ingests it. Only allow-listed senders.
 *  - "manual": a person downloads the export from the portal (ShopGoodwill
 *    seller portal, Cash Monkey orders, the Jewelry report) and drops it into
 *    the folder, or uploads it at /api/ingest. Same parsers either way.
 *
 * Which files a pull takes: only files whose name carries a date in the
 * range (YYYY-MM-DD inside it, or a YYYY-MM month overlapping it). Undated
 * files and files of other dates are never taken, so a pull for a day with
 * nothing in the folder ingests nothing. Already-ingested bytes are skipped
 * by ingest (same SHA-256), so re-pulling is harmless.
 *
 * Mock path: the fixture files (data/fixtures/<source_id>/ or the seed's
 * in-memory set) dated in the range, nothing else: no inbox, no parser samples.
 */
import { fixtureFiles, inboxDir } from "./fixtures";
import type { Connector, ConnectorMode, PulledFile } from "./types";
import { assertRange, filesInRange, listFiles, readLocal } from "./util";

export function dropFolderConnector(opts: {
  sourceId: string;
  label: string;
  mode: Extract<ConnectorMode, "email" | "manual">;
  describe: string;
}): Connector {
  return {
    ...opts,
    envVars: [],
    requiredEnvVars: [],
    // The drop folder needs no credentials; "configured" = the folder exists.
    hasCredentials: () => listFiles(inboxDir(opts.sourceId)).length > 0,
    async pull(req): Promise<PulledFile[]> {
      assertRange(req);
      const files = req.mock ? fixtureFiles(opts.sourceId, req) : filesInRange(listFiles(inboxDir(opts.sourceId)), req);
      return files.map((f) => readLocal(f, "pull_"));
    },
  };
}

export const uprightConnector = dropFolderConnector({
  sourceId: "upright",
  label: "Upright (Paid Order Items)",
  mode: "email",
  describe: "Scheduled 'Paid order items' report by email → inbox/upright/.",
});
export const shopgoodwillConnector = dropFolderConnector({
  sourceId: "shopgoodwill",
  label: "ShopGoodwill (periodic marketplace report)",
  mode: "manual",
  describe: "Seller portal download (Period 1 / Period 3) → inbox/shopgoodwill/ or upload.",
});
export const goodwillBooksConnector = dropFolderConnector({
  sourceId: "goodwill_books",
  label: "Goodwill Books (monthly statement)",
  mode: "email",
  describe: "Prior-month payment statement arrives as an email attachment → inbox/goodwill_books/.",
});
export const fedexConnector = dropFolderConnector({
  sourceId: "fedex",
  label: "FedEx (billing invoices)",
  mode: "email",
  describe: "FedEx Billing Online scheduled invoice CSV by email → inbox/fedex/.",
});
export const cashmonkeyConnector = dropFolderConnector({
  sourceId: "cashmonkey",
  label: "Cash Monkey (orders)",
  mode: "manual",
  describe: "Orders export, full month → inbox/cashmonkey/ or upload.",
});
export const jewelryConnector = dropFolderConnector({
  sourceId: "jewelry",
  label: "Jewelry report",
  mode: "manual",
  describe: "Jewelry Report (Co-Pivot fills Supplier) → inbox/jewelry/ or upload.",
});
