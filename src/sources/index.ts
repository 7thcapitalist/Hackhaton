/**
 * Parser registry. The ingest service picks a parser from here, either by
 * explicit source id or by asking each parser whether it accepts the file.
 */
import type { RawTable, SourceParser } from "./types";

// parsers are registered here as they land: amazon, ebay, shopgoodwill, upright, ...
export const parsers: SourceParser[] = [];

export function getParser(sourceId: string): SourceParser | undefined {
  return parsers.find((p) => p.sourceId === sourceId);
}

/**
 * First registered parser whose `accepts()` returns true. A parser that
 * throws inside `accepts()` is treated as "no".
 */
export function detectParser(table: RawTable, fileName: string): SourceParser | undefined {
  return parsers.find((p) => {
    try {
      return p.accepts(table, fileName);
    } catch {
      return false;
    }
  });
}
