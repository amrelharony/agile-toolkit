/**
 * What the Sprint Cockpit says about one sprint, as plain data: the state
 * of each ceremony, the numbers (read off the sprint board, else the typed
 * daily log), the blockers in the sprint's window, this sprint's review and
 * retro, the notes it raises as cards (a closed sprint's goal still
 * unanswered, how much improvement work the sprint holds), the interrupt
 * buffer and whether the goal is at risk (lib/sprints/risk). Pure, so the
 * page, the home card and the Markdown export agree and tests can check the
 * wording without rendering.
 */

import type {
  AsyncUpdate,
  Impediment,
  InterruptItem,
  KanbanBoard,
  RetroBoard,
  Sprint,
  SprintGoal,
  SprintReview,
  SprintSeries,
  StandupEntry,
  Story,
  TeamMember,
} from "@/lib/stores/workspace-types";
import { completionPct, sprintStatus, type SprintStatus } from "@/lib/sprints/metrics";
import {
  boardBurn,
  burnSeries,
  burnStatus,
  openUnpointed,
  type BurnSeries,
  type BurnStatus,
} from "@/lib/sprints/burn";
import type { WorkingCalendar } from "@/lib/sprints/calendar";
import {
  averageVelocity,
  completedSprints,
  fmt,
  hubTiles,
  type Tile,
  type TileId,
} from "@/lib/sprints/hub-view";
import { CEREMONY_HREF, CEREMONY_LABEL, type CeremonyKind } from "@/lib/sprints/cadence";
import { dayForDate, hasSyntheticDates, sprintLengthDays, todayIso } from "@/lib/sprints/series";
import {
  remainingToday,
  storyProgress,
  type RemainingToday,
  type StoryProgress,
} from "@/lib/sprints/progress";
import { DRAFT_REVIEW_ID, reviewDocId, reviewHasContent } from "@/lib/sprints/review-doc";
import { isExampleSprintId } from "@/lib/sprints/example";
import { isExampleId } from "@/lib/utils/example-id";
import {
  dayOf,
  impedimentStatus,
  isImpedimentOverdue,
  isResolved,
  openDuring,
  sortImpediments,
} from "@/lib/impediments/model";
import { allStandupEntries, hasBlocker } from "@/lib/standup/entries";
import type { HandoffLink } from "@/lib/handoffs/types";
import { RETRO_CURRENT_ID, collectRetroActions, type RetroAction } from "@/lib/retro/actions";
import { retroFor } from "@/lib/retro/board";
import { improvementsFor, type Improvements } from "@/lib/retro/improvement";
import { interruptBufferStatus, type InterruptBufferStatus } from "@/lib/sprints/interrupts";
import { impedimentCounts, sprintRisk, type SprintRisk } from "@/lib/sprints/risk";
import { unansweredGoal } from "@/app/(tools)/sprint-goal/doc";
import type { ChartText } from "@/lib/charts/chart-text";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import { burnChartText } from "@/app/(tools)/burndown/chart-text";
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

// Open stories without points: the board's "points left" is only a floor
// while there are any (lib/sprints/burn, which the delivery charts share).
export { openUnpointed };

/** "1 open story has no points", "2 open stories have no points". */
export function noPointsLine(n: number): string {
  return `${plural(n, "open story", "open stories")} ${n === 1 ? "has" : "have"} no points`;
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
      href: onSprint(CEREMONY_HREF.retro, sprint),
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
      href: onSprint(CEREMONY_HREF.retro, sprint),
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

/**
 * How many of the sprint's impediments were resolved during it: by its last
 * day. `openDuring` also keeps one resolved after the end (it was in the
 * way while the sprint ran), and that one doesn't count here. A sprint
 * without real dates has none (it only gets the unresolved ones).
 */
export function resolvedDuring(
  inWindow: readonly Impediment[],
  sprint: Pick<Sprint, "startDate" | "endDate">
): number {
  if (hasSyntheticDates(sprint)) return 0;
  const end = dayOf(sprint.endDate) as string;
  return inWindow.filter((i) => {
    const day = dayOf(i.resolvedAt);
    return day !== null && day <= end;
  }).length;
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

/** Where the interrupt buffer's tile links: the Interrupt Buffer on this sprint. */
export function interruptsHref(sprint: Pick<Sprint, "id">): string {
  return onSprint("/interrupt-buffer", sprint);
}

/**
 * The "Interrupt buffer" tile: the points the sprint's interrupts used
 * against its buffer (lib/sprints/interrupts), or how many were logged
 * while no buffer in points is set. Links to the Interrupt Buffer.
 */
export function interruptsTile(status: InterruptBufferStatus, sprint: Pick<Sprint, "id">): Tile {
  const link = { href: interruptsHref(sprint), linkLabel: "Open the Interrupt Buffer" };
  const open = status.open > 0 ? ` · ${status.open} open` : "";
  if (status.bufferPoints === null) {
    return {
      id: "interrupts",
      label: "Interrupt buffer",
      value: String(status.total),
      unit: status.total === 1 ? "interrupt" : "interrupts",
      hint: status.set ? "Plan the sprint's points to size the buffer" : "No buffer set",
      tone: "default",
      ...link,
    };
  }
  const left = status.leftPoints ?? 0;
  const hint =
    status.state === "over"
      ? `${fmt(-left)} over the buffer${open}`
      : status.total === 0
        ? "Nothing logged yet"
        : `${fmt(left)} left · ${plural(status.total, "interrupt")}${open}`;
  return {
    id: "interrupts",
    label: "Interrupt buffer",
    value: fmt(status.usedPoints),
    unit: `of ${fmt(status.bufferPoints)} pts`,
    hint,
    tone: status.state === "over" || status.state === "watch" ? "warning" : "default",
    ...link,
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

// Which retro belongs to which sprint is shared with the Retro page and
// agents (lib/retro/board); re-exported for the cockpit's callers.
export {
  RETRO_GRACE_DAYS,
  localDay,
  retroFor,
  retroWindow,
  type SprintRetro,
} from "@/lib/retro/board";

/* ── Numbers: the board first, the typed log as the fallback ───────────── */

/*
 * The burn itself (which source, the board's days, the log's days, the
 * ideal line on the team's working days, the gap and the projection) is
 * lib/sprints/burn, which Burndown, Burnup and their agent actions read
 * too. The cockpit maps it to its chart's rows and tiles.
 */

/** A burn's days as the chart's rows: the ideal line and the points left. */
function chartRows(burn: BurnSeries): BurndownChartRow[] {
  return burn.days.map((d) => ({ day: d.day, ideal: d.ideal, actual: d.remaining }));
}

/** Days the scope moved: flagged in the log, or a story joining or leaving the board. */
function scopeMoveDays(burn: BurnSeries): number[] {
  return burn.days
    .filter((d) => d.scopeChangeFlag || d.added > 0 || d.removed > 0)
    .map((d) => d.day);
}

/** The chart's rows from the typed daily log: the ideal line and what Burndown and Burnup logged. */
export function logBurndownRows(
  sprint: Sprint,
  series: SprintSeries | undefined,
  calendar?: WorkingCalendar
) {
  const burn = burnSeries({ sprint, series, stories: [], calendar, today: todayIso() });
  return { rows: chartRows(burn), scopeChangeDays: scopeMoveDays(burn), length: burn.lengthDays };
}

/**
 * The burndown read off the board: for every day up to today, the points in
 * the sprint that day minus those of its stories in Done by the end of it
 * (lib/sprints/burn). A done story with no done time, from before the board
 * kept them, counts from the day it arrived; stories done after the last
 * day count on it, so the last point is the tiles' "Remaining". Days after
 * today carry only the ideal line.
 */
export function boardBurndownRows(
  sprint: Sprint,
  stories: readonly Story[],
  today: string,
  _progress?: StoryProgress,
  calendar?: WorkingCalendar
): BurndownChartRow[] {
  return chartRows(boardBurn({ sprint, series: undefined, stories, calendar, today }));
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
  /** The sprint has real dates, so the board can be read by day. */
  dated: boolean;
  /** The sprint's stories added up (`storyProgress`). */
  progress: StoryProgress;
  /** Open stories without points (`openUnpointed`) while the board is the source, else 0. */
  unpointedOpen: number;
  /** The burn the chart and the board's tiles read (lib/sprints/burn). */
  burn: BurnSeries;
  /** Where it stands: the gap and the projection on the team's working days. */
  burnStatus: BurnStatus;
}

/**
 * The burndown the cockpit draws: the board's when the sprint has pointed
 * stories (`remainingToday` decides, as every delivery chart does), else
 * the typed daily log's. A closed sprint is read as it was recorded, never
 * off the board: closing can move its unfinished stories on (the close
 * dialog's carry-over, Sprint Planning's "Carry over"), so the board no
 * longer holds what it committed. Its chart is the daily log's, as in
 * Sprint Metrics, and its done points are the ones confirmed at close.
 */
export function cockpitBurndown(
  sprint: Sprint,
  series: SprintSeries | undefined,
  stories: readonly Story[],
  today: string,
  progress: StoryProgress = storyProgress(stories, sprint.id),
  calendar?: WorkingCalendar
): CockpitBurndown {
  const closed = sprint.status === "completed";
  const remaining = remainingToday({ sprint, stories: closed ? [] : stories, series, today });
  // The same rule as `remaining`: the board while it has pointed stories, a
  // closed sprint's log only (its tiles quote what was confirmed at close).
  const burn = burnSeries({ sprint, series, stories, calendar, today, recordedOnly: true });
  return {
    source: burn.source,
    remaining,
    rows: chartRows(burn),
    scopeChangeDays: scopeMoveDays(burn),
    length: burn.lengthDays,
    todayDay: burn.todayDay,
    dated: burn.dated,
    progress,
    unpointedOpen: burn.source === "stories" ? burn.unpointedOpen : 0,
    burn,
    burnStatus: burnStatus(burn, sprint),
  };
}

/**
 * The burndown in words: Burndown's (burnChartText), with the board's
 * wording when the board is the source, and each day's gap from the burn,
 * so the summary quotes the gap the tiles do.
 */
export function cockpitChartText(burndown: CockpitBurndown): ChartText {
  const days = burndown.burn.days;
  return burnChartText(
    burndown.rows.map((r) => ({ ...r, gap: days[r.day]?.gap ?? null })),
    {
      source: burndown.source,
      dated: burndown.dated,
      unpointedOpen: burndown.unpointedOpen,
      done: burndown.progress.done,
      scope: burndown.progress.scope,
    }
  );
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

/**
 * The hub tiles that the board answers, read off the stories. While open
 * stories have no points the board's "left" is only a floor: the tiles say
 * so and never show a success tone, and with every pointed story done the
 * pace and finish can't be told (not "Finished").
 */
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
  const n = burndown.unpointedOpen;
  const unpointed = n > 0 ? ` · ${plural(n, "story", "stories")} without points` : "";
  const unknown = (id: "gap" | "finish", label: string): Tile => ({
    id,
    label,
    value: "Can't tell yet",
    hint: noPointsLine(n),
    tone: "default",
    empty: true,
  });
  const tiles: Partial<Record<TileId, Tile>> = {
    scope: {
      id: "scope",
      label: "Scope now",
      value: fmt(p.scope),
      unit: "points",
      hint: `${
        committed <= 0
          ? FROM_BOARD
          : change > 0
            ? `+${fmt(change)} since the plan`
            : change < 0
              ? `−${fmt(-change)} since the plan`
              : "No change since the plan"
      }${unpointed}`,
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
  // The gap and the projection count the team's working days (lib/sprints/burn).
  const status = burndown.burnStatus;
  if (day !== null && day >= 0 && status.gap !== null && status.gapLabel !== null) {
    const at = Math.min(day, burndown.length);
    const g = status.gap;
    tiles.gap =
      n > 0 && p.remaining <= 0
        ? unknown("gap", "Pace vs ideal")
        : {
            id: "gap",
            label: "Pace vs ideal",
            value: status.gapLabel,
            hint: `Ideal: ${fmt(status.idealRemaining ?? 0)} left on day ${at}${unpointed}`,
            tone: g > 0 ? "warning" : n > 0 ? "default" : "success",
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

  const trend = burndown.rows.filter((r) => typeof r.actual === "number");
  if (p.remaining <= 0) {
    tiles.finish =
      n > 0
        ? unknown("finish", "Projected finish")
        : {
            id: "finish",
            label: "Projected finish",
            value: "Finished",
            hint: "Every pointed story is done",
            tone: "success",
          };
  } else if (trend.length === 0) {
    tiles.finish = {
      id: "finish",
      label: "Projected finish",
      value: dated ? "Not started yet" : "No dates set",
      tone: "default",
      empty: true,
    };
  } else {
    const finish = status.projectedFinishDay;
    tiles.finish =
      finish === null
        ? {
            id: "finish",
            label: "Projected finish",
            value: "No trend yet",
            hint:
              trend.length < 2
                ? "Move a story to Done tomorrow to see a trend"
                : "The points left aren't going down",
            tone: "default",
            empty: true,
          }
        : {
            id: "finish",
            label: "Projected finish",
            value: `Day ${Math.ceil(finish)}`,
            hint: `Trend of the ${n > 0 ? "pointed stories" : "board"} · last day is day ${
              burndown.length
            }`,
            tone: finish > burndown.length ? "warning" : n > 0 ? "default" : "success",
          };
  }
  return tiles;
}

/**
 * The cockpit's tiles: the Sprint Metrics hub's (lib/sprints/hub-view),
 * with the progress tiles read off the board when the sprint has pointed
 * stories, then the blockers tile, and the interrupt buffer's last when
 * the sprint has a buffer or logged interrupts. A closed sprint's Done is
 * the points confirmed when it closed, as its verdict says.
 */
export function cockpitTiles(
  data: Pick<
    CockpitData,
    "sprint" | "status" | "progress" | "burndown" | "openImpediments" | "blockedStories"
  > &
    Partial<Pick<CockpitData, "interrupts">>,
  sprints: readonly Sprint[],
  today: string,
  /** Sprint Comparison's computed average (lib/sprints/compare); absent: the typed ratings'. */
  { rating }: { rating?: number | null } = {}
): Tile[] {
  const { sprint, status } = data;
  const hub = hubTiles(
    sprint,
    status,
    averageVelocity(completedSprints(sprints), sprint.id),
    rating !== undefined ? { rating } : {}
  );
  const overrides: Partial<Record<TileId, Tile>> =
    data.burndown.source === "stories"
      ? boardTiles(sprint, data.progress, data.burndown, today)
      : {};
  if (sprint.status === "completed" && typeof sprint.pointsCompleted === "number") {
    overrides.done = {
      id: "done",
      label: "Done",
      value: fmt(sprint.pointsCompleted),
      unit: "points",
      hint: "When the sprint closed",
      tone: "default",
    };
  }
  return [
    ...hub.map((t) => overrides[t.id] ?? t),
    blockersTile(data.openImpediments, { blockedStories: data.blockedStories.length, today }),
    ...(data.interrupts ? [interruptsTile(data.interrupts, sprint)] : []),
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
  /**
   * The sprint goals, for "Did we meet the sprint goal?" on a closed sprint.
   * Absent in previews: the example's goal is never asked about.
   */
  goals?: readonly SprintGoal[];
  /** Read for retro actions sent to the Flow board, when `targetDone` is absent. */
  kanbanBoards?: readonly KanbanBoard[];
  /**
   * The team's working days (cadenceCalendar of the cadence): the ideal
   * line, the gap and the projections count them. Absent, calendar days.
   */
  calendar?: WorkingCalendar;
  /**
   * Interrupts logged against sprints (lib/sprints/interrupts), for the
   * buffer's tile and the risk. Absent: none logged.
   */
  interruptItems?: readonly InterruptItem[];
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
  /** Of those, the ones resolved by the sprint's last day (`resolvedDuring`). */
  resolvedImpediments: number;
  /** Open stories in the sprint flagged as blocked. */
  blockedStories: Story[];
  /**
   * The goal of a closed sprint that still has no answer to "Did we meet
   * the sprint goal?" (the close dialog asks, but it can be skipped). Null
   * while the sprint is open, with no goal, or once it is answered.
   */
  goalToAnswer: string | null;
  /** What the last retro and the impediments log left for this sprint (lib/retro/improvement). */
  improvements: Improvements;
  /**
   * The sprint's interrupt buffer (`interruptBufferStatus`), when it has a
   * buffer or logged interrupts; null otherwise.
   */
  interrupts: InterruptBufferStatus | null;
  /** Whether the sprint goal is at risk, and why (lib/sprints/risk). */
  risk: SprintRisk;
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
  const closed = sprint.status === "completed" || sprint.status === "cancelled";
  const open = inWindow.filter((i) => !isResolved(i));
  const blockedStories = sprintStories.filter((s) => s.blocked && s.status !== "done");
  const burndown = cockpitBurndown(sprint, series, stories, today, progress, src.calendar);
  // An example loaded into the Interrupt Buffer isn't the team's (the
  // cockpit's own example reads its example interrupts).
  const example = isExampleSprintId(sprint.id);
  const logged = (src.interruptItems ?? []).filter((i) => example || !isExampleId(i.id));
  const buffer = interruptBufferStatus(sprint, logged);
  const interrupts = buffer.set || buffer.total > 0 ? buffer : null;

  return {
    sprint,
    status: sprintStatus(sprint, series, { calendar: src.calendar }),
    sprintStories,
    backlogUnestimated,
    standup: { posted, members: teamMembers.length, blockers },
    openImpediments: open,
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
    burndown,
    sprintImpediments: inWindow,
    resolvedImpediments: resolvedDuring(inWindow, sprint),
    blockedStories,
    goalToAnswer: closed && src.goals ? unansweredGoal(src.goals, sprint) : null,
    improvements: improvementsFor({
      sprint,
      sprints: src.sprints ?? [sprint],
      retroBoards,
      // An example loaded into Impediments isn't the team's to plan, so it
      // isn't counted here either (Sprint Planning leaves it out the same
      // way). The cockpit's own example reads its example impediments.
      impediments: isExampleSprintId(sprint.id)
        ? impediments
        : impediments.filter((i) => !isExampleId(i.id)),
      stories,
      kanbanBoards: src.kanbanBoards,
      today,
      targetDone: src.targetDone,
    }),
    interrupts,
    risk: sprintRisk({
      sprint,
      burn: burndown.burn,
      status: burndown.burnStatus,
      blockedStories: blockedStories.length,
      impediments: impedimentCounts(open, today),
      interrupts,
    }),
  };
}

/* ── Notes: what the cockpit raises as cards ───────────────────────────── */

export interface CockpitNote {
  id: "goal-answer" | "improvement-in" | "improvement-none";
  /** "warning": something to do; "info": where it stands. */
  tone: "warning" | "info";
  title: string;
  detail: string;
  href: string;
  /** The link's text. */
  cta: string;
}

/** "is" / "are" for a count. */
const be = (n: number) => (n === 1 ? "is" : "are");

/**
 * The cockpit's notes, each a card with one link, never a toast:
 *
 *   - a closed sprint whose goal has no answer yet;
 *   - "N of M retro actions are in this sprint", while it is planned or
 *     running and at least one made it in;
 *   - no improvement item in the sprint (no story from a retro action or an
 *     impediment), while there is an open one to add. A planned sprint with
 *     no stories yet isn't nagged: planning hasn't begun.
 */
export function cockpitNotes(
  data: Pick<CockpitData, "sprint" | "sprintStories" | "goalToAnswer" | "improvements">
): CockpitNote[] {
  const { sprint, goalToAnswer, improvements: i } = data;
  const notes: CockpitNote[] = [];
  const closed = sprint.status === "completed" || sprint.status === "cancelled";

  if (closed && goalToAnswer) {
    notes.push({
      id: "goal-answer",
      tone: "warning",
      title: `${sprint.name} closed without an answer to “Did we meet the sprint goal?”`,
      detail: `Its goal: “${goalToAnswer}”. The Sprint Review, the retro and Sprint Comparison read the answer.`,
      href: onSprint("/sprint-goal", sprint),
      cta: "Answer it in Sprint Goal",
    });
  }
  if (closed) return notes;

  const planningHref = onSprint(PLANNING_HREF, sprint);
  if (i.actionsInSprint > 0) {
    const more = i.actionsCounted - i.actionsInSprint;
    notes.push({
      id: "improvement-in",
      tone: "info",
      title: `${i.actionsInSprint} of ${plural(i.actionsCounted, "retro action")} ${be(i.actionsInSprint)} in this sprint`,
      detail:
        more > 0
          ? `${more} more ${be(more)} still open. Each closes when its story is done.`
          : "Each closes when its story is done.",
      href: planningHref,
      cta: more > 0 ? "Add the rest in Sprint Planning" : "See them in Sprint Planning",
    });
  } else if (
    i.improvementStories.length === 0 &&
    (sprint.status === "active" || data.sprintStories.length > 0)
  ) {
    const waiting = [
      i.actions.length > 0 ? plural(i.actions.length, "retro action") : "",
      i.impediments.length > 0 ? plural(i.impediments.length, "impediment") : "",
    ].filter(Boolean);
    const total = i.actions.length + i.impediments.length;
    if (total > 0) {
      notes.push({
        id: "improvement-none",
        tone: "warning",
        title: "No improvement item is in this sprint",
        detail: `${waiting.join(" and ")} ${be(total)} open. Add one, so the sprint improves how the team works.`,
        href: planningHref,
        cta: "Add one in Sprint Planning",
      });
    }
  }
  return notes;
}
