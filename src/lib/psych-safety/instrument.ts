/**
 * The psychological-safety instrument: Amy Edmondson's seven team
 * statements (Edmondson, "Psychological Safety and Learning Behavior in
 * Work Teams", Administrative Science Quarterly 44(2), 1999), answered on a
 * 1–5 agreement scale, and how a round of answers is scored and compared.
 * Shared by the Psych Safety page and `tool.psych_safety.*`, so both read
 * the same scores. Pure and server-safe.
 *
 * Answers are kept only as a round's counts per question (how many chose
 * each point), never per person: a round from a vote room, typed in by the
 * facilitator, or folded from the per-response list the tool kept before
 * rounds. A round's results show from PSYCH_SAFETY_MIN_RESPONSES answers,
 * because in a small team three answers to "mistakes are held against me"
 * can point at a person.
 *
 * Three statements are worded negatively (q1, q3, q5): agreeing with them
 * means less safety, so they are reverse-scored (6 − the answer) wherever a
 * score is read. The counts stay raw.
 */

import type {
  PsychSafetyCounts,
  PsychSafetyLog,
  PsychSafetyQuestionId,
  PsychSafetyResponse,
  PsychSafetyRound,
} from "@/lib/stores/workspace-types";
import { PSYCH_SAFETY_ID } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { VOTE_LIMITS, type Questionnaire, type VoteScale } from "@/lib/realtime/vote-room/protocol";

export { PSYCH_SAFETY_ID };

export interface PsychSafetyQuestion {
  id: PsychSafetyQuestionId;
  text: string;
  /** Worded negatively: agreeing means less safety, so it is scored 6 − the answer. */
  reversed: boolean;
}

export const PSYCH_SAFETY_QUESTIONS: readonly PsychSafetyQuestion[] = [
  { id: "q1", text: "If I make a mistake on this team, it is held against me.", reversed: true },
  {
    id: "q2",
    text: "Members of this team are able to bring up problems and tough issues.",
    reversed: false,
  },
  {
    id: "q3",
    text: "People on this team sometimes reject others for being different.",
    reversed: true,
  },
  { id: "q4", text: "It is safe to take a risk on this team.", reversed: false },
  {
    id: "q5",
    text: "It is difficult to ask other members of this team for help.",
    reversed: true,
  },
  {
    id: "q6",
    text: "No one on this team would deliberately act in a way that undermines my efforts.",
    reversed: false,
  },
  {
    id: "q7",
    text: "Working with members of this team, my unique skills and talents are valued and utilized.",
    reversed: false,
  },
];

export const PSYCH_SAFETY_QUESTION_IDS: readonly PsychSafetyQuestionId[] =
  PSYCH_SAFETY_QUESTIONS.map((q) => q.id);

/** The agreement scale, 1 to 5, in the order people read it. */
export const PSYCH_SAFETY_SCALE: VoteScale = {
  id: "agreement-5",
  points: [
    { value: 1, label: "Strongly disagree" },
    { value: 2, label: "Disagree" },
    { value: 3, label: "Neither agree nor disagree" },
    { value: 4, label: "Agree" },
    { value: 5, label: "Strongly agree" },
  ],
};

/** Answers a round needs before any result shows (and a question before its own). */
export const PSYCH_SAFETY_MIN_RESPONSES = MIN_SAMPLE.psychSafety;

/** A question's mean falling by more than this between two rounds is an anomaly. */
export const ANOMALY_DROP = 0.5;

/** The id of the read-only round folded from the per-response list. */
export const LEGACY_ROUND_ID = "psRound_legacy";
export const LEGACY_ROUND_NAME = "Earlier responses";

export const ROUND_NAME_MAX = 80;

/** A raw answer as a score: reverse-scored statements count 6 − the answer. */
export function adjusted(raw: number, reversed: boolean): number {
  return reversed ? 6 - raw : raw;
}

export function questionMeta(id: string): PsychSafetyQuestion | undefined {
  return PSYCH_SAFETY_QUESTIONS.find((q) => q.id === id);
}

/** "Q3" */
export function questionLabel(id: string): string {
  return `Q${id.replace(/^q/, "")}`;
}

/* ── The vote room ────────────────────────────────────────────────────── */

/**
 * The vote-room questionnaire: the seven statements, every one required,
 * on the agreement scale. People see the statements as worded; reverse
 * scoring happens only when a saved round is read.
 */
export function psychSafetyQuestionnaire(): Questionnaire {
  return {
    id: "psych-safety",
    title: "Psychological safety",
    scale: PSYCH_SAFETY_SCALE,
    questions: PSYCH_SAFETY_QUESTIONS.map((q) => ({ id: q.id, text: q.text })),
  };
}

/* ── Counts ───────────────────────────────────────────────────────────── */

export function emptyCounts(): Record<PsychSafetyQuestionId, PsychSafetyCounts> {
  return Object.fromEntries(
    PSYCH_SAFETY_QUESTION_IDS.map((id) => [id, [0, 0, 0, 0, 0] as PsychSafetyCounts])
  ) as Record<PsychSafetyQuestionId, PsychSafetyCounts>;
}

const whole = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0);

/** How many answered a question. */
export function countsTotal(c: readonly number[] | undefined | null): number {
  return Array.isArray(c) ? c.reduce((sum, n) => sum + whole(n), 0) : 0;
}

/**
 * Answers per person (the per-response list from before rounds) as counts
 * per question. A value off the 1–5 scale is rounded onto it; one that
 * isn't a number is skipped.
 */
export function countsFromAnswers(
  answers: readonly Partial<Record<PsychSafetyQuestionId, number>>[]
): Record<PsychSafetyQuestionId, PsychSafetyCounts> {
  const out = emptyCounts();
  for (const a of answers) {
    for (const id of PSYCH_SAFETY_QUESTION_IDS) {
      const raw = a?.[id];
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const point = Math.min(5, Math.max(1, Math.round(raw)));
      out[id][point - 1] += 1;
    }
  }
  return out;
}

/**
 * A saved vote round's counts per question (each point by its value, 1–5).
 * A question withheld for having fewer than minN answers is saved with no
 * answers at all, never as answers of zero: it reads as unanswered.
 */
export function countsFromVoteResult(
  result: Pick<VoteRoundResult, "questions" | "scale">
): Record<PsychSafetyQuestionId, PsychSafetyCounts> {
  const out = emptyCounts();
  for (const q of result.questions) {
    if (!questionMeta(q.id) || !q.distribution) continue;
    const id = q.id as PsychSafetyQuestionId;
    result.scale.points.forEach((p, i) => {
      if (Number.isInteger(p.value) && p.value >= 1 && p.value <= 5) {
        out[id][p.value - 1] += whole(q.distribution?.[i]);
      }
    });
  }
  return out;
}

export type CountsCheck =
  | { ok: true; counts: Record<PsychSafetyQuestionId, PsychSafetyCounts>; responses: number }
  | { ok: false; reason: string };

/**
 * Counts typed in by an agent, checked as the page's count entry checks
 * them: whole numbers, 0 or more, for the seven questions; `responses` (the
 * people who answered; by default the question with the most answers) from
 * PSYCH_SAFETY_MIN_RESPONSES to the count entry's cap, and no question with
 * more answers than people. A question below the minimum is kept as
 * unanswered, as a vote round withholds it.
 */
export function checkRoundCounts(
  counts: Partial<Record<string, readonly number[]>> | undefined,
  responses?: number
): CountsCheck {
  if (!counts || typeof counts !== "object") return { ok: false, reason: "Give counts for q1-q7." };
  const out = emptyCounts();
  let most = 0;
  for (const id of PSYCH_SAFETY_QUESTION_IDS) {
    const row = counts[id];
    if (!Array.isArray(row) || row.length !== 5) {
      return { ok: false, reason: `${id} needs five counts: how many answered 1, 2, 3, 4 and 5.` };
    }
    for (const n of row) {
      if (!Number.isInteger(n) || n < 0) {
        return { ok: false, reason: `${id}: every count is a whole number, 0 or more.` };
      }
    }
    most = Math.max(most, countsTotal(row));
    out[id] = [row[0], row[1], row[2], row[3], row[4]];
  }
  const people = responses ?? most;
  if (!Number.isInteger(people) || people < 0) {
    return { ok: false, reason: "responses is a whole number, 0 or more." };
  }
  if (people > VOTE_LIMITS.maxTallyBallots) {
    return { ok: false, reason: `At most ${VOTE_LIMITS.maxTallyBallots} people in one round.` };
  }
  if (people < PSYCH_SAFETY_MIN_RESPONSES) {
    return {
      ok: false,
      reason: `A round needs at least ${PSYCH_SAFETY_MIN_RESPONSES} people, so no one's answers can be singled out; this has ${people}.`,
    };
  }
  for (const id of PSYCH_SAFETY_QUESTION_IDS) {
    if (countsTotal(out[id]) > people) {
      return {
        ok: false,
        reason: `${id} has more answers than the ${people} people who answered.`,
      };
    }
    // Withheld below the minimum, as the vote room does.
    if (countsTotal(out[id]) < PSYCH_SAFETY_MIN_RESPONSES) out[id] = [0, 0, 0, 0, 0];
  }
  return { ok: true, counts: out, responses: people };
}

/* ── Rounds ───────────────────────────────────────────────────────────── */

/** The day a timestamp falls on (its ISO date), the same on the page and the server. */
const isoDay = (ts: string | undefined) => (typeof ts === "string" ? ts.slice(0, 10) : "");

/**
 * The per-response list from before rounds, folded into one read-only
 * "legacy" round (counts only: who answered and what they wrote is never
 * read). Null when there is none.
 */
export function legacyRound(
  responses: readonly PsychSafetyResponse[] | undefined
): PsychSafetyRound | null {
  const list = (Array.isArray(responses) ? responses : []).filter(
    (r) => r && typeof r === "object" && r.scores && typeof r.scores === "object"
  );
  if (list.length === 0) return null;
  const latest = list.reduce((a, b) => ((b.ts ?? "") > (a.ts ?? "") ? b : a));
  return {
    id: LEGACY_ROUND_ID,
    name: LEGACY_ROUND_NAME,
    date: isoDay(latest.ts),
    source: "legacy",
    responses: list.length,
    counts: countsFromAnswers(list.map((r) => r.scores)),
    createdAt: latest.ts ?? "",
  };
}

function isRound(r: unknown): r is PsychSafetyRound {
  const x = r as PsychSafetyRound | null;
  return Boolean(x && typeof x === "object" && typeof x.id === "string" && x.counts);
}

/**
 * Every round, oldest first (by date, then when it was saved): the saved
 * rounds, plus the per-response list folded into a "legacy" round, so the
 * page and the agent read the same rounds from any stored shape.
 */
export function roundsOf(log: PsychSafetyLog | undefined | null): PsychSafetyRound[] {
  const saved = (Array.isArray(log?.rounds) ? log.rounds : []).filter(isRound);
  const legacy = legacyRound(log?.responses);
  return [...saved, ...(legacy ? [legacy] : [])]
    .map((r, i) => ({ r, i }))
    .sort((a, b) =>
      a.r.date === b.r.date
        ? (a.r.createdAt ?? "").localeCompare(b.r.createdAt ?? "") || a.i - b.i
        : a.r.date < b.r.date
          ? -1
          : 1
    )
    .map(({ r }) => r);
}

export interface QuestionResult {
  id: PsychSafetyQuestionId;
  text: string;
  reversed: boolean;
  /** People who answered it. */
  n: number;
  /** Mean raw answer, 1–5; null when withheld. */
  mean: number | null;
  /** Mean score after reverse scoring (higher is safer); null when withheld. */
  adjusted: number | null;
}

export interface RoundResult {
  responses: number;
  /** Mean of the questions' scores (higher is safer); null when every question is withheld. */
  teamScore: number | null;
  perQuestion: QuestionResult[];
  /** The question with the lowest score; null when none shows. */
  lowest: PsychSafetyQuestionId | null;
  /** Questions with too few answers to show. */
  withheld: PsychSafetyQuestionId[];
}

/**
 * A round's results: per question, its mean and its score (reverse scoring
 * applied), shown from PSYCH_SAFETY_MIN_RESPONSES answers; the team score is
 * the mean of the questions that show. Null for a round below the minimum.
 */
export function roundResult(r: PsychSafetyRound | null | undefined): RoundResult | null {
  if (!r || !(r.responses >= PSYCH_SAFETY_MIN_RESPONSES)) return null;
  const perQuestion = PSYCH_SAFETY_QUESTIONS.map((q): QuestionResult => {
    const c = r.counts?.[q.id];
    const n = countsTotal(c);
    if (!c || n < PSYCH_SAFETY_MIN_RESPONSES) {
      return { id: q.id, text: q.text, reversed: q.reversed, n, mean: null, adjusted: null };
    }
    const mean = c.reduce((sum, k, i) => sum + whole(k) * (i + 1), 0) / n;
    return {
      id: q.id,
      text: q.text,
      reversed: q.reversed,
      n,
      mean,
      adjusted: adjusted(mean, q.reversed),
    };
  });
  const shown = perQuestion.filter((q) => q.adjusted !== null);
  const teamScore =
    shown.length === 0
      ? null
      : shown.reduce((sum, q) => sum + (q.adjusted as number), 0) / shown.length;
  const lowest = shown.reduce<QuestionResult | null>(
    (low, q) => (!low || (q.adjusted as number) < (low.adjusted as number) ? q : low),
    null
  );
  return {
    responses: r.responses,
    teamScore,
    perQuestion,
    lowest: lowest?.id ?? null,
    withheld: perQuestion.filter((q) => q.adjusted === null).map((q) => q.id),
  };
}

export interface RoundComparison {
  /** Team score change, later minus earlier; null when either has none. */
  delta: number | null;
  perQuestion: { id: PsychSafetyQuestionId; delta: number | null }[];
  /** A question's score fell by more than ANOMALY_DROP. */
  anomaly: boolean;
  /** The questions that fell by more than ANOMALY_DROP, the biggest fall first. */
  dropped: PsychSafetyQuestionId[];
}

/**
 * Two rounds side by side (`cur` the later): each question's change in
 * score, and an anomaly when one fell by more than ANOMALY_DROP. Null unless
 * both rounds have PSYCH_SAFETY_MIN_RESPONSES answers: a change between thin
 * rounds is noise that reads like a finding.
 */
export function compareRounds(
  prev: PsychSafetyRound | null | undefined,
  cur: PsychSafetyRound | null | undefined
): RoundComparison | null {
  const a = roundResult(prev);
  const b = roundResult(cur);
  if (!a || !b) return null;
  const perQuestion = PSYCH_SAFETY_QUESTION_IDS.map((id) => {
    const x = a.perQuestion.find((q) => q.id === id)?.adjusted ?? null;
    const y = b.perQuestion.find((q) => q.id === id)?.adjusted ?? null;
    return { id, delta: x === null || y === null ? null : y - x };
  });
  const dropped = perQuestion
    .filter((q) => q.delta !== null && q.delta < -ANOMALY_DROP)
    .sort((p, q) => (p.delta as number) - (q.delta as number))
    .map((q) => q.id);
  return {
    delta: a.teamScore === null || b.teamScore === null ? null : b.teamScore - a.teamScore,
    perQuestion,
    anomaly: dropped.length > 0,
    dropped,
  };
}

/* ── Saving ───────────────────────────────────────────────────────────── */

export function emptyPsychSafetyLog(): PsychSafetyLog {
  return { id: PSYCH_SAFETY_ID, responses: [] };
}

/** The log with `round` added (the stored rounds only; the legacy fold is never written). */
export function withRound(
  log: PsychSafetyLog | null | undefined,
  round: PsychSafetyRound
): PsychSafetyLog {
  const base = log ?? emptyPsychSafetyLog();
  const rounds = (Array.isArray(base.rounds) ? base.rounds : []).filter(isRound);
  return {
    ...base,
    id: base.id || PSYCH_SAFETY_ID,
    responses: base.responses ?? [],
    rounds: [...rounds, round],
  };
}

/**
 * The log without round `id`: a saved round is dropped; the legacy round is
 * the per-response list, so removing it empties that list. Null when there
 * is no such round.
 */
export function withoutRound(
  log: PsychSafetyLog | null | undefined,
  id: string
): PsychSafetyLog | null {
  if (!log) return null;
  if (id === LEGACY_ROUND_ID) {
    return legacyRound(log.responses) ? { ...log, responses: [] } : null;
  }
  const rounds = Array.isArray(log.rounds) ? log.rounds : [];
  if (!rounds.some((r) => r.id === id)) return null;
  return { ...log, rounds: rounds.filter((r) => r.id !== id) };
}

/** A saved round with its name, date or sprint changed (never the legacy one). */
export function withRoundPatch(
  log: PsychSafetyLog,
  id: string,
  patch: Partial<Pick<PsychSafetyRound, "name" | "date" | "sprintId" | "sentTo">>
): PsychSafetyLog | null {
  const rounds = Array.isArray(log.rounds) ? log.rounds : [];
  if (!rounds.some((r) => r.id === id)) return null;
  return {
    ...log,
    rounds: rounds.map((r) => {
      if (r.id !== id) return r;
      const next: PsychSafetyRound = { ...r, ...patch };
      if (!next.sprintId) delete next.sprintId;
      return next;
    }),
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Why `day` can't date a round, or null: not a real day, or after `today`. */
export function roundDateProblem(day: string | undefined | null, today: string): string | null {
  if (typeof day !== "string" || !DAY_RE.test(day)) return "Pick a day.";
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
    return "Pick a day.";
  }
  if (day > today) return "A round can't be dated in the future.";
  return null;
}

/** The name a round gets when none is typed: "Round 3". */
export function defaultRoundName(log: PsychSafetyLog | null | undefined): string {
  return `Round ${roundsOf(log).length + 1}`;
}
