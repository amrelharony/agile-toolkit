/**
 * PUT /api/comics/stories/N/release: { releaseAt: ISO time | null }.
 *
 * A time schedules or publishes, and is refused until every panel has art and a
 * description. Null unpublishes: the story goes back to being a draft and keeps
 * its number.
 *
 * Errors: 400 invalid_ep | invalid_release, 404, 409 incomplete_story (with
 * `problems`), 401/403 not the owner, 503.
 */

import { parseEp } from "@/lib/comics/entry";
import { revalidateComics } from "@/lib/comics/revalidate";
import {
  OWNER_STORY_COLUMNS,
  parseReleaseAt,
  publishProblems,
  toOwnerStory,
  type StoryRow,
} from "@/lib/comics/story-input";
import { answer, loadStory, ownerRoute, readJson, refuse } from "../../../_owner";

type Params = { ep: string };

export const PUT = ownerRoute<Params>(async ({ req, admin, params }) => {
  const ep = parseEp(params.ep);
  if (ep === null) return refuse(400, "invalid_ep");
  const read = await readJson(req);
  if (read instanceof Response) return read;

  const raw = (read.body as { releaseAt?: unknown } | null)?.releaseAt;
  const releaseAt = raw === null ? null : parseReleaseAt(raw);
  if (releaseAt === null && raw !== null) return refuse(400, "invalid_release");

  const story = await loadStory(admin, ep);
  if (story === undefined) return refuse(503, "service_unavailable");
  if (story === null) return refuse(404, "not_found");
  if (releaseAt !== null) {
    const problems = publishProblems(story);
    if (problems.length > 0) return refuse(409, "incomplete_story", { problems });
  }

  const { data, error } = await admin
    .from("comic_stories")
    .update({ release_at: releaseAt, updated_at: new Date().toISOString() })
    .eq("ep", ep)
    .select(OWNER_STORY_COLUMNS)
    .maybeSingle<StoryRow>();
  if (error) return refuse(503, "service_unavailable");
  if (!data) return refuse(404, "not_found");

  revalidateComics([ep]);
  return answer({ story: toOwnerStory(data) });
});
