/**
 * ADKAR change initiatives: where each change is, how long it has been
 * there, and where adoption is stuck for whom.
 *
 * Pure and server-safe, so the page, the agent actions (tool.adkar.*) and
 * the next-step rules agree. The rules:
 *
 *   - Each group affected by a change is scored 1-5 on the five elements.
 *     Prosci's barrier point is the first element, in A-D-K-A-R order,
 *     scored 3 or lower (BARRIER_MAX): work on it before anything later
 *     helps. An unscored element before any low one leaves the barrier
 *     unknown ("score Awareness first"), never assumed fine.
 *   - The stage history starts on the start date (entry 0 is Awareness on
 *     `startDate`) and every move is dated: forward or back, never before
 *     the last move and never after today, so days per stage are real.
 *     The tracker used to stamp every move "today" and could only go
 *     forward.
 *   - Completed stages are derived from the current stage; the stored
 *     `stagesCompleted` is legacy and only ever grew.
 */

import {
  ADKAR_DOC_ID,
  ADKAR_ELEMENTS,
  ADKAR_KIND,
  type AdkarDoc,
  type AdkarElement,
  type AdkarGroup,
  type AdkarInitiative,
  type AdkarScore,
  type AdkarStageEntry,
} from "@/lib/stores/workspace-types";
import { isIsoDate } from "@/lib/sprints/calendar";
import { dayNumber } from "@/lib/flow/days";
import { percentile } from "@/lib/sprints/metrics";
import { enoughData } from "@/lib/analytics/min-sample";
import { formatDate } from "@/lib/utils/formatters";

export { ADKAR_DOC_ID, ADKAR_ELEMENTS, ADKAR_KIND };

/** The tool's old cloud-synced blob: a bare list of initiatives, kept as the backup. */
export const ADKAR_LEGACY_KEY = "agile-toolkit:adkar";
/** The legacy initiative ids already moved into the workspace, so one deleted since isn't moved again. */
export const ADKAR_MOVED_KEY = "agile-toolkit:adkar:moved";

/** Prosci: an element scored 3 or lower is a barrier. */
export const BARRIER_MAX = 3;
/** Days in one stage after which a change reads as stuck (next steps, the verdict). */
export const STUCK_DAYS = 30;
export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;

export const ELEMENT_LABEL: Record<AdkarElement, string> = {
  awareness: "Awareness",
  desire: "Desire",
  knowledge: "Knowledge",
  ability: "Ability",
  reinforcement: "Reinforcement",
};

export const ELEMENT_BLURB: Record<AdkarElement, string> = {
  awareness: "People understand the need for change and the risks of doing nothing.",
  desire: "People are motivated to take part: incentives are aligned with the change.",
  knowledge: "People know how to change: training, processes and tooling are there.",
  ability: "People can show the new behaviour in real work, with support nearby.",
  reinforcement: "Rituals, metrics and recognition sustain the change so it sticks.",
};

/** The 1-5 scale per element, worded for a facilitator scoring a group. */
export const ADKAR_SCORE_STEPS: readonly { value: AdkarScore; name: string; meaning: string }[] = [
  { value: 1, name: "Not there", meaning: "Hardly anyone in the group is there yet." },
  { value: 2, name: "Weak", meaning: "A few people are there; most aren't." },
  { value: 3, name: "Partly", meaning: "About half the group is there. Still a barrier." },
  { value: 4, name: "Mostly", meaning: "Most of the group is there." },
  { value: 5, name: "Fully", meaning: "The whole group is there." },
];

export const stageIndex = (el: AdkarElement): number => ADKAR_ELEMENTS.indexOf(el);
const isElement = (v: unknown): v is AdkarElement =>
  typeof v === "string" && (ADKAR_ELEMENTS as readonly string[]).includes(v);

/** A stored score as a whole 1-5, or null for Not scored. */
export function scoreOf(v: unknown): AdkarScore | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(5, Math.max(1, Math.round(v))) as AdkarScore;
}

/* ── Barriers ───────────────────────────────────────────────────────── */

export interface BarrierPoint {
  /** The first element scored BARRIER_MAX or lower; null = none found. */
  element: AdkarElement | null;
  score?: AdkarScore;
  /** Set when an element before any low score is unscored: the barrier is unknown. */
  unscoredBefore?: AdkarElement;
}

export function barrierPoint(scores: AdkarGroup["scores"] | undefined): BarrierPoint {
  for (const el of ADKAR_ELEMENTS) {
    const s = scoreOf(scores?.[el]);
    if (s === null) return { element: null, unscoredBefore: el };
    if (s <= BARRIER_MAX) return { element: el, score: s };
  }
  return { element: null };
}

/** Whether a group has any score at all. */
export const isScored = (g: AdkarGroup): boolean =>
  ADKAR_ELEMENTS.some((el) => scoreOf(g.scores?.[el]) !== null);

/** A group's barrier in words: "Barrier: Desire (2/5)", "Barrier unknown: score Awareness first"… */
export function barrierText(group: AdkarGroup): string {
  const b = barrierPoint(group.scores);
  if (b.element && b.score !== undefined)
    return `Barrier: ${ELEMENT_LABEL[b.element]} (${b.score}/5)`;
  if (b.unscoredBefore) {
    return isScored(group)
      ? `Barrier unknown: score ${ELEMENT_LABEL[b.unscoredBefore]} first`
      : "Not scored yet";
  }
  return `No barrier: every element above ${BARRIER_MAX}`;
}

export interface InitiativeBarrier {
  element: AdkarElement;
  groupId: string;
  groupName: string;
  score: AdkarScore;
}

/** The earliest barrier across the initiative's groups (ties: the lowest score, then the first group). */
export function initiativeBarrier(i: AdkarInitiative): InitiativeBarrier | null {
  let best: InitiativeBarrier | null = null;
  for (const g of i.groups ?? []) {
    const b = barrierPoint(g.scores);
    if (!b.element || b.score === undefined) continue;
    const better =
      !best ||
      stageIndex(b.element) < stageIndex(best.element) ||
      (b.element === best.element && b.score < best.score);
    if (better) best = { element: b.element, groupId: g.id, groupName: g.name, score: b.score };
  }
  return best;
}

/** Groups the initiative has moved past: their barrier comes before its current stage. */
export function pastBarrier(
  i: AdkarInitiative
): { group: AdkarGroup; barrier: AdkarElement; score: AdkarScore }[] {
  const at = stageIndex(i.currentStage);
  return (i.groups ?? []).flatMap((g) => {
    const b = barrierPoint(g.scores);
    return b.element && b.score !== undefined && stageIndex(b.element) < at
      ? [{ group: g, barrier: b.element, score: b.score }]
      : [];
  });
}

/* ── Stages and days ────────────────────────────────────────────────── */

export interface StageDuration {
  stage: AdkarElement;
  from: string;
  /** Null for the current stage, which runs to today. */
  to: string | null;
  days: number;
}

const daysBetween = (from: string, to: string): number => {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? 0 : Math.max(0, b - a);
};

/** Each period in the history, oldest first; the current one runs to today. */
export function stageDurations(i: AdkarInitiative, today: string): StageDuration[] {
  const h = i.stageHistory ?? [];
  return h.map((e, k) => {
    const to = h[k + 1]?.enteredAt ?? null;
    return { stage: e.stage, from: e.enteredAt, to, days: daysBetween(e.enteredAt, to ?? today) };
  });
}

/** Days since the initiative entered its current stage. */
export function daysInStage(i: AdkarInitiative, today: string): number {
  const last = i.stageHistory?.[i.stageHistory.length - 1];
  return last ? daysBetween(last.enteredAt, today) : 0;
}

/** The stages before the current one. */
export function completedStages(i: AdkarInitiative): AdkarElement[] {
  return ADKAR_ELEMENTS.slice(0, Math.max(0, stageIndex(i.currentStage)));
}

/** Why a move can't be dated `on`, or null: a real day, not before the last move, not after today. */
export function moveDateError(i: AdkarInitiative, on: string, today: string): string | null {
  if (!on.trim()) return "Pick the day it moved.";
  if (!isIsoDate(on)) return "Pick a real day.";
  const day = on.slice(0, 10);
  if (day > today) return "It can't move in the future.";
  const last = i.stageHistory?.[i.stageHistory.length - 1]?.enteredAt;
  if (last && day < last)
    return `It entered ${ELEMENT_LABEL[i.currentStage]} on ${formatDate(last)}; pick that day or later.`;
  return null;
}

function moved(i: AdkarInitiative, to: AdkarElement, on: string): AdkarInitiative {
  const entry: AdkarStageEntry = { stage: to, enteredAt: on.slice(0, 10) };
  const next: AdkarInitiative = {
    ...i,
    currentStage: to,
    stageHistory: [...(i.stageHistory ?? []), entry],
  };
  // Legacy: derived from the current stage now (completedStages), so it goes.
  delete next.stagesCompleted;
  return next;
}

/** The initiative a stage further on, entered on `on`; null at Reinforcement or for a bad day. */
export function advance(i: AdkarInitiative, on: string, today: string): AdkarInitiative | null {
  const next = ADKAR_ELEMENTS[stageIndex(i.currentStage) + 1];
  if (!next || moveDateError(i, on, today)) return null;
  return moved(i, next, on);
}

/** The initiative a stage back (adoption slipped), from `on`; null at Awareness or for a bad day. */
export function stepBack(i: AdkarInitiative, on: string, today: string): AdkarInitiative | null {
  const prev = ADKAR_ELEMENTS[stageIndex(i.currentStage) - 1];
  if (!prev || moveDateError(i, on, today)) return null;
  return moved(i, prev, on);
}

/** Why the start can't be `startDate`, or null: a real day, not after today or the first move. */
export function startDateError(
  i: AdkarInitiative | null,
  startDate: string,
  today: string
): string | null {
  if (!startDate.trim()) return "Pick the day it started.";
  if (!isIsoDate(startDate)) return "Pick a real day.";
  const day = startDate.slice(0, 10);
  if (day > today) return "It can't start in the future.";
  const firstMove = i?.stageHistory?.[1]?.enteredAt;
  if (firstMove && day > firstMove) {
    return `It moved to ${ELEMENT_LABEL[i!.stageHistory[1].stage]} on ${formatDate(firstMove)}; start on or before that.`;
  }
  return null;
}

/** The initiative with a new start date, which is also the day it entered Awareness. */
export function withStartDate(
  i: AdkarInitiative,
  startDate: string,
  today: string
): AdkarInitiative | null {
  if (startDateError(i, startDate, today)) return null;
  const day = startDate.slice(0, 10);
  const [, ...rest] = i.stageHistory ?? [];
  return { ...i, startDate: day, stageHistory: [{ stage: "awareness", enteredAt: day }, ...rest] };
}

/* ── Normalising stored rows ────────────────────────────────────────── */

type Loose = Record<string, unknown>;
const isRecord = (v: unknown): v is Loose =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const day = (v: unknown): string | undefined =>
  typeof v === "string" && isIsoDate(v) ? v.slice(0, 10) : undefined;

function normalizeGroup(raw: unknown): AdkarGroup | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string") {
    return null;
  }
  const scores: AdkarGroup["scores"] = {};
  const stored = isRecord(raw.scores) ? raw.scores : {};
  for (const el of ADKAR_ELEMENTS) {
    const s = scoreOf(stored[el]);
    if (s !== null) scores[el] = s;
  }
  const assessedAt = day(raw.assessedAt);
  const note = text(raw.note);
  return {
    id: raw.id,
    name: raw.name,
    scores,
    ...(assessedAt ? { assessedAt } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * A stored initiative as the page and agents read it, or null when it has
 * no id or name. Entry 0 of the history is Awareness on the start date (an
 * old initiative was stamped the day it was added, even when backdated); an
 * unknown stage reads as Awareness; an old initiative with no history keeps
 * its stage (entered on the start date, the only day known); a history
 * that ends elsewhere than the current stage gets the current stage added.
 */
export function normalizeInitiative(raw: unknown, today: string): AdkarInitiative | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const rawHistory = (Array.isArray(raw.stageHistory) ? raw.stageHistory : [])
    .filter(isRecord)
    .flatMap((e) =>
      isElement(e.stage) && day(e.enteredAt)
        ? [{ stage: e.stage, enteredAt: day(e.enteredAt)! }]
        : []
    );
  const startDate = day(raw.startDate) ?? rawHistory[0]?.enteredAt ?? today;
  const currentStage: AdkarElement = isElement(raw.currentStage) ? raw.currentStage : "awareness";
  let history = rawHistory;
  if (history[0]?.stage === "awareness") {
    // The stored first entry was "today" at the time it was added: the start date wins when earlier.
    if (history[0].enteredAt > startDate)
      history = [{ stage: "awareness", enteredAt: startDate }, ...history.slice(1)];
  } else {
    history = [{ stage: "awareness", enteredAt: startDate }, ...history];
  }
  // Days run forward: a move dated before the one it follows reads as that day.
  for (let k = 1; k < history.length; k++) {
    if (history[k].enteredAt < history[k - 1].enteredAt) {
      history[k] = { ...history[k], enteredAt: history[k - 1].enteredAt };
    }
  }
  if (history[history.length - 1].stage !== currentStage) {
    history = [
      ...history,
      { stage: currentStage, enteredAt: history[history.length - 1].enteredAt },
    ];
  }
  const owner = text(raw.owner);
  const description = text(raw.description);
  const groups = (Array.isArray(raw.groups) ? raw.groups : [])
    .map(normalizeGroup)
    .filter((g): g is AdkarGroup => g !== null);
  return {
    id: raw.id,
    name,
    ...(owner ? { owner } : {}),
    startDate: history[0].enteredAt,
    ...(description ? { description } : {}),
    currentStage,
    stageHistory: history,
    ...(groups.length > 0 ? { groups } : {}),
  };
}

/** A list of stored initiatives (the doc's or the legacy blob's), each id once. */
export function normalizeInitiatives(raw: unknown, today: string): AdkarInitiative[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).flatMap((r) => {
    const i = normalizeInitiative(r, today);
    if (!i || seen.has(i.id)) return [];
    seen.add(i.id);
    return [i];
  });
}

export function normalizeAdkarDoc(raw: AdkarDoc | null | undefined, today: string): AdkarDoc {
  return { id: ADKAR_DOC_ID, initiatives: normalizeInitiatives(raw?.initiatives, today) };
}

export interface AdkarLegacyMove {
  /** Legacy initiatives the workspace doc doesn't have yet. */
  toMove: AdkarInitiative[];
  /** The moved-ids record after this move. */
  moved: string[];
  /** Whether the record grew. */
  changed: boolean;
}

/**
 * The one-time move of the old blob into the workspace doc, as the flags'
 * move plans it: legacy initiatives whose id the doc doesn't have and that
 * weren't moved before. When the record is empty but the doc already has
 * some of them, another device moved them (and anything missing was
 * deleted since), so nothing moves. It never replaces a doc initiative.
 */
export function planAdkarMove(
  legacyRaw: unknown,
  existing: readonly { id: string }[],
  moved: readonly unknown[] | unknown,
  today: string
): AdkarLegacyMove {
  const legacy = normalizeInitiatives(legacyRaw, today);
  const known = Array.isArray(moved)
    ? moved.filter((id): id is string => typeof id === "string")
    : [];
  if (legacy.length === 0) return { toMove: [], moved: known, changed: false };
  const have = new Set(existing.map((i) => i.id));
  const marked = new Set(known);
  const movedElsewhere = marked.size === 0 && legacy.some((i) => have.has(i.id));
  const toMove = movedElsewhere ? [] : legacy.filter((i) => !have.has(i.id) && !marked.has(i.id));
  const next = Array.from(new Set([...known, ...legacy.map((i) => i.id)]));
  return { toMove, moved: next, changed: next.length !== known.length };
}

/* ── Writing ────────────────────────────────────────────────────────── */

/** Why an initiative or group name can't be saved, or null. */
export function nameError(
  name: string,
  what: "initiative" | "group" = "initiative"
): string | null {
  const clean = name.trim();
  if (!clean) return what === "group" ? "Name the group." : "Name the change.";
  if (clean.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters.`;
  return null;
}

export interface NewInitiative {
  name: string;
  owner?: string;
  startDate: string;
  description?: string;
}

/** A new initiative at Awareness, entered on its start date. */
export function newInitiative(values: NewInitiative, id: string): AdkarInitiative {
  const owner = values.owner?.trim();
  const description = values.description?.trim();
  const startDate = values.startDate.slice(0, 10);
  return {
    id,
    name: values.name.trim(),
    ...(owner ? { owner } : {}),
    startDate,
    ...(description ? { description } : {}),
    currentStage: "awareness",
    stageHistory: [{ stage: "awareness", enteredAt: startDate }],
  };
}

/** The initiative with its name, owner or description edited (null / "" clears an optional one). */
export function withDetails(
  i: AdkarInitiative,
  patch: { name?: string; owner?: string | null; description?: string | null }
): AdkarInitiative {
  const next: AdkarInitiative = { ...i };
  if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
  for (const key of ["owner", "description"] as const) {
    if (!(key in patch)) continue;
    const v = patch[key]?.trim();
    if (v) next[key] = v;
    else delete next[key];
  }
  return next;
}

export function newGroup(name: string, id: string): AdkarGroup {
  return { id, name: name.trim(), scores: {} };
}

/** The initiative with one group's element scored (null clears it); the first score dates the group. */
export function withGroupScore(
  i: AdkarInitiative,
  groupId: string,
  element: AdkarElement,
  score: AdkarScore | null,
  today: string
): AdkarInitiative {
  return {
    ...i,
    groups: (i.groups ?? []).map((g) => {
      if (g.id !== groupId) return g;
      const scores = { ...g.scores };
      if (score === null) delete scores[element];
      else scores[element] = score;
      return { ...g, scores, ...(g.assessedAt || score === null ? {} : { assessedAt: today }) };
    }),
  };
}

/** The initiative with a group renamed, re-dated or noted (null / "" clears the optional ones). */
export function withGroupPatch(
  i: AdkarInitiative,
  groupId: string,
  patch: { name?: string; assessedAt?: string | null; note?: string | null }
): AdkarInitiative {
  return {
    ...i,
    groups: (i.groups ?? []).map((g) => {
      if (g.id !== groupId) return g;
      const next: AdkarGroup = { ...g };
      if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
      if ("assessedAt" in patch) {
        if (patch.assessedAt && isIsoDate(patch.assessedAt))
          next.assessedAt = patch.assessedAt.slice(0, 10);
        else delete next.assessedAt;
      }
      if ("note" in patch) {
        const note = patch.note?.trim();
        if (note) next.note = note;
        else delete next.note;
      }
      return next;
    }),
  };
}

/** The doc with one initiative replaced by `fn` (null: unchanged). */
export function withInitiative(
  doc: AdkarDoc,
  id: string,
  fn: (i: AdkarInitiative) => AdkarInitiative | null
): AdkarDoc {
  return {
    ...doc,
    initiatives: doc.initiatives.map((i) => (i.id === id ? (fn(i) ?? i) : i)),
  };
}

/* ── Numbers for the page ───────────────────────────────────────────── */

export function stageCounts(initiatives: readonly AdkarInitiative[]): Record<AdkarElement, number> {
  const out = Object.fromEntries(ADKAR_ELEMENTS.map((el) => [el, 0])) as Record<
    AdkarElement,
    number
  >;
  for (const i of initiatives) if (isElement(i.currentStage)) out[i.currentStage] += 1;
  return out;
}

/**
 * The median days a stage took, over finished periods only (a current
 * stage hasn't ended). Shown from MIN_SAMPLE.average periods: one move is
 * one data point, not a typical time.
 */
export function medianDaysInStage(
  initiatives: readonly AdkarInitiative[],
  today: string
): { median: number | null; periods: number } {
  const days = initiatives.flatMap((i) =>
    stageDurations(i, today)
      .filter((d) => d.to !== null)
      .map((d) => d.days)
  );
  return {
    median: enoughData(days.length, "average") ? percentile(days, 50) : null,
    periods: days.length,
  };
}

/** The initiative longest in its current stage, or null with none. */
export function longestInCurrentStage(
  initiatives: readonly AdkarInitiative[],
  today: string
): { initiative: AdkarInitiative; days: number } | null {
  let best: { initiative: AdkarInitiative; days: number } | null = null;
  for (const i of initiatives) {
    const days = daysInStage(i, today);
    if (!best || days > best.days) best = { initiative: i, days };
  }
  return best;
}

/* ── The verdict ────────────────────────────────────────────────────── */

const initiativesWord = (n: number) => (n === 1 ? "1 initiative" : `${n} initiatives`);

/**
 * The one sentence above the list: which initiatives are held up, where,
 * and by whom; or what to score to find out.
 */
export function adkarVerdict(initiatives: readonly AdkarInitiative[], today: string): string {
  if (initiatives.length === 0) return "No change initiatives yet.";
  const scored = initiatives.some((i) => (i.groups ?? []).some(isScored));
  const stuck = initiatives.filter((i) => daysInStage(i, today) >= STUCK_DAYS).length;
  const stuckPart =
    stuck > 0
      ? ` ${initiativesWord(stuck)} ${stuck === 1 ? "has" : "have"} been in the same stage ${STUCK_DAYS}+ days.`
      : "";
  if (!scored) {
    return `Score each group on the five elements to find where adoption is stuck.${stuckPart}`;
  }
  const held = initiatives
    .map((i) => ({ i, b: initiativeBarrier(i) }))
    .filter((x): x is { i: AdkarInitiative; b: InitiativeBarrier } => x.b !== null);
  if (held.length === 0) {
    return `No initiative is held at a barrier: every scored group is above ${BARRIER_MAX} as far as it is scored.${stuckPart}`;
  }
  const named = held
    .slice(0, 2)
    .map(
      ({ i, b }) => `${i.name} at ${ELEMENT_LABEL[b.element]} (${b.groupName} scored ${b.score})`
    )
    .join("; ");
  const more = held.length > 2 ? `; ${held.length - 2} more` : "";
  const of = `${held.length} of ${initiativesWord(initiatives.length)}`;
  return `${of} ${held.length === 1 ? "is" : "are"} held up: ${named}${more}.${stuckPart}`;
}
