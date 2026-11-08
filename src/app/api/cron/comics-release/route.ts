/**
 * The refresh behind a Sunday's story.
 *
 *   GET /api/cron/comics-release — Vercel Cron, daily at the release hour
 *
 * The comic pages are cached for a day (their `revalidate`): rebuilt every ten
 * minutes, they ran to ~680K ISR write units in a week and paused the site on
 * Hobby. Stories come out at 07:00 UTC (lib/comics/queue.ts) with nobody there
 * to press anything, so this job refreshes what a release changed. A day with
 * no release refreshes nothing, and the pages keep their copy.
 *
 * It looks back RELEASE_LOOKBACK_MS, a little over the longest gap between two
 * runs (Hobby fires anywhere in the scheduled hour), so a story released at any
 * time since the last run is caught, at worst twice.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Without the variable the
 * route refuses: an open refresh would let anyone rebuild every comic page on
 * every visit. The pages still catch up within their day.
 */

import { timingSafeEqual } from "node:crypto";
import { revalidateComics } from "@/lib/comics/revalidate";
import { listReleasedWeekly } from "@/lib/comics/store";
import type { StorySummary } from "@/lib/comics/types";

export const dynamic = "force-dynamic";

/** 26 hours. Not exported: Next refuses unknown exports from a route file. */
const RELEASE_LOOKBACK_MS = 26 * 60 * 60 * 1000;
/** More than ever come out in a day: the launch released four at once. */
const RECENT_LIMIT = 20;
/** Vercel's advice for CRON_SECRET; anything shorter counts as unset. */
const MIN_SECRET_LENGTH = 16;

const NO_STORE = { "Cache-Control": "no-store" };

function answer(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    return answer(503, { error: "cron_unconfigured" });
  }
  if (!authorized(req.headers.get("authorization"), secret)) {
    return answer(401, { error: "unauthorized" });
  }

  let recent: StorySummary[];
  try {
    recent = await listReleasedWeekly(RECENT_LIMIT);
  } catch {
    // Vercel doesn't retry; the pages catch up within their day.
    return answer(502, { error: "read_failed" });
  }

  const since = Date.now() - RELEASE_LOOKBACK_MS;
  const released = recent
    .filter((story) => Date.parse(story.releaseAt) > since)
    .map((story) => story.ep);
  if (released.length > 0) revalidateComics(released);
  return answer(200, { refreshed: released });
}
