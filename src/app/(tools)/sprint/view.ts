/**
 * What the Sprint Cockpit says about one sprint, as plain data: the state
 * of each ceremony, the numbers (read off the sprint board, else the typed
 * daily log), the blockers in the sprint's window, and this sprint's review
 * and retro. Pure, so the page, the home card and the Markdown export agree
 * and tests can check the wording without rendering.
 */

import type {
  AsyncUpdate,
  Impediment,
  RetroBoard,
  Sprint,
  SprintReview,
  SprintSeries,
  StandupEntry,
  Story,
  TeamMember,
} from "@/lib/stores/workspace-types";
import {
  completionPct,
  gap as gapOf,
  gapLabel,
  projectFinish,
  sprintStatus,
  type SprintStatus,
} from "@/lib/sprints/metrics";
import {
  averageVelocity,
  completedSprints,
  fmt,
  hubTiles,
  type Tile,
  type TileId,
} from "@/lib/sprints/hub-view";
import { CEREMONY_HREF, CEREMONY_LABEL, type CeremonyKind } from "@/lib/sprints/cadence";
import {
  dayForDate,
  hasSyntheticDates,
  idealRemainingAt,
  sprintLengthDays,
  todayIso,
} from "@/lib/sprints/series";
import {
  remainingToday,
  storyProgress,
  type RemainingToday,
  type StoryProgress,
} from "@/lib/sprints/progress";
import { DRAFT_REVIEW_ID, reviewDocId, reviewHasContent } from "@/lib/sprints/review-doc";
import { isExampleSprintId } from "@/lib/sprints/example";
import {
  addDays,
  dayOf,
  daysBetween,
  impedimentStatus,
  isImpedimentOverdue,
  isResolved,
  openDuring,
  sortImpediments,
} from "@/lib/impediments/model";
import { allStandupEntries, hasBlocker } from "@/lib/standup/entries";
import type { HandoffLink } from "@/lib/handoffs/types";
import { RETRO_CURRENT_ID, collectRetroActions, type RetroAction } from "@/lib/retro/actions";
import type { ChartText } from "@/lib/charts/chart-text";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import { burndownView } from "@/app/(tools)/burndown/view";
import { burndownChartText } from "@/app/(tools)/burndown/chart-text";
import type { BurndownChartRow } from "@/app/(tools)/burndown/charts";

export { RETRO_CURRENT_ID };

/** Where every planning card goes: the Sprint Planning page. */
export const PLANNING_HREF = CEREMONY_HREF.planning;

export interface StandupToday {
  /** Team members with an entry today. */
  posted: number;
  /** Roster size; 0 when no roster is kept. */
  members: number;
  /** Entries today with an unresolved blocker. */
  blockers: number;
}

export interface ReviewPrep {
  demoItems: number;
  feedback: number;
  /** The review has something in it: demo items, feedback or checklist ticks. */
  started?: boolean;
  /** Read from the draft review, because the sprint has no review of its own yet. */
  fromDraft?: boolean;
}

export interface RetroState {
  /** This sprint has a retro: one archived in its window, or the current board with cards. */
  hasRetro: boolean;
  /** Action items still open, across every retro. */
  openActions: number;
  /** Open actions past their due date. */
  overdue: number;
  /** Cards on the current (unfinished) board, when it counts as this sprint's retro. */
  currentCards: number;
  /** When this sprint's retro was archived, if it was. */
  archivedAt?: string;
}

export interface CockpitInput {
  sprint: Sprint;
  status: SprintStatus;
  /** Stories planned into this sprint. */
  sprintStories: readonly Story[];
  /** Backlog stories (no sprint) without points. */
  backlogUnestimated: number;
  standup: StandupToday;
  /** Unresolved impediments in the sprint's way (`sprintImpediments`). */
  openImpediments: readonly Impediment[];
  review: ReviewPrep;
  retro: RetroState;
}

export type FlowState = "todo" | "doing" | "done";

export interface FlowCard {
  kind: CeremonyKind;
  label: string;
  state: FlowState;
  /** One line on where this ceremony stands. */
  line: string;
  href: string;
  /** The link's text. */
  cta: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * `path` opened on `sprint` (the `?sprint=` link of `sprintHref` in
 * lib/sprints/use-selected-sprint, which this pure module can't import: it
 * loads the store). The example's sprints don't exist there, so their links
 * stay plain.
 */
function onSprint(path: string, sprint: Pick<Sprint, "id">): string {
  return isExampleSprintId(sprint.id) ? path : `${path}?sprint=${encodeURIComponent(sprint.id)}`;
}

export function storyCounts(stories: readonly Story[]): {
  total: number;
  done: number;
  unestimated: number;
} {
  return {
    total: stories.length,
    done: stories.filter((s) => s.status === "done").length,
    unestimated: stories.filter((s) => !(typeof s.points === "number" && s.points > 0)).length,
  };
}

/** The five cards of the ceremony strip, Planning to Retro. */
export function flowCards(input: CockpitInput): FlowCard[] {
  const { sprint, sprintStories, backlogUnestimated, standup, review, retro } = input;
  const counts = storyCounts(sprintStories);
  const goal = Boolean(sprint.goal?.trim());
  const committed = sprint.pointsPlanned > 0;

  let planning: FlowCard;
  if (goal && committed) {
    planning = {
      kind: "planning",
      label: CEREMONY_LABEL.planning,
      state: "done",
      line: `Goal set · ${fmt(sprint.pointsPlanned)} pts committed${
        counts.total > 0 ? ` · ${plural(counts.total, "story", "stories")}` : ""
      }`,
      href: PLANNING_HREF,
      cta: "Review the plan",
    };
  } else if (goal) {
    planning = {
      kind: "planning",
      label: CEREMONY_LABEL.planning,
      state: "doing",
      line: "Goal set · no points committed yet",
      href: PLANNING_HREF,
      cta: "Set the commitment",
    };
  } else if (committed) {
    planning = {
      kind: "planning",
      label: CEREMONY_LABEL.planning,
      state: "doing",
      line: `${fmt(sprint.pointsPlanned)} pts committed · no goal yet`,
      href: PLANNING_HREF,
      cta: "Write the goal",
    };
  } else {
    planning = {
      kind: "planning",
      label: CEREMONY_LABEL.planning,
      state: "todo",
      line: "No goal or commitment yet",
      href: PLANNING_HREF,
      cta: "Plan the sprint",
    };
  }

  const blockers = standup.blockers > 0 ? ` · ${plural(standup.blockers, "blocker")}` : "";
  let daily: FlowCard;
  if (standup.members > 0 && standup.posted >= standup.members) {
    daily = {
      kind: "daily",
      label: CEREMONY_LABEL.daily,
      state: "done",
      line: `Everyone updated today${blockers}`,
      href: CEREMONY_HREF.daily,
      cta: "Open the standup",
    };
  } else if (standup.posted > 0) {
    daily = {
      kind: "daily",
      label: CEREMONY_LABEL.daily,
      state: "doing",
      line:
        standup.members > 0
          ? `${standup.posted} of ${standup.members} updated today${blockers}`
          : `${plural(standup.posted, "update")} today${blockers}`,
      href: CEREMONY_HREF.daily,
      cta: "Continue the standup",
    };
  } else {
    daily = {
      kind: "daily",
      label: CEREMONY_LABEL.daily,
      state: "todo",
      line: "No updates yet today",
      href: CEREMONY_HREF.daily,
      cta: "Run the daily",
    };
  }

  let refinement: FlowCard;
  if (counts.unestimated > 0) {
    refinement = {
      kind: "refinement",
      label: CEREMONY_LABEL.refinement,
      state: "doing",
      line: `${plural(counts.unestimated, "sprint story", "sprint stories")} without points`,
      href: "/planning-poker",
      cta: "Estimate them",
    };
  } else if (backlogUnestimated > 0) {
    refinement = {
      kind: "refinement",
      label: CEREMONY_LABEL.refinement,
      state: "todo",
      line: `${plural(backlogUnestimated, "backlog story", "backlog stories")} to size`,
      href: CEREMONY_HREF.refinement,
      cta: "Refine the backlog",
    };
  } else if (counts.total > 0) {
    refinement = {
      kind: "refinement",
      label: CEREMONY_LABEL.refinement,
      state: "done",
      line: `All ${plural(counts.total, "sprint story", "sprint stories")} sized`,
      href: CEREMONY_HREF.refinement,
      cta: "Check readiness",
    };
  } else {
    refinement = {
      kind: "refinement",
      label: CEREMONY_LABEL.refinement,
      state: "todo",
      line: "No stories in the sprint yet",
      href: CEREMONY_HREF.refinement,
      cta: "Refine the backlog",
    };
  }

  // The review is one document per sprint, so its link opens on this one.
  const reviewHref = onSprint(CEREMONY_HREF.review, sprint);
  const draft = review.fromDraft ? " · in the draft review" : "";
  let reviewCard: FlowCard;
  if (review.demoItems > 0) {
    reviewCard = {
      kind: "review",
      label: CEREMONY_LABEL.review,
      state: "done",
      line: `${plural(review.demoItems, "demo item")}${
        review.feedback > 0 ? ` · ${plural(review.feedback, "feedback note")}` : ""
      }${draft}`,
      href: reviewHref,
      cta: "Open the review kit",
    };
  } else if (review.started) {
    reviewCard = {
      kind: "review",
      label: CEREMONY_LABEL.review,
      state: "doing",
      line: `Review started · no demo items yet${draft}`,
      href: reviewHref,
      cta: "Continue the review",
    };
  } else {
    reviewCard = {
      kind: "review",
      label: CEREMONY_LABEL.review,
      state: "todo",
      line: "No demo script yet",
      href: reviewHref,
      cta: "Prepare the review",
    };
  }

  let retroCard: FlowCard;
  if (retro.currentCards > 0) {
    retroCard = {
      kind: "retro",
      label: CEREMONY_LABEL.retro,
      state: "doing",
      line: `Retro in progress · ${plural(retro.currentCards, "card")}`,
      href: CEREMONY_HREF.retro,
      cta: "Continue the retro",
    };
  } else if (!retro.hasRetro) {
    retroCard = {
      kind: "retro",
      label: CEREMONY_LABEL.retro,
      state: "todo",
      line: `No retro for this sprint yet${
        retro.openActions > 0 ? ` · ${plural(retro.openActions, "open action")}` : ""
      }`,
      href: CEREMONY_HREF.retro,
      cta: "Open the retro board",
    };
  } else if (retro.openActions > 0) {
    retroCard = {
      kind: "retro",
      label: CEREMONY_LABEL.retro,
      state: "doing",
      line: `${plural(retro.openActions, "open action")}${
        retro.overdue > 0 ? ` (${retro.overdue} overdue)` : ""
      }`,
      href: "/retro-actions",
      cta: "Follow up",
    };
  } else {
    retroCard = {
      kind: "retro",
      label: CEREMONY_LABEL.retro,
      state: "done",
      line: "No open retro actions",
      href: "/retro-actions",
      cta: "See past actions",
    };
  }

  return [planning, daily, refinement, reviewCard, retroCard];
}

/* ── Blockers ──────────────────────────────────────────────────────────── */

/** Unresolved impediments: escalated first, then overdue, worst and oldest. */
export function openImpediments(all: readonly Impediment[], today = todayIso()): Impediment[] {
  return sortImpediments(
    all.filter((i) => !isResolved(i)),
    today
  );
}

/**
 * The impediments in `sprint`'s way: raised by its last day and not
 * resolved before its first (`openDuring`), in the Impediments page's order
 * (escalated, then overdue, worst and oldest; resolved ones last). Viewing
 * an earlier sprint no longer shows today's blockers. A sprint without real
 * dates can't be placed, so it gets every unresolved impediment, as before.
 */
export function sprintImpediments(
  all: readonly Impediment[],
  sprint: Pick<Sprint, "startDate" | "endDate">,
  today: string
): Impediment[] {
  if (hasSyntheticDates(sprint)) return openImpediments(all, today);
  const start = dayOf(sprint.startDate) as string;
  const end = dayOf(sprint.endDate) as string;
  return sortImpediments(
    all.filter((i) => openDuring(i, start, end)),
    today
  );
}

export interface BlockersTileOptions {
  /** Open stories flagged as blocked on the sprint board. */
  blockedStories?: number;
  /** YYYY-MM-DD, for the overdue count; without it nothing counts as overdue. */
  today?: string;
}

/** The "Open blockers" tile: unresolved impediments plus blocked stories. */
export function blockersTile(
  open: readonly Impediment[],
  { blockedStories = 0, today }: BlockersTileOptions = {}
): Tile {
  const unresolved = open.filter((i) => !isResolved(i));
  const total = unresolved.length + blockedStories;
  const escalated = unresolved.filter((i) => impedimentStatus(i) === "escalated").length;
  const overdue = today ? unresolved.filter((i) => isImpedimentOverdue(i, today)).length : 0;
  const high = unresolved.filter((i) => i.severity === "high" || i.severity === "critical").length;
  const notes = [
    escalated > 0 ? `${escalated} escalated` : "",
    overdue > 0 ? `${overdue} overdue` : "",
    high > 0 ? `${high} high or critical` : "",
    blockedStories > 0 ? plural(blockedStories, "blocked story", "blocked stories") : "",
  ].filter(Boolean);
  // "impediments" while only impediments count, as the Impediments page says.
  const unit =
    blockedStories > 0
      ? total === 1
        ? "blocker"
        : "blockers"
      : total === 1
        ? "impediment"
        : "impediments";
  return {
    id: "blockers",
    label: "Open blockers",
    value: String(total),
    unit,
    hint:
      notes.length > 0
        ? notes.join(" · ")
        : total > 0
          ? "None high or critical"
          : "Nothing blocking the team",
    tone: notes.length > 0 ? "warning" : total > 0 ? "default" : "success",
  };
}

/** "Day 3 of 10 · 7 days left", or what the hub says when dates are missing. */
export function daysLeftLine(dayLine: string): string {
  const m = /^Day (\d+) of (\d+)$/.exec(dayLine);
  if (!m) return dayLine;
  const left = Number(m[2]) - Number(m[1]);
  return `${dayLine} · ${left === 0 ? "last day" : `${plural(left, "day")} left`}`;
}

/* ── Review and retro, per sprint ──────────────────────────────────────── */

/**
 * The review to show for `sprint`: its own document (`reviewDocId`), even
 * an empty one. Without one, the draft (`sprint-review:current`, the single
 * review from before reviews were per sprint) when it has something in it
 * and isn't another sprint's. Never "any review that exists".
 */
export function reviewFor(
  reviews: readonly SprintReview[],
  sprint: Pick<Sprint, "id">
): { doc: SprintReview | undefined; fromDraft: boolean } {
  const own = reviews.find((r) => r.id === reviewDocId(sprint.id));
  if (own) return { doc: own, fromDraft: false };
  const draft = reviews.find((r) => r.id === DRAFT_REVIEW_ID);
  if (draft && reviewHasContent(draft) && (!draft.sprintId || draft.sprintId === sprint.id)) {
    return { doc: draft, fromDraft: true };
  }
  return { doc: undefined, fromDraft: false };
}

/** Days after a sprint's last day in which its retro can still be archived. */
export const RETRO_GRACE_DAYS = 7;

/** The local calendar day of a timestamp (or a plain "YYYY-MM-DD" as it is). */
export function localDay(value: string | undefined | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? todayIso(new Date(t)) : dayOf(value);
}

/** The days `sprint`'s retro can fall in: its first day to a week after its last. */
export function retroWindow(
  sprint: Pick<Sprint, "startDate" | "endDate">
): { start: string; end: string } | null {
  if (hasSyntheticDates(sprint)) return null;
  const start = dayOf(sprint.startDate) as string;
  return { start, end: addDays(dayOf(sprint.endDate) as string, RETRO_GRACE_DAYS) };
}

/**
 * The sprint a retro board names. Boards don't record one yet; Phase 4 adds
 * `RetroBoard.sprintId`, and this is the one place that reads it, so the
 * day-window guesses below give way to it as soon as boards carry it.
 */
function boardSprintId(board: RetroBoard): string | undefined {
  const id = (board as RetroBoard & { sprintId?: unknown }).sprintId;
  return typeof id === "string" && id ? id : undefined;
}

/**
 * Whether an archived board is `sprint`'s retro: it was archived in the
 * sprint's window, and of the sprints whose windows hold that day, this one
 * ended nearest to it (a retro archived two days into the next sprint is
 * still the last one's). A tie goes to the sprint that had already ended.
 */
function isArchivedRetroOf(board: RetroBoard, sprint: Sprint, sprints: readonly Sprint[]): boolean {
  const day = localDay(board.archivedAt);
  if (!day) return false;
  const candidates = [
    sprint,
    ...sprints.filter((s) => s.id !== sprint.id && s.status !== "cancelled"),
  ];
  let best: { id: string; distance: number; ended: boolean } | null = null;
  for (const s of candidates) {
    const w = retroWindow(s);
    if (!w || day < w.start || day > w.end) continue;
    const end = dayOf(s.endDate) as string;
    const distance = Math.abs(daysBetween(end, day));
    const ended = end <= day;
    if (!best || distance < best.distance || (distance === best.distance && ended && !best.ended)) {
      best = { id: s.id, distance, ended };
    }
  }
  return best?.id === sprint.id;
}

export interface SprintRetro {
  /** The current board, when it has cards and counts as this sprint's retro in progress. */
  current?: RetroBoard;
  /** This sprint's archived retro (the latest, if several). */
  archived?: RetroBoard;
}

/**
 * `sprint`'s retro. The current board with cards is its retro in progress
 * while today is in the sprint's window (any day for a sprint without
 * dates), so an old sprint doesn't claim today's board; an archived board
 * counts when `isArchivedRetroOf` says so.
 */
export function retroFor(
  boards: readonly RetroBoard[],
  sprint: Sprint,
  sprints: readonly Sprint[],
  today: string
): SprintRetro {
  const out: SprintRetro = {};
  const window = retroWindow(sprint);
  for (const board of boards) {
    const tagged = boardSprintId(board);
    if (!board.archivedAt) {
      if (board.id !== RETRO_CURRENT_ID || board.cards.length === 0) continue;
      const mine = tagged
        ? tagged === sprint.id
        : !window || (today >= window.start && today <= window.end);
      if (mine) out.current = board;
      continue;
    }
    const mine = tagged ? tagged === sprint.id : isArchivedRetroOf(board, sprint, sprints);
    if (mine && (!out.archived || board.archivedAt > (out.archived.archivedAt ?? ""))) {
      out.archived = board;
    }
  }
  return out;
}

/* ── Numbers: the board first, the typed log as the fallback ───────────── */

/** The line the ideal burndown starts from: the commitment, else the board's scope. */
export function idealBase(sprint: Pick<Sprint, "pointsPlanned">, progress: StoryProgress): number {
  return sprint.pointsPlanned > 0 ? sprint.pointsPlanned : progress.scope;
}

/** The chart's rows from the typed daily log: the ideal line and what Burndown and Burnup logged. */
export function logBurndownRows(sprint: Sprint, series: SprintSeries | undefined) {
  const length = sprintLengthDays(sprint);
  const view = burndownView(sprint, series);
  const rows: BurndownChartRow[] = view.entries
    .filter((e) => e.day <= length)
    .map((e) => ({
      day: e.day,
      ideal: round1(length > 0 ? sprint.pointsPlanned * (1 - e.day / length) : 0),
      actual: e.remaining,
    }));
  return { rows, scopeChangeDays: view.scopeChangeDays, length };
}

/** When a done story was done: `doneAt`, else its last move into done. */
function doneDay(story: Story): string | null {
  if (story.doneAt) return localDay(story.doneAt);
  const history = story.statusHistory ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === "done") return localDay(history[i].at);
  }
  return null;
}

/**
 * The burndown read off the board: for every day up to today, the sprint's
 * points minus those of the stories done by then. The scope is today's (the
 * board doesn't record when a story joined the sprint), and a done story
 * with no done time, from before the board kept them, counts from day 0.
 * Stories done after the last day count on it, so the last point is the
 * tiles' "Remaining". Days after today carry only the ideal line.
 */
export function boardBurndownRows(
  sprint: Sprint,
  stories: readonly Story[],
  today: string,
  progress: StoryProgress = storyProgress(stories, sprint.id)
): BurndownChartRow[] {
  const length = sprintLengthDays(sprint);
  const base = idealBase(sprint, progress);
  const todayDay = hasSyntheticDates(sprint) ? null : dayForDate(sprint, today);
  const last = todayDay === null ? -1 : Math.min(todayDay, length);
  const burnt = new Array<number>(Math.max(0, last + 1)).fill(0);
  if (last >= 0) {
    for (const story of stories) {
      if (story.sprintId !== sprint.id || story.status !== "done") continue;
      const points =
        typeof story.points === "number" && Number.isFinite(story.points) ? story.points : 0;
      if (points <= 0) continue;
      const day = doneDay(story);
      const at = day === null ? 0 : (dayForDate(sprint, day) ?? 0);
      burnt[Math.min(last, Math.max(0, at))] += points;
    }
  }
  const rows: BurndownChartRow[] = [];
  let done = 0;
  for (let day = 0; day <= length; day++) {
    if (day <= last) done += burnt[day];
    rows.push({
      day,
      ideal: round1(idealRemainingAt(sprint, base, day)),
      actual: day <= last ? round1(Math.max(0, progress.scope - done)) : null,
    });
  }
  return rows;
}

export interface CockpitBurndown {
  /** Where "points left" comes from: the pointed stories, the typed daily log, or nothing yet. */
  source: RemainingToday["source"];
  /** Points left now (`remainingToday`). */
  remaining: RemainingToday;
  rows: BurndownChartRow[];
  scopeChangeDays: number[];
  /** The sprint's last day. */
  length: number;
  /** Today's sprint day, when today falls inside the sprint. */
  todayDay: number | null;
}

/**
 * The burndown the cockpit draws: the board's when the sprint has pointed
 * stories (`remainingToday` decides, as every delivery chart does), else
 * the typed daily log's.
 */
export function cockpitBurndown(
  sprint: Sprint,
  series: SprintSeries | undefined,
  stories: readonly Story[],
  today: string,
  progress: StoryProgress = storyProgress(stories, sprint.id)
): CockpitBurndown {
  const remaining = remainingToday({ sprint, stories, series, today });
  const length = sprintLengthDays(sprint);
  const d = dayForDate(sprint, today);
  const todayDay = d !== null && d >= 0 && d <= length ? d : null;
  if (remaining.source === "stories") {
    return {
      source: "stories",
      remaining,
      rows: boardBurndownRows(sprint, stories, today, progress),
      scopeChangeDays: [],
      length,
      todayDay,
    };
  }
  const log = logBurndownRows(sprint, series);
  return {
    source: remaining.source,
    remaining,
    rows: log.rows,
    scopeChangeDays: log.scopeChangeDays,
    length,
    todayDay,
  };
}

/**
 * The burndown in words (Burndown's own summary and table), except that a
 * board-read chart before the sprint starts says so rather than "No days
 * logged": nothing is typed on the board.
 */
export function cockpitChartText(burndown: CockpitBurndown): ChartText {
  const text = burndownChartText(burndown.rows);
  const { rows } = burndown;
  if (
    burndown.source !== "stories" ||
    rows.length === 0 ||
    rows.some((r) => typeof r.actual === "number")
  ) {
    return text;
  }
  return {
    ...text,
    summary: `Nothing has burned down yet; the ideal line falls from ${fmt(rows[0].ideal)} points to 0 by day ${rows[rows.length - 1].day}.`,
  };
}

/**
 * The days "points left" can be typed for: day 0 up to today, or up to the
 * last day once the sprint is over. None before it starts or without dates.
 */
export function loggableDays(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  today: string
): number[] {
  if (hasSyntheticDates(sprint)) return [];
  const d = dayForDate(sprint, today);
  if (d === null || d < 0) return [];
  const last = Math.min(d, sprintLengthDays(sprint));
  return Array.from({ length: last + 1 }, (_, i) => i);
}

export interface DayLogDraft {
  day: string;
  remaining: string;
}

export interface DayLogValues {
  day: number;
  remaining: number;
}

/** A day's "points left": a day the sprint has had, and 0 or more points (blank isn't 0). */
export function validateDayLog(
  draft: DayLogDraft,
  days: readonly number[]
): Validation<DayLogValues, keyof DayLogDraft> {
  const errors: FormErrors<keyof DayLogDraft> = {};
  const day = parseNumber(draft.day);
  if (day === undefined || !days.includes(day)) errors.day = "Pick a day of the sprint.";
  const remaining = parseNumber(draft.remaining);
  if (remaining === undefined || !Number.isFinite(remaining) || remaining < 0) {
    errors.remaining = "Enter 0 or more points.";
  }
  if (errors.day || errors.remaining) return { ok: false, errors };
  return { ok: true, values: { day: day as number, remaining: remaining as number } };
}

const FROM_BOARD = "From the sprint board";

/** The hub tiles that the board answers, read off the stories. */
function boardTiles(
  sprint: Sprint,
  p: StoryProgress,
  burndown: CockpitBurndown,
  today: string
): Partial<Record<TileId, Tile>> {
  const committed = sprint.pointsPlanned;
  const change = committed > 0 ? round1(p.scope - committed) : 0;
  const pct = completionPct(p.done, p.scope);
  const open = p.count - p.doneCount;
  const tiles: Partial<Record<TileId, Tile>> = {
    scope: {
      id: "scope",
      label: "Scope now",
      value: fmt(p.scope),
      unit: "points",
      hint:
        committed <= 0
          ? FROM_BOARD
          : change > 0
            ? `+${fmt(change)} since the plan`
            : change < 0
              ? `−${fmt(-change)} since the plan`
              : "No change since the plan",
      tone: change > 0 ? "warning" : "default",
    },
    done: {
      id: "done",
      label: "Done",
      value: fmt(p.done),
      unit: "points",
      hint: pct !== null ? `${pct}% of the scope · from the board` : FROM_BOARD,
      tone: "default",
    },
    remaining: {
      id: "remaining",
      label: "Remaining",
      value: fmt(p.remaining),
      unit: "points",
      hint:
        open === 0
          ? "Every story done · from the board"
          : `${plural(open, "story", "stories")} to go · from the board`,
      tone: "default",
    },
  };

  const dated = !hasSyntheticDates(sprint);
  const day = dated ? dayForDate(sprint, today) : null;
  if (day !== null && day >= 0) {
    const at = Math.min(day, burndown.length);
    const ideal = idealRemainingAt(sprint, idealBase(sprint, p), at);
    const g = gapOf(p.remaining, ideal);
    tiles.gap = {
      id: "gap",
      label: "Pace vs ideal",
      value: gapLabel(g),
      hint: `Ideal: ${fmt(ideal)} left on day ${at}`,
      tone: g > 0 ? "warning" : "success",
    };
  } else {
    tiles.gap = {
      id: "gap",
      label: "Pace vs ideal",
      value: dated ? "Not started yet" : "No dates set",
      tone: "default",
      empty: true,
    };
  }

  const points = burndown.rows.flatMap((r) =>
    typeof r.actual === "number" ? [{ x: r.day, y: r.actual }] : []
  );
  if (p.remaining <= 0) {
    tiles.finish = {
      id: "finish",
      label: "Projected finish",
      value: "Finished",
      hint: "Every pointed story is done",
      tone: "success",
    };
  } else if (points.length === 0) {
    tiles.finish = {
      id: "finish",
      label: "Projected finish",
      value: dated ? "Not started yet" : "No dates set",
      tone: "default",
      empty: true,
    };
  } else {
    const finish = projectFinish(points);
    tiles.finish =
      finish === null
        ? {
            id: "finish",
            label: "Projected finish",
            value: "No trend yet",
            hint:
              points.length < 2
                ? "Move a story to Done tomorrow to see a trend"
                : "The points left aren't going down",
            tone: "default",
            empty: true,
          }
        : {
            id: "finish",
            label: "Projected finish",
            value: `Day ${Math.ceil(finish)}`,
            hint: `Trend of the board · last day is day ${burndown.length}`,
            tone: finish <= burndown.length ? "success" : "warning",
          };
  }
  return tiles;
}

/**
 * The cockpit's tiles: the Sprint Metrics hub's (lib/sprints/hub-view),
 * with the progress tiles read off the board when the sprint has pointed
 * stories, and the blockers tile last.
 */
export function cockpitTiles(
  data: Pick<
    CockpitData,
    "sprint" | "status" | "progress" | "burndown" | "openImpediments" | "blockedStories"
  >,
  sprints: readonly Sprint[],
  today: string
): Tile[] {
  const { sprint, status } = data;
  const hub = hubTiles(sprint, status, averageVelocity(completedSprints(sprints), sprint.id));
  const board =
    data.burndown.source === "stories"
      ? boardTiles(sprint, data.progress, data.burndown, today)
      : null;
  return [
    ...(board ? hub.map((t) => board[t.id] ?? t) : hub),
    blockersTile(data.openImpediments, { blockedStories: data.blockedStories.length, today }),
  ];
}

/* ── Everything the cockpit reads ──────────────────────────────────────── */

const nameKey = (name: string | null | undefined) => (name ?? "").trim().toLowerCase();

export interface CockpitSources {
  sprint: Sprint;
  series: SprintSeries | undefined;
  stories: readonly Story[];
  impediments: readonly Impediment[];
  standupEntries: readonly StandupEntry[];
  /** The async tool's older updates, read alongside the standup entries. */
  asyncUpdates?: readonly AsyncUpdate[];
  teamMembers: readonly TeamMember[];
  retroBoards: readonly RetroBoard[];
  reviews: readonly SprintReview[];
  /** Every sprint, so a retro archived between two sprints goes to the nearer one. */
  sprints?: readonly Sprint[];
  today: string;
  /** Whether a hand-off target is finished (lib/handoffs routes); absent in previews. */
  targetDone?: (link: HandoffLink) => boolean;
}

export interface CockpitData extends CockpitInput {
  /** The open retro actions, for the report. */
  openActions: RetroAction[];
  /** The review shown (`reviewFor`): this sprint's, or the draft. */
  reviewDoc: SprintReview | undefined;
  /** This sprint's archived retro, if it has one. */
  retroBoard?: RetroBoard;
  /** The sprint's stories added up (`storyProgress`). */
  progress: StoryProgress;
  burndown: CockpitBurndown;
  /** Every impediment in the sprint's window, resolved ones last. */
  sprintImpediments: Impediment[];
  /** Open stories in the sprint flagged as blocked. */
  blockedStories: Story[];
}

/** Everything the cockpit shows, read from the other tools' workspace data. */
export function gatherCockpitData(src: CockpitSources): CockpitData {
  const { sprint, series, stories, impediments, teamMembers, retroBoards, reviews, today } = src;
  const sprintStories = stories.filter((s) => s.sprintId === sprint.id);
  const backlogUnestimated = stories.filter(
    (s) => !s.sprintId && s.status === "backlog" && !(typeof s.points === "number" && s.points > 0)
  ).length;
  const progress = storyProgress(stories, sprint.id);

  // Live and async updates are one standup; the async tool's old rows count too.
  const todayEntries = allStandupEntries(src.standupEntries, src.asyncUpdates).filter(
    (e) => e.date === today
  );
  const posted = new Set(todayEntries.map((e) => nameKey(e.member)).filter(Boolean)).size;
  const blockers = todayEntries.filter((e) => hasBlocker(e) && !e.blockerResolved).length;

  const inWindow = sprintImpediments(impediments, sprint, today);
  const retro = retroFor(retroBoards, sprint, src.sprints ?? [sprint], today);
  const actions = collectRetroActions(retroBoards, { today, targetDone: src.targetDone });
  const openActions = actions.filter((a) => !a.done);
  const review = reviewFor(reviews, sprint);

  return {
    sprint,
    status: sprintStatus(sprint, series),
    sprintStories,
    backlogUnestimated,
    standup: { posted, members: teamMembers.length, blockers },
    openImpediments: inWindow.filter((i) => !isResolved(i)),
    review: {
      demoItems: review.doc?.features.length ?? 0,
      feedback: review.doc?.feedbackItems.length ?? 0,
      started: reviewHasContent(review.doc),
      ...(review.fromDraft ? { fromDraft: true } : {}),
    },
    retro: {
      hasRetro: Boolean(retro.current || retro.archived),
      openActions: openActions.length,
      overdue: openActions.filter((a) => a.overdue).length,
      currentCards: retro.current?.cards.length ?? 0,
      ...(retro.archived?.archivedAt ? { archivedAt: retro.archived.archivedAt } : {}),
    },
    openActions,
    reviewDoc: review.doc,
    ...(retro.archived ? { retroBoard: retro.archived } : {}),
    progress,
    burndown: cockpitBurndown(sprint, series, stories, today, progress),
    sprintImpediments: inWindow,
    blockedStories: sprintStories.filter((s) => s.blocked && s.status !== "done"),
  };
}
