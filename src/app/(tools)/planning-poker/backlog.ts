/**
 * Planning Poker: saving the session's stories to the backlog.
 *
 * Stories typed into a session lived only in the session, so when it ended
 * the estimates went with it unless someone copied them across by hand.
 * "Save to backlog" makes them workspace Stories in the backlog, with the
 * accepted estimate as points when it is a number, linked back by
 * `sourceRef` (tool "planning-poker", the session story's id).
 *
 * Stories pulled in from the queue are left out: their estimate already
 * goes back to where they came from, a story-map card or a backlog story
 * (lib/handoffs/poker-writeback). Saving again adds only what's new, and
 * gives a saved story the points it was estimated at since. It never makes
 * a duplicate, and never overwrites points someone set in the backlog.
 */

import { buildBacklogStory } from "@/lib/handoffs/targets/backlog-story";
import type { Story as WorkspaceStory } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/components/tool-frame/example-data";
import type { Story as SessionStory } from "./types";

/** `sourceRef.tool` on the backlog stories this tool saves. */
export const POKER_SOURCE_TOOL = "planning-poker";

export interface BacklogSavePlan {
  /** New backlog stories. */
  create: WorkspaceStory[];
  /** Saved stories getting the points they were estimated at since. */
  update: { before: WorkspaceStory; after: WorkspaceStory }[];
  /** Stories saved earlier with nothing new to add. */
  alreadySaved: number;
  /** New stories going in without points: not estimated yet, or a T-shirt size. */
  unsized: number;
}

/** The backlog story saved from session story `id`, if there is one. */
export function savedStoryFor(
  stories: readonly WorkspaceStory[],
  id: string
): WorkspaceStory | undefined {
  return stories.find((s) => s.sourceRef?.tool === POKER_SOURCE_TOOL && s.sourceRef.id === id);
}

/** An accepted estimate as story points: "8" → 8; a T-shirt size, "?" or none → undefined. */
export function pointsFromEstimate(estimate: string | null | undefined): number | undefined {
  if (estimate === null || estimate === undefined || estimate.trim() === "") return undefined;
  const n = Number(estimate.trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * What a save would do. `skip` holds the session stories that came from
 * the queue; example stories are never saved (the example must not write
 * into the user's backlog).
 */
export function planBacklogSave(
  sessionStories: readonly SessionStory[],
  backlog: readonly WorkspaceStory[],
  skip: ReadonlySet<string> = new Set()
): BacklogSavePlan {
  const plan: BacklogSavePlan = { create: [], update: [], alreadySaved: 0, unsized: 0 };
  for (const st of sessionStories) {
    if (skip.has(st.id) || isExampleId(st.id) || !st.title.trim()) continue;
    const points = pointsFromEstimate(st.finalEstimate);
    const saved = savedStoryFor(backlog, st.id);
    if (saved) {
      if (points !== undefined && saved.points === undefined) {
        plan.update.push({ before: saved, after: { ...saved, points } });
      } else {
        plan.alreadySaved++;
      }
      continue;
    }
    if (points === undefined) plan.unsized++;
    plan.create.push(
      buildBacklogStory({
        title: st.title,
        points,
        sourceRef: { tool: POKER_SOURCE_TOOL, id: st.id },
      })
    );
  }
  return plan;
}

/** How many stories a save would add or update. */
export const planSize = (plan: BacklogSavePlan) => plan.create.length + plan.update.length;

/** Session stories already in the backlog (saved from here). */
export function savedCount(
  sessionStories: readonly SessionStory[],
  backlog: readonly WorkspaceStory[]
): number {
  return sessionStories.filter((st) => savedStoryFor(backlog, st.id)).length;
}
