/**
 * Sprint Planning's reading of the workspace: which stories are in the
 * sprint, which were left over by a closed sprint, which backlog items could
 * be imported, the priority score used to order the backlog, the capacity
 * forecast, and the warnings shown before committing. Pure.
 */

import type { BacklogItem, CapacityPlan, Sprint, Story } from "@/lib/stores/workspace-types";
import {
  backlogByPriority,
  selectStoriesForCapacity,
  storyPoints,
  totalStoryPoints,
  type CapacitySelection,
} from "@/lib/sprints/plan";
import { carryOver } from "@/lib/sprints/progress";
import { withBacklogDefaults } from "@/lib/prioritization/frameworks";
import { sprintsNewestFirst } from "@/lib/sprints/series";
import { findCapacityPlan, planCapacity } from "@/lib/sprints/capacity";
import { hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { capacityForecast, countedPlan, isExampleOnly } from "@/app/(tools)/capacity-planner/model";
import { listAnd } from "@/lib/charts/chart-text";
import { parseNumber, type Validation } from "@/lib/utils/form";

/** Trimmed, case-insensitive, single-spaced: how two names count as the same story. */
export const nameKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** A number for display: whole numbers as is, others to one decimal. */
export function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1 story", "3 stories" */
export const storiesCount = (n: number) => plural(n, "story", "stories");

/** "1 point", "2.5 points" */
export const pointsCount = (n: number) => `${fmt(n)} ${n === 1 ? "point" : "points"}`;

/**
 * One priority number from the shared backlog's inputs: WSJF (business
 * value + time criticality + risk reduction, over job size). It is the
 * Scrum-side ordering of the Prioritizer's backlog; a story keeps the score
 * it was imported with.
 */
export function priorityScore(stored: BacklogItem): number {
  // Phase 7 engine replaces this: a missing part reads as its old default.
  const item = withBacklogDefaults(stored);
  const cod = item.businessValue + item.timeCriticality + item.riskReduction;
  const size = item.jobSize > 0 ? item.jobSize : 1;
  return Math.round((cod / size) * 100) / 100;
}

/** Stories planned into `sprintId`, done last so the open work reads first. */
export function sprintStories(stories: readonly Story[], sprintId: string): Story[] {
  const inSprint = stories.filter((s) => s.sprintId === sprintId);
  const rank = (s: Story) => (s.status === "done" ? 1 : 0);
  return inSprint.slice().sort((a, b) => rank(a) - rank(b));
}

/** Stories not in any sprint, highest priority first (unscored last). */
export function backlogStories(stories: readonly Story[]): Story[] {
  return stories
    .filter((s) => !s.sprintId && s.status === "backlog")
    .slice()
    .sort((a, b) => (b.priorityScore ?? -Infinity) - (a.priorityScore ?? -Infinity));
}

/* ── Left over from a closed sprint ──────────────────────────────────── */

/** A sprint that is over: its unfinished stories wait to be carried over. */
export function isClosed(sprint: Pick<Sprint, "status">): boolean {
  return sprint.status === "completed" || sprint.status === "cancelled";
}

export interface LeftoverGroup {
  sprint: Sprint;
  /** The closed sprint's stories that aren't done, in stored order. */
  stories: Story[];
  points: number;
}

/**
 * What closed sprints left unfinished. Closing a sprint leaves its open
 * stories pointing at it, so they showed in neither the sprint being
 * planned nor the backlog; here each closed sprint with open stories gets
 * a group, newest first, until they are carried over or sent back. The
 * sprint being planned is never its own leftover.
 */
export function leftoverGroups(
  sprints: readonly Sprint[],
  stories: readonly Story[],
  planningId?: string
): LeftoverGroup[] {
  return sprintsNewestFirst(sprints)
    .filter((s) => isClosed(s) && s.id !== planningId)
    .map((sprint) => ({ sprint, ...carryOver(sprint, stories) }))
    .filter((g) => g.stories.length > 0);
}

/** "Carry over 2 stories (8 points)" */
export function carryOverLabel(group: Pick<LeftoverGroup, "stories" | "points">): string {
  return `Carry over ${storiesCount(group.stories.length)} (${pointsCount(group.points)})`;
}

/* ── Fill to capacity ────────────────────────────────────────────────── */

export interface FillPlan extends CapacitySelection {
  /** Sized stories that didn't fit in what was left when their turn came. */
  tooBig: Story[];
  /** Stories with no points: they can't be weighed against a capacity. */
  unestimated: Story[];
}

/**
 * "Fill to capacity" over the backlog: the shared greedy pick
 * (`selectStoriesForCapacity`), plus the stories it passed over and why, so
 * the toast can name them instead of leaving the user to guess.
 */
export function planFill(backlog: readonly Story[], room: number): FillPlan {
  const selection = selectStoriesForCapacity(backlog, room);
  const picked = new Set(selection.selected.map((s) => s.id));
  const rest = backlogByPriority(backlog).filter((s) => !picked.has(s.id));
  return {
    ...selection,
    tooBig: rest.filter((s) => storyPoints(s) > 0),
    unestimated: rest.filter((s) => storyPoints(s) <= 0),
  };
}

const shortTitle = (t: string, max = 40) => {
  const s = t.trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/** Up to three titles, then "and N more". */
function named(stories: readonly Story[], withPoints: boolean): string {
  const shown = stories.slice(0, 3).map((s) => {
    const title = `“${shortTitle(s.title)}”`;
    return withPoints ? `${title} (${fmt(storyPoints(s))})` : title;
  });
  const more = stories.length - shown.length;
  return listAnd(more > 0 ? [...shown, `${more} more`] : shown);
}

/** "Too big for the points left: “Apple Pay” (13). Not estimated: “Fraud checks”." */
export function skippedText(fill: Pick<FillPlan, "tooBig" | "unestimated">): string | undefined {
  const parts: string[] = [];
  if (fill.tooBig.length > 0) {
    parts.push(`Too big for the points left: ${named(fill.tooBig, true)}.`);
  }
  if (fill.unestimated.length > 0) {
    parts.push(`Not estimated: ${named(fill.unestimated, false)}.`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/* ── Capacity forecast ───────────────────────────────────────────────── */

export interface CapacityRead {
  /** The plan the sprint uses: its own, else the general fallback. */
  plan?: CapacityPlan;
  /** True when it is the sprint's own plan (not the general fallback). */
  perSprint: boolean;
  /** Effective hours, or null when there is no plan with people in it. */
  hours: number | null;
  people: number;
  /** This sprint's hours as a share of a normal sprint. */
  ratio: number | null;
  /** Velocity scaled by that share; null without both. */
  points: number | null;
  /** The plan still holds example members (Capacity Planner's "Load an example"). */
  example: boolean;
}

/**
 * The capacity side of the plan: the sprint's capacity plan (or the general
 * one every team had before plans were per sprint) and the points it
 * suggests, recent velocity scaled by how much of a normal sprint the team
 * has (the Capacity Planner's `capacityForecast`, so both tools say the
 * same). A normal sprint is the team's usual `usualDays`, so a holiday or a
 * short sprint lowers the suggestion. The counting is the planner's too: a
 * blank row is nobody, and a plan holding only the example team ("Load an
 * example") doesn't plan a real sprint: a sprint's own is passed over for
 * the general plan, and an example-only general plan counts as none.
 */
export function readCapacity(
  plans: readonly CapacityPlan[] | undefined,
  sprintId: string,
  velocity: number | null,
  usualDays?: number
): CapacityRead {
  const usable = isExampleId(sprintId) ? plans : plans?.filter((p) => !isExampleOnly(p));
  const found = findCapacityPlan(usable, sprintId);
  const plan = found?.plan;
  const counted = plan ? countedPlan(plan) : undefined;
  const people = counted?.members.length ?? 0;
  const forecast = capacityForecast(counted, velocity, usualDays);
  return {
    plan,
    perSprint: found?.perSprint ?? false,
    hours: counted && people > 0 ? planCapacity(counted).totalHours : null,
    people,
    ratio: forecast.ratio,
    points: forecast.points,
    example: hasExampleItems(plan?.members),
  };
}

/** The points to suggest: the capacity forecast, else plain velocity, else none. */
export function suggestedPoints(read: CapacityRead, velocity: number | null): number | null {
  return read.points ?? velocity;
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/**
 * The capacity verdict in one sentence, always comparing points with
 * points: "Capacity is 90% of a normal sprint, so plan about 27 points."
 * Says plainly when there is no capacity plan or no velocity to go on.
 */
export function forecastText(read: CapacityRead, velocity: number | null): string {
  if (read.ratio === null) {
    const why = !read.plan
      ? "There's no capacity plan for this sprint"
      : read.people === 0
        ? "The capacity plan has nobody in it yet"
        : "The capacity plan's settings leave no working hours";
    return velocity === null
      ? `${why}, and no finished sprint has points yet. Type the points to commit to.`
      : `${why}, so the suggestion is plain velocity: about ${pointsCount(velocity)}.`;
  }
  if (read.ratio === 0) {
    return "Nobody is available this sprint (0% of a normal sprint), so there is no room to plan.";
  }
  if (velocity === null) {
    return `Capacity is ${pct(read.ratio)} of a normal sprint, but no finished sprint has points yet, so there's no velocity to scale. Type the points to commit to.`;
  }
  return `Capacity is ${pct(read.ratio)} of a normal sprint, so plan about ${pointsCount(
    read.points ?? 0
  )} (velocity ${fmt(velocity)} × ${pct(read.ratio)}).`;
}

/* ── Typed points ────────────────────────────────────────────────────── */

/**
 * Why a typed "Commit to" can't be used, or undefined. Blank is fine (the
 * suggestion is used); anything else must be a number, 0 or more, and says
 * so instead of quietly dropping the comparison. `badInput` is the field's
 * own verdict: a number field reports "3e" or "-" as blank.
 */
export function targetError(raw: string, badInput = false): string | undefined {
  const fix = "Leave it blank to use the suggestion.";
  if (badInput) return `Points are a number. ${fix}`;
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? undefined : `Points are 0 or more. ${fix}`;
}

/**
 * A story's points as typed in its row: blank clears them (not sized yet),
 * a number 0 or more is kept, and anything else is an error that names what
 * still counts, never a silent revert or a silent clear.
 */
export function checkStoryPoints(
  raw: string,
  saved: number,
  badInput = false
): { ok: true; points: number | undefined } | { ok: false; error: string } {
  const still = saved > 0 ? `Still counting ${pointsCount(saved)}.` : "Still not sized.";
  if (badInput) return { ok: false, error: `Points are a number. ${still}` };
  const t = raw.trim();
  if (t === "") return { ok: true, points: undefined };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `Points are 0 or more. ${still}` };
  return { ok: true, points: n };
}

/* ── Readiness ───────────────────────────────────────────────────────── */

/** Ready by the team's Definition of Ready (as last checked in Refinement). */
export const isReady = (story: Pick<Story, "readiness">) => story.readiness?.ready === true;

/** Whether the team checks readiness at all: any story has been through Refinement. */
export const usesReadiness = (stories: readonly Story[]) => stories.some((s) => s.readiness);

/* ── The add-story form ──────────────────────────────────────────────── */

export interface StoryDraft {
  title: string;
  /** As typed: blank means "not sized yet". */
  points: string;
}

export type StoryField = keyof StoryDraft;
export interface StoryValues {
  title: string;
  points?: number;
}

export const EMPTY_STORY_DRAFT: StoryDraft = { title: "", points: "" };

/** A title is required; points are optional, but a typed value must be a number, 0 or more. */
export function validateStory(d: StoryDraft): Validation<StoryValues, StoryField> {
  const errors: Partial<Record<StoryField, string>> = {};
  const title = d.title.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!title) errors.title = "Enter the story's title.";
  const points = parseNumber(d.points);
  if (points !== undefined && (!Number.isFinite(points) || points < 0)) {
    errors.points = "Points are a number, 0 or more. Leave it blank if it isn't sized yet.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: points === undefined ? { title } : { title, points } };
}

/** Backlog items with no story of the same name yet, in Prioritizer order. */
export function importCandidates(
  backlogItems: readonly BacklogItem[],
  stories: readonly Story[]
): BacklogItem[] {
  const taken = new Set(stories.map((s) => nameKey(s.title)));
  return backlogItems.filter((b) => b.name.trim() && !taken.has(nameKey(b.name)));
}

/** A story from a backlog item: its name, with the shared priority score. */
export function storyFromBacklogItem(item: BacklogItem, id: string): Story {
  return {
    id,
    title: item.name.trim().slice(0, 200),
    status: "backlog",
    priorityScore: priorityScore(item),
  };
}

/* ── Warnings ────────────────────────────────────────────────────────── */

export interface PlanWarning {
  id: "no-goal" | "over-capacity" | "unestimated" | "empty" | "another-active" | "not-ready";
  text: string;
}

export interface PlanCheckInput {
  sprint: Sprint;
  stories: readonly Story[];
  /** Points the team means to commit to (typed, or the suggestion). */
  targetPoints: number | null;
  otherActive: readonly Sprint[];
  /** Flag open stories that aren't ready (only for teams that check readiness). */
  checkReadiness?: boolean;
}

/** What to look at before starting the sprint, in the order shown. */
export function planWarnings(input: PlanCheckInput): PlanWarning[] {
  const { sprint, stories, targetPoints, otherActive, checkReadiness = false } = input;
  const out: PlanWarning[] = [];
  const total = totalStoryPoints(stories);
  const unestimated = stories.filter((s) => storyPoints(s) <= 0).length;
  if (stories.length === 0) {
    out.push({ id: "empty", text: "No stories are planned into this sprint yet." });
  }
  if (!sprint.goal?.trim()) {
    out.push({
      id: "no-goal",
      text: "The sprint has no goal yet. Teams commit to a goal, not a list.",
    });
  }
  if (targetPoints !== null && targetPoints > 0 && total > targetPoints * 1.1) {
    out.push({
      id: "over-capacity",
      text: `${total} points planned against a capacity of ${targetPoints}: more than 10% over.`,
    });
  }
  if (unestimated > 0) {
    out.push({
      id: "unestimated",
      text: `${unestimated} ${unestimated === 1 ? "story has" : "stories have"} no points, so the commitment can't be weighed.`,
    });
  }
  if (checkReadiness) {
    const notReady = stories.filter((s) => s.status !== "done" && !isReady(s)).length;
    if (notReady > 0) {
      out.push({
        id: "not-ready",
        text: `${notReady} ${notReady === 1 ? "story isn't" : "stories aren't"} refined yet: check ${notReady === 1 ? "it" : "them"} against the Definition of Ready before committing.`,
      });
    }
  }
  if (otherActive.length > 0) {
    out.push({
      id: "another-active",
      text: `${otherActive.map((s) => s.name).join(", ")} ${otherActive.length === 1 ? "is" : "are"} still active; starting this one leaves ${otherActive.length === 1 ? "it" : "them"} open.`,
    });
  }
  return out;
}

/** "9 stories · 34 points" */
export function planLine(stories: readonly Story[]): string {
  const n = stories.length;
  return `${n} ${n === 1 ? "story" : "stories"} · ${totalStoryPoints(stories)} points`;
}
