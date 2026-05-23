"use client";

import { memo, useMemo } from "react";
import type { WhiteboardObject, WhiteboardMindMapNode } from "@/lib/stores/workspace-types";

/**
 * Renders the parent → child curves for every mind map on the board.
 *
 * Edges are NOT stored — they're derived from each node's
 * `parentNodeId`. This means deleting a parent removes its child
 * edges automatically and there's no edge state to keep in sync.
 *
 * A cubic Bézier curve from the right-middle of the parent to the
 * left-middle of the child reads as a clean "branch" connection,
 * matching the mind-map convention in Miro / MindMeister / XMind.
 *
 * Collapsed parents render with their direct descendants HIDDEN, so
 * we walk the tree skipping any subtree under a collapsed node when
 * deciding which edges to draw.
 */
export const MindMapEdges = memo(function MindMapEdges({
  objects,
}: {
  objects: readonly WhiteboardObject[];
}) {
  // Pre-compute the visible-node map and pull out mind map nodes
  // once. The whole-objects array reference changes on every drag
  // frame so we memoise the derivation off it.
  const nodes = useMemo(
    () => objects.filter((o): o is WhiteboardMindMapNode => o.type === "mindMapNode"),
    [objects],
  );

  const edges = useMemo(() => {
    if (nodes.length === 0) return [];
    const byId = new Map<string, WhiteboardMindMapNode>();
    for (const n of nodes) byId.set(n.id, n);
    // Walk down from each ROOT, skipping subtrees under collapsed
    // parents. Visited set guards against pathological data where a
    // child's parentNodeId loops back into an ancestor (shouldn't
    // happen during normal ops but defensive).
    const visible = new Set<string>();
    const visit = (id: string) => {
      if (visible.has(id)) return;
      visible.add(id);
      const n = byId.get(id);
      if (!n || n.collapsed) return;
      for (const child of nodes) {
        if (child.parentNodeId === id) visit(child.id);
      }
    };
    for (const n of nodes) {
      if (!n.parentNodeId) visit(n.id);
    }
    const out: { id: string; d: string; stroke: string }[] = [];
    for (const n of nodes) {
      if (!n.parentNodeId) continue;
      if (!visible.has(n.id)) continue;
      const parent = byId.get(n.parentNodeId);
      if (!parent || !visible.has(parent.id)) continue;
      // Anchor: parent's right-middle → child's left-middle.
      const px = parent.x + parent.w;
      const py = parent.y + parent.h / 2;
      const cx = n.x;
      const cy = n.y + n.h / 2;
      // Cubic Bézier with horizontal control points half the
      // distance between parent and child — creates a smooth
      // "branch" curve regardless of vertical offset.
      const midX = (px + cx) / 2;
      const d = `M ${px} ${py} C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}`;
      out.push({
        id: n.id,
        d,
        stroke: n.color ?? "rgba(148, 163, 184, 0.7)",
      });
    }
    return out;
  }, [nodes]);

  if (edges.length === 0) return null;
  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      {edges.map((e) => (
        <path
          key={e.id}
          d={e.d}
          fill="none"
          stroke={e.stroke}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
});
