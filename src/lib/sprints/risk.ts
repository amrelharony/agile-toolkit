/**
 * Is the sprint goal at risk? A plain rule over what the cockpit already
 * reads, so the page, its Markdown, the wall view and Amr's tool.sprint.risk
 * give the same answer with the same reasons:
 *
 *   - the pace: the burn's projected finish lands after the last day, the
 *     points left sit well above the ideal line, or nothing is done yet
 *     well into the sprint (lib/sprints/burn `burnStatus`);
 *   - the scope grew a lot since day 0;
 *   - stories blocked on the board;
 *   - open impediments that are severe, escalated or overdue;
 *   - the interrupt buffer, nearly or wholly spent (lib/sprints/interrupts
 *     `interruptBufferStatus`).
 *
 * Each sign is a reason with its own level ("watch" or "at_risk") and one
 * thing to try. The sprint's level is the highest of its reasons: "none",
 * "watch" or "at_risk". It only reads a running sprint: before it starts,
 * after its last day, closed or without dates there is no pace to judge,
 * and `applies` says so.
 *
 * Pure: no store, no hooks, so the MCP route runs it too.
 */

import type { Impediment, Sprint } from "@/lib/stores/workspace-types";
import type { BurnSeries, BurnStatus } from "@/lib/sprints/burn";
import type { InterruptBufferStatus } from "@/lib/sprints/interrupts";
import { impedimentStatus, isImpedimentOverdue, isResolved } from "@/lib/impediments/model";

export type RiskLevel = "none" | "watch" | "at_risk";

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  none: "On track",
  watch: "Worth watching",
  at_risk: "At risk",
};

export type RiskReasonId =
  | "finish-late"
  | "behind"
  | "no-progress"
  | "no-data"
  | "cant-tell"
  | "scope-grew"
  | "blocked"
  | "impediments"
  | "interrupts";

export interface RiskReason {
  id: RiskReasonId;
  level: Exclude<RiskLevel, "none">;
  /** One sentence: what the numbers say. */
  text: string;
  /** One sentence: a thing the team could try. */
  tryThis: string;
}

/** Why the rule can't judge the sprint, when it can't. */
export type RiskNotApplicable = "closed" | "undated" | "before" | "over";

export interface SprintRisk {
  /** The rule reads this sprint: it is running today. */
  applies: boolean;
  /** Why it doesn't, when it doesn't. */
  notApplicable: RiskNotApplicable | null;
  level: RiskLevel;
  /** The worst first. */
  reasons: RiskReason[];
  /** One sentence for the top of the card. */
  headline: string;
}

/** The open impediments in the sprint's way, counted for the rule. */
export interface ImpedimentCounts {
  open: number;
  /** High or critical. */
  severe: number;
  critical: number;
  escalated: number;
  overdue: number;
}

export interface SprintRiskFacts {
  sprint: Pick<Sprint, "name" | "goal" | "status">;
  burn: Pick<
    BurnSeries,
    | "phase"
    | "todayDay"
    | "lengthDays"
    | "source"
    | "done"
    | "remaining"
    | "scopeNow"
    | "initialScope"
    | "scopeAdded"
    | "scopeRemoved"
    | "unpointedOpen"
  >;
  status: Pick<BurnStatus, "gap" | "projectedFinishDay" | "willFinishOnTime" | "cantTell">;
  /** Open stories in the sprint flagged as blocked. */
  blockedStories: number;
  impediments: ImpedimentCounts;
  /** The sprint's interrupt buffer, when it has one or logged interrupts. */
  interrupts?: Pick<InterruptBufferStatus, "state" | "summary"> | null;
}

/** Behind the ideal line by this share of the scope: worth watching. */
export const BEHIND_WATCH_SHARE = 0.15;
/** Behind by this share: at risk. */
export const BEHIND_RISK_SHARE = 0.3;
/** Nothing done this far into the sprint (share of its days): worth watching… */
export const STALL_WATCH_SHARE = 0.3;
/** …and at risk from here. */
export const STALL_RISK_SHARE = 0.5;
/** The scope grew by this share of day 0's: worth watching. */
export const SCOPE_GROWTH_WATCH_SHARE = 0.2;
/** Blocked stories from which the goal is at risk. */
export const BLOCKED_RISK_COUNT = 3;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const be = (n: number) => (n === 1 ? "is" : "are");
const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(round1(n));
const pointsText = (n: number) => `${fmt(n)} ${round1(n) === 1 ? "point" : "points"}`;

/** Counts of the open impediments that matter to the rule; resolved ones don't count. */
export function impedimentCounts(
  impediments: readonly Impediment[],
  today: string
): ImpedimentCounts {
  const open = impediments.filter((i) => !isResolved(i));
  return {
    open: open.length,
    severe: open.filter((i) => i.severity === "high" || i.severity === "critical").length,
    critical: open.filter((i) => i.severity === "critical").length,
    escalated: open.filter((i) => impedimentStatus(i) === "escalated").length,
    overdue: open.filter((i) => isImpedimentOverdue(i, today)).length,
  };
}

const NO_IMPEDIMENTS: ImpedimentCounts = {
  open: 0,
  severe: 0,
  critical: 0,
  escalated: 0,
  overdue: 0,
};

/** "The sprint goal" when the sprint has one, else its name; `mid` for the middle of a sentence. */
function subject(sprint: SprintRiskFacts["sprint"]): { lead: string; mid: string } {
  if (sprint.goal?.trim()) return { lead: "The sprint goal", mid: "the sprint goal" };
  const name = sprint.name.trim();
  return name ? { lead: name, mid: name } : { lead: "This sprint", mid: "this sprint" };
}

/** The reasons the numbers give, in the order the rule checks them. */
function reasonsFor(f: SprintRiskFacts): RiskReason[] {
  const { burn, status } = f;
  const out: RiskReason[] = [];
  const day = burn.todayDay ?? 0;
  const length = burn.lengthDays;
  const into = length > 0 ? day / length : 0;
  const left = burn.remaining;

  // The pace: one reason at most, the strongest the numbers give.
  if (burn.source === "none" || burn.done === null || left === null) {
    if (day >= 1) {
      out.push({
        id: "no-data",
        level: "watch",
        text: `No progress is recorded on day ${day} of ${length}, so the pace can't be read.`,
        tryThis:
          "Point the stories and move them on the sprint board, or log the points left each day.",
      });
    }
  } else if (status.cantTell) {
    out.push({
      id: "cant-tell",
      level: "watch",
      text: `Every pointed story is done, but ${plural(burn.unpointedOpen, "open story", "open stories")} ${
        burn.unpointedOpen === 1 ? "has" : "have"
      } no points, so what is left can't be told.`,
      tryThis: "Size the open stories in a short refinement, so the pace can be read again.",
    });
  } else if (left > 0) {
    if (status.willFinishOnTime === false && status.projectedFinishDay !== null) {
      out.push({
        id: "finish-late",
        level: "at_risk",
        text: `At this pace the work left finishes around day ${Math.ceil(
          status.projectedFinishDay
        )}, after the last day (day ${length}).`,
        tryThis:
          "Agree with the Product Owner what to drop or split, so the part that meets the goal lands.",
      });
    } else if (burn.done === 0 && into >= STALL_WATCH_SHARE) {
      out.push({
        id: "no-progress",
        level: into >= STALL_RISK_SHARE ? "at_risk" : "watch",
        text: `Nothing is done yet on day ${day} of ${length}.`,
        tryThis: "Swarm on the top story together to get one thing to Done.",
      });
    } else {
      const scope = burn.scopeNow > 0 ? burn.scopeNow : 0;
      const gap = status.gap;
      if (gap !== null && gap > 0 && scope > 0 && gap / scope >= BEHIND_WATCH_SHARE) {
        out.push({
          id: "behind",
          level: gap / scope >= BEHIND_RISK_SHARE ? "at_risk" : "watch",
          text: `The points left are ${pointsText(gap)} above the ideal line on day ${day}.`,
          tryThis: "Finish the stories already started before pulling in new ones.",
        });
      }
    }
  }

  const grew = round1(burn.scopeAdded - burn.scopeRemoved);
  if (burn.initialScope > 0 && grew > 0 && grew / burn.initialScope >= SCOPE_GROWTH_WATCH_SHARE) {
    out.push({
      id: "scope-grew",
      level: "watch",
      text: `The scope grew by ${pointsText(grew)} since day 0 (${Math.round(
        (grew / burn.initialScope) * 100
      )}% more).`,
      tryThis:
        "Check each new story against the sprint goal; what doesn't serve it can wait on the backlog.",
    });
  }

  if (f.blockedStories > 0) {
    out.push({
      id: "blocked",
      level: f.blockedStories >= BLOCKED_RISK_COUNT ? "at_risk" : "watch",
      text: `${plural(f.blockedStories, "story", "stories")} ${be(f.blockedStories)} blocked on the board.`,
      tryThis: "Unblock before starting anything new: ask who can help today.",
    });
  }

  const imp = f.impediments;
  const notes = [
    imp.critical > 0 ? `${imp.critical} critical` : "",
    imp.severe - imp.critical > 0 ? `${imp.severe - imp.critical} high` : "",
    imp.escalated > 0 ? `${imp.escalated} escalated` : "",
    imp.overdue > 0 ? `${imp.overdue} overdue` : "",
  ].filter(Boolean);
  if (notes.length > 0) {
    out.push({
      id: "impediments",
      level: imp.critical > 0 || imp.severe >= 2 ? "at_risk" : "watch",
      text: `${plural(imp.open, "impediment")} ${be(imp.open)} open (${notes.join(", ")}).`,
      tryThis: "Take the worst impediment to whoever can remove it, today.",
    });
  }

  const interrupts = f.interrupts;
  if (interrupts && (interrupts.state === "over" || interrupts.state === "watch")) {
    out.push({
      id: "interrupts",
      level: interrupts.state === "over" ? "at_risk" : "watch",
      text: `Interrupt buffer: ${interrupts.summary}`,
      tryThis:
        interrupts.state === "over"
          ? "Run the Emergency Procedure: stop, tell the Product Owner and re-plan the sprint."
          : "Hold new requests for the backlog until the sprint's own work is safe.",
    });
  }

  return out;
}

const NOT_APPLICABLE_HEADLINE: Record<RiskNotApplicable, (name: string) => string> = {
  closed: (name) => `${name} is closed, so there is nothing left to put at risk.`,
  undated: (name) => `${name} has no dates, so its risk can't be read.`,
  before: (name) => `${name} hasn't started yet, so there is no pace to judge.`,
  over: (name) => `${name} has passed its last day: close it to record what was done.`,
};

/** Where the sprint stands against its goal, with the reasons. */
export function sprintRisk(facts: SprintRiskFacts): SprintRisk {
  const { sprint, burn } = facts;
  const name = sprint.name.trim() || "This sprint";
  let notApplicable: RiskNotApplicable | null = null;
  if (sprint.status === "completed" || sprint.status === "cancelled") notApplicable = "closed";
  else if (burn.phase === "undated") notApplicable = "undated";
  else if (burn.phase === "before") notApplicable = "before";
  else if (burn.phase === "over") notApplicable = "over";
  if (notApplicable) {
    return {
      applies: false,
      notApplicable,
      level: "none",
      reasons: [],
      headline: NOT_APPLICABLE_HEADLINE[notApplicable](name),
    };
  }

  const reasons = reasonsFor({ ...facts, impediments: facts.impediments ?? NO_IMPEDIMENTS });
  // The worst first, keeping the rule's order within a level.
  reasons.sort((a, b) => (a.level === b.level ? 0 : a.level === "at_risk" ? -1 : 1));
  const level: RiskLevel = reasons.some((r) => r.level === "at_risk")
    ? "at_risk"
    : reasons.length > 0
      ? "watch"
      : "none";
  const who = subject(sprint);
  const headline =
    level === "at_risk"
      ? `${who.lead} is at risk.`
      : level === "watch"
        ? `Worth watching: ${plural(reasons.length, "sign")} could put ${who.mid} at risk.`
        : `${who.lead} looks on track: nothing puts it at risk today.`;
  return { applies: true, notApplicable: null, level, reasons, headline };
}

/**
 * The risk as two or three plain sentences, without AI: the headline, the
 * main reason (and the next, when there is one) and the first thing to try.
 * The `sprint.risk_note` task's fallback, and the line Amr's read gives.
 */
export function riskNote(risk: {
  level: RiskLevel;
  headline: string;
  reasons: readonly Pick<RiskReason, "text" | "tryThis">[];
}): string {
  const [first, second] = risk.reasons;
  if (risk.level === "none" || !first) return risk.headline;
  const why = second ? `${first.text} ${second.text}` : first.text;
  return `${risk.headline} ${why} Try this: ${first.tryThis.charAt(0).toLowerCase()}${first.tryThis.slice(1)}`;
}
