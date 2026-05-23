import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardSticky, WhiteboardMindMapNode } from "@/lib/stores/workspace-types";

/**
 * Canvas (whiteboard) actions. The agent / MCP can:
 *   - add a sticky note to a board
 *   - move an existing object
 *   - add a mind-map node (root or child)
 *   - resolve a comment thread
 *
 * Authoritative object data lives in workspace.whiteboardObjects (cloud-
 * synced per Thread 2). The actions reach directly into the workspace
 * store rather than going through the canvas client component, so they
 * work even when the canvas isn't currently rendered.
 */

const ws = () => useWorkspaceStore.getState();

function nowIso(): string {
  return new Date().toISOString();
}

function nextZ(boardId: string): number {
  const objs = ws().whiteboardObjects ?? [];
  let max = 0;
  for (const o of objs) {
    if (o.boardId !== boardId) continue;
    if (o.z > max) max = o.z;
  }
  return max + 1;
}

// ──────── tool.canvas.add_sticky ────────
registry.register({
  id: "tool.canvas.add_sticky",
  toolId: "tool.canvas",
  name: "add_sticky",
  category: "write",
  description: "Add a sticky note to a whiteboard at the given world coordinates.",
  paramsSchema: z.object({
    boardId: z.string(),
    content: z.string(),
    x: z.number(),
    y: z.number(),
    color: z.string().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  }),
  handler: async (params: {
    boardId: string;
    content: string;
    x: number;
    y: number;
    color?: string;
    w?: number;
    h?: number;
  }) => {
    const sticky: WhiteboardSticky = {
      id: `obj_${nanoid(10)}`,
      boardId: params.boardId,
      type: "sticky",
      x: params.x,
      y: params.y,
      w: params.w ?? 200,
      h: params.h ?? 200,
      z: nextZ(params.boardId),
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso(),
      content: params.content,
      color: params.color ?? "#FFE066",
    };
    const current = ws().whiteboardObjects ?? [];
    useWorkspaceStore.setState({ whiteboardObjects: [...current, sticky] });
    return { id: sticky.id };
  },
});

// ──────── tool.canvas.move_object ────────
registry.register({
  id: "tool.canvas.move_object",
  toolId: "tool.canvas",
  name: "move_object",
  category: "write",
  description: "Move a whiteboard object to new world coordinates.",
  paramsSchema: z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  handler: async (params: { id: string; x: number; y: number }) => {
    const current = ws().whiteboardObjects ?? [];
    const idx = current.findIndex((o) => o.id === params.id);
    if (idx === -1) return { moved: false };
    const updated = {
      ...current[idx],
      x: params.x,
      y: params.y,
      version: current[idx].version + 1,
      updatedAt: nowIso(),
    };
    const next = current.slice();
    next[idx] = updated;
    useWorkspaceStore.setState({ whiteboardObjects: next });
    return { moved: true };
  },
});

// ──────── tool.canvas.add_mind_map_node ────────
registry.register({
  id: "tool.canvas.add_mind_map_node",
  toolId: "tool.canvas",
  name: "add_mind_map_node",
  category: "write",
  description:
    "Add a mind-map node to a whiteboard. Pass parentNodeId to add a child; omit to create a new root node for a new mind map.",
  paramsSchema: z.object({
    boardId: z.string(),
    text: z.string(),
    x: z.number(),
    y: z.number(),
    parentNodeId: z.string().optional(),
    mindMapId: z.string().optional(),
    color: z.string().optional(),
  }),
  handler: async (params: {
    boardId: string;
    text: string;
    x: number;
    y: number;
    parentNodeId?: string;
    mindMapId?: string;
    color?: string;
  }) => {
    // Resolve mindMapId in order: explicit param → inherit from parent
    // (if the parent is a mindMapNode) → fresh id for a new map.
    let mindMapId = params.mindMapId;
    if (!mindMapId && params.parentNodeId) {
      const parent = (ws().whiteboardObjects ?? []).find(
        (o) => o.id === params.parentNodeId && o.type === "mindMapNode"
      ) as WhiteboardMindMapNode | undefined;
      mindMapId = parent?.mindMapId;
    }
    if (!mindMapId) {
      mindMapId = `mindmap_${nanoid(8)}`;
    }
    const node: WhiteboardMindMapNode = {
      id: `obj_${nanoid(10)}`,
      boardId: params.boardId,
      type: "mindMapNode",
      x: params.x,
      y: params.y,
      w: 180,
      h: 60,
      z: nextZ(params.boardId),
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso(),
      text: params.text,
      parentNodeId: params.parentNodeId,
      mindMapId,
      color: params.color,
    };
    const current = ws().whiteboardObjects ?? [];
    useWorkspaceStore.setState({ whiteboardObjects: [...current, node] });
    return { id: node.id, mindMapId: node.mindMapId };
  },
});

// ──────── tool.canvas.list_objects ────────
registry.register({
  id: "tool.canvas.list_objects",
  toolId: "tool.canvas",
  name: "list_objects",
  category: "read",
  description: "List all objects on a whiteboard (optionally filtered by type).",
  paramsSchema: z.object({
    boardId: z.string(),
    type: z.string().optional(),
  }),
  handler: async (params: { boardId: string; type?: string }) => {
    const all = ws().whiteboardObjects ?? [];
    const filtered = all.filter(
      (o) => o.boardId === params.boardId && (!params.type || o.type === params.type)
    );
    return { items: filtered };
  },
});
