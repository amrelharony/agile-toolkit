/**
 * GET  /api/comics/stories: every story, drafts included.
 * POST /api/comics/stories: a new story, always a draft. Without a number it
 * takes the next weekly one.
 *
 * Errors: 400 invalid_input (with `field`), 409 taken, 401/403 not the owner, 503.
 */

import { revalidateComics } from "@/lib/comics/revalidate";
import {
  OWNER_STORY_COLUMNS,
  collectionForEp,
  isValidStoryEp,
  nextWeeklyEp,
  parseStoryFields,
  storyFieldsToRow,
  toOwnerStory,
  type StoryRow,
} from "@/lib/comics/story-input";
import { answer, loadStories, ownerRoute, readJson, refuse } from "../_owner";

export const dynamic = "force-dynamic";

const UNIQUE_VIOLATION = "23505";

export const GET = ownerRoute(async ({ admin }) => {
  const stories = await loadStories(admin);
  if (!stories) return refuse(503, "service_unavailable");
  return answer({ stories });
});

export const POST = ownerRoute(async ({ req, admin }) => {
  const read = await readJson(req);
  if (read instanceof Response) return read;
  const parsed = parseStoryFields(read.body);
  if (!parsed.ok) return refuse(400, "invalid_input", { field: parsed.field });

  let ep = (read.body as { ep?: unknown }).ep;
  if (ep === undefined) {
    const stories = await loadStories(admin);
    if (!stories) return refuse(503, "service_unavailable");
    ep = nextWeeklyEp(stories.map((s) => s.ep));
  }
  if (!isValidStoryEp(ep)) return refuse(400, "invalid_input", { field: "ep" });
  const collection = collectionForEp(ep);

  const { data, error } = await admin
    .from("comic_stories")
    .insert({
      ...storyFieldsToRow(parsed.fields),
      ep,
      collection,
      // Only a book episode has a printed page to point at.
      book_page: collection === "book" ? (parsed.fields.bookPage ?? null) : null,
    })
    .select(OWNER_STORY_COLUMNS)
    .single<StoryRow>();
  if (error?.code === UNIQUE_VIOLATION) return refuse(409, "taken");
  if (error || !data) return refuse(503, "service_unavailable");

  revalidateComics([ep]);
  return answer({ story: toOwnerStory(data) }, 201);
});
