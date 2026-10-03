/**
 * No-op, kept only because scripts/seed/run.ts still imports it.
 *
 * It used to swap Intl.DateTimeFormat for a caching version while the seed
 * ingested, because the parsers' date helpers built a new formatter for every
 * timestamp. Those helpers now cache their formatters themselves
 * (src/sources/_shared/table.ts cachedFormatter), so this just runs `fn`.
 * Delete this file once run.ts stops importing it.
 */
export async function withCachedDateTimeFormat<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}
