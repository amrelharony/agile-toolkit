/**
 * POST /api/comics/queue/reorder: { order: [ep, ep, ...] }, a new order for the
 * unreleased weekly stories it names. Each number keeps its date and takes the
 * next story in the order. A released story can't be one of them.
 *
 * The swap itself is one transaction in comic_reorder_queue (migration 0030),
 * which repeats the released check under a row lock.
 *
 * Errors: 400 invalid_order, 409 not_in_queue | incomplete_story (with `ep`),
 * 401/403 not the owner, 503.
 */

import { checkReorder } from "@/lib/comics/queue";
import { revalidateComics } from "@/lib/comics/revalidate";
import { answer, loadStories, ownerRoute, readJson, refuse } from "../../_owner";

export const POST = ownerRoute(async ({ req, admin }) => {
  const read = await readJson(req);
  if (read instanceof Response) return read;

  const stories = await loadStories(admin);
  if (!stories) return refuse(503, "service_unavailable");

  const order = (read.body as { order?: unknown } | null)?.order;
  const check = checkReorder(stories, order, Date.now());
  if (!check.ok) {
    const status = check.error === "invalid_order" ? 400 : 409;
    return refuse(status, check.error, check.ep === undefined ? undefined : { ep: check.ep });
  }

  const { error } = await admin.rpc("comic_reorder_queue", {
    p_slots: check.slots,
    p_stories: check.order,
  });
  if (error) return refuse(503, "service_unavailable");

  revalidateComics(check.slots);
  const fresh = await loadStories(admin);
  if (!fresh) return refuse(503, "service_unavailable");
  return answer({ stories: fresh });
});
