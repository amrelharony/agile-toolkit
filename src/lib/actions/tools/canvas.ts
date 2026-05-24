import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverListEntities,
  serverGetEntity,
  serverUpsertEntity,
  serverDeleteEntity,
  serverNextZForBoard,
} from "../server-store";
import type {
  Whiteboard,
  WhiteboardObject,
  WhiteboardSticky,
  WhiteboardMindMapNode,
  WhiteboardConnector,
} from "@/lib/stores/workspace-types";

/** Entity kinds used in user_entities for the cloud-synced collections
 *  this file operates against. Matches the registrations in
 *  workspace-store.ts → registerCollection(...). */
const KIND_WHITEBOARD = "workspace:whiteboard";
const KIND_WHITEBOARD_OBJECT = "workspace:whiteboardObject";

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

/**
 * Compute z-index one above the current top object on the board.
 *
 * Reads the store once at call time. Agent calls are serial within
 * a single conversation turn so the snapshot is stable across the
 * subsequent upsert. Two concurrent agent sessions COULD collide here
 * (both read the same max, both insert at max+1), but the canvas
 * tolerates ties — render order falls back to insertion order. Not
 * worth a transactional claim for the workload.
 */
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
    ws().upsertWhiteboardObject(sticky);
    return { id: sticky.id };
  },
  mcpHandler: async (params, ctx) => {
    const sticky: WhiteboardSticky = {
      id: `obj_${nanoid(10)}`,
      boardId: params.boardId,
      type: "sticky",
      x: params.x,
      y: params.y,
      w: params.w ?? 200,
      h: params.h ?? 200,
      z: await serverNextZForBoard(ctx.userId, params.boardId),
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso(),
      content: params.content,
      color: params.color ?? "#FFE066",
    };
    await serverUpsertEntity(ctx.userId, KIND_WHITEBOARD_OBJECT, sticky);
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
    const target = current.find((o) => o.id === params.id);
    if (!target) return { moved: false };
    ws().upsertWhiteboardObject({
      ...target,
      x: params.x,
      y: params.y,
      version: target.version + 1,
      updatedAt: nowIso(),
    });
    return { moved: true };
  },
  mcpHandler: async (params, ctx) => {
    const target = await serverGetEntity<WhiteboardObject>(
      ctx.userId,
      KIND_WHITEBOARD_OBJECT,
      params.id
    );
    if (!target) return { moved: false };
    await serverUpsertEntity(ctx.userId, KIND_WHITEBOARD_OBJECT, {
      ...target,
      x: params.x,
      y: params.y,
      version: target.version + 1,
      updatedAt: nowIso(),
    });
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
    ws().upsertWhiteboardObject(node);
    return { id: node.id, mindMapId: node.mindMapId };
  },
  mcpHandler: async (params, ctx) => {
    let mindMapId = params.mindMapId;
    if (!mindMapId && params.parentNodeId) {
      const parent = await serverGetEntity<WhiteboardMindMapNode>(
        ctx.userId,
        KIND_WHITEBOARD_OBJECT,
        params.parentNodeId
      );
      if (parent && parent.type === "mindMapNode") {
        mindMapId = parent.mindMapId;
      }
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
      z: await serverNextZForBoard(ctx.userId, params.boardId),
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso(),
      text: params.text,
      parentNodeId: params.parentNodeId,
      mindMapId,
      color: params.color,
    };
    await serverUpsertEntity(ctx.userId, KIND_WHITEBOARD_OBJECT, node);
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
  mcpHandler: async (params, ctx) => {
    const all = await serverListEntities<WhiteboardObject>(ctx.userId, KIND_WHITEBOARD_OBJECT);
    const filtered = all.filter(
      (o) => o.boardId === params.boardId && (!params.type || o.type === params.type)
    );
    return { items: filtered };
  },
});

// ──────── tool.canvas.create_board ────────
// Equivalent to workspace.whiteboard.create but with a stable, named
// tool-id surface so the agent can think in canvas-domain verbs.
// Returns the new boardId.
registry.register({
  id: "tool.canvas.create_board",
  toolId: "tool.canvas",
  name: "create_board",
  category: "write",
  description: "Create a new whiteboard (canvas). Returns the new boardId.",
  paramsSchema: z.object({
    name: z.string(),
    template: z.string().optional(),
  }),
  handler: async (params: { name: string; template?: string }) => {
    const now = nowIso();
    const board: Whiteboard = {
      id: `wb_${nanoid(8)}`,
      name: params.name,
      template: params.template,
      createdAt: now,
      updatedAt: now,
    };
    ws().upsertWhiteboard(board);
    return { boardId: board.id };
  },
  mcpHandler: async (params, ctx) => {
    const now = nowIso();
    const board: Whiteboard = {
      id: `wb_${nanoid(8)}`,
      name: params.name,
      template: params.template,
      createdAt: now,
      updatedAt: now,
    };
    await serverUpsertEntity(ctx.userId, KIND_WHITEBOARD, board);
    return { boardId: board.id };
  },
});

// ──────── tool.canvas.delete_object ────────
// Uses the store's removeWhiteboardObject — it cascades dangling
// connectors, comment threads pinned to the object, and frameId
// references inside contained children. Idempotent: deleting a
// non-existent id is a no-op that returns deleted=false.
registry.register({
  id: "tool.canvas.delete_object",
  toolId: "tool.canvas",
  name: "delete_object",
  category: "write",
  description:
    "Delete a whiteboard object by id. Cascades connectors, comment threads, and frameId references.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params: { id: string }) => {
    const existed = (ws().whiteboardObjects ?? []).some((o) => o.id === params.id);
    if (!existed) return { deleted: false };
    ws().removeWhiteboardObject(params.id);
    return { deleted: true };
  },
  mcpHandler: async (params, ctx) => {
    const existing = await serverGetEntity<WhiteboardObject>(
      ctx.userId,
      KIND_WHITEBOARD_OBJECT,
      params.id
    );
    if (!existing) return { deleted: false };
    // NB: server-side delete only writes the tombstone for THIS object.
    // The browser store's `removeWhiteboardObject` cascades connectors and
    // clears frameId references in place; an MCP-driven delete relies on
    // the next browser pull to apply those cascades locally (or on a
    // subsequent agent invocation to clean up dangling refs). Document as
    // a known asymmetry rather than rewalk every object server-side.
    await serverDeleteEntity(ctx.userId, KIND_WHITEBOARD_OBJECT, params.id);
    return { deleted: true };
  },
});

// ──────── tool.canvas.set_object_text ────────
// One verb to update the text-bearing field of any text-supporting
// object kind. The field name varies by `type`:
//
//   sticky / text / freehand    → `content`
//   shape (rect/ellipse/...)    → `content`
//   frame / kanban              → `label`
//   card                        → `title`
//   voting                      → `question`
//   mindMapNode                 → `text`
//   diagramShape                → `label`
//   connector                   → `label`
//
// Object kinds without a text slot (line, arrow, image, table,
// timer, embed) return updated=false.
registry.register({
  id: "tool.canvas.set_object_text",
  toolId: "tool.canvas",
  name: "set_object_text",
  category: "write",
  description:
    "Change the text/label/title/content/question of a whiteboard object. The actual field updated depends on object type; the agent passes the new value and the action figures out the right slot.",
  paramsSchema: z.object({
    id: z.string(),
    text: z.string(),
  }),
  handler: async (params: { id: string; text: string }) => {
    const current = ws().whiteboardObjects ?? [];
    const idx = current.findIndex((o) => o.id === params.id);
    if (idx === -1) return { updated: false };
    const obj = current[idx];
    const now = nowIso();
    const baseBump = { version: obj.version + 1, updatedAt: now } as const;

    let next: WhiteboardObject;
    switch (obj.type) {
      case "sticky":
      case "text":
        next = { ...obj, content: params.text, ...baseBump };
        break;
      case "freehand":
        // Freehand has no text slot in the type def; skip.
        return { updated: false };
      case "rect":
      case "ellipse":
      case "diamond":
      case "triangle":
        next = { ...obj, content: params.text, ...baseBump };
        break;
      case "frame":
      case "kanban":
        next = { ...obj, label: params.text, ...baseBump };
        break;
      case "card":
        next = { ...obj, title: params.text, ...baseBump };
        break;
      case "voting":
        next = { ...obj, question: params.text, ...baseBump };
        break;
      case "mindMapNode":
        next = { ...obj, text: params.text, ...baseBump };
        break;
      case "diagramShape":
        next = { ...obj, label: params.text, ...baseBump };
        break;
      case "connector":
        next = { ...obj, label: params.text, ...baseBump };
        break;
      // line / arrow / image / table / timer / embed have no text slot.
      default:
        return { updated: false };
    }
    ws().upsertWhiteboardObject(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const obj = await serverGetEntity<WhiteboardObject>(
      ctx.userId,
      KIND_WHITEBOARD_OBJECT,
      params.id
    );
    if (!obj) return { updated: false };
    const now = nowIso();
    const baseBump = { version: obj.version + 1, updatedAt: now } as const;
    let next: WhiteboardObject;
    switch (obj.type) {
      case "sticky":
      case "text":
      case "rect":
      case "ellipse":
      case "diamond":
      case "triangle":
        next = { ...obj, content: params.text, ...baseBump };
        break;
      case "freehand":
        return { updated: false };
      case "frame":
      case "kanban":
        next = { ...obj, label: params.text, ...baseBump };
        break;
      case "card":
        next = { ...obj, title: params.text, ...baseBump };
        break;
      case "voting":
        next = { ...obj, question: params.text, ...baseBump };
        break;
      case "mindMapNode":
        next = { ...obj, text: params.text, ...baseBump };
        break;
      case "diagramShape":
      case "connector":
        next = { ...obj, label: params.text, ...baseBump };
        break;
      default:
        return { updated: false };
    }
    await serverUpsertEntity(ctx.userId, KIND_WHITEBOARD_OBJECT, next);
    return { updated: true };
  },
});

// ──────── tool.canvas.add_connector ────────
// Draw a connector between two existing objects on the same board.
// Validates both endpoints exist and live on the same boardId — a
// cross-board connector wouldn't render and would dangle silently.
registry.register({
  id: "tool.canvas.add_connector",
  toolId: "tool.canvas",
  name: "add_connector",
  category: "write",
  description: "Add a connector (arrow) between two whiteboard objects on the same board.",
  paramsSchema: z.object({
    fromId: z.string(),
    toId: z.string(),
    routing: z.enum(["straight", "orthogonal", "curved"]).optional(),
    arrowStart: z.boolean().optional(),
    arrowEnd: z.boolean().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
    label: z.string().optional(),
    dashed: z.boolean().optional(),
  }),
  handler: async (params: {
    fromId: string;
    toId: string;
    routing?: "straight" | "orthogonal" | "curved";
    arrowStart?: boolean;
    arrowEnd?: boolean;
    stroke?: string;
    strokeWidth?: number;
    label?: string;
    dashed?: boolean;
  }) => {
    const all = ws().whiteboardObjects ?? [];
    const from = all.find((o) => o.id === params.fromId);
    const to = all.find((o) => o.id === params.toId);
    if (!from) throw new Error(`Connector source object ${params.fromId} not found.`);
    if (!to) throw new Error(`Connector target object ${params.toId} not found.`);
    if (from.boardId !== to.boardId) {
      throw new Error(
        `Connector endpoints must live on the same board (from=${from.boardId}, to=${to.boardId}).`
      );
    }
    const now = nowIso();
    const connector: WhiteboardConnector = {
      id: `obj_${nanoid(10)}`,
      boardId: from.boardId,
      type: "connector",
      // The connector renders against its endpoints — x/y/w/h are
      // bookkeeping only. Position at the source.
      x: from.x,
      y: from.y,
      w: 0,
      h: 0,
      z: nextZ(from.boardId),
      version: 1,
      createdAt: now,
      updatedAt: now,
      fromId: params.fromId,
      toId: params.toId,
      routing: params.routing ?? "orthogonal",
      arrowStart: params.arrowStart ?? false,
      arrowEnd: params.arrowEnd ?? true,
      stroke: params.stroke ?? "#94a3b8",
      strokeWidth: params.strokeWidth ?? 2,
      label: params.label,
      dashed: params.dashed,
    };
    ws().upsertWhiteboardObject(connector);
    return { id: connector.id };
  },
  mcpHandler: async (params, ctx) => {
    const from = await serverGetEntity<WhiteboardObject>(
      ctx.userId,
      KIND_WHITEBOARD_OBJECT,
      params.fromId
    );
    const to = await serverGetEntity<WhiteboardObject>(
      ctx.userId,
      KIND_WHITEBOARD_OBJECT,
      params.toId
    );
    if (!from) throw new Error(`Connector source object ${params.fromId} not found.`);
    if (!to) throw new Error(`Connector target object ${params.toId} not found.`);
    if (from.boardId !== to.boardId) {
      throw new Error(
        `Connector endpoints must live on the same board (from=${from.boardId}, to=${to.boardId}).`
      );
    }
    const now = nowIso();
    const connector: WhiteboardConnector = {
      id: `obj_${nanoid(10)}`,
      boardId: from.boardId,
      type: "connector",
      x: from.x,
      y: from.y,
      w: 0,
      h: 0,
      z: await serverNextZForBoard(ctx.userId, from.boardId),
      version: 1,
      createdAt: now,
      updatedAt: now,
      fromId: params.fromId,
      toId: params.toId,
      routing: params.routing ?? "orthogonal",
      arrowStart: params.arrowStart ?? false,
      arrowEnd: params.arrowEnd ?? true,
      stroke: params.stroke ?? "#94a3b8",
      strokeWidth: params.strokeWidth ?? 2,
      label: params.label,
      dashed: params.dashed,
    };
    await serverUpsertEntity(ctx.userId, KIND_WHITEBOARD_OBJECT, connector);
    return { id: connector.id };
  },
});
