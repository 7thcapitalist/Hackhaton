/**
 * Signed, expiring download links for the raw-file archive.
 *
 * Archived originals can hold marketplace buyer ids that the database only
 * stores hashed, so /api/archive must not serve a file to anyone who guesses
 * an ingest run id. Server code that renders a link signs it here (HMAC-SHA256
 * over run id + expiry); the route verifies the signature and the expiry.
 *
 * Secret: ARCHIVE_LINK_SECRET, else BUYER_KEY_SALT, else CRON_SECRET. With no
 * secret configured, unsigned links are allowed only outside production.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a rendered download link stays valid. */
export const ARCHIVE_LINK_TTL_SECONDS = 15 * 60;

function secret(): string | null {
  return process.env.ARCHIVE_LINK_SECRET || process.env.BUYER_KEY_SALT || process.env.CRON_SECRET || null;
}

function sign(runId: string, exp: number, key: string): string {
  return createHmac("sha256", key).update(`archive:${runId}:${exp}`).digest("hex");
}

/** `/api/archive?run=…&exp=…&sig=…`, valid for ARCHIVE_LINK_TTL_SECONDS. */
export function signedArchivePath(runId: string, now = Date.now()): string {
  const key = secret();
  const run = encodeURIComponent(runId);
  if (!key) return `/api/archive?run=${run}`;
  const exp = Math.floor(now / 1000) + ARCHIVE_LINK_TTL_SECONDS;
  return `/api/archive?run=${run}&exp=${exp}&sig=${sign(runId, exp, key)}`;
}

export type LinkCheck = { ok: true } | { ok: false; reason: string };

/** Verify a signed link. Unsigned links pass only when no secret is set and we're not in production. */
export function verifyArchiveLink(runId: string, exp: string | null, sig: string | null, now = Date.now()): LinkCheck {
  const key = secret();
  if (!key) {
    return process.env.NODE_ENV === "production"
      ? { ok: false, reason: "archive downloads are disabled: no signing secret configured" }
      : { ok: true };
  }
  if (!exp || !sig) return { ok: false, reason: "missing signature" };
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum * 1000 < now) return { ok: false, reason: "link expired" };
  const expected = Buffer.from(sign(runId, expNum, key), "hex");
  const given = Buffer.from(sig, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}
