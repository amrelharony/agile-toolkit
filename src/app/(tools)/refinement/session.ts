/**
 * The refinement session's logic: which stories still need refining, where
 * each stands against the Definition of Ready, and what "Mark ready" asks
 * for. Pure, so the page, the Markdown export and the tests share one
 * definition of "ready".
 */

import type { Story } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { todayLocalISO } from "@/lib/utils/formatters";
import { checkCounts, type CheckValues, type Criterion, type StorySave } from "./store";

/* -------------------------------------------------------------------------- */
/*  Which stories                                                             */
/* -------------------------------------------------------------------------- */

/** Not started yet: still in the backlog, or planned into a sprint and to do. */
export function isRefinementCandidate(story: Pick<Story, "status">): boolean {
  return story.status === "backlog" || story.status === "todo";
}

/**
 * No points yet. The same test as the cockpit's "backlog stories to size"
 * (sprint/view.ts), so the number on its "Refine the backlog" card is the
 * number of unsized backlog stories this page lists.
 */
export function isUnsized(story: Pick<Story, "points">): boolean {
  return !(typeof story.points === "number" && story.points > 0);
}

/** What the cockpit counts behind "Refine the backlog": no sprint, in the backlog, no points. */
export function isBacklogUnsized(story: Story): boolean {
  return !story.sprintId && story.status === "backlog" && isUnsized(story);
}

/**
 * Marked ready and sized. A story marked ready without points (by an agent,
 * or before an estimate was cleared) stays on the list: it can't be weighed
 * against a sprint's capacity yet.
 */
export function isReady(story: Story): boolean {
  return story.readiness?.ready === true && !isUnsized(story);
}

/** Highest priority score first; unscored ones after, in their stored order. */
function byPriority(a: Story, b: Story): number {
  return (b.priorityScore ?? -Infinity) - (a.priorityScore ?? -Infinity);
}

export interface RefinementSession {
  /** Not ready, or ready but unsized, in priority order: the session walks these. */
  toRefine: Story[];
  /** Ready and sized, in priority order. */
  ready: Story[];
  /** Every story not started yet (to refine + ready). */
  total: number;
  /** Unsized stories among them. */
  unsized: number;
  /** The cockpit's count: unsized backlog stories with no sprint (all in `toRefine`). */
  backlogUnsized: number;
}

export function refinementSession(stories: readonly Story[]): RefinementSession {
  // Array.prototype.sort is stable, so equal scores keep their stored order.
  const candidates = stories.filter(isRefinementCandidate).sort(byPriority);
  const toRefine = candidates.filter((s) => !isReady(s));
  return {
    toRefine,
    ready: candidates.filter(isReady),
    total: candidates.length,
    unsized: candidates.filter(isUnsized).length,
    backlogUnsized: candidates.filter(isBacklogUnsized).length,
  };
}

/* -------------------------------------------------------------------------- */
/*  Readiness of one story                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The ids in `checked` that are still in the Definition of Ready, in the
 * criteria's order. A criterion deleted since the check no longer counts;
 * one added since starts unticked.
 */
export function metCriteria(
  checked: readonly string[] | undefined,
  criteria: readonly Criterion[]
): string[] {
  const ticked = new Set(checked ?? []);
  return criteria.filter((c) => ticked.has(c.id)).map((c) => c.id);
}

export type ReadinessState = "ready" | "partial" | "not-ready" | "unchecked";

/** The badge on a story: never checked, none met, some met, or ready. */
export function readinessState(story: Story, criteria: readonly Criterion[]): ReadinessState {
  if (!story.readiness) return "unchecked";
  if (isReady(story)) return "ready";
  return metCriteria(story.readiness.checked, criteria).length > 0 ? "partial" : "not-ready";
}

export interface ReadyDraft {
  /** Ids of the criteria ticked so far. */
  checked: string[];
}

export type ReadyField = "criteria" | "points";

/**
 * "Mark ready" asks for every criterion ticked and some points. Saving the
 * checks without marking it ready is always possible (see `withReadiness`).
 */
export function validateReady(
  draft: ReadyDraft,
  criteria: readonly Criterion[],
  story: Pick<Story, "points">
): Validation<ReadyDraft, ReadyField> {
  const errors: Partial<Record<ReadyField, string>> = {};
  const met = metCriteria(draft.checked, criteria);
  if (criteria.length === 0) {
    errors.criteria = "Add a Definition of Ready criterion first.";
  } else if (met.length < criteria.length) {
    const open = criteria.length - met.length;
    errors.criteria = `${open} of ${criteria.length} ${
      criteria.length === 1 ? "criterion isn't" : "criteria aren't"
    } ticked yet. Tick ${open === 1 ? "it" : "them"}, or save the checks and come back to it.`;
  }
  if (isUnsized(story)) {
    errors.points = "It has no points yet. Queue it for Planning Poker, then mark it ready.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { checked: met } };
}

/** The story with its readiness set: the criteria that passed, and the team's call. */
export function withReadiness(
  story: Story,
  checked: readonly string[],
  ready: boolean,
  at: string = new Date().toISOString()
): Story {
  return { ...story, readiness: { checked: [...checked], ready, updatedAt: at } };
}

/* -------------------------------------------------------------------------- */
/*  Checks by name                                                            */
/* -------------------------------------------------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime()) && todayLocalISO(d) === value;
}

export interface CheckDraft {
  storyName: string;
  description: string;
  /** "YYYY-MM-DD"; today unless backdated. */
  date: string;
  checked: string[];
}

export type CheckField = "storyName" | "date";

function dateError(date: string, today: string): string | undefined {
  if (!date.trim()) return "Pick the date of the check.";
  if (!isIsoDate(date)) return "Enter a date as YYYY-MM-DD.";
  if (date > today) return "A check can't be dated in the future.";
  return undefined;
}

/** A check by name needs a name and a real date no later than today. */
export function validateCheck(
  draft: CheckDraft,
  criteria: readonly Criterion[],
  today: string = todayLocalISO()
): Validation<CheckValues, CheckField> {
  const errors: Partial<Record<CheckField, string>> = {};
  const storyName = draft.storyName.trim();
  if (!storyName) errors.storyName = "Enter the story's name or ID.";
  const date = dateError(draft.date, today);
  if (date) errors.date = date;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const description = draft.description.trim();
  return {
    ok: true,
    values: {
      storyName,
      ...(description ? { description } : {}),
      date: draft.date,
      checked: metCriteria(draft.checked, criteria),
    },
  };
}

export interface CheckEditDraft {
  storyName: string;
  description: string;
  date: string;
}

export type CheckEditValues = Pick<StorySave, "storyName" | "description" | "date">;

/** Editing a saved check: the same rules for the name and the date. */
export function validateCheckEdit(
  draft: CheckEditDraft,
  today: string = todayLocalISO()
): Validation<CheckEditValues, CheckField> {
  const errors: Partial<Record<CheckField, string>> = {};
  const storyName = draft.storyName.trim();
  if (!storyName) errors.storyName = "Enter the story's name or ID.";
  const date = dateError(draft.date, today);
  if (date) errors.date = date;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const description = draft.description.trim();
  return {
    ok: true,
    values: { storyName, date: draft.date, ...(description ? { description } : {}) },
  };
}

/* -------------------------------------------------------------------------- */
/*  Pass rate over time                                                       */
/* -------------------------------------------------------------------------- */

export interface PassRecord {
  id: string;
  name: string;
  /** Local "YYYY-MM-DD". */
  date: string;
  metCount: number;
  totalCriteria: number;
  /** 0–100, rounded. */
  passRate: number;
  source: "story" | "check";
}

/**
 * Every check on record, oldest first: each story's latest readiness (one
 * per story — re-checking replaces it) and the checks saved by name. A
 * story's checks are counted against today's criteria; a saved check keeps
 * the counts it was saved with.
 */
export function passRateRecords(
  stories: readonly Story[],
  history: readonly StorySave[],
  criteria: readonly Criterion[]
): PassRecord[] {
  const records: PassRecord[] = [];
  // History is stored newest first.
  for (const h of [...history].reverse()) {
    if (!(h.totalCriteria > 0) || !ISO_DATE.test(h.date)) continue;
    records.push({
      id: h.id,
      name: h.storyName,
      date: h.date,
      metCount: h.metCount,
      totalCriteria: h.totalCriteria,
      passRate: h.passRate,
      source: "check",
    });
  }
  if (criteria.length > 0) {
    const checkedStories = stories
      .map((s) => ({ s, at: s.readiness ? new Date(s.readiness.updatedAt) : null }))
      .filter((x): x is { s: Story; at: Date } => x.at !== null && !Number.isNaN(x.at.getTime()))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const { s, at } of checkedStories) {
      const counts = checkCounts(metCriteria(s.readiness?.checked, criteria), criteria);
      records.push({
        id: s.id,
        name: s.title,
        date: todayLocalISO(at),
        ...counts,
        source: "story",
      });
    }
  }
  // Stable: same-day records keep checks-by-name first, then stories.
  return records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
