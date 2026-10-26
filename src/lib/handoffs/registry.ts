/**
 * Hand-off routes, and the small link helpers both sides use.
 *
 * Which source offers which route is decided at the call site (a retro
 * action offers impediment and kanban; a premortem cause offers risk), so a
 * route knows only how to create, remove and find its target.
 *
 * `decision` writes the one decision record the Decision Log, DACI and
 * RAPID share (workspace.decisions, lib/decisions). A route whose target
 * entity doesn't exist yet writes to today's closest slice: `dependency` to
 * the Dependency Map's graph (until the one dependency model lands).
 */

import type { HandoffLink, HandoffRef, HandoffRoute, HandoffRouteId } from "./types";
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
  return tool.href;
}

/* ── Links on the source item ────────────────────────────────────────── */

export function findLink(
  links: readonly HandoffLink[] | undefined,
  route: HandoffRouteId
): HandoffLink | undefined {
  return (links ?? []).find((l) => l.route === route);
}

/** The links with `link` recorded; it replaces an older link on its route. */
export function withLink(
  links: readonly HandoffLink[] | undefined,
  link: HandoffLink
): HandoffLink[] {
  return [...(links ?? []).filter((l) => l.route !== link.route), link];
}

/** The links without `link` (matched on route and target). */
export function withoutLink(
  links: readonly HandoffLink[] | undefined,
  link: HandoffLink
): HandoffLink[] {
  return (links ?? []).filter((l) => !(l.route === link.route && l.targetId === link.targetId));
}

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
