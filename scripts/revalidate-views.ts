/**
 * After a script writes to a remote (production) database, drop the live site's cached
 * view results (src/lib/views/cache.ts) so the pages show the new numbers right away.
 *
 * Writes through the app's routes already do this. CLI scripts (seed, demo:reset, ingest,
 * close, workbook:import, pull) write to the database directly, so they call this at the end.
 *
 * - Local database (file:...): nothing to do, the app isn't caching it.
 * - Remote: POST <site>/api/views/revalidate with `Bearer $CRON_SECRET`. The site is
 *   REPORTS_VIEW_ORIGIN, else https://$VERCEL_PROJECT_PRODUCTION_URL.
 * - Never fails the script: if the call can't be made, it prints how to do it by hand.
 */
export async function revalidateViews(): Promise<void> {
  const db = process.env.TURSO_DATABASE_URL?.trim() ?? "";
  if (!db || db.startsWith("file:")) return;

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const origin = process.env.REPORTS_VIEW_ORIGIN?.trim() || (host ? `https://${host}` : "");
  const secret = process.env.CRON_SECRET?.trim();
  const byHand = 'curl -X POST -H "Authorization: Bearer $CRON_SECRET" <site>/api/views/revalidate';
  if (!origin || !secret) {
    console.warn(`Cache: set REPORTS_VIEW_ORIGIN and CRON_SECRET to refresh the live site automatically, or run: ${byHand}`);
    console.warn("Until then the live pages can show the previous numbers for up to 1 hour.");
    return;
  }
  try {
    const res = await fetch(new URL("/api/views/revalidate", origin), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) console.log(`Cache: live site refreshed (${new URL(origin).host}).`);
    else console.warn(`Cache: refresh failed (HTTP ${res.status}). Run: ${byHand}`);
  } catch (err) {
    console.warn(`Cache: refresh failed (${err instanceof Error ? err.message : err}). Run: ${byHand}`);
  }
}
