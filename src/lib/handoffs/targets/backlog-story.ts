/**
 * Hand-off target: a story in the backlog.
 *
 * Adds a workspace Story in the backlog (no sprint), the same row Sprint
 * Planning lists and `workspace.story.create` makes, with `sourceRef` so the
 * story links back to what it came from (review feedback, a tech-debt item,
 * a JTBD job). A points estimate the source already has (a Planning Poker
 * result) is kept, and so is the description that comes with it (a
 * story-map card's, a check by name's, a review comment's context), as the
 * story's notes.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import { storyNotes } from "@/lib/stories/fields";
import type { HandoffRoute, HandoffSource } from "../types";

/** Same cap as Sprint Planning's add-story field. */
export const STORY_TITLE_MAX = 200;

export function buildBacklogStory(src: HandoffSource, id = `story_${nanoid(8)}`): Story {
  const owner = (src.owner ?? "").trim();
  const points = src.points;
  const notes = storyNotes(src.description);
  return {
    id,
    title: src.title.trim().slice(0, STORY_TITLE_MAX),
    status: "backlog",
    ...(typeof points === "number" && Number.isFinite(points) && points > 0 ? { points } : {}),
    ...(owner ? { owner } : {}),
    ...(notes ? { notes } : {}),
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
