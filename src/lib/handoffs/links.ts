/**
 * The links a source item keeps of where it was sent (`sentTo`), as plain
 * list helpers. Pure, with no route or store imports: Amr's actions read
 * them on the MCP server too, where the routes' browser halves must not
 * load. The registry (./registry) re-exports them beside `liveLink`, which
 * needs the routes.
 */

import type { HandoffLink, HandoffRouteId } from "./types";

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
