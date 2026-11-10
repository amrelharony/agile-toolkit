/**
 * Sprint Planning's reading of the workspace: which stories are in the
 * sprint, which were left over by a closed sprint, which backlog items could
 * be imported, the priority score used to order the backlog, the capacity
 * forecast, what the last retro and the impediments log leave to plan in,
 * and the warnings shown before committing. Pure.
 */

import type {
  BacklogItem,
  CapacityPlan,
  Impediment,
  PrioritizationItem,
  Sprint,
  Story,
} from "@/lib/stores/workspace-types";
import { IMPEDIMENT_SEVERITY_LABEL, daysOverdue, impedimentAgeDays } from "@/lib/impediments/model";
import type { RetroAction } from "@/lib/retro/actions";
import type { Improvements, StoryPlace } from "@/lib/retro/improvement";
import {
  BACKLOG_SOURCE_TOOL,
  backlogByPriority,
  backlogItemRank,
  compareBacklogOrder,
  selectStoriesForCapacity,
  storyPoints,
  totalStoryPoints,
  withLiveBacklogRank,
  type CapacitySelection,
} from "@/lib/sprints/plan";
import { carryOver } from "@/lib/sprints/progress";
import { evaluateItemIn } from "@/lib/prioritization/methods";
import { decidedOrder } from "@/lib/prioritization/rank";
import { sprintsNewestFirst } from "@/lib/sprints/series";
import { findCapacityPlan, planCapacity } from "@/lib/sprints/capacity";
import { hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { capacityForecast, countedPlan, isExampleOnly } from "@/app/(tools)/capacity-planner/model";
import { listAnd } from "@/lib/charts/chart-text";
import { storyNotes } from "@/lib/stories/fields";
import { parseNumber, type Validation } from "@/lib/utils/form";
import { pastedLines } from "@/lib/utils/paste-lines";

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
 * value + time criticality + risk reduction, over job size), from the
 * method registry, so it is the number the Prioritizer, the WSJF tool and
 * the agent show for the item. Null when the item isn't WSJF-scored. A
 * story keeps the score it was imported with (to 2 decimal places, as the
 * board shows it). With the workspace's method `rows`, a WSJF row linked
 * before Phase 7 scores the item where its old defaults hide the parts
 * (methods withLegacyLinks), as the Prioritizer and the WSJF tool read it.
 */
export function priorityScore(
  item: BacklogItem,
  rows: readonly PrioritizationItem[] = []
): number | null {
  return evaluateItemIn(item, rows, "wsjf").score;
}

/** Stories planned into `sprintId`, done last so the open work reads first. */
export function sprintStories(stories: readonly Story[], sprintId: string): Story[] {
  const inSprint = stories.filter((s) => s.sprintId === sprintId);
  const rank = (s: Story) => (s.status === "done" ? 1 : 0);
  return inSprint.slice().sort((a, b) => rank(a) - rank(b));
}

/**
 * Stories not in any sprint, in the shared backlog order: the decided rank
 * their backlog item holds now (`withLiveBacklogRank`, so a later Decide
 * order reorders stories pulled earlier), then priority score, highest
 * first (unscored last).
 */
export function backlogStories(
  stories: readonly Story[],
  backlogItems?: readonly BacklogItem[]
): Story[] {
  return withLiveBacklogRank(
    stories.filter((s) => !s.sprintId && s.status === "backlog"),
    backlogItems
  ).sort(compareBacklogOrder);
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

/* ── From the last retro ─────────────────────────────────────────────── */

export {
  improvementsFor,
  type Improvements,
  type PlannedAction,
  type PlannedImpediment,
  type StoryPlace,
} from "@/lib/retro/improvement";

/** Whether the panel has anything to list: an open action, an open impediment. */
export function hasImprovements(i: Improvements): boolean {
  return i.actions.length > 0 || i.impediments.length > 0 || i.earlierOpen > 0;
}

/**
 * The panel's heading: "From the last retro" and "2 open actions, 1 open
 * impediment". A team that has never agreed a retro action has no last
 * retro to name, so its open impediments are headed by where they do come
 * from.
 */
export function improvementsHeading(
  i: Pick<Improvements, "actions" | "impediments" | "retroLabel">
): { lead: string; counts: string } {
  const blockers = plural(i.impediments.length, "open impediment");
  return i.retroLabel === undefined
    ? { lead: "From the impediments log", counts: blockers }
    : {
        lead: "From the last retro",
        counts: `${plural(i.actions.length, "open action")}, ${blockers}`,
      };
}

/**
 * What "Add to this sprint" does for a row, from where its story is: make a
 * new story ("new"), move the one waiting in the backlog in ("move"), or
 * nothing (null: it is planned already). A story that is done no longer
 * stands for the row, so a new one can be made, unless it was done in this
 * very sprint.
 */
export function addMode(place: StoryPlace): "new" | "move" | null {
  if (place.where === "none") return "new";
  if (place.story.status === "done") return place.where === "sprint" ? null : "new";
  return place.where === "backlog" ? "move" : null;
}

/** Where a row's story is, in words; null when it has none. */
export function placeText(place: StoryPlace): string | null {
  if (place.where === "none") return null;
  const done = place.story.status === "done";
  if (place.where === "sprint") return done ? "Done in this sprint" : "In this sprint";
  if (place.where === "backlog") return done ? "Its story is done" : "Its story is in the backlog";
  const name = place.sprintName ?? "another sprint";
  return done ? `Its story was done in ${name}` : `In ${name}`;
}

/** "30 Oct": a due date, short. The raw text when it isn't a date. */
function shortDay(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T12:00:00`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : day;
}

/** "Sam · due 30 Oct", or "No owner": who has a retro action, and by when. */
export function actionMeta(action: Pick<RetroAction, "assignee" | "dueDate">): string {
  const owner = action.assignee.trim() || "No owner";
  return action.dueDate ? `${owner} · due ${shortDay(action.dueDate)}` : owner;
}

/** "High · open 6 days · Bo": how bad an impediment is, how old, and who has it. */
export function impedimentMeta(impediment: Impediment, today: string): string {
  const age = impedimentAgeDays(impediment, today);
  const parts = [
    IMPEDIMENT_SEVERITY_LABEL[impediment.severity] ?? impediment.severity,
    age === null ? "" : age === 0 ? "raised today" : `open ${plural(age, "day")}`,
    impediment.owner?.trim() ?? "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Whether an impediment is past the day it should be gone by. */
export const impedimentOverdue = (impediment: Impediment, today: string) =>
  daysOverdue(impediment, today) > 0;

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

/* ── Paste stories ───────────────────────────────────────────────────── */

/** Most stories one paste adds here. The other tools' add boxes keep 30. */
export const PASTE_STORIES_CAP = 200;

/** A story title's limit, as in the add form. */
const STORY_TITLE_CAP = 200;

export interface PastedStories {
  /** The titles to add, one per pasted line, in the pasted order. */
  titles: string[];
  /** Non-empty lines left out because of the cap. */
  dropped: number;
  /** Titles cut to the 200-character limit. */
  cut: number;
}

/**
 * A pasted list as story titles: one per non-empty line, list markers
 * ("- ", "1. ") removed, at most `cap` lines, each title cut to 200
 * characters like a typed one.
 */
export function pastedStories(text: string, cap: number = PASTE_STORIES_CAP): PastedStories {
  const { lines, dropped } = pastedLines(text, cap);
  const whole = lines.map((line) => line.replace(/\s+/g, " "));
  return {
    titles: whole.map((title) => title.slice(0, STORY_TITLE_CAP).trimEnd()),
    dropped,
    cut: whole.filter((title) => title.length > STORY_TITLE_CAP).length,
  };
}

export interface PasteDraft {
  text: string;
  /** Plan them into the sprint, instead of leaving them in the backlog. */
  intoSprint: boolean;
}

export type PasteField = "text";
export interface PasteValues extends PastedStories {
  intoSprint: boolean;
}

/** A paste needs at least one title. */
export function validatePaste(d: PasteDraft): Validation<PasteValues, PasteField> {
  const pasted = pastedStories(d.text);
  if (pasted.titles.length === 0) {
    return { ok: false, errors: { text: "Paste or type at least one story title, one per line." } };
  }
  return { ok: true, values: { ...pasted, intoSprint: d.intoSprint } };
}

/**
 * What a paste will do, said under the box while the list is typed: how
 * many stories, and what the caps leave out. "" for an empty box.
 */
export function pasteSummary(pasted: PastedStories): string {
  if (pasted.titles.length === 0) return "";
  const parts = [`${storiesCount(pasted.titles.length)} to add.`];
  if (pasted.dropped > 0) {
    parts.push(
      `${pasted.dropped} more ${pasted.dropped === 1 ? "line is" : "lines are"} over the limit of ${PASTE_STORIES_CAP} and will be left out.`
    );
  }
  if (pasted.cut > 0) {
    parts.push(
      `${pasted.cut} ${pasted.cut === 1 ? "title is" : "titles are"} longer than ${STORY_TITLE_CAP} characters and will be cut.`
    );
  }
  return parts.join(" ");
}

/** Where a story pulled from the backlog came from. */
export { BACKLOG_SOURCE_TOOL };

/**
 * Backlog items with no story yet (none pulled from them, none of the same
 * name), in the backlog's decided order: ranked items by rank, then the
 * ones not ordered yet in stored order.
 */
export function importCandidates(
  backlogItems: readonly BacklogItem[],
  stories: readonly Story[]
): BacklogItem[] {
  const taken = new Set(stories.map((s) => nameKey(s.title)));
  const pulled = new Set(
    stories.filter((s) => s.sourceRef?.tool === BACKLOG_SOURCE_TOOL).map((s) => s.sourceRef?.id)
  );
  return decidedOrder(backlogItems).filter(
    (b) => b.name.trim() && !taken.has(nameKey(b.name)) && !pulled.has(b.id)
  );
}

/**
 * A story from a backlog item: its name, its description as the story's
 * notes, the shared priority score (left off when the item isn't
 * WSJF-scored), the decided rank it was pulled in with (read live while the
 * item exists: `withLiveBacklogRank`) and a link back to the item. `rows` as
 * priorityScore.
 */
export function storyFromBacklogItem(
  item: BacklogItem,
  id: string,
  rows: readonly PrioritizationItem[] = []
): Story {
  const score = priorityScore(item, rows);
  const story: Story = {
    id,
    title: item.name.trim().slice(0, 200),
    status: "backlog",
    sourceRef: { tool: BACKLOG_SOURCE_TOOL, id: item.id },
  };
  const notes = storyNotes(item.description);
  if (notes) story.notes = notes;
  if (score !== null) story.priorityScore = Math.round(score * 100) / 100;
  const rank = backlogItemRank(item);
  if (rank !== undefined) story.backlogRank = rank;
  return story;
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
