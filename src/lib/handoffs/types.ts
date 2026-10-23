/**
 * Hand-offs: one tool sends an item to another.
 *
 *   retro action      → impediment, Kanban card
 *   standup blocker   → impediment
 *   premortem cause   → risk
 *   story-map card    → Planning Poker queue
 *
 * and, for the tools later phases upgrade, a backlog story, a retro topic
 * or action on the current retro board, a hypothesis, a proposed decision,
 * or a node (and edge) on the dependency map.
 *
 * The target records where the item came from (`sourceRef`), and the source
 * records where it went (`sentTo`, a list of HandoffLink). Both sides can then
 * link to each other, and a second send of the same item to the same place
 * is avoided. The link types live with the workspace entities; this module
 * adds the route contract.
 */

import type { HandoffLink, HandoffRef, HandoffRouteId } from "@/lib/stores/workspace-types";

export type { HandoffLink, HandoffRef, HandoffRouteId };

/** What a source tool hands over. Targets use the fields that fit them. */
export interface HandoffSource {
  title: string;
  description?: string;
  /** Who owns the follow-up (a retro action's assignee). */
  owner?: string;
  /** Who raised it (the team member a standup blocker belongs to). */
  raisedBy?: string;
  /** 1–5. A premortem cause's likelihood becomes a risk's probability. */
  likelihood?: number;
  /** 1–5. A premortem cause's impact. */
  impact?: number;
  /** A premortem cause's preventive action becomes the risk's mitigation. */
  mitigation?: string;
  /** An estimate a backlog story keeps (a Planning Poker result). */
  points?: number;
  /** Which kind of retro column a topic belongs in: a concern (the
   *  default, e.g. a red health check) or an appreciation (a kudos). */
  tone?: "concern" | "appreciation";
  /** A dependency's other side: the team or deliverable it waits on. */
  dependsOn?: string;
  /** Where the item lives, so the target can link back to it. */
  sourceRef: HandoffRef;
}

export interface HandoffRoute {
  id: HandoffRouteId;
  /** The target, as a menu item names it: "Impediment", "Kanban card". */
  label: string;
  /** Past tense, for the toast: "Raised as an impediment". */
  doneLabel: string;
  /** Tool id of the target (matches the tool registry). */
  targetToolId: string;
  /** Where "Open" goes for a sent item. */
  targetHref: (targetId: string) => string;
  /** Create the target item and return its id. */
  send: (src: HandoffSource) => string;
  /** Remove the target item (Undo). Unknown ids are ignored. */
  remove: (targetId: string) => void;
  /** Whether the target item still exists. A send whose target is gone
   *  (deleted, or lost to a concurrent edit) can be sent again. */
  exists: (targetId: string) => boolean;
  /** Whether the target item is finished (an impediment resolved, a Kanban
   *  card in Done). Absent when the route can't tell. */
  isDone?: (targetId: string) => boolean;
}
