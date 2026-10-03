/** One generated export file, as the platform would deliver it. */
export interface FixtureFile {
  /** The parser that must read it (= its folder under data/fixtures). */
  sourceId: string;
  /** Path relative to data/fixtures, e.g. "amazon/amazon_2026-09-14.csv". */
  path: string;
  content: string;
  /** When Goodwill would have uploaded it (ISO UTC); seed ingests in this order. */
  uploadedAt: string;
  /** Why this file is special (messy case), if it is. */
  note?: string;
}
