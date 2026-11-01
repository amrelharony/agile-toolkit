/**
 * POST /api/comics/queue/schedule: { items: [{ ep, releaseAt }] }, the dates the
 * portal previewed. All or nothing up front: every story must be an unreleased
 * weekly one that's fit to publish before any date is written.
 *
 * Errors: 400 invalid_items, 409 not_in_queue | incomplete_story (with `ep`),
 * 401/403 not the owner, 503 (with `saved`, how many dates were written).
 */

import { revalidateComics } from "@/lib/comics/revalidate";
import { parseReleaseAt, publishProblems, storyState } from "@/lib/comics/story-input";
import { answer, loadStories, ownerRoute, readJson, refuse } from "../../_owner";

const MAX_ITEMS = 200;
/** A hundred one-row writes in a row would use up a serverless function's time. */
const WRITES_AT_ONCE = 10;

export const POST = ownerRoute(async ({ req, admin }) => {
  const read = await readJson(req);
  if (read instanceof Response) return read;

  const raw = (read.body as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) {
    return refuse(400, "invalid_items");
  }
  const items: { ep: number; releaseAt: string }[] = [];
  for (const item of raw as { ep?: unknown; releaseAt?: unknown }[]) {
    const releaseAt = parseReleaseAt(item?.releaseAt);
    if (!Number.isInteger(item?.ep) || !releaseAt) return refuse(400, "invalid_items");
    items.push({ ep: item.ep as number, releaseAt });
  }
  if (new Set(items.map((i) => i.ep)).size !== items.length) return refuse(400, "invalid_items");

  const stories = await loadStories(admin);
  if (!stories) return refuse(503, "service_unavailable");
  const byEp = new Map(stories.map((s) => [s.ep, s]));
  const now = Date.now();
  for (const { ep } of items) {
    const story = byEp.get(ep);
    if (
      !story ||
      story.collection !== "weekly" ||
      storyState(story.releaseAt, now) === "released"
    ) {
      return refuse(409, "not_in_queue", { ep });
    }
    if (publishProblems(story).length > 0) return refuse(409, "incomplete_story", { ep });
  }

  let saved = 0;
  const updatedAt = new Date().toISOString();
  for (let i = 0; i < items.length; i += WRITES_AT_ONCE) {
    const results = await Promise.all(
      items
        .slice(i, i + WRITES_AT_ONCE)
        .map(({ ep, releaseAt }) =>
          admin
            .from("comic_stories")
            .update({ release_at: releaseAt, updated_at: updatedAt })
            .eq("ep", ep)
        )
    );
    saved += results.filter((r) => !r.error).length;
    if (results.some((r) => r.error)) {
      revalidateComics(items.map((item) => item.ep));
      return refuse(503, "service_unavailable", { saved });
    }
  }

  revalidateComics(items.map((item) => item.ep));
  const fresh = await loadStories(admin);
  if (!fresh) return refuse(503, "service_unavailable", { saved });
  return answer({ stories: fresh });
});
