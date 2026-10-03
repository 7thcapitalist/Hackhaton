/**
 * Speed shim for the seed only. The parsers' date helpers build a new
 * Intl.DateTimeFormat for every timestamp (src/sources/_shared/table.ts
 * businessDateOf, _shared/marketplace.ts and _other.ts tzOffsetMinutes).
 * Building one is expensive: parsing all fixtures takes ~11 s that way and
 * ~1 s with formatters reused. Until those helpers cache their formatters
 * (a three-line fix in the data lane), the seed reuses formatters while it
 * ingests. Formatters are immutable, so sharing them is safe; the original
 * constructor is restored afterwards.
 */
export async function withCachedDateTimeFormat<T>(fn: () => Promise<T>): Promise<T> {
  const Orig = Intl.DateTimeFormat;
  const cache = new Map<string, Intl.DateTimeFormat>();
  const Cached = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    const key = JSON.stringify([locales ?? null, options ?? null]);
    let f = cache.get(key);
    if (!f) {
      f = new Orig(locales, options);
      cache.set(key, f);
    }
    return f;
  } as unknown as typeof Intl.DateTimeFormat;
  Object.assign(Cached, { supportedLocalesOf: Orig.supportedLocalesOf.bind(Orig) });
  (Cached as unknown as { prototype: object }).prototype = Orig.prototype;
  Intl.DateTimeFormat = Cached;
  try {
    return await fn();
  } finally {
    Intl.DateTimeFormat = Orig;
  }
}
