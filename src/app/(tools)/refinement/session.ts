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

/**
 * In the backlog proper: no sprint yet. The rest of the stories not started
 * are planned into a sprint (to do there), and the cockpit counts those
 * separately ("sprint stories without points").
 */
export function isInBacklog(story: Pick<Story, "status" | "sprintId">): boolean {
  return !story.sprintId && story.status === "backlog";
}

/** What the cockpit counts behind "Refine the backlog": no sprint, in the backlog, no points. */
export function isBacklogUnsized(story: Story): boolean {
  return isInBacklog(story) && isUnsized(story);
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
  /** Those still in the backlog, with no sprint; the rest are planned into one. */
  backlog: number;
  /** Unsized stories among them. */
  unsized: number;
  /**
   * The cockpit's count: unsized backlog stories with no sprint (all in
   * `toRefine`). The page shows it as is, so the number on the card that
   * led here is on the page too.
   */
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
    backlog: candidates.filter(isInBacklog).length,
    unsized: candidates.filter(isUnsized).length,
    backlogUnsized: candidates.filter(isBacklogUnsized).length,
  };
}

/** A story title compared loosely: case and runs of spaces don't count. */
export function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
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

export type ReadinessState = "ready" | "needs-points" | "partial" | "not-ready" | "unchecked";

/**
 * The badge on a story: never checked, none met, some met, ready, or ready
 * but for its points. A story marked ready (by an agent, or before its
 * estimate was cleared) or with every criterion met, but unsized, isn't
 * "Partial": the estimate is all it lacks, and the badge says so.
 */
export function readinessState(story: Story, criteria: readonly Criterion[]): ReadinessState {
  if (!story.readiness) return "unchecked";
  if (isReady(story)) return "ready";
  const met = metCriteria(story.readiness.checked, criteria).length;
  const allMet = criteria.length > 0 && met === criteria.length;
  if (isUnsized(story) && (story.readiness.ready || allMet)) return "needs-points";
  return met > 0 ? "partial" : "not-ready";
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
    // The noun follows the list ("1 of 2 criteria"), the verb the open count.
    errors.criteria = `${open} of ${criteria.length} ${
      criteria.length === 1 ? "criterion" : "criteria"
    } ${open === 1 ? "isn't" : "aren't"} ticked yet. Tick ${
      open === 1 ? "it" : "them"
    }, or save the checks and come back to it.`;
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

/**
 * "Save checks" keeps the team's call while it still holds: a ready story
 * re-checked with every criterion still ticked stays ready. Unticking one
 * takes it out of Ready (and out of Sprint Planning's ready set), and the
 * page says so.
 */
export function keepsReady(
  story: Pick<Story, "readiness">,
  checked: readonly string[],
  criteria: readonly Criterion[]
): boolean {
  return (
    story.readiness?.ready === true &&
    criteria.length > 0 &&
    metCriteria(checked, criteria).length === criteria.length
  );
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

/**
 * The readiness a check by name hands to the backlog story "Add to backlog"
 * makes from it: the criteria it ticked, not the team's call (ready is made
 * in the session), dated the day of the check, so the session shows where
 * the story stood instead of "Not checked".
 */
export function readinessFromCheck(
  check: Pick<StorySave, "checks" | "date">,
  now: Date = new Date()
): NonNullable<Story["readiness"]> {
  const checked = (check.checks ?? []).filter((c) => c.checked).map((c) => c.criterionId);
  // Noon, local: the stamp reads back as the same day in this time zone.
  const at = isIsoDate(check.date) ? new Date(`${check.date}T12:00:00`) : now;
  return { checked, ready: false, updatedAt: (at > now ? now : at).toISOString() };
}

/** The local "YYYY-MM-DD" of a readiness stamp, or "" when it isn't a date. */
export function localDateOf(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : todayLocalISO(d);
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
 * the counts it was saved with. A check added to the backlog carried its
 * ticks to the story, so once that story has a readiness of its own the
 * check isn't counted again beside it.
 */
export function passRateRecords(
  stories: readonly Story[],
  history: readonly StorySave[],
  criteria: readonly Criterion[]
): PassRecord[] {
  const records: PassRecord[] = [];
  const promoted = new Set(
    stories.flatMap((s) =>
      s.readiness && s.sourceRef?.tool === "refinement" ? [s.sourceRef.id] : []
    )
  );
  // History is stored newest first.
  for (const h of [...history].reverse()) {
    if (!(h.totalCriteria > 0) || !ISO_DATE.test(h.date) || promoted.has(h.id)) continue;
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

/**
 * The same checks, newest first, in the shape the Team charter's Definition
 * of Ready card reads (`DorDoc.history` in team/charter-view.ts). Its pass
 * rate should come from here rather than from the store's checks by name
 * alone, which since the session hold only the legacy and outside checks.
 */
export function dorCheckHistory(
  stories: readonly Story[],
  history: readonly StorySave[],
  criteria: readonly Criterion[]
): { passRate: number; date: string; storyName: string }[] {
  return passRateRecords(stories, history, criteria)
    .reverse()
    .map((r) => ({ passRate: r.passRate, date: r.date, storyName: r.name }));
}
