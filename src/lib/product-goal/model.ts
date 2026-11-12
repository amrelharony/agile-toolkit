/**
 * The Product Goal: the one long-term objective a Scrum Team's sprints work
 * towards (`ProductGoal`, one active at a time). One reading for the tool,
 * its agent verbs, the read-only line on Sprint Goal, Sprint Planning and
 * the team charter, and the next steps.
 *
 * At most one goal is "active". Setting a new one closes the active one
 * first, as achieved or abandoned (the person says which), so the record
 * keeps every earlier goal with its outcome. A reader that finds two active
 * goals (synced from two devices) takes the one updated last.
 *
 * Pure; server-safe. Example goals ("example-" ids) are never the team's:
 * `activeGoal` and `goalHistory` leave them out unless asked not to.
 */

import {
  PRODUCT_GOAL_STATUSES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type ProductGoal,
  type ProductGoalStatus,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import type { Validation } from "@/lib/utils/form";

export const GOAL_STATUS_LABEL: Record<ProductGoalStatus, string> = {
  active: "Active",
  achieved: "Achieved",
  abandoned: "Abandoned",
};

/** The two ways a goal is closed. */
export type GoalOutcome = Exclude<ProductGoalStatus, "active">;
export const GOAL_OUTCOMES: readonly GoalOutcome[] = ["achieved", "abandoned"];

const byUpdatedDesc = (a: ProductGoal, b: ProductGoal) =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;

const usable = (goals: readonly ProductGoal[] | undefined, withExamples: boolean) =>
  (goals ?? []).filter(
    (g) =>
      g &&
      typeof g.statement === "string" &&
      PRODUCT_GOAL_STATUSES.includes(g.status) &&
      (withExamples || !isExampleId(g.id))
  );

/**
 * The active goal: the one with status "active", or the latest updated of
 * two (a sync of two devices). Undefined when none is active.
 */
export function activeGoal(
  goals: readonly ProductGoal[] | undefined,
  { withExamples = false }: { withExamples?: boolean } = {}
): ProductGoal | undefined {
  return usable(goals, withExamples)
    .filter((g) => g.status === "active")
    .sort(byUpdatedDesc)[0];
}

/** Every goal that isn't the active one, newest closed first (then latest updated). */
export function goalHistory(
  goals: readonly ProductGoal[] | undefined,
  { withExamples = false }: { withExamples?: boolean } = {}
): ProductGoal[] {
  const active = activeGoal(goals, { withExamples });
  return usable(goals, withExamples)
    .filter((g) => g.id !== active?.id)
    .sort((a, b) => {
      const ca = a.closedAt ?? a.updatedAt;
      const cb = b.closedAt ?? b.updatedAt;
      return ca < cb ? 1 : ca > cb ? -1 : 0;
    });
}

/** Other goals still marked active beside `activeGoal` (a sync of two devices). */
export function extraActiveGoals(goals: readonly ProductGoal[] | undefined): ProductGoal[] {
  const active = activeGoal(goals, { withExamples: true });
  return usable(goals, true).filter((g) => g.status === "active" && g.id !== active?.id);
}

/** One line for another tool's page: the active goal's statement, or null. */
export function productGoalLine(goals: readonly ProductGoal[] | undefined): string | null {
  const goal = activeGoal(goals);
  const text = goal?.statement.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** "by 30 Jun 2027", or "" without a date. */
export function targetText(targetDate: string | undefined): string {
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return "";
  const [y, m, d] = targetDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return "";
  return `by ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}

/** Whole days from `today` to the target date (negative once it has passed), or null. */
export function daysToTarget(targetDate: string | undefined, today: string): number | null {
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const t = Date.parse(`${targetDate}T00:00:00Z`);
  const n = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(t) || Number.isNaN(n)) return null;
  return Math.round((t - n) / 86_400_000);
}

/* ── The check list ─────────────────────────────────────────────────── */

export type GoalCheckId = "outcome" | "measurable" | "single" | "vision";

export interface GoalCheck {
  id: GoalCheckId;
  /** The question, asked so that yes is good. */
  label: string;
  /** What to try when it isn't met. */
  hint: string;
  /**
   * true: it looks met; false: it looks missing; null: only the team can
   * say (no vision written to compare with).
   */
  met: boolean | null;
}

/** Words that start a list of things to build rather than an outcome. */
const OUTPUT_START =
  /^(build|implement|develop|create|add|ship|release|launch|deliver|make|code|migrate|integrate|rewrite|refactor|finish|complete)\b/i;
/** Words that name an outcome for someone. */
const OUTCOME_WORDS =
  /\b(so that|so|customers?|users?|people|teams?|patients?|shoppers?|members?|clients?|can|able|without|faster|fewer|less|more|reduce|increase|grow|halve|double|trust|choose|keep|stay|reach|become|be)\b/i;
/** A number, a percentage or a money amount: something to measure against. */
const MEASURE_HINT = /\d|%|\b(half|double|twice|triple|zero|none|every|all)\b/i;

const STOP_WORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or our so that the their them they this to us we what when where which who will with without you your".split(
    " "
  )
);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
}

/**
 * The check list, in our own words, with a reading of each from the text:
 *   - outcome-shaped: says what changes for someone, not what gets built;
 *   - measurable: has a measure, or a number in it;
 *   - one goal: a single objective, not a list joined by "and" or ";";
 *   - fits the vision: shares words with the product vision when one is
 *     written (otherwise only the team can say).
 * The readings are hints for a conversation, never a score.
 */
export function goalChecks(
  goal: Pick<ProductGoal, "statement" | "measures">,
  vision = ""
): GoalCheck[] {
  const statement = goal.statement.replace(/\s+/g, " ").trim();
  const measures = (goal.measures ?? []).filter((m) => m.trim());
  const outcome =
    statement.length > 0 && !OUTPUT_START.test(statement) && OUTCOME_WORDS.test(statement);
  const measurable = measures.length > 0 || MEASURE_HINT.test(statement);
  const joins = (statement.match(/\band\b|;|\s\+\s|,\s*(?:and\s+)?(?:also|plus)\b/gi) ?? []).length;
  const single = statement.length > 0 && joins <= 1 && statement.split(/[.!?]\s+\S/).length <= 2;
  const visionWords = keywords(vision);
  let fits: boolean | null = null;
  if (visionWords.size > 0 && statement) {
    const words = keywords(statement);
    fits = Array.from(words).some((w) => visionWords.has(w));
  }
  return [
    {
      id: "outcome",
      label: "Is it about an outcome, not a feature list?",
      hint: "Say what changes for customers or the business, such as “shoppers can…”, not what you will build.",
      met: outcome,
    },
    {
      id: "measurable",
      label: "Can you tell when it is reached?",
      hint: "Add a measure or two: a number you can check at each Sprint Review.",
      met: measurable,
    },
    {
      id: "single",
      label: "Is it one goal?",
      hint: "Keep one objective. If it lists several, pick the one that matters most now; the rest wait their turn.",
      met: single,
    },
    {
      id: "vision",
      label: "Does it move the product towards its vision?",
      hint: visionWords.size
        ? "It shares no words with the vision. Check that it is a step towards it."
        : "Write the product vision above to compare, or talk it through with the team.",
      met: fits,
    },
  ];
}

/* ── The form ───────────────────────────────────────────────────────── */

export interface GoalDraft {
  statement: string;
  why: string;
  /** One measure a line. */
  measures: string;
  /** "YYYY-MM-DD" or "". */
  targetDate: string;
}

export type GoalField = keyof GoalDraft;

export interface GoalValues {
  statement: string;
  why?: string;
  measures: string[];
  targetDate?: string;
}

export const EMPTY_GOAL_DRAFT: GoalDraft = { statement: "", why: "", measures: "", targetDate: "" };

export function goalDraftFor(goal: ProductGoal): GoalDraft {
  return {
    statement: goal.statement,
    why: goal.why ?? "",
    measures: (goal.measures ?? []).join("\n"),
    targetDate: goal.targetDate ?? "",
  };
}

/** The measures as typed: one a line, blanks dropped. */
export function measureLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*[-*•]\s*/, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

const tooLong = (what: string, max: number) =>
  `Keep ${what} to ${max.toLocaleString("en-GB")} characters or fewer.`;

/** A real calendar day as "YYYY-MM-DD". */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * The goal needs its statement; everything else is optional but must fit
 * the caps the agents' schema holds (TOOL_TEXT_MAX, TOOL_LIST_MAX), so a
 * goal saved here is always one an agent can update.
 */
export function validateGoalDraft(draft: GoalDraft): Validation<GoalValues, GoalField> {
  const errors: Partial<Record<GoalField, string>> = {};
  const statement = draft.statement.replace(/\s+/g, " ").trim();
  const why = draft.why.replace(/\r\n?/g, "\n").trim();
  const measures = measureLines(draft.measures);
  const targetDate = draft.targetDate.trim();
  if (!statement) errors.statement = "Write the goal: one sentence about the outcome.";
  else if (statement.length > TOOL_TEXT_MAX.text) {
    errors.statement = tooLong("the goal", TOOL_TEXT_MAX.text);
  }
  if (why.length > TOOL_TEXT_MAX.text) errors.why = tooLong("why it matters", TOOL_TEXT_MAX.text);
  if (measures.length > TOOL_LIST_MAX.measures) {
    errors.measures = `Keep it to ${TOOL_LIST_MAX.measures} measures or fewer.`;
  } else if (measures.some((m) => m.length > TOOL_TEXT_MAX.short)) {
    errors.measures = `Keep each measure to ${TOOL_TEXT_MAX.short} characters or fewer.`;
  }
  if (targetDate && !isIsoDay(targetDate)) errors.targetDate = "Pick a day, or leave it empty.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      statement,
      ...(why ? { why } : {}),
      measures,
      ...(targetDate ? { targetDate } : {}),
    },
  };
}

/** A closing note as typed, checked: optional, within TOOL_TEXT_MAX.text. */
export function validateNote(note: string): Validation<string | undefined, "note"> {
  const text = note.replace(/\r\n?/g, "\n").trim();
  if (text.length > TOOL_TEXT_MAX.text) {
    return { ok: false, errors: { note: tooLong("the note", TOOL_TEXT_MAX.text) } };
  }
  return { ok: true, values: text || undefined };
}

/* ── Writes, as plain data ──────────────────────────────────────────── */

/** A new active goal from the form's values, stamped `now` (an ISO time). */
export function newGoal(id: string, values: GoalValues, now: string): ProductGoal {
  return {
    id,
    statement: values.statement,
    ...(values.why ? { why: values.why } : {}),
    measures: values.measures,
    ...(values.targetDate ? { targetDate: values.targetDate } : {}),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

/** `goal` with the form's values, updatedAt `now`; an optional field left blank is removed. */
export function withGoalValues(goal: ProductGoal, values: GoalValues, now: string): ProductGoal {
  const next: ProductGoal = { ...goal, statement: values.statement, measures: values.measures };
  if (values.why) next.why = values.why;
  else delete next.why;
  if (values.targetDate) next.targetDate = values.targetDate;
  else delete next.targetDate;
  next.updatedAt = now;
  return next;
}

/** `goal` closed as `outcome` at `now`, with an optional note. */
export function closedGoal(
  goal: ProductGoal,
  outcome: GoalOutcome,
  now: string,
  note?: string
): ProductGoal {
  const next: ProductGoal = { ...goal, status: outcome, closedAt: now, updatedAt: now };
  if (note) next.note = note;
  else delete next.note;
  return next;
}

/** `goal` made active again (its closing date cleared). */
export function reopenedGoal(goal: ProductGoal, now: string): ProductGoal {
  const { closedAt: _closed, ...rest } = goal;
  void _closed;
  return { ...rest, status: "active", updatedAt: now };
}

/**
 * The writes that make `next` the active goal: every other active goal
 * closed as `outcome` first (with `note`), then `next` itself. One list, so
 * a page writes them with one Undo and an agent in one call.
 */
export function activationWrites(
  goals: readonly ProductGoal[] | undefined,
  next: ProductGoal,
  outcome: GoalOutcome,
  now: string,
  note?: string
): ProductGoal[] {
  const closing = usable(goals, true)
    .filter((g) => g.status === "active" && g.id !== next.id)
    .map((g) => closedGoal(g, outcome, now, note));
  return [...closing, { ...next, status: "active" }];
}

/* ── Sprint Goal: which part of the Product Goal it serves ──────────── */

/** The prefix a sprint's business objective carries when it names the Product Goal. */
export const SERVES_PREFIX = "Serves the Product Goal";

/** Whether `objective` already names the Product Goal (by the prefix or its statement). */
export function objectiveNamesGoal(
  objective: string,
  goal: Pick<ProductGoal, "statement">
): boolean {
  const text = objective.toLowerCase();
  const statement = goal.statement.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    text.includes(SERVES_PREFIX.toLowerCase()) || (statement.length > 0 && text.includes(statement))
  );
}

/**
 * The business objective with a line that names the Product Goal: a text
 * link, so no field is added. The line goes first, and what was typed
 * stays under it. Unchanged when it already names the goal.
 */
export function objectiveServingGoal(
  objective: string,
  goal: Pick<ProductGoal, "statement">
): string {
  if (objectiveNamesGoal(objective, goal)) return objective;
  const line = `${SERVES_PREFIX}: “${goal.statement.replace(/\s+/g, " ").trim()}”. This sprint moves it by: `;
  const rest = objective.trim();
  return rest ? `${line}\n${rest}` : line;
}
