/**
 * Hand-off routes, and the small link helpers both sides use.
 *
 * Which source offers which route is decided at the call site (a retro
 * action offers impediment and kanban; a premortem cause offers risk), so a
 * route knows only how to create, remove and find its target.
 */

import type { HandoffLink, HandoffRef, HandoffRoute, HandoffRouteId } from "./types";
import { impedimentRoute } from "./targets/impediment";
import { kanbanRoute } from "./targets/kanban";
import { riskRoute } from "./targets/risk";
import { pokerQueueRoute } from "./targets/poker-queue";

export const HANDOFF_ROUTES: Readonly<Record<HandoffRouteId, HandoffRoute>> = {
  impediment: impedimentRoute,
  kanban: kanbanRoute,
  risk: riskRoute,
  "poker-queue": pokerQueueRoute,
};

export function getHandoffRoute(id: HandoffRouteId): HandoffRoute {
  return HANDOFF_ROUTES[id];
}

/* ── Sources ─────────────────────────────────────────────────────────── */

/** Tools that send items, with where a "From …" link on the target goes. */
const SOURCE_TOOLS: Record<string, { name: string; href: string }> = {
  retro: { name: "retro", href: "/retro" },
  standup: { name: "standup", href: "/standup" },
  premortem: { name: "premortem", href: "/premortem" },
  "story-mapper": { name: "story map", href: "/story-mapper" },
};

/** "From retro", for a target item's back-link; null for an unknown tool. */
export function sourceLabel(ref: HandoffRef | undefined): string | null {
  const tool = ref && SOURCE_TOOLS[ref.tool];
  return tool ? `From ${tool.name}` : null;
}

export function sourceHref(ref: HandoffRef | undefined): string | null {
  return (ref && SOURCE_TOOLS[ref.tool]?.href) || null;
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
