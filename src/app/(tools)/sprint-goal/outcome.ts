import type { Sprint, SprintGoal, SprintGoalOutcome } from "@/lib/stores/workspace-types";
import { GOAL_OUTCOMES, GOAL_OUTCOME_LABEL } from "@/lib/sprints/goal-doc";
import { isoDayNumber } from "@/lib/sprints/calendar";
import { hasSyntheticDates, todayIso } from "@/lib/sprints/series";
import type { Validation } from "@/lib/utils/form";

/**
 * "Did we meet the sprint goal?": the team's answer once the sprint is
 * over, kept on the sprint's goal document (`SprintGoal.outcome`) where the
 * tool.sprint_goal.record_outcome agent verb writes it too, so the Sprint
 * Review can read one answer whoever recorded it. Pure.
 */

export { GOAL_OUTCOMES, GOAL_OUTCOME_LABEL };

export type GoalMet = SprintGoalOutcome["met"];

/** The longest note kept with an answer (the agent verb's limit). */
export const OUTCOME_NOTE_MAX = 2000;

/** What each answer means: the option's tooltip and accessible description. */
export const GOAL_OUTCOME_MEANING: Record<GoalMet, string> = {
  met: "The outcome the goal promised was delivered.",
  partly: "Some of the goal's outcome was delivered, not all of it.",
  "not-met": "The goal's outcome wasn't delivered.",
};

/** Why the tool asks now: the sprint's last day, after it, or a cancelled sprint. */
export type OutcomeMoment = "last-day" | "ended" | "cancelled";

/**
 * Whether it's time to ask "Did we meet the sprint goal?" on `today`, and
 * why; null while the sprint still runs (or hasn't started). A completed or
 * cancelled sprint is over whatever its dates say. Placeholder dates (old
 * sprints saved without real ones) say nothing, so only the status counts.
 */
export function outcomeMoment(
  sprint: Pick<Sprint, "status" | "startDate" | "endDate">,
  today: string = todayIso()
): OutcomeMoment | null {
  if (sprint.status === "cancelled") return "cancelled";
  if (sprint.status === "completed") return "ended";
  if (hasSyntheticDates(sprint)) return null;
  const end = isoDayNumber(sprint.endDate);
  const now = isoDayNumber(today);
  if (end === null || now === null || now < end) return null;
  return now === end ? "last-day" : "ended";
}

export function isGoalMet(value: unknown): value is GoalMet {
  return (GOAL_OUTCOMES as readonly unknown[]).includes(value);
}

/**
 * A stored answer in shape, or undefined when it can't be read (no answer,
 * or one outside met / partly / not-met, say from an import): the page and
 * the Review never show a label that doesn't exist.
 */
export function normalizeOutcome(raw: unknown): SprintGoalOutcome | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { met, note, decidedAt, ...rest } = raw as Record<string, unknown>;
  if (!isGoalMet(met)) return undefined;
  return {
    ...rest,
    met,
    ...(typeof note === "string" && note.trim() ? { note } : {}),
    decidedAt: typeof decidedAt === "string" ? decidedAt : "",
  };
}

// ─── The form ───────────────────────────────────────────────────────────────

export interface OutcomeDraft {
  /** Null until the user picks: there is no default answer. */
  met: GoalMet | null;
  note: string;
}

export interface OutcomeValues {
  met: GoalMet;
  note?: string;
}

export const EMPTY_OUTCOME_DRAFT: OutcomeDraft = { met: null, note: "" };

/** The answer is required, the note optional and capped like the agent verb's. */
export function validateOutcome(
  draft: OutcomeDraft
): Validation<OutcomeValues, keyof OutcomeDraft> {
  const errors: Partial<Record<keyof OutcomeDraft, string>> = {};
  const note = draft.note.trim();
  if (!draft.met) errors.met = "Pick whether the sprint met its goal.";
  if (note.length > OUTCOME_NOTE_MAX) {
    errors.note = `Keep the note to ${OUTCOME_NOTE_MAX} characters or fewer.`;
  }
  if (!draft.met || errors.note) return { ok: false, errors };
  return { ok: true, values: { met: draft.met, ...(note ? { note } : {}) } };
}

/** The draft that "Change" starts from: the recorded answer. */
export function draftFromOutcome(outcome: SprintGoalOutcome): OutcomeDraft {
  return { met: outcome.met, note: outcome.note ?? "" };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/** `doc` with `values` as its answer, dated `now`. Replaces an earlier answer. */
export function withOutcome(doc: SprintGoal, values: OutcomeValues, now = new Date()): SprintGoal {
  const outcome: SprintGoalOutcome = {
    met: values.met,
    ...(values.note ? { note: values.note } : {}),
    decidedAt: now.toISOString(),
  };
  return { ...doc, outcome };
}

/** `doc` without an answer, or with `previous` put back (Undo). */
export function withoutOutcome(doc: SprintGoal, previous?: SprintGoalOutcome): SprintGoal {
  const next = { ...doc };
  delete next.outcome;
  return previous ? { ...next, outcome: previous } : next;
}

// ─── Words ──────────────────────────────────────────────────────────────────

/** "Sprint 2 partly met its goal", without the full stop. */
export function outcomeClause(met: GoalMet, sprintName?: string): string {
  const who = sprintName?.trim() || "The sprint";
  if (met === "met") return `${who} met its goal`;
  if (met === "partly") return `${who} partly met its goal`;
  return `${who} didn't meet its goal`;
}

/** "23 Oct 2026" for when the answer was recorded, or null when it has no usable date. */
export function outcomeDate(outcome: Pick<SprintGoalOutcome, "decidedAt">): string | null {
  const t = Date.parse(outcome.decidedAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Why the question is on screen, under it. */
export function outcomePrompt(moment: OutcomeMoment | null, sprintName: string): string {
  if (moment === "last-day") {
    return `${sprintName} ends today. Once the team has looked at the goal, record its answer here.`;
  }
  if (moment === "cancelled") {
    return `${sprintName} was cancelled. Record how much of its goal the team delivered.`;
  }
  return `${sprintName} is over. Record the team's answer while it's fresh.`;
}
