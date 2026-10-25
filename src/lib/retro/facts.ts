/**
 * What a retro can open with, read from the rest of the toolkit instead of
 * from memory: whether the sprint goal was met, say/do, the burndown's
 * shape, the impediments the sprint ran into, the team's mood, how the last
 * retro's actions turned out, and the kudos given (seeds for the
 * appreciations column). Shared by the Retro page and tool.retro.list_state.
 * Pure: the caller passes the workspace slices and today.
 */

import type {
  HandoffLink,
  Impediment,
  Kudos,
  MoodEntry,
  RetroBoard,
  Sprint,
  SprintGoal,
  SprintGoalOutcome,
  Story,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { doneOn } from "@/lib/flow";
import { dayOf, impedimentStatus } from "@/lib/impediments/model";
import { storyPoints } from "@/lib/sprints/plan";
import { reviewFacts } from "@/lib/sprints/review-doc";
import { hasSyntheticDates } from "@/lib/sprints/series";
import type { SayDo } from "@/lib/sprints/metrics";
import { moodDuring } from "@/lib/team/mood";
import { followThroughByRetro, type RetroFollowThrough } from "./actions";
import { isArchivedRetroOf, localDay, retroWindow } from "./board";

export type BurndownShape = "none" | "steady" | "late";

export interface RetroFacts {
  sprintId: string;
  sprintName: string;
  /** False for a sprint without real dates: the dated facts are left empty. */
  dated: boolean;
  goal: string | null;
  /** The answer to "Did we meet the sprint goal?", from Sprint Goal. */
  goalOutcome: SprintGoalOutcome | null;
  committed: number;
  completed: number;
  /** Whether the points come from the sprint's stories (else the sprint's typed points). */
  fromStories: boolean;
  sayDo: SayDo | null;
  /** How the done points spread over the sprint; null without done, pointed stories. */
  burndown: { shape: BurndownShape; lateShare: number | null; sentence: string } | null;
  impediments: {
    /** Raised during the sprint. */
    raised: number;
    /** Of those, resolved by its last day. */
    resolvedInSprint: number;
    /** Still in the way today, of those raised during the sprint. */
    stillOpen: number;
    escalated: number;
  };
  mood: {
    /** Mean score (1–5), quoted from MIN_SAMPLE.average check-ins; else null. */
    average: number | null;
    checkIns: number;
    people: number;
  };
  /** How the previous retro's actions turned out; null when there is none. */
  followThrough: RetroFollowThrough | null;
  /** Kudos given during the sprint, oldest first (example kudos left out). */
  kudos: Pick<Kudos, "id" | "toName" | "fromName" | "message" | "sentAt">[];
}

export interface RetroFactsInput {
  sprint: Sprint;
  sprints: readonly Sprint[];
  stories: readonly Story[];
  goals?: readonly SprintGoal[];
  impediments?: readonly Impediment[];
  moodEntries?: readonly MoodEntry[];
  retroBoards?: readonly RetroBoard[];
  kudos?: readonly Kudos[];
  /** "YYYY-MM-DD", local. */
  today: string;
  targetDone?: (link: HandoffLink) => boolean;
}

/** A done share at or above this, in the sprint's last third, reads as a late finish. */
export const LATE_SHARE = 0.6;

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The burndown's shape from when the sprint's stories were done: "late"
 * when most done points landed in the sprint's last third (a hockey stick),
 * "steady" otherwise, "none" when nothing was done. Stories done after the
 * last day count on it; a story with no done date counts as late.
 */
export function burndownShape(
  sprint: Pick<Sprint, "id" | "startDate" | "endDate">,
  stories: readonly Story[]
): RetroFacts["burndown"] {
  const planned = stories.filter((s) => s.sprintId === sprint.id);
  if (!planned.some((s) => storyPoints(s) > 0)) return null;
  const start = dayOf(sprint.startDate);
  const end = dayOf(sprint.endDate);
  const done = planned.filter((s) => s.status === "done" && storyPoints(s) > 0);
  const total = done.reduce((sum, s) => sum + storyPoints(s), 0);
  if (total === 0) {
    return { shape: "none", lateShare: null, sentence: "No pointed story was finished." };
  }
  if (!start || !end || end < start) return null;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const lastThird = startMs + ((endMs - startMs) * 2) / 3;
  let late = 0;
  for (const s of done) {
    // The one day-a-story-was-done rule: `doneAt`, else its last move into done.
    const day = doneOn(s);
    const t = day ? Date.parse(`${day}T00:00:00Z`) : NaN;
    if (!Number.isFinite(t) || t >= lastThird) late += storyPoints(s);
  }
  const lateShare = late / total;
  return lateShare >= LATE_SHARE
    ? {
        shape: "late",
        lateShare,
        sentence: `Most of the done points (${pct(lateShare)}) landed in the sprint's last third.`,
      }
    : {
        shape: "steady",
        lateShare,
        sentence: `Points were finished through the sprint (${pct(lateShare)} in its last third).`,
      };
}

const inWindow = (day: string | null, start: string, end: string) =>
  Boolean(day && day >= start && day <= end);

export function retroFacts(input: RetroFactsInput): RetroFacts {
  const { sprint, today } = input;
  const review = reviewFacts(sprint, input.stories, input.goals);
  const dated = !hasSyntheticDates(sprint);
  const start = dayOf(sprint.startDate) ?? "";
  const end = dayOf(sprint.endDate) ?? "";

  const impediments = { raised: 0, resolvedInSprint: 0, stillOpen: 0, escalated: 0 };
  const mood = { average: null as number | null, checkIns: 0, people: 0 };
  let kudos: RetroFacts["kudos"] = [];

  if (dated) {
    for (const i of input.impediments ?? []) {
      if (isExampleId(i.id) || !inWindow(dayOf(i.raisedAt), start, end)) continue;
      impediments.raised++;
      const resolved = dayOf(i.resolvedAt);
      if (resolved && resolved <= end) impediments.resolvedInSprint++;
      const status = impedimentStatus(i);
      if (status !== "resolved") impediments.stillOpen++;
      if (i.escalatedAt) impediments.escalated++;
    }
    Object.assign(mood, moodDuring(input.moodEntries, start, end));
    kudos = (input.kudos ?? [])
      .filter((k) => !isExampleId(k.id) && inWindow(localDay(k.sentAt), start, end))
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
      .map(({ id, toName, fromName, message, sentAt }) => ({
        id,
        toName,
        fromName,
        message,
        sentAt,
      }));
  }

  // The previous retro: the newest archived one that isn't this sprint's,
  // archived before this sprint's retro window closes (or today).
  const boards = input.retroBoards ?? [];
  const window = retroWindow(sprint);
  const limit = window?.end ?? today;
  const mine = new Set(
    boards
      .filter((b) => b.archivedAt && isArchivedRetroOf(b, sprint, input.sprints))
      .map((b) => b.id)
  );
  const previous = followThroughByRetro(boards, { targetDone: input.targetDone })
    .filter((f) => !mine.has(f.boardId) && (localDay(f.archivedAt) ?? "") <= limit)
    .at(-1);

  return {
    sprintId: sprint.id,
    sprintName: sprint.name,
    dated,
    goal: review.goal,
    goalOutcome: review.goalOutcome,
    committed: review.committed,
    completed: review.completed,
    fromStories: review.fromStories,
    sayDo: review.sayDo,
    burndown: burndownShape(sprint, input.stories),
    impediments,
    mood,
    followThrough: previous ?? null,
    kudos,
  };
}
