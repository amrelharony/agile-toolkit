/**
 * Tech Debt: one reading of a debt item for the page, next steps, the
 * backlog hand-off and the tool.tech_debt.* agent actions, so an item's
 * age, score and rank are the same everywhere.
 *
 * workspace.techDebt is the one store since Phase 8 (the old page blob
 * moves in through ./legacy). An item is open until `resolvedAt` is set.
 * Its age is counted in sprints of the team's cadence (calendar days ÷
 * sprintLengthDays, default 14) and its score is
 *
 *     impact × 4 − effort + min(INTEREST_CAP, interestRate × ageSprints)
 *
 * with impact and effort on the 1–5 scale (a stored value off it is read
 * rounded and clamped, one that isn't a number as 3, as the old page's
 * hotspot matrix read it) and the interest per sprint 0 when not
 * estimated. The cap keeps an old trivial item from outranking a fresh
 * critical one (the old score grew with days without bound).
 *
 * Pure and server-safe: only types, lib/utils/example-id, the sprint
 * calendar, the risk scale and lib/analytics' sample sizes and survival
 * curve, so the agent actions can run it inside the MCP route handler.
 */

import type { HandoffLink, Story, TechDebtItem } from "@/lib/stores/workspace-types";
import { enoughData } from "@/lib/analytics/min-sample";
import {
  kaplanMeier,
  medianSurvivalTime,
  type SurvivalObservation,
} from "@/lib/analytics/survival";
import { isExampleId } from "@/lib/utils/example-id";
import { isIsoDate, isoDayNumber } from "@/lib/sprints/calendar";
import { linksOf, sprintLengthOr, toScale } from "@/lib/risks/model";

/** The most the interest term can add to a score (about half the top base of 19). */
export const INTEREST_CAP = 10;

/** The highest interest per sprint a write sets (the workspace schema's bound too). */
export const INTEREST_RATE_MAX = 100;

/** The longest title: a backlog story's (STORY_TITLE_MAX), so "Add to backlog" never cuts it. */
export const DEBT_TITLE_MAX = 200;
/** The longest description. */
export const DEBT_TEXT_MAX = 4000;
/** The longest area name. */
export const DEBT_AREA_MAX = 120;

/** The area key for items with no area, in the per-area counts (the agent's byArea has used it). */
export const UNASSIGNED_AREA = "__unassigned";

/** Whether the item is still open (no resolvedAt). */
export const isOpenDebt = (t: Pick<TechDebtItem, "resolvedAt">): boolean => !t.resolvedAt;

/** A stored 1–5 rating as the score reads it: on the scale, and 3 when it isn't a number. */
export const debtScale = (v: unknown): number => toScale(v) ?? 3;

/** The interest per sprint the score counts: a finite rate from 0, else 0 (not estimated). */
export function interestOf(t: Pick<TechDebtItem, "interestRate">): number {
  const r = t.interestRate;
  return typeof r === "number" && Number.isFinite(r) ? Math.max(0, r) : 0;
}

/** Whether the interest per sprint was estimated (a finite number stored, 0 included). */
export const isInterestEstimated = (t: Pick<TechDebtItem, "interestRate">): boolean =>
  typeof t.interestRate === "number" && Number.isFinite(t.interestRate);

/** The "YYYY-MM-DD" a stored date starts with when it is a real day (a timestamp reads as its date). */
function dayOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const day = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && isIsoDate(day) ? day : undefined;
}

/**
 * Calendar days from the day it was raised to the day it was resolved
 * (today while open); null when raisedAt isn't a day; never negative (a
 * raised day after today, or a resolved day before the raised one, is 0).
 */
export function debtAgeDays(
  t: Pick<TechDebtItem, "raisedAt" | "resolvedAt">,
  today: string
): number | null {
  const from = isoDayNumber(dayOf(t.raisedAt));
  const to = isoDayNumber(dayOf(t.resolvedAt) ?? dayOf(today));
  if (from === null || to === null) return null;
  return Math.max(0, to - from);
}

/**
 * Its age in whole sprints of the team's cadence: ⌊days ÷ sprintLengthDays⌋
 * (a length that isn't a whole number of days from 1 reads as 14). The age
 * stops growing once the item is resolved. Null when raisedAt isn't a day.
 */
export function debtAgeSprints(
  t: Pick<TechDebtItem, "raisedAt" | "resolvedAt">,
  sprintLengthDays: number,
  today: string
): number | null {
  const days = debtAgeDays(t, today);
  return days === null ? null : Math.floor(days / sprintLengthOr(sprintLengthDays));
}

export interface DebtScore {
  /** impact × 4 − effort, each on the 1–5 scale: −1 to 19. */
  base: number;
  /** min(INTEREST_CAP, interest per sprint × age in sprints); 0 when not estimated or the age is unknown. */
  interest: number;
  /** Whether the cap cut the interest term. */
  capped: boolean;
  /** base + interest. */
  total: number;
}

/**
 * The item's score at `ageSprints` (null, an unknown age, adds no
 * interest). Takes any numbers, so a hypothetical item (the agent's
 * compute_priority) scores the same way as a stored one.
 */
export function debtScore(
  t: { impact: number; effort: number; interestRate?: number },
  ageSprints: number | null
): DebtScore {
  const base = debtScale(t.impact) * 4 - debtScale(t.effort);
  const age = typeof ageSprints === "number" && ageSprints > 0 ? ageSprints : 0;
  const raw = interestOf(t) * age;
  const interest = Math.min(INTEREST_CAP, raw);
  return { base, interest, capped: raw > INTEREST_CAP, total: base + interest };
}

/** An item with the numbers it is ranked by. */
export interface RankedDebt {
  item: TechDebtItem;
  ageDays: number | null;
  ageSprints: number | null;
  score: DebtScore;
}

/** The item's age and score on `today` with the team's sprint length. */
export function rankDebt(item: TechDebtItem, sprintLengthDays: number, today: string): RankedDebt {
  const ageSprints = debtAgeSprints(item, sprintLengthDays, today);
  return {
    item,
    ageDays: debtAgeDays(item, today),
    ageSprints,
    score: debtScore(item, ageSprints),
  };
}

/** Open before resolved, then the highest total, then the oldest, then by title. */
export function compareDebt(a: RankedDebt, b: RankedDebt): number {
  const open = Number(isOpenDebt(b.item)) - Number(isOpenDebt(a.item));
  if (open) return open;
  const total = b.score.total - a.score.total;
  if (total) return total;
  const age = (b.ageSprints ?? -1) - (a.ageSprints ?? -1);
  if (age) return age;
  return (a.item.title ?? "").localeCompare(b.item.title ?? "");
}

/** compareDebt on the items themselves, for a stable-order hook that sorts the rows. */
export function debtComparator(
  sprintLengthDays: number,
  today: string
): (a: TechDebtItem, b: TechDebtItem) => number {
  return (a, b) =>
    compareDebt(rankDebt(a, sprintLengthDays, today), rankDebt(b, sprintLengthDays, today));
}

/** The items ranked, in the page's order. */
export function rankedDebt(
  items: readonly TechDebtItem[],
  sprintLengthDays: number,
  today: string
): RankedDebt[] {
  return items.map((t) => rankDebt(t, sprintLengthDays, today)).sort(compareDebt);
}

/** The newest link the item was put on the backlog through, if any. */
export function backlogLinkOf(t: Pick<TechDebtItem, "sentTo">): HandoffLink | undefined {
  const links = (t.sentTo ?? []).filter((l) => l.route === "backlog-story");
  return links[links.length - 1];
}

/**
 * The backlog story the item was sent to, when it still exists among
 * `stories`: its id and whether it is done (the page's "mark resolved"
 * nudge). Null when it was never sent or its story is gone.
 */
export function debtStoryOf(
  t: Pick<TechDebtItem, "sentTo">,
  stories: readonly Pick<Story, "id" | "status">[]
): { storyId: string; done: boolean } | null {
  const link = backlogLinkOf(t);
  const story = link ? stories.find((s) => s.id === link.targetId) : undefined;
  return story ? { storyId: story.id, done: story.status === "done" } : null;
}

/**
 * Whether example rows count. Left out by default (the agent and the next
 * steps count the team's own); a page holding only its example passes
 * true to show the example's own numbers.
 */
export interface DebtCountOptions {
  includeExamples?: boolean;
}

export interface DebtSummary {
  /** Real open items (example rows are left out of every count here, unless included). */
  open: number;
  resolved: number;
  /** Σ interest per sprint over open items whose interest is estimated. */
  interestPerSprint: number;
  /** Open items with no interest estimate. */
  unestimated: number;
  /** The oldest open item's age in sprints; null with none open (or no known age). */
  oldestSprints: number | null;
  /** Open items per area (trimmed; UNASSIGNED_AREA for none). */
  openByArea: Record<string, number>;
  /** The area with the most impact points of open debt, or null when no open item has an area. */
  hotspot: { area: string; impact: number } | null;
  /** Open items on the backlog: with a backlog story that still exists (with `stories`), or any backlog link without. */
  inBacklog: number;
}

/** The page's numbers, examples left out unless included. Pass `stories` to count only links whose story still exists. */
export function debtSummary(
  items: readonly TechDebtItem[],
  sprintLengthDays: number,
  today: string,
  stories?: readonly Pick<Story, "id" | "status">[],
  { includeExamples = false }: DebtCountOptions = {}
): DebtSummary {
  const s: DebtSummary = {
    open: 0,
    resolved: 0,
    interestPerSprint: 0,
    unestimated: 0,
    oldestSprints: null,
    openByArea: {},
    hotspot: null,
    inBacklog: 0,
  };
  const impactByArea = new Map<string, number>();
  for (const t of items) {
    if (!includeExamples && isExampleId(t.id)) continue;
    if (!isOpenDebt(t)) {
      s.resolved += 1;
      continue;
    }
    s.open += 1;
    if (isInterestEstimated(t)) s.interestPerSprint += interestOf(t);
    else s.unestimated += 1;
    const age = debtAgeSprints(t, sprintLengthDays, today);
    if (age !== null && (s.oldestSprints === null || age > s.oldestSprints)) s.oldestSprints = age;
    const area = (t.area ?? "").trim();
    const key = area || UNASSIGNED_AREA;
    s.openByArea[key] = (s.openByArea[key] ?? 0) + 1;
    if (area) impactByArea.set(area, (impactByArea.get(area) ?? 0) + debtScale(t.impact));
    if (stories ? debtStoryOf(t, stories) : backlogLinkOf(t)) s.inBacklog += 1;
  }
  for (const [area, impact] of Array.from(impactByArea.entries())) {
    if (!s.hotspot || impact > s.hotspot.impact) s.hotspot = { area, impact };
  }
  return s;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A number for a sentence: whole, or one decimal. */
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** A title for a sentence: trimmed, one line, cut at 60. */
function quote(title: string): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim() || "Untitled item";
  return `“${t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t}”`;
}

/**
 * One sentence on the debt, examples left out unless included: how many
 * items are open and what they cost a sprint, then the top one by score
 * and its age, e.g. '7 open items cost about 4.5 points a sprint; the top
 * one, “Flaky deploy script”, is 6 sprints old.'
 */
export function debtVerdict(
  items: readonly TechDebtItem[],
  sprintLengthDays: number,
  today: string,
  { includeExamples = false }: DebtCountOptions = {}
): string {
  const real = includeExamples ? items : items.filter((t) => !isExampleId(t.id));
  if (real.length === 0) return "No tech debt logged yet.";
  const s = debtSummary(real, sprintLengthDays, today, undefined, { includeExamples });
  if (s.open === 0) {
    return s.resolved === 1
      ? "The one debt item logged is paid down."
      : `All ${s.resolved} debt items are paid down.`;
  }
  const top = rankedDebt(real, sprintLengthDays, today)[0];
  const cost =
    s.unestimated === s.open
      ? `${plural(s.open, "open item")}, none with an interest estimate`
      : `${plural(s.open, "open item")} ${s.open === 1 ? "costs" : "cost"} about ${num(
          s.interestPerSprint
        )} ${
          s.interestPerSprint === 1 ? "point" : "points"
        } a sprint${s.unestimated > 0 ? ` (${s.unestimated} not estimated)` : ""}`;
  const age =
    top.ageSprints === null
      ? ""
      : top.ageSprints === 0
        ? "was raised this sprint and "
        : `is ${plural(top.ageSprints, "sprint")} old and `;
  return `${cost}; the top one, ${quote(top.item.title)}, ${age}scores ${num(top.score.total)}${
    top.score.capped ? " (interest capped)" : ""
  }.`;
}

/* ── Time to pay down ──────────────────────────────────────────────────── */

/**
 * Days raised → resolved for each item with a raised day (debtAgeDays),
 * open items censored at today (still waiting): what the time to pay down
 * and the page's survival curve are read from.
 */
export function debtPayDownObservations(
  items: readonly TechDebtItem[],
  today: string
): SurvivalObservation[] {
  return items.flatMap((t) => {
    const duration = debtAgeDays(t, today);
    return duration === null ? [] : [{ duration, event: !isOpenDebt(t) }];
  });
}

export interface DebtTimeToResolve {
  /** Items paid down. */
  resolved: number;
  /**
   * The Kaplan-Meier median days from raised to resolved, open items
   * counted as still waiting; null below MIN_SAMPLE.distribution paid-down
   * items, or while fewer than half are.
   */
  medianDays: number | null;
}

/**
 * How long debt takes to pay down, the median under the page's survival
 * curve and tool.tech_debt.list_state's timeToResolve. Every item passed
 * counts, so the caller leaves the examples out.
 */
export function debtTimeToResolve(
  items: readonly TechDebtItem[],
  today: string
): DebtTimeToResolve {
  const observations = debtPayDownObservations(items, today);
  const resolved = observations.filter((o) => o.event).length;
  return {
    resolved,
    medianDays: enoughData(resolved, "distribution")
      ? medianSurvivalTime(kaplanMeier(observations))
      : null,
  };
}

/* ── Reading a stored row ──────────────────────────────────────────────── */

function textOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/**
 * A stored item in today's shape, or null when it can't be one (no id).
 * For the old Tech Debt blob's rows: impact and effort on the 1–5 scale
 * (one that isn't a number reads as 3), the interest kept when it is a
 * finite number and clamped into 0–INTEREST_RATE_MAX (a cleared field's 0
 * stays 0), dates read as their day (raisedAt "" when it isn't one:
 * unknown; a resolved date that isn't one is dropped), blank text and tags
 * dropped. Every Phase 8 field carries over when present.
 */
export function normalizeTechDebt(raw: unknown): TechDebtItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id : null;
  if (!id) return null;
  const description = textOf(r.description);
  const area = textOf(r.area);
  const rate =
    typeof r.interestRate === "number" && Number.isFinite(r.interestRate)
      ? Math.max(0, Math.min(INTEREST_RATE_MAX, r.interestRate))
      : undefined;
  const resolvedAt = dayOf(r.resolvedAt);
  const tags = Array.isArray(r.tags)
    ? Array.from(new Set(r.tags.map(textOf).filter((x): x is string => x !== undefined)))
    : [];
  const sentTo = linksOf(r.sentTo);
  const updatedAt = textOf(r.updatedAt);
  return {
    id,
    title: typeof r.title === "string" ? r.title.trim() : "",
    ...(description ? { description } : {}),
    ...(area ? { area } : {}),
    impact: debtScale(r.impact) as TechDebtItem["impact"],
    effort: debtScale(r.effort) as TechDebtItem["effort"],
    ...(rate !== undefined ? { interestRate: rate } : {}),
    raisedAt: dayOf(r.raisedAt) ?? "",
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(sentTo ? { sentTo } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}
