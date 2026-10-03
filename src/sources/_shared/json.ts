/**
 * JSON documents carried through the RawTable contract (see the JSON section
 * of src/sources/types.ts). Pure, no I/O.
 */
import {
  JSON_TABLE_MARKER,
  type JsonSourceParser,
  type ParseResult,
  type RawInput,
  type RawTable,
  type SourceParser,
} from "../types";

/** Raw JSON text → the one-row RawTable that ingest passes to parsers. */
export function jsonTable(text: string): RawTable {
  return [[JSON_TABLE_MARKER, text]];
}

export function isJsonTable(table: RawTable): boolean {
  return table.length === 1 && table[0]?.[0] === JSON_TABLE_MARKER;
}

const cache = new WeakMap<RawTable, RawInput>();

/** Table → RawInput. A JSON table whose text does not parse comes back as a table. */
export function rawInputOf(table: RawTable): RawInput {
  const hit = cache.get(table);
  if (hit) return hit;
  let out: RawInput = { kind: "table", table };
  if (isJsonTable(table)) {
    try {
      out = { kind: "json", json: JSON.parse(table[0][1] ?? "") };
    } catch {
      // leave as table: no parser will accept it, ingest reports "unrecognized"
    }
  }
  cache.set(table, out);
  return out;
}

/** Adapt a JsonSourceParser to the SourceParser registry contract. */
export function jsonSourceParser(p: JsonSourceParser): SourceParser & JsonSourceParser {
  return {
    ...p,
    accepts(table: RawTable, fileName: string): boolean {
      const input = rawInputOf(table);
      return input.kind === "json" && p.acceptsJson(input.json, fileName);
    },
    parse(table, ctx): ParseResult {
      const input = rawInputOf(table);
      if (input.kind !== "json") {
        return {
          orders: [],
          moneyLines: [],
          warnings: [{ message: `${p.sourceId} API parser expects a JSON document.` }],
          headerRowIndex: -1,
          header: [],
        };
      }
      return p.parseJson(input.json, ctx);
    },
  };
}

// --- small readers for untyped API payloads ---------------------------------

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

/** Decimal string or number ("5.12", "5.12000", 5.12) → integer cents; null if absent/bad. */
export function decimalCents(v: unknown): number | null {
  const s = str(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/** eBay-style Amount { value: "12.34", currency: "USD" } → cents (0 when absent). */
export function amountCents(v: unknown): number {
  return isObj(v) ? decimalCents(v.value) ?? 0 : 0;
}

/** Top-level keys of a JSON object, for ParseResult.header (feeds headerSignature). */
export function topKeys(json: unknown): string[] {
  return isObj(json) ? Object.keys(json).map((k) => k.toLowerCase()) : [];
}
