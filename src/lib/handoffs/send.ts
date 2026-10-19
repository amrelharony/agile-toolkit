/**
 * Send an item to another tool, with Undo.
 *
 * Creates the target through its route and records a HandoffLink on the
 * source item, inside `undoable()`: Undo removes the target and the link
 * (and puts back an older link the send replaced). A route the item was
 * already sent on, whose target still exists, is refused, so a double click
 * or a second menu can't make a duplicate.
 */

import { undoable } from "@/lib/utils/undoable";
import { findLink, getHandoffRoute, liveLink, withLink, withoutLink } from "./registry";
import type { HandoffLink, HandoffRouteId, HandoffSource } from "./types";

export interface HandoffLinkStore {
  /** The source item's current links (read fresh). */
  getLinks: () => readonly HandoffLink[] | undefined;
  /** Replace the source item's links. */
  setLinks: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
}

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Returns the new link, or null when nothing was sent (a blank title, or a
 * live link on this route already).
 */
export function sendHandoff(
  routeId: HandoffRouteId,
  src: HandoffSource,
  links: HandoffLinkStore
): HandoffLink | null {
  const route = getHandoffRoute(routeId);
  if (!src.title.trim()) return null;
  if (liveLink(links.getLinks(), routeId)) return null;
  // A dead link (its target is gone) is replaced, and comes back on Undo.
  const previous = findLink(links.getLinks(), routeId);
  let sent: HandoffLink | null = null;
  undoable({
    label: route.doneLabel,
    description: `“${shortName(src.title)}”`,
    apply: () => {
      const link: HandoffLink = {
        route: routeId,
        targetId: route.send(src),
        at: new Date().toISOString(),
      };
      sent = link;
      links.setLinks((cur) => withLink(cur, link));
    },
    revert: () => {
      const link = sent;
      if (!link) return;
      route.remove(link.targetId);
      links.setLinks((cur) => {
        const rest = withoutLink(cur, link);
        return previous && !findLink(rest, routeId) ? [...rest, previous] : rest;
      });
    },
  });
  return sent;
}
