"use client";

import { useCallback, type RefObject } from "react";
import { wbId } from "@/lib/whiteboard/clipboard";
import { layoutMindMap, MIND_MAP_NODE_DEFAULT } from "@/lib/whiteboard/mind-map-layout";
import type { WhiteboardObject, WhiteboardMindMapNode } from "@/lib/stores/workspace-types";

export type MindMapAction = "child" | "sibling" | "promote";

/**
 * Mind-map structural editor — wires Tab / Enter / Shift+Tab from
 * inside a node's inline editor to the actual tree mutation.
 *
 * Returns a single callback `(nodeId, action, committedText)`:
 *
 *   - `child`    (Tab)        — commit text, add a new empty child of
 *                               nodeId, re-layout, select + edit child.
 *   - `sibling`  (Enter)      — commit text, add a new empty sibling
 *                               of nodeId (same parent), re-layout,
 *                               select + edit new sibling. ROOT nodes
 *                               can't have siblings; the call no-ops
 *                               apart from committing the text.
 *   - `promote`  (Shift+Tab)  — commit text, move nodeId up one level
 *                               (becomes a sibling of its parent),
 *                               re-layout. Root + first-level nodes
 *                               are immutable — no-op apart from text.
 *
 * Layout runs after every structural mutation so the tree stays
 * tidy. The root's existing world position is preserved as the
 * layout anchor — dragging the root won't get reset by the next
 * structural change.
 *
 * Single-snapshot per action so undo restores the whole "Tab"
 * operation (text commit + new node + layout) in one step.
 */
export function useMindMapStructural(params: {
  boardId: string;
  objects: readonly WhiteboardObject[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  upsertMany: (objs: WhiteboardObject[]) => void;
  setSelection: (ids: string[]) => void;
  setEditingObjectId: (id: string | null) => void;
  pushSnapshot: () => void;
  topZRef: RefObject<number>;
  readOnly: boolean;
}) {
  const {
    boardId, objects, objectsById, upsertMany,
    setSelection, setEditingObjectId, pushSnapshot, topZRef, readOnly,
  } = params;

  return useCallback(
    (nodeId: string, action: MindMapAction, committedText: string) => {
      if (readOnly) {
        setEditingObjectId(null);
        return;
      }
      const node = objectsById.get(nodeId);
      if (!node || node.type !== "mindMapNode") {
        setEditingObjectId(null);
        return;
      }
      const now = new Date().toISOString();
      // Commit the in-flight text first, then perform the action.
      const textUpdate: WhiteboardMindMapNode = {
        ...node,
        text: committedText,
        version: node.version + 1,
        updatedAt: now,
      };

      // Gather every node in the same mind map. We'll mutate this set
      // and feed it back to layoutMindMap.
      const family = objects.filter(
        (o): o is WhiteboardMindMapNode =>
          o.type === "mindMapNode" && o.mindMapId === node.mindMapId,
      );
      const familyById = new Map<string, WhiteboardMindMapNode>();
      for (const n of family) familyById.set(n.id, n);
      // Apply the just-edited text so layout sees the updated node.
      familyById.set(nodeId, textUpdate);

      let newNodeId: string | null = null;
      let newSubtree: WhiteboardMindMapNode[] = [];

      if (action === "child") {
        newNodeId = wbId("wb");
        const newNode: WhiteboardMindMapNode = {
          id: newNodeId,
          boardId,
          type: "mindMapNode",
          x: node.x + node.w + 64,
          y: node.y,
          w: MIND_MAP_NODE_DEFAULT.w,
          h: MIND_MAP_NODE_DEFAULT.h,
          z: (topZRef.current ?? 0) + 1,
          version: 1,
          createdAt: now,
          updatedAt: now,
          text: "",
          parentNodeId: nodeId,
          mindMapId: node.mindMapId,
        };
        newSubtree = [newNode];
        familyById.set(newNodeId, newNode);
      } else if (action === "sibling") {
        // Root has no siblings — no-op apart from text.
        if (!node.parentNodeId) {
          pushSnapshot();
          upsertMany([textUpdate]);
          setEditingObjectId(null);
          return;
        }
        newNodeId = wbId("wb");
        const newNode: WhiteboardMindMapNode = {
          id: newNodeId,
          boardId,
          type: "mindMapNode",
          x: node.x,
          y: node.y + node.h + 18,
          w: MIND_MAP_NODE_DEFAULT.w,
          h: MIND_MAP_NODE_DEFAULT.h,
          z: (topZRef.current ?? 0) + 1,
          version: 1,
          createdAt: now,
          updatedAt: now,
          text: "",
          parentNodeId: node.parentNodeId,
          mindMapId: node.mindMapId,
        };
        newSubtree = [newNode];
        familyById.set(newNodeId, newNode);
      } else if (action === "promote") {
        // Root + first-level nodes can't promote further. (First-level
        // would become a sibling of the root, which makes no sense
        // for a single-rooted mind map.)
        const parent = node.parentNodeId ? familyById.get(node.parentNodeId) : null;
        if (!parent || !parent.parentNodeId) {
          pushSnapshot();
          upsertMany([textUpdate]);
          setEditingObjectId(null);
          return;
        }
        const promoted: WhiteboardMindMapNode = {
          ...textUpdate,
          parentNodeId: parent.parentNodeId,
        };
        familyById.set(node.id, promoted);
      }

      // Re-layout the full mind map, anchored at the current root.
      const rootBefore = family.find((n) => !n.parentNodeId);
      const rootAnchor = rootBefore ? { x: rootBefore.x, y: rootBefore.y } : null;
      const familyArr = Array.from(familyById.values());
      const positions = layoutMindMap(familyArr, rootAnchor);

      // Build the patch: every node in the family gets its new x/y,
      // plus the structural fields for any newly-created node.
      const patch: WhiteboardObject[] = [];
      for (const fam of familyArr) {
        const pos = positions.get(fam.id);
        if (!pos) continue;
        const moved = pos.x !== fam.x || pos.y !== fam.y;
        // Bump version when position changed OR for the structurally
        // updated node so peers receive the change.
        const isStructural = fam.id === nodeId || fam.id === newNodeId;
        if (!moved && !isStructural) continue;
        patch.push({
          ...fam,
          x: pos.x,
          y: pos.y,
          version: fam.version + (isStructural ? 0 : 1), // structural updates already bumped above
          updatedAt: now,
        });
      }
      // Make sure the original text-update for `nodeId` lands even
      // if it didn't move (single-node map editing the root).
      if (!patch.some((o) => o.id === nodeId)) {
        patch.push(textUpdate);
      }

      pushSnapshot();
      upsertMany(patch);

      if (newNodeId) {
        setSelection([newNodeId]);
        setEditingObjectId(newNodeId);
      } else {
        // Promote case: keep the same node selected; exit edit mode
        // so the next Tab/Enter on this node starts fresh.
        setSelection([nodeId]);
        setEditingObjectId(null);
      }
      // We're using void below to satisfy the void newSubtree usage
      // warning while keeping the local for potential future use.
      void newSubtree;
    },
    [readOnly, objectsById, objects, boardId, topZRef, pushSnapshot, upsertMany, setSelection, setEditingObjectId],
  );
}
