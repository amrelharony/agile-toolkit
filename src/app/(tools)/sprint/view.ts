/**
 * What the Sprint Cockpit says about the current sprint, as plain data: the
 * state of each ceremony, the blockers tile and the open-impediment list.
 * Pure, so the page, the home card and the report agree and tests can check
 * the wording without rendering.
 */

import type {
  Impediment,
  RetroBoard,
  Sprint,
  SprintReview,
  SprintSeries,
  StandupEntry,
  Story,
  TeamMember,
} from "@/lib/stores/workspace-types";
import { sprintStatus, type SprintStatus } from "@/lib/sprints/metrics";
import { fmt, type Tile } from "@/lib/sprints/hub-view";
import { CEREMONY_HREF, CEREMONY_LABEL, type CeremonyKind } from "@/lib/sprints/cadence";
import { dayForDate } from "@/lib/sprints/series";
import { localDayOf } from "@/lib/sprints/report";
import type { HandoffLink } from "@/lib/handoffs/types";
import { collectRetroActions, type RetroAction } from "@/lib/retro/actions";

/** MUST match RB_ID in src/app/(tools)/retro/retro-client.tsx. */
export const RETRO_CURRENT_ID = "retro:current";
/** MUST match SR_ID in src/app/(tools)/sprint-review/use-sprint-review-store.ts. */
export const SPRINT_REVIEW_ID = "sprint-review:current";

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
}

export interface RetroState {
  /** Any retro, current or archived, exists. */
  hasRetro: boolean;
  /** Action items still open, across every retro. */
  openActions: number;
  /** Open actions past their due date. */
  overdue: number;
  /** Cards on the current (unfinished) board. */
  currentCards: number;
}

export interface CockpitInput {
  sprint: Sprint;
  status: SprintStatus;
  /** Stories planned into this sprint. */
  sprintStories: readonly Story[];
  /** Backlog stories (no sprint) without points. */
  backlogUnestimated: number;
  standup: StandupToday;
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

  const reviewCard: FlowCard =
    review.demoItems > 0
      ? {
          kind: "review",
          label: CEREMONY_LABEL.review,
          state: "done",
          line: `${plural(review.demoItems, "demo item")}${
            review.feedback > 0 ? ` · ${plural(review.feedback, "feedback note")}` : ""
          }`,
          href: CEREMONY_HREF.review,
          cta: "Open the review kit",
        }
      : {
          kind: "review",
          label: CEREMONY_LABEL.review,
          state: "todo",
          line: "No demo script yet",
          href: CEREMONY_HREF.review,
          cta: "Prepare the review",
        };

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
      line: "No retro yet",
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

const SEVERITY_RANK: Record<Impediment["severity"], number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/** Unresolved impediments, worst and oldest first. */
export function openImpediments(all: readonly Impediment[]): Impediment[] {
  return all
    .filter((i) => !i.resolvedAt)
    .slice()
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        (a.raisedAt ?? "").localeCompare(b.raisedAt ?? "")
    );
}

/**
 * Whole days since an impediment was raised (0 when raised today or undated),
 * counted in local days: a timestamped `raisedAt` is UTC.
 */
export function impedimentAgeDays(imp: Pick<Impediment, "raisedAt">, today: string): number {
  const d = dayForDate({ startDate: localDayOf(imp.raisedAt ?? "") }, today);
  return d === null || d < 0 ? 0 : d;
}

/** The "Open blockers" tile. */
export function blockersTile(open: readonly Impediment[]): Tile {
  const high = open.filter((i) => i.severity === "high" || i.severity === "critical").length;
  return {
    id: "blockers",
    label: "Open blockers",
    value: String(open.length),
    unit: open.length === 1 ? "impediment" : "impediments",
    hint:
      high > 0
        ? `${high} high or critical`
        : open.length > 0
          ? "None high or critical"
          : "Nothing blocking the team",
    tone: high > 0 ? "warning" : open.length > 0 ? "default" : "success",
  };
}

/** "Day 3 of 10 · 7 days left", or what the hub says when dates are missing. */
export function daysLeftLine(dayLine: string): string {
  const m = /^Day (\d+) of (\d+)$/.exec(dayLine);
  if (!m) return dayLine;
  const left = Number(m[2]) - Number(m[1]);
  return `${dayLine} · ${left === 0 ? "last day" : `${plural(left, "day")} left`}`;
}

const nameKey = (name: string | null | undefined) => (name ?? "").trim().toLowerCase();

export interface CockpitSources {
  sprint: Sprint;
  series: SprintSeries | undefined;
  stories: readonly Story[];
  impediments: readonly Impediment[];
  standupEntries: readonly StandupEntry[];
  teamMembers: readonly TeamMember[];
  retroBoards: readonly RetroBoard[];
  reviews: readonly SprintReview[];
  today: string;
  /** Whether a hand-off target is finished (lib/handoffs routes); absent in previews. */
  targetDone?: (link: HandoffLink) => boolean;
}

export interface CockpitData extends CockpitInput {
  /** The open retro actions, for the report. */
  openActions: RetroAction[];
  reviewDoc: SprintReview | undefined;
}

/** Everything the cockpit shows, read from the other tools' workspace data. */
export function gatherCockpitData(src: CockpitSources): CockpitData {
  const {
    sprint,
    series,
    stories,
    impediments,
    standupEntries,
    teamMembers,
    retroBoards,
    reviews,
  } = src;
  const sprintStories = stories.filter((s) => s.sprintId === sprint.id);
  const backlogUnestimated = stories.filter(
    (s) => !s.sprintId && s.status === "backlog" && !(typeof s.points === "number" && s.points > 0)
  ).length;

  const todayEntries = standupEntries.filter((e) => e.date === src.today);
  const posted = new Set(todayEntries.map((e) => nameKey(e.member)).filter(Boolean)).size;
  const blockers = todayEntries.filter((e) => e.blockers.trim() && !e.blockerResolved).length;

  const current = retroBoards.find((b) => b.id === RETRO_CURRENT_ID && !b.archivedAt);
  const actions = collectRetroActions(retroBoards, {
    today: src.today,
    targetDone: src.targetDone,
  });
  const openActions = actions.filter((a) => !a.done);
  const reviewDoc = reviews.find((r) => r.id === SPRINT_REVIEW_ID);

  return {
    sprint,
    status: sprintStatus(sprint, series),
    sprintStories,
    backlogUnestimated,
    standup: { posted, members: teamMembers.length, blockers },
    openImpediments: openImpediments(impediments),
    review: {
      demoItems: reviewDoc?.features.length ?? 0,
      feedback: reviewDoc?.feedbackItems.length ?? 0,
    },
    retro: {
      hasRetro:
        retroBoards.some((b) => typeof b.archivedAt === "string") ||
        Boolean(current && current.cards.length > 0),
      openActions: openActions.length,
      overdue: openActions.filter((a) => a.overdue).length,
      currentCards: current?.cards.length ?? 0,
    },
    openActions,
    reviewDoc,
  };
}
