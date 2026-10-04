/**
 * Raw file archive (slide 40 step 02 "Archive: consistent year / month ·
 * source file naming · run history"; slide 39 step 1 "save all files under
 * Accounting / Month End / year / month / Journal Entries / E-Commerce JEs").
 *
 * Every successfully ingested file keeps its ORIGINAL bytes at a deterministic
 * key:
 *
 *   Month End/<YYYY>/<MM>/<source_id>/<original file name>
 *
 * Daily files go under their month. If that key already holds different bytes
 * (same name, new content, e.g. a corrected re-export), the file is stored as
 * `<name>_<sha256 first 10>.<ext>` instead, so nothing is ever overwritten.
 *
 * Backends:
 * - "blob": Vercel Blob, private access. Used when BLOB_READ_WRITE_TOKEN is set,
 *   or BLOB_STORE_ID (a store connected to the Vercel project; auth via OIDC).
 * - "local": data/archive/<key> on disk (dev; gitignored).
 * - "repo": seed fixtures, which are already versioned in the repo (key = path).
 *   Seed-only mock API responses (JSON the mock connectors generate in memory)
 *   use the marker key `mock-api:<source_id>/<file>`: deterministic and
 *   regenerable from versioned code, so no bytes are stored.
 * - "none": archiving was skipped or failed. Archiving never fails an ingest.
 *
 * Privacy: raw files can contain marketplace buyer ids that ingest hashes and
 * never stores in the DB. The archive keeps them (it is the audit copy), so the
 * blob store is private and downloads go through /api/archive.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export type ArchiveBackend = "blob" | "local" | "repo" | "none";

export interface ArchiveResult {
  key: string | null;
  url: string | null;
  backend: ArchiveBackend;
  /** Why archiving was skipped or failed (backend "none"). */
  note?: string;
}

/** Key prefix of seed mock API responses (backend "repo", nothing stored). */
export const MOCK_API_KEY_PREFIX = "mock-api:";
export const MOCK_API_NOT_STORED = "regenerable mock API response, not stored";

export function isMockApiKey(key: string | null | undefined): boolean {
  return !!key?.startsWith(MOCK_API_KEY_PREFIX);
}

/** Root of the local archive (dev). Override with ARCHIVE_DIR. */
export function localArchiveRoot(): string {
  return resolve(process.env.ARCHIVE_DIR?.trim() || join(process.cwd(), "data", "archive"));
}

/** Blob is used when a token or a connected store id is present. */
export function blobEnabled(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_STORE_ID?.trim());
}

/** Default backend for new archives: blob when configured, else local disk. */
export function archiveBackend(): "blob" | "local" {
  return blobEnabled() ? "blob" : "local";
}

/** File name made safe for a path segment (no folders, no control chars). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+/, "").trim();
  return clean || "upload";
}

/** `Month End/<YYYY>/<MM>/<source_id>/<file name>` for a YYYY-MM period. */
export function archiveKeyOf(period: string, sourceId: string, fileName: string): string {
  const [yyyy, mm] = period.split("-");
  const source = sourceId.replace(/[^a-z0-9_-]/gi, "_");
  return `Month End/${yyyy}/${mm}/${source}/${safeFileName(fileName)}`;
}

/** The same key with the content hash before the extension (collision fallback). */
export function suffixedKey(key: string, sha256: string): string {
  const slash = key.lastIndexOf("/");
  const dir = key.slice(0, slash + 1);
  const name = key.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const tag = sha256.slice(0, 10);
  return dot > 0 ? `${dir}${name.slice(0, dot)}_${tag}${name.slice(dot)}` : `${dir}${name}_${tag}`;
}

/** Absolute path of a local archive key; null if the key escapes the archive root. */
export function localPathOf(key: string): string | null {
  const root = localArchiveRoot();
  const p = resolve(root, key);
  return p === root || p.startsWith(root + sep) ? p : null;
}

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function archiveLocal(key: string, bytes: Uint8Array, sha: string): Promise<ArchiveResult> {
  for (const k of [key, suffixedKey(key, sha)]) {
    const path = localPathOf(k);
    if (!path) throw new Error(`archive key escapes the archive folder: ${k}`);
    let existing: Buffer | null = null;
    try {
      existing = await readFile(path);
    } catch {
      existing = null;
    }
    if (existing && sha256Hex(existing) !== sha) continue; // same name, different bytes
    if (!existing) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
    return { key: k, url: null, backend: "local" };
  }
  throw new Error(`archive key collision for ${key}`);
}

async function archiveBlob(key: string, bytes: Uint8Array, sha: string, contentType: string): Promise<ArchiveResult> {
  const { put } = await import("@vercel/blob");
  const body = Buffer.from(bytes);
  try {
    const r = await put(key, body, { access: "private", addRandomSuffix: false, contentType });
    return { key: r.pathname, url: r.url, backend: "blob" };
  } catch (err) {
    // The plain key exists (a different file with the same name, or an orphan
    // of a failed run). The suffixed key is content-addressed, so overwriting
    // it can only write the same bytes.
    if (!/exist/i.test(err instanceof Error ? err.message : String(err))) throw err;
    const k = suffixedKey(key, sha);
    const r = await put(k, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
    return { key: r.pathname, url: r.url, backend: "blob" };
  }
}

export function contentTypeOf(fileName: string): string {
  const ext = /\.[^.]+$/.exec(fileName.toLowerCase())?.[0] ?? "";
  return (
    {
      ".csv": "text/csv",
      ".tsv": "text/tab-separated-values",
      ".txt": "text/plain",
      ".json": "application/json",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[ext] ?? "application/octet-stream"
  );
}

/**
 * Store the original bytes. Never throws: a failure comes back as backend
 * "none" with a note, so the ingest goes on.
 */
export async function archiveFile(input: {
  bytes: Uint8Array;
  fileName: string;
  sourceId: string;
  /** YYYY-MM the file belongs to. */
  period: string;
  sha256?: string;
  backend?: "blob" | "local";
}): Promise<ArchiveResult> {
  const key = archiveKeyOf(input.period, input.sourceId, input.fileName);
  const sha = input.sha256 ?? sha256Hex(input.bytes);
  const backend = input.backend ?? archiveBackend();
  try {
    return backend === "blob"
      ? await archiveBlob(key, input.bytes, sha, contentTypeOf(input.fileName))
      : await archiveLocal(key, input.bytes, sha);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { key: null, url: null, backend: "none", note: `archive (${backend}) failed: ${msg.replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, "[redacted]")}` };
  }
}

export interface ArchivedFile {
  body: ReadableStream<Uint8Array> | Uint8Array;
  contentType: string;
  size: number | null;
  fileName: string;
}

/**
 * Read an archived file back (for /api/archive). Null when it is not there,
 * and always null for a mock API key (MOCK_API_NOT_STORED).
 */
export async function readArchived(key: string, backend: ArchiveBackend): Promise<ArchivedFile | null> {
  if (isMockApiKey(key)) return null; // MOCK_API_NOT_STORED
  const fileName = key.split("/").pop() || "file";
  if (backend === "blob") {
    const { get } = await import("@vercel/blob");
    const r = await get(key, { access: "private" });
    if (!r || r.statusCode !== 200) return null;
    return { body: r.stream, contentType: r.blob.contentType || contentTypeOf(fileName), size: r.blob.size, fileName };
  }
  let path: string | null;
  if (backend === "repo") {
    // Seed fixtures: a repo-relative path under data/.
    const root = resolve(process.cwd(), "data");
    const p = resolve(process.cwd(), key);
    path = p.startsWith(root + sep) ? p : null;
  } else if (backend === "local") {
    path = localPathOf(key);
  } else {
    return null;
  }
  if (!path) return null;
  try {
    const bytes = new Uint8Array(await readFile(path));
    return { body: bytes, contentType: contentTypeOf(fileName), size: bytes.byteLength, fileName };
  } catch {
    return null;
  }
}
