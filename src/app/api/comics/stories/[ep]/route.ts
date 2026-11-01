/**
 * PATCH  /api/comics/stories/N: edit fields, including replacing art. The files
 * the edit stopped using come back as `replacedPaths` and are never deleted
 * here: the portal lists them for clean-up (see ../../unused-art).
 * DELETE /api/comics/stories/N: remove a draft. Scheduled stories must be
 * unpublished first. One that has ever been out stays: its number has been shared.
 *
 * Errors: 400 invalid_input | invalid_ep, 404, 409 incomplete_story | art_missing
 * (with `paths`) | not_a_draft | was_released, 401/403 not the owner, 503.
 */

import { revalidateComics } from "@/lib/comics/revalidate";
import { parseEp } from "@/lib/comics/entry";
import {
  OWNER_STORY_COLUMNS,
  everReleased,
  parseStoryFields,
  publishProblems,
  storyFieldsToRow,
  toOwnerStory,
  type StoryRow,
} from "@/lib/comics/story-input";
import {
  answer,
  artPaths,
  loadStory,
  missingArt,
  ownerRoute,
  readJson,
  refuse,
} from "../../_owner";

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

  // Only what this edit brings in: the files a story already holds can't be cleared.
  const held = new Set(artPaths(story));
  const incoming = artPaths(merged).filter((path) => !held.has(path));
  if (incoming.length > 0) {
    const missing = await missingArt(admin, incoming);
    if (!missing) return refuse(503, "service_unavailable");
    if (missing.length > 0) return refuse(409, "art_missing", { paths: missing });
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
  if (everReleased(story)) return refuse(409, "was_released");
  if (story.releaseAt) return refuse(409, "not_a_draft");

  // The conditions repeat the checks, in case the story was scheduled meanwhile.
  const { error } = await admin
    .from("comic_stories")
    .delete()
    .eq("ep", ep)
    .is("release_at", null)
    .is("first_released_at", null);
  if (error) return refuse(503, "service_unavailable");

  revalidateComics([ep]);
  return answer({ removedPaths: artPaths(story) });
});
