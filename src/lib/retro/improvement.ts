/**
 * What the last retro and the impediments log leave for a sprint's plan: the
 * retro's open actions and the open impediments, each with the story it
 * became (if it did) and where that story is now. Sprint Planning lists them
 * with "Add to this sprint"; the Sprint Cockpit counts how many made it in.
 *
 * A retro action keeps the link to its story (`sentTo`, the "backlog-story"
 * hand-off), so the action closes when the story is done and reads as open
 * again if the story is deleted. An impediment has no such field: its story
 * names it in `sourceRef`, and is found from there. Resolving the impediment
 * stays a decision for the Impediments page, whatever happens to the story.
 *
 * Pure: the caller hands in the boards, stories and impediments, so the page,
 * the in-memory example, the cockpit and tests read the same thing.
 */

import type {
  HandoffLink,
  HandoffRef,
  Impediment,
  KanbanBoard,
  RetroBoard,
  Sprint,
  Story,
} from "@/lib/stores/workspace-types";
import { isResolved, sortImpediments } from "@/lib/impediments/model";
import { collectRetroActions, targetDoneIn, type RetroAction } from "./actions";

/** The hand-off route a retro action takes to become a story. */
export const STORY_ROUTE = "backlog-story" as const;

/** The tool a story made from a retro action names in its `sourceRef`. */
export const RETRO_SOURCE_TOOL = "retro";

/** The tool a story planned from an impediment names (lib/handoffs SOURCE_TOOLS). */
export const IMPEDIMENT_SOURCE_TOOL = "impediments";

/** Where an action's or an impediment's story is, seen from the sprint being planned. */
export type StoryPlace =
  /** It has no story (never added, or the story was deleted). */
  | { where: "none" }
  /** Its story is in the sprint being planned. */
  | { where: "sprint"; story: Story }
  /** Its story waits in the backlog. */
  | { where: "backlog"; story: Story }
  /** Its story is in another sprint (named when that sprint still exists). */
  | { where: "elsewhere"; story: Story; sprintName?: string };

export interface PlannedAction {
  action: RetroAction;
  place: StoryPlace;
}

export interface PlannedImpediment {
  impediment: Impediment;
  place: StoryPlace;
}

export interface ImprovementInput {
  /** The sprint being planned (or shown in the cockpit). */
  sprint: Pick<Sprint, "id">;
  /** Every sprint, to name the one a story is in. */
  sprints: readonly Pick<Sprint, "id" | "name">[];
  retroBoards: readonly RetroBoard[];
  impediments: readonly Impediment[];
  stories: readonly Story[];
  /** Read for actions sent to the Flow board; absent, none of those count as done. */
  kanbanBoards?: readonly KanbanBoard[];
  /** YYYY-MM-DD, local. */
  today: string;
  /**
   * Whether a hand-off target is finished, when the caller already has a
   * way to ask (the cockpit's). Absent: read from the data above.
   */
  targetDone?: (link: HandoffLink) => boolean;
}

export interface Improvements {
  /**
   * The last retro that agreed an action, as Retro Actions names it:
   * "Current retro", or the archived retro's format and day. Absent when no
   * retro has an action item yet.
   */
  retroLabel?: string;
  /** That retro's open actions, in the board's order. */
  actions: PlannedAction[];
  /** Open actions on earlier retros (Retro Actions lists them). */
  earlierOpen: number;
  /** Unresolved impediments, in the Impediments page's order. */
  impediments: PlannedImpediment[];
  /**
   * Of the last retro's actions that are open or were finished by a story
   * in this sprint, how many have their story in this sprint.
   */
  actionsInSprint: number;
  /** The actions `actionsInSprint` is counted out of. */
  actionsCounted: number;
  /** Stories in this sprint that came from a retro action or an impediment. */
  improvementStories: Story[];
}

/** The story `links` point at on the story route, while it still exists. */
export function linkedStory(
  links: readonly HandoffLink[] | undefined,
  stories: readonly Story[]
): Story | undefined {
  const link = (links ?? []).find((l) => l.route === STORY_ROUTE);
  return link ? stories.find((s) => s.id === link.targetId) : undefined;
}

const cameFrom = (story: Story, tool: string, id?: string) =>
  story.sourceRef?.tool === tool && (id === undefined || story.sourceRef.id === id);

/**
 * The story planned from impediment `id`: the one in `sprintId` when there
 * is one, else one still open, else any (a second "Add" after the first
 * story was done makes a new one, and the open one is the one to show).
 */
export function impedimentStory(
  id: string,
  stories: readonly Story[],
  sprintId: string
): Story | undefined {
  const mine = stories.filter((s) => cameFrom(s, IMPEDIMENT_SOURCE_TOOL, id));
  return (
    mine.find((s) => s.sprintId === sprintId) ?? mine.find((s) => s.status !== "done") ?? mine[0]
  );
}

/** Where `story` is, seen from sprint `sprintId`. */
export function storyPlace(
  story: Story | undefined,
  sprintId: string,
  sprints: readonly Pick<Sprint, "id" | "name">[]
): StoryPlace {
  if (!story) return { where: "none" };
  if (story.sprintId === sprintId) return { where: "sprint", story };
  if (!story.sprintId) return { where: "backlog", story };
  const name = sprints.find((s) => s.id === story.sprintId)?.name;
  return { where: "elsewhere", story, ...(name ? { sprintName: name } : {}) };
}

/** Whether a story is improvement work: it came from a retro action or an impediment. */
export function isImprovementStory(story: Pick<Story, "sourceRef">): boolean {
  const tool = story.sourceRef?.tool;
  return tool === RETRO_SOURCE_TOOL || tool === IMPEDIMENT_SOURCE_TOOL;
}

/** What `sprint`'s plan can take in from the last retro and the impediments log. */
export function improvementsFor(input: ImprovementInput): Improvements {
  const { sprint, sprints, retroBoards, impediments, stories, kanbanBoards, today } = input;
  const all = collectRetroActions(retroBoards, {
    today,
    targetDone: input.targetDone ?? targetDoneIn({ impediments, kanbanBoards, stories }),
  });
  // Current board first, then the archives newest first: the first action's
  // board is the last retro that agreed one.
  const lastBoard = all[0]?.boardId;
  const last = all.filter((a) => a.boardId === lastBoard);
  const placed = last.map((action) => ({
    action,
    place: storyPlace(linkedStory(action.sentTo, stories), sprint.id, sprints),
  }));
  const counted = placed.filter((p) => !p.action.done || p.place.where === "sprint");

  return {
    ...(last[0] ? { retroLabel: last[0].retroLabel } : {}),
    actions: placed.filter((p) => !p.action.done),
    earlierOpen: all.filter((a) => a.boardId !== lastBoard && !a.done).length,
    impediments: sortImpediments(
      impediments.filter((i) => !isResolved(i)),
      today
    ).map((impediment) => ({
      impediment,
      place: storyPlace(impedimentStory(impediment.id, stories, sprint.id), sprint.id, sprints),
    })),
    actionsInSprint: counted.filter((p) => p.place.where === "sprint").length,
    actionsCounted: counted.length,
    improvementStories: stories.filter((s) => s.sprintId === sprint.id && isImprovementStory(s)),
  };
}

/** The `sourceRef` a story made from a retro action carries: the card, on its board. */
export function actionSourceRef(action: Pick<RetroAction, "id" | "boardId">): HandoffRef {
  return { tool: RETRO_SOURCE_TOOL, id: action.id, doc: action.boardId };
}

/** The `sourceRef` a story planned from an impediment carries. */
export function impedimentSourceRef(impediment: Pick<Impediment, "id">): HandoffRef {
  return { tool: IMPEDIMENT_SOURCE_TOOL, id: impediment.id };
}
