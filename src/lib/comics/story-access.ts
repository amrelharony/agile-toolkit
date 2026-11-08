/**
 * Whether a weekly story can take a reader's count yet: the guess and "Seen
 * this at work?" taps (/api/comics/taps) and the engagement counts
 * (/api/comics/stats) share it. A story counts once it's out, or while it's in
 * the reader's VIP window for a device with the book's key. Server only.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EARLY_WINDOW_DAYS } from "@/lib/comics/store";
import { hasVipAccess } from "@/lib/vip/access";

const DAY_MS = 86_400_000;

export interface OpenStory {
  guess: unknown;
}

export type StoryAccess =
  | { ok: true; story: OpenStory }
  | { ok: false; status: 404 | 503; error: "not_found" | "service_unavailable" };

type StoryRow = { guess: unknown; release_at: string | null; collection: string };

export async function storyOpenForCounts(
  admin: SupabaseClient,
  ep: number,
  now = Date.now()
): Promise<StoryAccess> {
  const { data, error } = await admin
    .from("comic_stories")
    .select("guess,release_at,collection")
    .eq("ep", ep)
    .maybeSingle<StoryRow>();
  if (error) return { ok: false, status: 503, error: "service_unavailable" };
  if (!data || data.collection !== "weekly" || !data.release_at) {
    return { ok: false, status: 404, error: "not_found" };
  }
  const releaseAt = Date.parse(data.release_at);
  if (releaseAt > now) {
    const inWindow = releaseAt <= now + EARLY_WINDOW_DAYS * DAY_MS;
    if (!inWindow || !(await hasVipAccess())) return { ok: false, status: 404, error: "not_found" };
  }
  return { ok: true, story: { guess: data.guess } };
}
