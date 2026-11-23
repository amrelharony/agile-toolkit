/**
 * Coach me: a short coaching talk over an Improvement Kata's storyboard, in
 * six steps. The order and the wording are our own; the shape of the talk
 * (where you are, the target, the obstacle, the next try and when to look)
 * comes from Mike Rother's Toyota Kata.
 *
 * The talk keeps its answers until Finish (or "Save and stop"), then
 * `withCoaching` turns them into one write, so one Undo takes the whole
 * talk back. Pure and server-safe, like the model.
 */

import type { Improvement, ImprovementCondition } from "@/lib/stores/workspace-types";
import { cleanLine } from "@/lib/root-cause/model";
import {
  hasCondition,
  isDay,
  lastExperiment,
  touched,
  validateStep,
  valueText,
  withCondition,
  withObstacle,
  withObstaclePatch,
  withReading,
  withStep,
  withStepPatch,
  withTargetReached,
  type ReadingInput,
  type ReadingRefusal,
} from "./model";

export type CoachStepId = "since" | "number" | "aim" | "obstacle" | "next-try" | "next-look";

export interface CoachStep {
  id: CoachStepId;
  /** The step's short name, for the walk's heading ("Step 2 of 6: Today's number"). */
  title: string;
  /** The coach's question, read against the Kata as it is. */
  question: (item: Improvement) => string;
  /** Left out of the walk (nothing to ask about yet). */
  skip?: (item: Improvement) => boolean;
}

const quote = (text: string, max = 80) => `“${cleanLine(text, max)}”`;

/** The target in words: “Under 8 h” by 2026-12-04 (or its number when it has no words). */
function aimText(item: Improvement): string {
  const t = item.target;
  const words = t.text.trim() || [t.metric?.trim(), valueText(t)].filter(Boolean).join(" ");
  return t.date ? `${quote(words)} by ${t.date}` : quote(words);
}

export const COACH_STEPS: readonly CoachStep[] = [
  {
    id: "since",
    title: "Since last time",
    question: (item) => {
      const last = lastExperiment(item);
      return `Last time you tried ${quote(last?.text ?? "")}. What did you see, and what do you know now?`;
    },
    skip: (item) => lastExperiment(item) === null,
  },
  {
    id: "number",
    title: "Today's number",
    question: () => "What does the number say today?",
  },
  {
    id: "aim",
    title: "The aim",
    question: (item) =>
      hasCondition(item.target)
        ? `Is ${aimText(item)} still what you're aiming for?`
        : "What are you aiming for next, and by when?",
  },
  {
    id: "obstacle",
    title: "In the way",
    question: () => "Which obstacle are you on now?",
  },
  {
    id: "next-try",
    title: "Next try",
    question: () => "What's the smallest thing you'll try next, and what do you think will happen?",
  },
  {
    id: "next-look",
    title: "Next look",
    question: () => "When will you look at what happened together?",
  },
];

/** The talk's steps for this Kata, in order (Since last time only once there was a try). */
export function coachStepsFor(item: Improvement): CoachStep[] {
  return COACH_STEPS.filter((s) => !s.skip?.(item));
}

/** What a talk collected. Every answer is optional: "Save and stop" saves what there is. */
export interface CoachAnswers {
  /** Since last time: what happened, and what was learned. */
  result?: string;
  learned?: string;
  /** Today's number. */
  reading?: ReadingInput;
  /** The aim: keep it, change it (to `target`), or Reached it. */
  aim?: "keep" | "change" | "reached";
  target?: Partial<ImprovementCondition>;
  /** In the way: an obstacle picked, or a new one. */
  obstacleId?: string;
  newObstacle?: string;
  /** Next try: a planned experiment. */
  nextTry?: { text: string; expect: string };
  /** Next look: the next coaching day (YYYY-MM-DD). */
  nextLook?: string;
}

/** The ids a talk's new rows take. */
export interface CoachIds {
  reading: string;
  obstacle: string;
  step: string;
}

export type CoachRefusal =
  | { step: "number"; reason: ReadingRefusal }
  | { step: "obstacle"; reason: "blank" | "list_full" }
  | { step: "next-try"; reason: "blank" | "needs_expect" | "list_full" }
  | { step: "next-look"; reason: "bad_date" | "past_date" };

export interface CoachOutcome {
  item: Improvement;
  /** A reading was logged. */
  reading: boolean;
  /** An experiment was planned. */
  experiment: boolean;
  /** The target was reached. */
  reached: boolean;
}

/** Why the talk's next-look day can't be kept, or null. */
export function nextLookProblem(day: string, today: string): "bad_date" | "past_date" | null {
  if (!isDay(day)) return "bad_date";
  return day < today ? "past_date" : null;
}

/**
 * The talk's answers as one change to the Kata: the last experiment's
 * result and learning (done once something happened, when it had an
 * expectation), a reading, the aim kept, changed or reached, the obstacle
 * worked on, a planned experiment and the next coaching day. `latestDay`
 * bounds the reading's day (latestCheckInDay); `today` the next look's.
 * Refused, saving nothing, when an answer can't be kept.
 */
export function withCoaching(
  start: Improvement,
  answers: CoachAnswers,
  ids: CoachIds,
  now: string,
  { today, latestDay }: { today: string; latestDay: string }
): { ok: true; outcome: CoachOutcome } | { ok: false; refusal: CoachRefusal } {
  let item = start;
  const last = lastExperiment(item);
  const result = answers.result?.trim() ?? "";
  const learned = answers.learned?.trim() ?? "";
  if (last && (result || learned)) {
    const patch = {
      ...(result ? { result } : {}),
      ...(learned ? { learned } : {}),
    };
    // Something happened: the try is done, once it said what it expected.
    const finished =
      result && last.status !== "done" && !validateStep(item.method, { ...last, status: "done" });
    const changed = withStepPatch(
      item,
      last.id,
      finished ? { ...patch, status: "done" } : patch,
      now
    );
    if (changed.ok) item = changed.item;
  }

  let reading = false;
  if (answers.reading) {
    const changed = withReading(item, answers.reading, ids.reading, now, latestDay);
    if (!changed.ok) return { ok: false, refusal: { step: "number", reason: changed.reason } };
    item = changed.item;
    reading = true;
  }

  let reached = false;
  if (answers.aim === "reached") {
    const next = withTargetReached(item, now);
    if (next) {
      item = next;
      reached = true;
    }
  } else if (answers.aim === "change" && answers.target) {
    item = withCondition(item, "target", answers.target, now);
  }

  const fresh = answers.newObstacle?.trim() ?? "";
  if (fresh && item.method === "kata") {
    const added = withObstacle(item, fresh, ids.obstacle, now);
    if (!added.ok) {
      const reason = added.reason === "list_full" ? "list_full" : "blank";
      return { ok: false, refusal: { step: "obstacle", reason } };
    }
    item = withObstaclePatch(added.item, ids.obstacle, { status: "working" }, now) ?? added.item;
  } else if (answers.obstacleId) {
    item = withObstaclePatch(item, answers.obstacleId, { status: "working" }, now) ?? item;
  }

  let experiment = false;
  if (answers.nextTry && (answers.nextTry.text.trim() || answers.nextTry.expect.trim())) {
    const text = answers.nextTry.text.trim();
    const expect = answers.nextTry.expect.trim();
    if (!text) return { ok: false, refusal: { step: "next-try", reason: "blank" } };
    if (!expect) return { ok: false, refusal: { step: "next-try", reason: "needs_expect" } };
    const working = item.obstacles.find((o) => o.status === "working");
    const added = withStep(
      item,
      { text, expect, status: "planned", ...(working ? { obstacleId: working.id } : {}) },
      ids.step,
      now
    );
    if (!added.ok) {
      return {
        ok: false,
        refusal: {
          step: "next-try",
          reason: added.reason === "list_full" ? "list_full" : "blank",
        },
      };
    }
    item = added.item;
    experiment = true;
  }

  const nextLook = answers.nextLook ?? "";
  if (nextLook) {
    const why = nextLookProblem(nextLook, today);
    if (why) return { ok: false, refusal: { step: "next-look", reason: why } };
  }
  // Stamped even when nothing was answered: the talk still happened.
  item = touched(item, nextLook ? { nextCoachingAt: nextLook } : {}, now);
  return { ok: true, outcome: { item, reading, experiment, reached } };
}

/** Two stored values the same (rows are plain JSON). */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What a field was before the talk, unless it changed again after it. */
const back = <T>(now: T, was: T, made: T): T => (same(now, made) ? was : now);

/** A row's fields put back three ways (now, before the talk, after it), unset ones dropped. */
function rowBack<R extends object>(now: R, was: R, made: R, keys: readonly (keyof R)[]): R {
  const out = { ...now } as Record<string, unknown>;
  for (const k of keys) {
    const v = back(now[k], was[k], made[k]);
    if (v === undefined) delete out[k as string];
    else out[k as string] = v;
  }
  return out as R;
}

/**
 * A coaching talk's Undo, on the Kata as it is now (`current`): the reading,
 * obstacle and experiment the talk added go, by their ids; the last
 * experiment's result, learning and status, the obstacles' statuses, where
 * things stand, the target, the past targets and the next coaching day go
 * back to how they were before the talk (`before`). Anything changed again
 * since the talk (`after`) stays as it is now, and so does every field and
 * link the talk didn't touch: a send, a step's status, a reading or a synced
 * change made while the Undo was offered isn't lost.
 */
export function withoutCoaching(
  current: Improvement,
  before: Improvement,
  after: Improvement,
  ids: CoachIds,
  now: string
): Improvement {
  const madeHere = <T extends { id: string }>(was: readonly T[], made: readonly T[], id: string) =>
    made.some((x) => x.id === id) && !was.some((x) => x.id === id);
  const dropReading = madeHere(before.readings, after.readings, ids.reading);
  const dropStep = madeHere(before.steps, after.steps, ids.step);
  const dropObstacle = madeHere(before.obstacles, after.obstacles, ids.obstacle);

  const steps = current.steps
    .filter((s) => !(dropStep && s.id === ids.step))
    .map((s) => {
      const was = before.steps.find((x) => x.id === s.id);
      const made = after.steps.find((x) => x.id === s.id);
      if (!was || !made) return s;
      return rowBack(s, was, made, ["result", "learned", "status", "doneAt"] as const);
    });

  let obstacles = current.obstacles
    .filter((o) => !(dropObstacle && o.id === ids.obstacle))
    .map((o) => {
      const was = before.obstacles.find((x) => x.id === o.id);
      const made = after.obstacles.find((x) => x.id === o.id);
      return was && made ? { ...o, status: back(o.status, was.status, made.status) } : o;
    });
  // One obstacle worked on at a time: one picked since the talk keeps it.
  if (obstacles.filter((o) => o.status === "working").length > 1) {
    const picked = new Set(
      current.obstacles.filter((o) => o.status === "working").map((o) => o.id)
    );
    obstacles = obstacles.map((o) =>
      o.status === "working" && !picked.has(o.id) ? { ...o, status: "open" as const } : o
    );
  }

  return touched(
    current,
    {
      readings: current.readings.filter((r) => !(dropReading && r.id === ids.reading)),
      steps,
      obstacles,
      current: back(current.current, before.current, after.current),
      target: back(current.target, before.target, after.target),
      pastTargets: back(current.pastTargets, before.pastTargets, after.pastTargets),
      nextCoachingAt: back(current.nextCoachingAt, before.nextCoachingAt, after.nextCoachingAt),
    },
    now
  );
}
