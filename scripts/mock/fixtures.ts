/**
 * All mock export files, rendered from the truth model, in upload order.
 * Pure: used by `npm run mock:generate` (writes data/fixtures) and by the demo
 * reset (ingests them from memory; Vercel has no data/ folder at runtime).
 */
import { buildModel, type MockModel } from "./model";
import type { FixtureFile } from "./types";
import { writeAmazon } from "./writers/amazon";
import { writeCashmonkey } from "./writers/cashmonkey";
import { writeEbay } from "./writers/ebay";
import { writeFedex } from "./writers/fedex";
import { writeGoodwillBooks } from "./writers/goodwill_books";
import { writeJewelry } from "./writers/jewelry";
import { writeShipping } from "./writers/shipping_osm_pb_easypost";
import { writeShopgoodwill } from "./writers/shopgoodwill";
import { writeUpright } from "./writers/upright";

export type { FixtureFile } from "./types";

/** Every fixture, sorted by upload time (then path): the order the seed ingests them. */
export function buildFixtures(model: MockModel = buildModel()): FixtureFile[] {
  const files = [
    ...writeShopgoodwill(model),
    ...writeAmazon(model),
    ...writeEbay(model),
    ...writeUpright(model),
    ...writeCashmonkey(model),
    ...writeJewelry(model),
    ...writeShipping(model),
    ...writeFedex(model),
    ...writeGoodwillBooks(model),
  ];
  return files.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.path.localeCompare(b.path));
}

/** Manifest row (data/fixtures/manifest.json): the seed reads files in this order. */
export interface ManifestEntry {
  path: string;
  sourceId: string;
  uploadedAt: string;
  bytes: number;
  note?: string;
}

export function manifestOf(files: FixtureFile[]): ManifestEntry[] {
  return files.map((f) => ({
    path: f.path,
    sourceId: f.sourceId,
    uploadedAt: f.uploadedAt,
    bytes: Buffer.byteLength(f.content, "utf8"),
    ...(f.note ? { note: f.note } : {}),
  }));
}
