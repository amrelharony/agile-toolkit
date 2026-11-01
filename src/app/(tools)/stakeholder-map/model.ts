/**
 * The Stakeholder Map's data and its numbers: who the stakeholders are,
 * where they sit on Interest × Authority (nowhere until someone places
 * them), how they feel now and how you need them to feel, and when you
 * last spoke and next will. Pure, so the page, the example, the Markdown
 * export and the tests share one definition of each.
 *
 * The stakeholders stay a blob under STORAGE_KEY. `normalizeStakeholders`
 * reads every shape saved so far: the old single `sentiment` is the current
 * one, and old positions keep their place (a saved 5/5 can't be told from a
 * choice, so nothing saved is ever unplaced).
 */

import { isIsoDate, isoDayNumber } from "@/lib/sprints/calendar";
import { nudge, snap, type MatrixAxis } from "@/lib/utils/matrix";

export const STORAGE_KEY = "agile-toolkit:stakeholder-map";

export type Sentiment = "champion" | "supporter" | "neutral" | "skeptic" | "blocker";

/** Most supportive first, as the pickers list them. */
export const SENTIMENTS: readonly Sentiment[] = [
  "champion",
  "supporter",
  "neutral",
  "skeptic",
  "blocker",
];

export const SENTIMENT_RANK: Record<Sentiment, number> = {
  blocker: 0,
  skeptic: 1,
  neutral: 2,
  supporter: 3,
  champion: 4,
};

export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  champion: "Champion",
  supporter: "Supporter",
  neutral: "Neutral",
  skeptic: "Skeptic",
  blocker: "Blocker",
};

export interface Stakeholder {
  id: string;
  name: string;
  role?: string;
  /** 0–10; null until placed. */
  interest: number | null;
  /** 0–10; null until placed. */
  authority: number | null;
  /** How they feel now; null until set. */
  currentSentiment: Sentiment | null;
  /** How you need them to feel; null until set. */
  desiredSentiment: Sentiment | null;
  strategy?: string;
  description?: string;
  /** "YYYY-MM-DD": when you last spoke. */
  lastContactAt?: string;
  /** "YYYY-MM-DD": when you'll next reach out. */
  nextTouchAt?: string;
}

export type Quadrant = "manageClosely" | "keepSatisfied" | "keepInformed" | "monitor";

export const QUADRANTS: readonly Quadrant[] = [
  "manageClosely",
  "keepSatisfied",
  "keepInformed",
  "monitor",
];

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  manageClosely: "Manage Closely",
  keepSatisfied: "Keep Satisfied",
  keepInformed: "Keep Informed",
  monitor: "Monitor",
};

export const QUADRANT_DESCRIPTION: Record<Quadrant, string> = {
  manageClosely: "High authority + high interest. Engage frequently, co-create plans.",
  keepSatisfied: "High authority + low interest. Brief succinctly, avoid surprises.",
  keepInformed: "Low authority + high interest. Share progress, harness for advocacy.",
  monitor: "Low authority + low interest. Light touch, watch for shifts.",
};

/** Where "Place in…" puts someone: the middle of the quadrant's high or low half. */
export const QUADRANT_CENTRE: Record<Quadrant, { interest: number; authority: number }> = {
  manageClosely: { interest: 8, authority: 8 },
  keepSatisfied: { interest: 2, authority: 8 },
  keepInformed: { interest: 8, authority: 2 },
  monitor: { interest: 2, authority: 2 },
};

/** A score of 5 or more is high (the map's middle line). */
export const HIGH = 5;
/** How soon a next touch counts as due soon, in days. */
export const DUE_SOON_DAYS = 7;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const sentiment = (v: unknown): Sentiment | null =>
  SENTIMENTS.includes(v as Sentiment) ? (v as Sentiment) : null;

/** A "YYYY-MM-DD" that exists. */
export const isIsoDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isIsoDate(v);

/** The map's scale on both axes: 0–10 in whole steps; a keyboard move of an unplaced axis starts mid-way. */
export const STAKEHOLDER_AXIS: MatrixAxis = {
  kind: "linear",
  min: 0,
  max: 10,
  step: 1,
  start: HIGH,
};

/** 0–10, whole: the map's scale. */
export const clampScore = (n: number) => snap(STAKEHOLDER_AXIS, n);

// A saved position keeps its exact value (kept on the scale, not rounded),
// so it stays in the quadrant it was in.
const score = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : null;

/**
 * The stakeholders in any shape saved so far. The old `sentiment` reads as
 * the current one until a current one is saved (null included, so clearing
 * it sticks); rows that aren't stakeholders are dropped; unknown fields are
 * kept. Safe on every read and write.
 */
export function normalizeStakeholders(raw: unknown): Stakeholder[] {
  if (!Array.isArray(raw)) return [];
  const out: Stakeholder[] = [];
  raw.forEach((s, i) => {
    if (!isObject(s)) return;
    const next: Stakeholder = {
      ...(s as Partial<Stakeholder>),
      id: str(s.id) || `stakeholder-${i}`,
      name: str(s.name) ?? "",
      interest: score(s.interest),
      authority: score(s.authority),
      currentSentiment: sentiment("currentSentiment" in s ? s.currentSentiment : s.sentiment),
      desiredSentiment: sentiment(s.desiredSentiment),
    };
    for (const k of ["role", "strategy", "description"] as const) {
      if (next[k] !== undefined && typeof next[k] !== "string") delete next[k];
    }
    for (const k of ["lastContactAt", "nextTouchAt"] as const) {
      if (next[k] !== undefined && !isIsoDay(next[k])) delete next[k];
    }
    out.push(next);
  });
  return out;
}

export const isPlaced = (s: Pick<Stakeholder, "interest" | "authority">) =>
  s.interest !== null && s.authority !== null;

/** The quadrant, or null for someone not placed yet. */
export function quadrantOf(s: Pick<Stakeholder, "interest" | "authority">): Quadrant | null {
  if (s.interest === null || s.authority === null) return null;
  const highInterest = s.interest >= HIGH;
  const highAuthority = s.authority >= HIGH;
  if (highAuthority && highInterest) return "manageClosely";
  if (highAuthority) return "keepSatisfied";
  if (highInterest) return "keepInformed";
  return "monitor";
}

/**
 * How many steps their sentiment has to move to reach the one you need:
 * positive = short of it, 0 = there, negative = warmer than needed; null
 * until both are set.
 */
export function sentimentGap(
  s: Pick<Stakeholder, "currentSentiment" | "desiredSentiment">
): number | null {
  if (!s.currentSentiment || !s.desiredSentiment) return null;
  return SENTIMENT_RANK[s.desiredSentiment] - SENTIMENT_RANK[s.currentSentiment];
}

/** "2 steps short", "on target", "1 step past"; "" until both are set. */
export function gapText(gap: number | null): string {
  if (gap === null) return "";
  if (gap === 0) return "on target";
  const steps = Math.abs(gap) === 1 ? "1 step" : `${Math.abs(gap)} steps`;
  return gap > 0 ? `${steps} short` : `${steps} past`;
}

export type TouchStatus = "overdue" | "due-soon" | "scheduled" | "none";

/** The next touch: past its day, within a week, later, or not planned. */
export function touchStatus(s: Pick<Stakeholder, "nextTouchAt">, today: string): TouchStatus {
  if (!s.nextTouchAt) return "none";
  const due = isoDayNumber(s.nextTouchAt);
  const now = isoDayNumber(today);
  if (due === null || now === null) return "none";
  if (due < now) return "overdue";
  if (due - now <= DUE_SOON_DAYS) return "due-soon";
  return "scheduled";
}

/** Days from `today` to the next touch (negative when it's past). */
export function daysToTouch(s: Pick<Stakeholder, "nextTouchAt">, today: string): number | null {
  const due = isoDayNumber(s.nextTouchAt);
  const now = isoDayNumber(today);
  return due === null || now === null ? null : due - now;
}

/** One step on an axis, kept on the scale; an unplaced axis starts mid-way. */
export function moveBy(s: Stakeholder, axis: "interest" | "authority", delta: number): Stakeholder {
  return { ...s, [axis]: nudge(STAKEHOLDER_AXIS, s[axis], delta) };
}

/** Put someone in the middle of a quadrant (an explicit choice, never a default). */
export function placeIn(s: Stakeholder, q: Quadrant): Stakeholder {
  return { ...s, ...QUADRANT_CENTRE[q] };
}

/** "interest 7, authority 8, Manage Closely", or "not placed yet". */
export function positionText(s: Pick<Stakeholder, "interest" | "authority">): string {
  const q = quadrantOf(s);
  return q
    ? `interest ${s.interest}, authority ${s.authority}, ${QUADRANT_LABEL[q]}`
    : "not placed yet";
}

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/**
 * The one sentence over the map: how many of the people you must manage
 * closely are short of where you need them, the most overdue touch, and
 * who isn't placed yet.
 */
export function stakeholderVerdict(list: readonly Stakeholder[], today: string): string {
  if (list.length === 0) return "No stakeholders yet.";
  const placed = list.filter(isPlaced);
  const unplaced = list.length - placed.length;
  const close = placed.filter((s) => quadrantOf(s) === "manageClosely");
  const short = close.filter((s) => (sentimentGap(s) ?? 0) > 0);
  const overdue = list
    .filter((s) => touchStatus(s, today) === "overdue")
    .sort((a, b) => (daysToTouch(a, today) ?? 0) - (daysToTouch(b, today) ?? 0));

  const parts: string[] = [];
  if (placed.length === 0) {
    parts.push(
      `${list.length === 1 ? "1 stakeholder" : `${list.length} stakeholders`}, none placed on the map yet`
    );
  } else if (close.length > 0 && short.length > 0) {
    parts.push(
      `${short.length} of ${close.length} Manage Closely ${close.length === 1 ? "stakeholder is" : "stakeholders are"} below where you need them`
    );
  } else if (close.length > 0) {
    const rated = close.filter((s) => sentimentGap(s) !== null).length;
    parts.push(
      rated === close.length
        ? `Every Manage Closely stakeholder is where you need them`
        : `${close.length} to manage closely; set how you need them to feel to see who needs work`
    );
  } else {
    parts.push(`${placed.length} placed, none to manage closely`);
  }
  if (overdue.length > 0) {
    const first = overdue[0];
    const late = -(daysToTouch(first, today) ?? 0);
    parts.push(
      overdue.length === 1
        ? `${first.name}'s next touch was due ${days(late)} ago`
        : `${overdue.length} touches are overdue, ${first.name}'s by ${days(late)}`
    );
  }
  if (unplaced > 0 && placed.length > 0) parts.push(`${unplaced} not placed yet`);
  return `${parts.join("; ")}.`;
}
