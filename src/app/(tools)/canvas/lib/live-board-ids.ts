/**
 * How a live board (./live-boards) and its children are told apart from the
 * rest of a board: by the container's `sourceRef`, and by child ids made
 * from the container's (`${containerId}__${part}`). Kept apart from the
 * reconcile so the object views and the property panel can ask without
 * loading the sprint and story-map logic.
 */

import type {
  WhiteboardFrame,
  WhiteboardKanbanFrame,
  WhiteboardObject,
} from "@/lib/stores/workspace-types";

/** Between a container's id and its child's part: `${containerId}__${part}`. */
export const LIVE_SEP = "__";

/** The `sourceRef.tool` of a Sprint board container. */
export const SPRINT_BOARD_TOOL = "sprint";
/** The `sourceRef.tool` of a Story map container. */
export const STORY_MAP_TOOL = "story-mapper";

/** The kinds of container a live board can be. */
export type LiveContainer = WhiteboardKanbanFrame | WhiteboardFrame;

/** A kanban that mirrors a sprint. A cleared `sourceRef` (the sprint was deleted) makes it a plain kanban. */
export function isSprintBoard(o: WhiteboardObject | null | undefined): o is WhiteboardKanbanFrame {
  return (
    !!o && o.type === "kanban" && o.sourceRef?.tool === SPRINT_BOARD_TOOL && !!o.sourceRef.entityId
  );
}

/** A frame that mirrors the story map. */
export function isStoryMapBoard(o: WhiteboardObject | null | undefined): o is WhiteboardFrame {
  return (
    !!o && o.type === "frame" && o.sourceRef?.tool === STORY_MAP_TOOL && !!o.sourceRef.entityId
  );
}

export function isLiveContainer(o: WhiteboardObject | null | undefined): o is LiveContainer {
  return isSprintBoard(o) || isStoryMapBoard(o);
}

/** A live container's child id. */
export function liveChildId(containerId: string, part: string): string {
  return `${containerId}${LIVE_SEP}${part}`;
}

/**
 * The live container `id` belongs to, or null. Tries every `__` in the id,
 * so a container whose own id has one (agents mint nanoid ids, which can)
 * still owns its children; the child must be on the container's board.
 */
export function liveContainerOf(
  id: string,
  byId: ReadonlyMap<string, WhiteboardObject>
): LiveContainer | null {
  const child = byId.get(id);
  let at = id.indexOf(LIVE_SEP);
  while (at > 0) {
    const c = byId.get(id.slice(0, at));
    if (isLiveContainer(c) && (!child || child.boardId === c.boardId)) return c;
    at = id.indexOf(LIVE_SEP, at + 1);
  }
  return null;
}

export function isLiveChild(
  o: WhiteboardObject,
  byId: ReadonlyMap<string, WhiteboardObject>
): boolean {
  return liveContainerOf(o.id, byId) !== null;
}

/** The objects of `objects` whose ids are children of `containerId`. */
export function liveChildrenOf(
  containerId: string,
  objects: readonly WhiteboardObject[]
): WhiteboardObject[] {
  const prefix = containerId + LIVE_SEP;
  return objects.filter((o) => o.id.startsWith(prefix));
}
