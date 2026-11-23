/**
 * Hand-off target: a story in the backlog.
 *
 * Adds a workspace Story in the backlog (no sprint), the same row Sprint
 * Planning lists and `workspace.story.create` makes, with `sourceRef` so the
 * story links back to what it came from (review feedback, a tech-debt item,
 * a JTBD job). A points estimate the source already has (a Planning Poker
 * result) is kept, and so is the description that comes with it (a
 * story-map card's, a check by name's, a review comment's context), as the
 * story's notes. A title longer than a story's is cut, and its whole text
 * goes first in the notes (an Improve countermeasure or a Kickoff line can
 * run to 1000 characters), so none of it is lost on the story.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import { storyNotes } from "@/lib/stories/fields";
import { cutText } from "@/lib/utils/cut-text";
import type { HandoffRoute, HandoffSource } from "../types";

/** Same cap as Sprint Planning's add-story field. */
export const STORY_TITLE_MAX = 200;

/** Tags a sent story keeps, and the length of each. */
export const STORY_TAGS_MAX = 5;
export const STORY_TAG_MAX = 40;

/** The source's tags as a story keeps them: trimmed, blank ones dropped, each cut, at most 5. */
function storyTags(tags: readonly string[] | undefined): string[] {
  return (tags ?? [])
    .map((t) => (typeof t === "string" ? t.trim().slice(0, STORY_TAG_MAX) : ""))
    .filter((t) => t !== "")
    .slice(0, STORY_TAGS_MAX);
}

export function buildBacklogStory(src: HandoffSource, id = `story_${nanoid(8)}`): Story {
  const owner = (src.owner ?? "").trim();
  const points = src.points;
  const full = src.title.trim();
  // Cut without splitting a character (a lone surrogate fails the stories push).
  const title = full.length > STORY_TITLE_MAX ? cutText(full, STORY_TITLE_MAX).trimEnd() : full;
  // A title cut to fit keeps its whole text first in the notes, as a sent risk does.
  const description = typeof src.description === "string" ? src.description.trim() : "";
  const notes = storyNotes([title === full ? "" : full, description].filter(Boolean).join("\n\n"));
  const tags = storyTags(src.tags);
  return {
    id,
    title,
    status: "backlog",
    ...(typeof points === "number" && Number.isFinite(points) && points > 0 ? { points } : {}),
    ...(owner ? { owner } : {}),
    ...(notes ? { notes } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    sourceRef: src.sourceRef,
  };
}

const story = (id: string) => useWorkspaceStore.getState().stories.find((s) => s.id === id);

export const backlogStoryRoute: HandoffRoute = {
  id: "backlog-story",
  label: "Backlog story",
  doneLabel: "Added to the backlog",
  targetToolId: "sprint-planning",
  targetHref: () => "/sprint-planning",
  send: (src) => {
    const s = buildBacklogStory(src);
    useWorkspaceStore.getState().upsertStory(s);
    return s.id;
  },
  remove: (id) => {
    if (story(id)) useWorkspaceStore.getState().removeStory(id);
  },
  exists: (id) => Boolean(story(id)),
  isDone: (id) => story(id)?.status === "done",
};
