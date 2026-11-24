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

import type { HandoffLink, HandoffRoute, HandoffRouteId } from "./types";
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
import { bugRoute } from "./targets/bug";
import { interruptRoute } from "./targets/interrupt";
import { epicRoute } from "./targets/epic";
import { agreementRuleRoute } from "./targets/agreement-rule";

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
  // Phase 43, the tools plan's phase 2.
  bug: bugRoute,
  interrupt: interruptRoute,
  epic: epicRoute,
  "agreement-rule": agreementRuleRoute,
};

export function getHandoffRoute(id: HandoffRouteId): HandoffRoute {
  return HANDOFF_ROUTES[id];
}

/* ── Sources ─────────────────────────────────────────────────────────── */

// The sources and their back-link helpers live in ./sources, which loads no route.
export { SOURCE_TOOLS, sourceHref, sourceLabel } from "./sources";

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
