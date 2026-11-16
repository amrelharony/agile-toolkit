/**
 * Hand-off routes, and the small link helpers both sides use.
 *
 * Which source offers which route is decided at the call site (a retro
 * action offers impediment, kanban and backlog story; a premortem cause
 * offers risk), so a route knows only how to create, remove and find its
 * target.
 *
 * `decision` writes the one decision record the Decision Log, DACI and
 * RAPID share (workspace.decisions, lib/decisions). A route whose target
 * entity doesn't exist yet writes to today's closest slice: `dependency` to
 * the Dependency Map's graph (until the one dependency model lands).
 * `opportunity` adds a node to the Opportunity Tree (an interview quote
 * raised as an opportunity).
 */

import type { HandoffLink, HandoffRef, HandoffRoute, HandoffRouteId } from "./types";
import { findLink } from "./links";
import { impedimentRoute } from "./targets/impediment";
import { kanbanRoute } from "./targets/kanban";
import { riskRoute } from "./targets/risk";
import { pokerQueueRoute } from "./targets/poker-queue";
import { backlogStoryRoute } from "./targets/backlog-story";
import { retroTopicRoute } from "./targets/retro-topic";
import { retroActionRoute } from "./targets/retro-action";
import { hypothesisRoute } from "./targets/hypothesis";
import { decisionRoute } from "./targets/decision";
import { dependencyRoute } from "./targets/dependency";
import { opportunityRoute } from "./targets/opportunity";
import { rootCauseRoute } from "./targets/root-cause";

/** One route per id in HANDOFF_ROUTE_IDS: a stored link on any of them reads through its route. */
export const HANDOFF_ROUTES: Readonly<Record<HandoffRouteId, HandoffRoute>> = {
  impediment: impedimentRoute,
  kanban: kanbanRoute,
  risk: riskRoute,
  "poker-queue": pokerQueueRoute,
  "backlog-story": backlogStoryRoute,
  "retro-topic": retroTopicRoute,
  "retro-action": retroActionRoute,
  hypothesis: hypothesisRoute,
  decision: decisionRoute,
  dependency: dependencyRoute,
  opportunity: opportunityRoute,
  "root-cause": rootCauseRoute,
};

export function getHandoffRoute(id: HandoffRouteId): HandoffRoute {
  return HANDOFF_ROUTES[id];
}

/* ── Sources ─────────────────────────────────────────────────────────── */

/**
 * Tools that send items, with where a "From …" link on the target goes: the
 * ones sending today, and the ones the tool upgrade wires to the new routes.
 */
export const SOURCE_TOOLS: Readonly<Record<string, { name: string; href: string }>> = {
  retro: { name: "retro", href: "/retro" },
  standup: { name: "standup", href: "/standup" },
  premortem: { name: "premortem", href: "/premortem" },
  "story-mapper": { name: "story map", href: "/story-mapper" },
  // Plan the sprint
  "sprint-planning": { name: "Sprint Planning", href: "/sprint-planning" },
  "planning-poker": { name: "Planning Poker", href: "/planning-poker" },
  refinement: { name: "refinement", href: "/refinement" },
  "walking-skeleton": { name: "walking skeleton", href: "/walking-skeleton" },
  "jtbd-mapper": { name: "jobs to be done", href: "/jtbd-mapper" },
  "pi-planning": { name: "PI Planning", href: "/pi-planning" },
  "scrum-of-scrums": { name: "Scrum of Scrums", href: "/scrum-of-scrums" },
  // Run the sprint
  "async-standup": { name: "async standup", href: "/async-standup" },
  // An open impediment planned into a sprint as a story (Sprint Planning's
  // "From the last retro" panel): the story links back to the log.
  impediments: { name: "impediments", href: "/impediments" },
  "sprint-review": { name: "Sprint Review", href: "/sprint-review" },
  // Retrospect & improve
  "six-hats": { name: "six hats", href: "/six-hats" },
  "design-sprint": { name: "design sprint", href: "/design-sprint" },
  // Team & people
  "health-check": { name: "health check", href: "/health-check" },
  "psych-safety": { name: "psychological safety", href: "/psych-safety" },
  "mood-tracker": { name: "mood tracker", href: "/mood-tracker" },
  kudos: { name: "kudos", href: "/kudos" },
  maturity: { name: "maturity assessment", href: "/maturity" },
  "working-agreement": { name: "working agreement", href: "/working-agreement" },
  // Prioritize & decide
  // Sprint Planning pulls its backlog items in as stories (sprint-planning/view.ts).
  prioritizer: { name: "Backlog Prioritizer", href: "/prioritizer" },
  "weighted-decision": { name: "weighted decision", href: "/weighted-decision" },
  cynefin: { name: "Cynefin", href: "/cynefin" },
  "buy-a-feature": { name: "Buy a Feature", href: "/buy-a-feature" },
  // Shelved, but its "Push to Decision Log" still sends decided RFCs.
  "rfc-tracker": { name: "RFC", href: "/rfc-tracker" },
  // Outcomes & quality
  "opportunity-tree": { name: "opportunity tree", href: "/opportunity-tree" },
  "riskiest-assumption": { name: "riskiest assumption", href: "/riskiest-assumption" },
  "user-interviews": { name: "user interviews", href: "/user-interviews" },
  "risk-register": { name: "Risk Register", href: "/risk-register" },
  "tech-debt": { name: "tech debt", href: "/tech-debt" },
  // Track delivery
  burndown: { name: "burndown", href: "/burndown" },
  burnup: { name: "burnup", href: "/burnup" },
  velocity: { name: "velocity", href: "/velocity" },
  "sprint-metrics": { name: "Sprint Metrics", href: "/sprint-metrics" },
  "cumulative-flow": { name: "cumulative flow", href: "/cumulative-flow" },
  "cycle-time": { name: "cycle time", href: "/cycle-time" },
  "value-stream": { name: "value stream map", href: "/value-stream" },
  "health-dashboard": { name: "health dashboard", href: "/health-dashboard" },
  "dora-scorecard": { name: "DORA scorecard", href: "/dora-scorecard" },
  "release-readiness": { name: "Release Readiness", href: "/release-readiness" },
  "feature-flag-tracker": { name: "feature flag tracker", href: "/feature-flag-tracker" },
  // For readers of the book: its actions go to Retro Actions. Someone without
  // access who follows the back-link gets the lock panel and nothing else.
  "squad-session": { name: "Squad Session Kit", href: "/squad-session" },
  // A story's question for the team, sent from the story's page.
  comics: { name: "Agile at Work", href: "/comics" },
  // Phase 42, the tools plan's phase 1: listed ahead of their senders, which
  // each tool's builder adds (a parked point, a countermeasure, wall feedback
  // turned into backlog items, an interrupt, a note).
  "parking-lot": { name: "parking lot", href: "/parking-lot" },
  "root-cause": { name: "root-cause analysis", href: "/root-cause" },
  "audience-wall": { name: "Audience Wall", href: "/audience-wall" },
  // A saved vote's result, sent to the Decision Log or the retro.
  "quick-vote": { name: "Quick Vote", href: "/quick-vote" },
  "interrupt-buffer": { name: "interrupt buffer", href: "/interrupt-buffer" },
  "sm-notebook": { name: "Scrum Master Notebook", href: "/sm-notebook" },
  // A contributing factor taken to Root Cause (its analysis's sourceRef): the
  // plan's hand-off from Post-Mortem, whose sender Root Cause's builder adds.
  "post-mortem": { name: "post-mortem", href: "/post-mortem" },
};

/** The sending tool, or undefined for one not listed (never an inherited key like "constructor"). */
function sourceTool(ref: HandoffRef | undefined): { name: string; href: string } | undefined {
  return ref && Object.prototype.hasOwnProperty.call(SOURCE_TOOLS, ref.tool)
    ? SOURCE_TOOLS[ref.tool]
    : undefined;
}

/** "From retro", for a target item's back-link; null for an unknown tool. */
export function sourceLabel(ref: HandoffRef | undefined): string | null {
  const tool = sourceTool(ref);
  return tool ? `From ${tool.name}` : null;
}

export function sourceHref(ref: HandoffRef | undefined): string | null {
  const tool = sourceTool(ref);
  if (!tool) return null;
  // A tool that keeps several documents opens the one the item came from.
  if (ref?.tool === "premortem" && ref.doc) {
    return `${tool.href}?premortem=${encodeURIComponent(ref.doc)}`;
  }
  if (ref?.tool === "weighted-decision" && ref.doc) {
    return `${tool.href}?matrix=${encodeURIComponent(ref.doc)}`;
  }
  if ((ref?.tool === "squad-session" || ref?.tool === "comics") && ref.doc) {
    return `${tool.href}?ep=${encodeURIComponent(ref.doc)}`;
  }
  // A countermeasure sent from Root Cause opens its analysis.
  if (ref?.tool === "root-cause" && ref.id) {
    return `${tool.href}?analysis=${encodeURIComponent(ref.id)}`;
  }
  return tool.href;
}

/* ── Links on the source item ────────────────────────────────────────── */

// The plain list helpers live in ./links, which loads no route.
export { findLink, withLink, withoutLink } from "./links";

/**
 * The link on `route` whose target still exists. A send whose target was
 * deleted, or lost to a concurrent edit, doesn't count, so the item can be
 * sent again.
 */
export function liveLink(
  links: readonly HandoffLink[] | undefined,
  route: HandoffRouteId
): HandoffLink | undefined {
  const link = findLink(links, route);
  return link && getHandoffRoute(route).exists(link.targetId) ? link : undefined;
}
