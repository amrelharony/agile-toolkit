/**
 * Send an item to another tool, with Undo.
 *
 * Creates the target through its route and records a HandoffLink on the
 * source item, inside `undoable()`: Undo removes the target and the link
 * (and puts back an older link the send replaced). A route the item was
 * already sent on, whose target still exists, is refused, so a double click
 * or a second menu can't make a duplicate; so is an item the route says it
 * can't take yet (HandoffRoute.problem: an unrated risk).
 */

import { undoable } from "@/lib/utils/undoable";
import { findLink, getHandoffRoute, liveLink, withLink, withoutLink } from "./registry";
import type { HandoffLink, HandoffRoute, HandoffRouteId, HandoffSource } from "./types";

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
 * A fresh toast id for each send. A hand-off is a success (it destroys
 * nothing) that keeps its Undo, and an id of its own keeps two sends apart:
 * one built from the title would merge two items that share a name ("Fix
 * CI" twice) into one toast whose Undo takes back only the second.
 */
let handoffToastSeq = 0;
const nextHandoffToastId = (routeId: HandoffRouteId) => `handoff:${routeId}:${++handoffToastSeq}`;

/** Whether `route` can take `src` now: a title, and nothing the route's own check refuses. */
const sendable = (route: HandoffRoute, src: HandoffSource): boolean =>
  Boolean(src.title.trim()) && !route.problem?.(src);

/**
 * Returns the new link, or null when nothing was sent (a blank title, a
 * source the route can't take yet, or a live link on this route already).
 */
export function sendHandoff(
  routeId: HandoffRouteId,
  src: HandoffSource,
  links: HandoffLinkStore
): HandoffLink | null {
  const route = getHandoffRoute(routeId);
  if (!sendable(route, src)) return null;
  if (liveLink(links.getLinks(), routeId)) return null;
  // A dead link (its target is gone) is replaced, and comes back on Undo.
  const previous = findLink(links.getLinks(), routeId);
  let sent: HandoffLink | null = null;
  undoable({
    label: route.doneLabel,
    description: `“${shortName(src.title)}”`,
    // Sending makes something new and destroys nothing: a success, with Undo.
    kind: "success",
    id: nextHandoffToastId(routeId),
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

export interface HandoffBatchItem {
  src: HandoffSource;
  links: HandoffLinkStore;
}

/**
 * Send several items on one route with one toast and one Undo ("Sent 3
 * to the Risk Register"). Items with a blank title, a source the route
 * can't take yet or a live link on the route are skipped, as `sendHandoff`
 * would skip them. Undo removes every target and link this send made, and
 * puts back any dead link a send replaced. Should a send still throw, the
 * ones made before it are taken back first, so none is left with no Undo.
 * Returns the new links, in the items' order.
 */
export function sendHandoffBatch(
  routeId: HandoffRouteId,
  items: readonly HandoffBatchItem[],
  label?: string
): HandoffLink[] {
  const route = getHandoffRoute(routeId);
  const todo = items.filter(
    (item) => sendable(route, item.src) && !liveLink(item.links.getLinks(), routeId)
  );
  if (todo.length === 0) return [];
  const previous = todo.map((item) => findLink(item.links.getLinks(), routeId));
  const sent: (HandoffLink | null)[] = todo.map(() => null);
  const takeBack = () => {
    todo.forEach((item, i) => {
      const link = sent[i];
      if (!link) return;
      route.remove(link.targetId);
      const prior = previous[i];
      item.links.setLinks((cur) => {
        const rest = withoutLink(cur, link);
        return prior && !findLink(rest, routeId) ? [...rest, prior] : rest;
      });
      sent[i] = null;
    });
  };
  undoable({
    label: label ?? route.doneLabel,
    description: todo.length === 1 ? `“${shortName(todo[0].src.title)}”` : `${todo.length} items`,
    kind: "success",
    id: nextHandoffToastId(routeId),
    apply: () => {
      try {
        todo.forEach((item, i) => {
          const link: HandoffLink = {
            route: routeId,
            targetId: route.send(item.src),
            at: new Date().toISOString(),
          };
          sent[i] = link;
          item.links.setLinks((cur) => withLink(cur, link));
        });
      } catch (err) {
        // undoable() makes its toast only after apply: without this, the
        // targets sent so far would stay with no toast and no Undo.
        takeBack();
        throw err;
      }
    },
    revert: takeBack,
  });
  return sent.filter((l): l is HandoffLink => l !== null);
}
