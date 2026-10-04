/**
 * Read-only SQL guard for the chat's `run_sql` tool. Pure (no DB access), so
 * `npm run check:chat-sql` can test it.
 *
 * Layers (the DB-side ones live in sql.ts):
 *  1. Comments are stripped (outside string literals) so `--` cannot comment
 *     out the LIMIT wrapper and `/* *\/` cannot hide a keyword split.
 *  2. Exactly one statement: a single trailing `;` is allowed, any other `;`
 *     outside a string literal is rejected.
 *  3. Must start with SELECT or WITH.
 *  4. Write / admin keywords are rejected as whole words anywhere outside
 *     string literals (PRAGMA, ATTACH, INSERT, UPDATE, DELETE, DROP, ...).
 *  5. `golden_*` tables (demo-reset snapshot) are rejected, quoted or not.
 *  6. The query is wrapped as `SELECT * FROM (<query>) LIMIT 500`.
 */

export const SQL_ROW_LIMIT = 500;
export const SQL_MAX_LENGTH = 8000;

/** Whole-word keywords that are never allowed (outside string literals). */
export const FORBIDDEN_KEYWORDS = [
  "PRAGMA",
  "ATTACH",
  "DETACH",
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "REPLACE",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "UPSERT",
  "TRUNCATE",
  "LOAD_EXTENSION",
  "READFILE",
  "WRITEFILE",
  "EDIT",
  "FTS3_TOKENIZER",
] as const;

export type SqlGuardResult =
  | { ok: true; sql: string; wrapped: string }
  | { ok: false; reason: string };

interface Scan {
  /** Query with comments replaced by a space; string literals kept. */
  cleaned: string;
  /** Like `cleaned`, with string-literal contents blanked out ('' kept). */
  skeleton: string;
  error?: string;
}

/**
 * One pass over the text that understands '...' strings ('' escapes),
 * "..." / `...` / [...] quoted identifiers, -- line comments and block comments.
 */
function scan(input: string): Scan {
  let cleaned = "";
  let skeleton = "";
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i]!;
    const next = input[i + 1];
    if (c === "-" && next === "-") {
      const end = input.indexOf("\n", i + 2);
      i = end === -1 ? n : end + 1;
      cleaned += " ";
      skeleton += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      const end = input.indexOf("*/", i + 2);
      if (end === -1) return { cleaned, skeleton, error: "Unterminated /* comment" };
      i = end + 2;
      cleaned += " ";
      skeleton += " ";
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (input[j] === "'") {
          if (input[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) return { cleaned, skeleton, error: "Unterminated string literal" };
      cleaned += input.slice(i, j + 1);
      skeleton += "''";
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const end = input.indexOf(close, i + 1);
      if (end === -1) return { cleaned, skeleton, error: "Unterminated quoted identifier" };
      const ident = input.slice(i, end + 1);
      cleaned += ident;
      // Keep identifier text in the skeleton (as a bare word) so golden_ and
      // keyword checks still see it.
      skeleton += ` ${input.slice(i + 1, end)} `;
      i = end + 1;
      continue;
    }
    cleaned += c;
    skeleton += c;
    i++;
  }
  return { cleaned, skeleton };
}

export function guardSql(query: unknown): SqlGuardResult {
  if (typeof query !== "string" || !query.trim()) return { ok: false, reason: "Empty query" };
  if (query.length > SQL_MAX_LENGTH) {
    return { ok: false, reason: `Query too long (max ${SQL_MAX_LENGTH} characters)` };
  }
  if (query.includes("\0")) return { ok: false, reason: "Query contains a NUL byte" };

  const s = scan(query);
  if (s.error) return { ok: false, reason: s.error };

  // Drop one trailing semicolon (plus whitespace); any other is a second statement.
  let cleaned = s.cleaned.trim();
  let skeleton = s.skeleton.trim();
  if (skeleton.endsWith(";")) {
    skeleton = skeleton.slice(0, -1).trim();
    cleaned = cleaned.replace(/;\s*$/, "").trim();
  }
  if (!skeleton) return { ok: false, reason: "Empty query" };
  if (skeleton.includes(";")) return { ok: false, reason: "Only one statement is allowed (found ';')" };

  if (!/^(SELECT|WITH)\b/i.test(skeleton)) {
    return { ok: false, reason: "Query must start with SELECT or WITH" };
  }

  const upper = skeleton.toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`(^|[^A-Z0-9_$])${kw}([^A-Z0-9_$]|$)`).test(upper)) {
      return { ok: false, reason: `Keyword ${kw} is not allowed (read-only queries only)` };
    }
  }
  // Table-valued pragma functions (pragma_table_info(...), ...).
  if (/(^|[^A-Z0-9_$])PRAGMA_/.test(upper)) {
    return { ok: false, reason: "PRAGMA functions are not allowed" };
  }
  if (/golden_/i.test(skeleton) || /golden_/i.test(cleaned)) {
    return { ok: false, reason: "golden_* tables (demo snapshot) are not queryable" };
  }

  return {
    ok: true,
    sql: cleaned,
    wrapped: `SELECT * FROM (\n${cleaned}\n) LIMIT ${SQL_ROW_LIMIT}`,
  };
}
