/**
 * PATCH  /api/comics/stories/N: edit fields, including replacing art. The files
 * the edit stopped using come back as `replacedPaths` and are never deleted
 * here: the portal lists them for clean-up (see ../../unused-art).
 * DELETE /api/comics/stories/N: remove a draft. Scheduled and released stories
 * must be unpublished first.
 *
 * Errors: 400 invalid_input | invalid_ep, 404, 409 incomplete_story | not_a_draft,
 * 401/403 not the owner, 503.
 */

import { revalidateComics } from "@/lib/comics/revalidate";
import { parseEp } from "@/lib/comics/entry";
import {
  OWNER_STORY_COLUMNS,
  parseStoryFields,
  publishProblems,
  storyFieldsToRow,
  toOwnerStory,
  type StoryRow,
} from "@/lib/comics/story-input";
import { answer, artPaths, loadStory, ownerRoute, readJson, refuse } from "../../_owner";

export const dynamic = "force-dynamic";

type Params = { ep: string };

export const PATCH = ownerRoute<Params>(async ({ req, admin, params }) => {
  const ep = parseEp(params.ep);
  if (ep === null) return refuse(400, "invalid_ep");
  const read = await readJson(req);
  if (read instanceof Response) return read;
  const parsed = parseStoryFields(read.body);
  if (!parsed.ok) return refuse(400, "invalid_input", { field: parsed.field });

  const story = await loadStory(admin, ep);
  if (story === undefined) return refuse(503, "service_unavailable");
  if (story === null) return refuse(404, "not_found");

  // A story's identity is settled when it's created: resuming an import reads it.
  const fields = { ...parsed.fields };
  delete fields.sourceId;
  // Only a book episode has a printed page to point at.
  if (story.collection !== "book") delete fields.bookPage;

  const merged = { ...story, ...fields };
  if (story.releaseAt) {
    const problems = publishProblems(merged);
    if (problems.length > 0) return refuse(409, "incomplete_story", { problems });
  }

  const { data, error } = await admin
    .from("comic_stories")
    .update({ ...storyFieldsToRow(fields), updated_at: new Date().toISOString() })
    .eq("ep", ep)
    .select(OWNER_STORY_COLUMNS)
    .maybeSingle<StoryRow>();
  if (error) return refuse(503, "service_unavailable");
  if (!data) return refuse(404, "not_found");

  revalidateComics([ep]);
  const kept = new Set(artPaths(merged));
  return answer({
    story: toOwnerStory(data),
    replacedPaths: artPaths(story).filter((path) => !kept.has(path)),
  });
});

export const DELETE = ownerRoute<Params>(async ({ admin, params }) => {
  const ep = parseEp(params.ep);
  if (ep === null) return refuse(400, "invalid_ep");
  const story = await loadStory(admin, ep);
  if (story === undefined) return refuse(503, "service_unavailable");
  if (story === null) return refuse(404, "not_found");
  if (story.releaseAt) return refuse(409, "not_a_draft");

  // The condition repeats the check, in case the story was scheduled meanwhile.
  const { error } = await admin.from("comic_stories").delete().eq("ep", ep).is("release_at", null);
  if (error) return refuse(503, "service_unavailable");

  revalidateComics([ep]);
  return answer({ removedPaths: artPaths(story) });
});
