/**
 * Six Thinking Hats sessions, pure: rounds, the clock for a round, which
 * thoughts belong where, and the checks behind the forms.
 *
 * A session (workspace.sixHatsSessions) is one topic worn hat by hat. Its
 * `currentRound` is the index in `order` of the hat being worn, absent
 * before the first round and once the session is closed. The clock for a
 * round lives on the app's docked timer, so it keeps running while the
 * facilitator opens another tool; nothing here starts it.
 */

import type { SixHatsHat, SixHatsSession, SixHatsThought } from "@/lib/stores/workspace-types";
import type { DockedTimer } from "@/lib/timer/dock-timer";
import { startSteps, stepDock, type StepRun } from "@/lib/timer/step-timer";
import type { Validation } from "@/lib/utils/form";
import { hatInfo, hatName, isHat } from "./hats";

/** The page that owns a round's docked clock. */
export const SIX_HATS_PATH = "/six-hats";

/**
 * A common running order, the same one the agents start with
 * (tool.six_hats.start_session): Blue opens and closes, facts come before
 * ideas, and risks come after benefits so new ideas don't die early.
 */
export const DEFAULT_ORDER: readonly SixHatsHat[] = [
  "blue",
  "white",
  "green",
  "yellow",
  "black",
  "red",
  "blue",
];

/** The limits the agent actions enforce too. */
export const TOPIC_MAX = 300;
export const THOUGHT_MAX = 2000;
export const SUMMARY_MAX = 4000;
export const ORDER_MAX = 12;
export const ROUND_MINUTES_MIN = 1;
export const ROUND_MINUTES_MAX = 30;

/* ── Rounds ── */

export type SessionStatus = "not-started" | "in-round" | "closed";

/** The round being worn, or null before the first one and after closing. */
export function currentIndex(s: SixHatsSession): number | null {
  if (s.closedAt) return null;
  const i = s.currentRound;
  if (i === undefined || !Number.isInteger(i) || i < 0 || i >= s.order.length) return null;
  return i;
}

export function sessionStatus(s: SixHatsSession): SessionStatus {
  if (s.closedAt) return "closed";
  return currentIndex(s) === null ? "not-started" : "in-round";
}

/** The hat being worn now, if a round is on. */
export function currentHat(s: SixHatsSession): SixHatsHat | undefined {
  const i = currentIndex(s);
  return i === null ? undefined : s.order[i];
}

export const isLastRound = (s: SixHatsSession): boolean => {
  const i = currentIndex(s);
  return i !== null && i === s.order.length - 1;
};

/** "Round 3 of 7: Green hat" */
export function roundLabel(s: SixHatsSession, i: number): string {
  return `Round ${i + 1} of ${s.order.length}: ${hatName(s.order[i])}`;
}

/** Rounds still to come after the current one (all of them before the first). */
export function roundsLeft(s: SixHatsSession): number {
  if (s.closedAt) return 0;
  const i = currentIndex(s);
  return i === null ? s.order.length : s.order.length - 1 - i;
}

/** The next round: the first one before the session starts; the last one stays put. */
export function nextRound(s: SixHatsSession): SixHatsSession {
  if (s.closedAt || s.order.length === 0) return s;
  const i = currentIndex(s);
  if (i === null) return { ...s, currentRound: 0 };
  return i >= s.order.length - 1 ? s : { ...s, currentRound: i + 1 };
}

/** One round back; the first round stays put. */
export function prevRound(s: SixHatsSession): SixHatsSession {
  const i = currentIndex(s);
  return i === null || i === 0 ? s : { ...s, currentRound: i - 1 };
}

/** Closed now: no round is worn any more (as tool.six_hats.close_session does). */
export function closed(s: SixHatsSession, at: string): SixHatsSession {
  const rest = { ...s };
  delete rest.currentRound;
  return { ...rest, closedAt: at };
}

/** Open again, back in the last round (the closing Blue round), with its clock not running. */
export function reopened(s: SixHatsSession): SixHatsSession {
  const rest = { ...s };
  delete rest.closedAt;
  delete rest.currentRound;
  return s.order.length > 0 ? { ...rest, currentRound: s.order.length - 1 } : rest;
}

/**
 * The rounds as a run of timed steps (lib/timer/step-timer). Each step's
 * label names its place, "Blue hat (1/7)", so the opening and the closing
 * Blue rounds have different clocks.
 */
export function sessionRun(s: SixHatsSession): StepRun {
  const seconds = Math.max(0, Math.round(s.roundMinutes * 60));
  const run = startSteps(
    SIX_HATS_PATH,
    "Six Hats",
    s.order.map((hat, i) => ({
      id: String(i),
      label: `${hatName(hat)} (${i + 1}/${s.order.length})`,
      seconds,
      hint: hatInfo(hat).hint,
    }))
  );
  const i = currentIndex(s);
  return i === null ? { ...run, finished: true } : { ...run, index: i };
}

/** The docked countdown for the round being worn, running from `now`; null when none is. */
export function roundDock(s: SixHatsSession, now: number = Date.now()): DockedTimer | null {
  return stepDock(sessionRun(s), now);
}

/** Whether the docked clock is this session's current round. */
export function isRoundClock(timer: DockedTimer | null | undefined, s: SixHatsSession): boolean {
  if (!timer || timer.href !== SIX_HATS_PATH) return false;
  const dock = roundDock(s, 0);
  return dock !== null && timer.label === dock.label;
}

/** A Red-hat round runs short: gut reactions don't need the full time. A hint, never a rule. */
export function halfTimeHint(s: SixHatsSession): string | null {
  if (currentHat(s) !== "red") return null;
  const half = Math.round((s.roundMinutes * 60) / 2);
  const m = Math.floor(half / 60);
  const sec = String(half % 60).padStart(2, "0");
  return `Gut reactions are quick: about half the time (${m}:${sec}) is usually enough.`;
}

/* ── Sessions and thoughts ── */

/** Newest first. */
export function sortSessions(sessions: readonly SixHatsSession[]): SixHatsSession[] {
  return [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * The session to show: the one picked, else the one whose round is on the
 * docked clock (back from another tool, or a reload), else the newest open
 * one, else the newest. The page pins whatever this gives it, so it only
 * decides on a visit and after the shown session is deleted.
 */
export function pickSession(
  sessions: readonly SixHatsSession[],
  pickedId: string | null | undefined,
  dock: DockedTimer | null = null
): SixHatsSession | null {
  const picked = pickedId ? sessions.find((x) => x.id === pickedId) : undefined;
  if (picked) return picked;
  const timed = dock ? sessions.find((x) => isRoundClock(dock, x)) : undefined;
  if (timed) return timed;
  const sorted = sortSessions(sessions);
  return sorted.find((x) => !x.closedAt) ?? sorted[0] ?? null;
}

const byLogged = (a: SixHatsThought, b: SixHatsThought) => a.loggedAt.localeCompare(b.loggedAt);

/** A session's thoughts with a known hat, oldest first (the order they were said in). */
export function sessionThoughts(
  thoughts: readonly SixHatsThought[],
  sessionId: string
): SixHatsThought[] {
  return thoughts.filter((t) => t.sessionId === sessionId && isHat(t.hat)).sort(byLogged);
}

/**
 * Thoughts that belong to no session on screen: logged before sessions
 * existed, or left behind when an agent deleted their session (the store
 * keeps a removed session's thoughts). Oldest first.
 */
export function earlierThoughts(
  thoughts: readonly SixHatsThought[],
  sessions: readonly SixHatsSession[]
): SixHatsThought[] {
  const ids = new Set(sessions.map((x) => x.id));
  return thoughts
    .filter((t) => isHat(t.hat) && (!t.sessionId || !ids.has(t.sessionId)))
    .sort(byLogged);
}

/**
 * The id prefix of a session made from earlier thoughts. Nobody set one up
 * with rounds, so the page reads it as a past discussion: no rounds done,
 * no minutes per round (it keeps the agents' default only for a reopen).
 */
const ADOPTED_PREFIX = "earlier-";
/** Its minutes per round if it is ever reopened and timed: the agents' start_session default. */
const ADOPTED_ROUND_MINUTES = 5;

export const isAdoptedSession = (s: Pick<SixHatsSession, "id">): boolean =>
  s.id.startsWith(ADOPTED_PREFIX);

/**
 * Earlier thoughts (oldest first) as a session of their own: dated from the
 * first thought and closed at the last, since that discussion is over (so
 * it never becomes the open session an agent's log_thought files into),
 * with the hats in the order they first came up.
 */
export function adoptedSession(
  topic: string,
  list: readonly SixHatsThought[],
  uuid: string
): SixHatsSession {
  const order: SixHatsHat[] = [];
  for (const t of list) if (isHat(t.hat) && !order.includes(t.hat)) order.push(t.hat);
  return {
    id: `${ADOPTED_PREFIX}${uuid}`,
    topic,
    order,
    roundMinutes: ADOPTED_ROUND_MINUTES,
    startedAt: list[0].loggedAt,
    closedAt: list[list.length - 1].loggedAt,
  };
}

export type ByHat = Record<SixHatsHat, SixHatsThought[]>;

export function byHat(thoughts: readonly SixHatsThought[]): ByHat {
  const m: ByHat = { white: [], red: [], black: [], yellow: [], green: [], blue: [] };
  // Skip a hat outside the six (legacy persist, a hand edit) instead of crashing.
  for (const t of thoughts) if (isHat(t.hat)) m[t.hat].push(t);
  return m;
}

/**
 * The hats to show, in the session's order (each once), then any other hat
 * that has thoughts. Without a session: every hat with thoughts, in De Bono's
 * order.
 */
export function hatColumns(
  order: readonly SixHatsHat[] | null,
  thoughts: readonly SixHatsThought[]
): SixHatsHat[] {
  const used = new Set(thoughts.filter((t) => isHat(t.hat)).map((t) => t.hat));
  const out: SixHatsHat[] = [];
  for (const hat of order ?? []) if (!out.includes(hat)) out.push(hat);
  for (const hat of ["white", "red", "black", "yellow", "green", "blue"] as const) {
    if (used.has(hat) && !out.includes(hat)) out.push(hat);
  }
  return out;
}

/* ── Forms ── */

/**
 * Editing a session mid-round: the round being worn when the form opened
 * (`from`) and where the edits have put it (`at`; null once it is removed).
 * Followed through each move and removal, so taking out or moving a hat
 * before it never makes another hat the one being worn.
 */
export interface WornRound {
  from: number;
  at: number | null;
}

export interface SessionDraft {
  topic: string;
  order: SixHatsHat[];
  /** As typed: blank until someone enters it. */
  minutes: string;
  worn?: WornRound;
}

export type SessionField = "topic" | "order" | "minutes";

export interface SessionValues {
  topic: string;
  order: SixHatsHat[];
  roundMinutes: number;
  worn?: WornRound;
}

export const emptySessionDraft = (): SessionDraft => ({
  topic: "",
  order: [...DEFAULT_ORDER],
  minutes: "",
});

export function sessionDraftFrom(s: SixHatsSession): SessionDraft {
  const i = currentIndex(s);
  return {
    topic: s.topic,
    order: [...s.order],
    minutes: String(s.roundMinutes),
    ...(i === null ? {} : { worn: { from: i, at: i } }),
  };
}

export function validateSession(d: SessionDraft): Validation<SessionValues, SessionField> {
  const errors: Partial<Record<SessionField, string>> = {};
  const topic = d.topic.replace(/\s+/g, " ").trim();
  if (!topic) errors.topic = "Enter the question the team will think about.";
  else if (topic.length > TOPIC_MAX) errors.topic = `Keep the topic under ${TOPIC_MAX} characters.`;
  const order = d.order.filter(isHat);
  if (order.length === 0) errors.order = "Add at least one hat.";
  else if (order.length > ORDER_MAX) errors.order = `Use at most ${ORDER_MAX} rounds.`;
  const raw = d.minutes.trim();
  const minutes = Number(raw);
  if (!raw) errors.minutes = "Enter the minutes for each round.";
  else if (!Number.isFinite(minutes) || minutes < ROUND_MINUTES_MIN || minutes > ROUND_MINUTES_MAX)
    errors.minutes = `A round runs from ${ROUND_MINUTES_MIN} to ${ROUND_MINUTES_MAX} minutes.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { topic, order, roundMinutes: minutes, ...(d.worn ? { worn: d.worn } : {}) },
  };
}

export function newSession(v: SessionValues, id: string, now: string): SixHatsSession {
  return { id, topic: v.topic, order: [...v.order], roundMinutes: v.roundMinutes, startedAt: now };
}

/** Where the worn round is after the hat at `i` swaps places with its neighbour. */
export function wornAfterMove(
  worn: WornRound | undefined,
  i: number,
  by: -1 | 1,
  length: number
): WornRound | undefined {
  const j = i + by;
  if (!worn || worn.at === null || i < 0 || i >= length || j < 0 || j >= length) return worn;
  return { ...worn, at: worn.at === i ? j : worn.at === j ? i : worn.at };
}

/** Where the worn round is after the hat at `i` is removed: gone when it was that one. */
export function wornAfterRemove(worn: WornRound | undefined, i: number): WornRound | undefined {
  if (!worn || worn.at === null) return worn;
  return { ...worn, at: i === worn.at ? null : i < worn.at ? worn.at - 1 : worn.at };
}

/**
 * The same round in another order: the same hat, and the same time it is
 * worn (the closing Blue stays the closing Blue), else its last one. Null
 * when the other order doesn't have that hat.
 */
export function sameRoundIn(
  order: readonly SixHatsHat[],
  i: number,
  next: readonly SixHatsHat[]
): number | null {
  const hat = order[i];
  if (!hat) return null;
  const nth = order.slice(0, i).filter((h) => h === hat).length;
  const places = next.flatMap((h, k) => (h === hat ? [k] : []));
  return places.length === 0 ? null : places[Math.min(nth, places.length - 1)];
}

/**
 * Where the round on now is in the edited order: as the form followed it,
 * or (the round moved on while the form was open) the same hat. Null when
 * no round is on, or the round being worn was removed.
 */
export function editedRound(s: SixHatsSession, v: SessionValues): number | null {
  const i = currentIndex(s);
  if (i === null) return null;
  return v.worn && v.worn.from === i ? v.worn.at : sameRoundIn(s.order, i, v.order);
}

/**
 * The session with edited values. A round on keeps its hat (editedRound);
 * when that round was removed, the one now in its place is worn (the last
 * one past a shortened order), and the page says so.
 */
export function editedSession(s: SixHatsSession, v: SessionValues): SixHatsSession {
  const next: SixHatsSession = {
    ...s,
    topic: v.topic,
    order: [...v.order],
    roundMinutes: v.roundMinutes,
  };
  const i = currentIndex(s);
  if (i !== null) next.currentRound = editedRound(s, v) ?? Math.min(i, v.order.length - 1);
  // A stored round that was already out of range (a hand edit) must not
  // turn into a real one because the order grew.
  else delete next.currentRound;
  return next;
}

export const sameSessionValues = (s: SixHatsSession, v: SessionValues): boolean =>
  s.topic === v.topic &&
  s.roundMinutes === v.roundMinutes &&
  s.order.length === v.order.length &&
  s.order.every((h, i) => h === v.order[i]);

/** Hat-order editing for the session form. */
export function moveHat(order: readonly SixHatsHat[], i: number, by: -1 | 1): SixHatsHat[] {
  const j = i + by;
  if (i < 0 || i >= order.length || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export const removeHatAt = (order: readonly SixHatsHat[], i: number): SixHatsHat[] =>
  order.filter((_, k) => k !== i);

export interface ThoughtDraft {
  text: string;
  /** Null until picked: a thought never lands under a hat by default. */
  hat: SixHatsHat | null;
}

export type ThoughtField = keyof ThoughtDraft;

export function validateThought(
  d: ThoughtDraft
): Validation<{ text: string; hat: SixHatsHat }, ThoughtField> {
  const errors: Partial<Record<ThoughtField, string>> = {};
  const text = d.text.trim();
  if (!text) errors.text = "Write the thought first.";
  else if (text.length > THOUGHT_MAX)
    errors.text = `Keep a thought under ${THOUGHT_MAX} characters.`;
  if (!d.hat || !isHat(d.hat)) errors.hat = "Pick the hat this thought is under.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { text, hat: d.hat as SixHatsHat } };
}

export function validateSummary(d: { summary: string }): Validation<string, "summary"> {
  const summary = d.summary.trim();
  if (!summary)
    return {
      ok: false,
      errors: { summary: "Write the summary: what the team concluded and what happens next." },
    };
  if (summary.length > SUMMARY_MAX)
    return { ok: false, errors: { summary: `Keep the summary under ${SUMMARY_MAX} characters.` } };
  return { ok: true, values: summary };
}

export const hasSummary = (s: SixHatsSession): boolean => Boolean(s.summary?.trim());
