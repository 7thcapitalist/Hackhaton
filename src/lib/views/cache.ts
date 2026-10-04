/**
 * Read-through cache for view functions, so page views don't re-scan Turso.
 *
 * Turso bills rows *scanned*, and the views aggregate whole tables, while the data only
 * changes when something is ingested, closed or edited. So view results live in the Next
 * Data Cache under one tag, and every route that writes calls `invalidateViews()`.
 *
 * - Only on a production Next server: scripts (tsx) and `next dev` call the function directly,
 *   so local seeding never shows stale numbers.
 * - Keyed by deployment, so a new deploy never reads results shaped by old code.
 * - `revalidate` bounds staleness for writes that bypass the app (e.g. a script run against
 *   the production database): at most an hour, or call `POST /api/views/revalidate`.
 * - Results must be JSON-serializable (view functions already are).
 */
import { revalidateTag, unstable_cache } from "next/cache";

export const VIEWS_TAG = "views";
const REVALIDATE_SECONDS = 60 * 60;
const BUILD = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

const enabled = () => !!process.env.NEXT_RUNTIME && process.env.NODE_ENV === "production";

export function cachedView<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const cached = unstable_cache(fn, ["view", BUILD, name], { tags: [VIEWS_TAG], revalidate: REVALIDATE_SECONDS });
  return (...args: A) => (enabled() ? cached(...args) : fn(...args));
}

/** Drop every cached view result. Call after any write to the database. */
export function invalidateViews(): void {
  if (!enabled()) return;
  try {
    revalidateTag(VIEWS_TAG);
  } catch (err) {
    console.error("[views] cache invalidation failed", err);
  }
}
