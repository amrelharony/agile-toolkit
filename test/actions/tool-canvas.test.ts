/**
 * tool.canvas.* action coverage (the CAS write path of move_object and
 * set_object_text is pinned separately in test/mcp/canvas-cas.test.ts).
 *
 *   1. all eight verbs register, with an MCP handler each
 *   2. the in-app handlers against the workspace store: add_sticky,
 *      move_object, add_mind_map_node, list_objects, create_board,
 *      delete_object, set_object_text, add_connector
 *   3. the MCP handlers against a mocked server store: where they read
 *      and write, and the same validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
    serverUpsertEntity: vi.fn(async () => {}),
    serverDeleteEntity: vi.fn(async () => {}),
    serverVersionedUpdate: vi.fn(async () => null),
    serverNextZForBoard: vi.fn(async () => 1),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  WhiteboardConnector,
  WhiteboardMindMapNode,
  WhiteboardObject,
} from "@/lib/stores/workspace-types";
import "@/lib/actions/tools/canvas";
import {
  cardFixture,
  diagramShapeFixture,
  embedFixture,
  freehandFixture,
  frameFixture,
  imageFixture,
  kanbanFixture,
  lineFixture,
  mindMapNodeFixture,
  shapeFixture,
  stickyFixture,
  tableFixture,
  textFixture,
  timerFixture,
  votingFixture,
} from "../canvas/object-fixtures";

const KIND_OBJECT = "workspace:whiteboardObject";
const KIND_BOARD = "workspace:whiteboard";

const get = vi.mocked(serverStore.serverGetEntity);
const list = vi.mocked(serverStore.serverListEntities);
const upsert = vi.mocked(serverStore.serverUpsertEntity);
const del = vi.mocked(serverStore.serverDeleteEntity);
const nextZ = vi.mocked(serverStore.serverNextZForBoard);

const ctx = () => makeContext("user-1", "agent");
const mcpCtx = () => makeContext("user-1", "mcp");

async function run<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const action = registry.get(`tool.canvas.${name}`);
  return (await action!.handler(params as never, ctx())) as T;
}
async function runMcp<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const action = registry.get(`tool.canvas.${name}`);
  return (await action!.mcpHandler!(params as never, mcpCtx())) as T;
}

const objects = () => useWorkspaceStore.getState().whiteboardObjects ?? [];
const obj = (id: string) => objects().find((o) => o.id === id);

beforeEach(() => {
  useWorkspaceStore.setState({
    whiteboards: [],
    whiteboardObjects: [],
    whiteboardCommentThreads: [],
  });
  get.mockReset().mockResolvedValue(null);
  list.mockReset().mockResolvedValue([]);
  upsert.mockReset().mockResolvedValue();
  del.mockReset().mockResolvedValue();
  nextZ.mockReset().mockResolvedValue(1);
});

describe("tool.canvas — registration", () => {
  it("registers every verb with an MCP handler; only list_objects is a read", () => {
    const verbs = [
      "add_sticky",
      "move_object",
      "add_mind_map_node",
      "list_objects",
      "create_board",
      "delete_object",
      "set_object_text",
      "add_connector",
    ];
    for (const v of verbs) {
      const a = registry.get(`tool.canvas.${v}`);
      expect(a, v).toBeDefined();
      expect(a!.mcpHandler, v).toBeTypeOf("function");
      expect(a!.category, v).toBe(v === "list_objects" ? "read" : "write");
    }
  });
});

describe("tool.canvas.add_sticky", () => {
  it("adds a yellow 200×200 sticky on top of that board's objects", async () => {
    useWorkspaceStore.setState({
      whiteboardObjects: [
        stickyFixture({ id: "a", boardId: "b1", z: 4 }),
        stickyFixture({ id: "b", boardId: "b1", z: 9 }),
        stickyFixture({ id: "c", boardId: "b2", z: 50 }),
      ],
    });
    const { id } = await run<{ id: string }>("add_sticky", {
      boardId: "b1",
      content: "Hello",
      x: 10,
      y: 20,
    });
    expect(id).toMatch(/^obj_/);
    expect(obj(id)).toMatchObject({
      boardId: "b1",
      type: "sticky",
      content: "Hello",
      x: 10,
      y: 20,
      w: 200,
      h: 200,
      z: 10,
      version: 1,
      color: "#FFE066",
    });
  });

  it("takes a colour and size, and starts at z 1 on an empty board", async () => {
    const { id } = await run<{ id: string }>("add_sticky", {
      boardId: "b1",
      content: "",
      x: 0,
      y: 0,
      color: "#00ff00",
      w: 120,
      h: 90,
    });
    expect(obj(id)).toMatchObject({ color: "#00ff00", w: 120, h: 90, z: 1 });
  });

  it("writes to the server store on the MCP path, on top of the board", async () => {
    nextZ.mockResolvedValue(7);
    const { id } = await runMcp<{ id: string }>("add_sticky", {
      boardId: "b1",
      content: "Agent",
      x: 1,
      y: 2,
    });
    expect(nextZ).toHaveBeenCalledWith("user-1", "b1");
    expect(upsert).toHaveBeenCalledWith(
      "user-1",
      KIND_OBJECT,
      expect.objectContaining({ id, type: "sticky", content: "Agent", z: 7 })
    );
    expect(objects()).toEqual([]);
  });
});

describe("tool.canvas.move_object", () => {
  it("moves an object and bumps its version", async () => {
    useWorkspaceStore.setState({ whiteboardObjects: [stickyFixture({ id: "s1", version: 3 })] });
    expect(await run("move_object", { id: "s1", x: 400, y: -50 })).toEqual({ moved: true });
    expect(obj("s1")).toMatchObject({ x: 400, y: -50, version: 4 });
  });

  it("moves freehand ink with its box", async () => {
    useWorkspaceStore.setState({
      whiteboardObjects: [freehandFixture({ id: "f1", x: 0, y: 0, points: [0, 0, 10, 20] })],
    });
    await run("move_object", { id: "f1", x: 5, y: 5 });
    expect(obj("f1")).toMatchObject({ x: 5, y: 5, points: [5, 5, 15, 25] });
  });

  it("reports moved:false for an unknown id", async () => {
    expect(await run("move_object", { id: "ghost", x: 0, y: 0 })).toEqual({ moved: false });
  });
});

describe("tool.canvas.add_mind_map_node", () => {
  it("starts a new map for a root node", async () => {
    const r = await run<{ id: string; mindMapId: string }>("add_mind_map_node", {
      boardId: "b1",
      text: "Root",
      x: 0,
      y: 0,
    });
    expect(r.mindMapId).toMatch(/^mindmap_/);
    expect(obj(r.id)).toMatchObject({
      type: "mindMapNode",
      text: "Root",
      w: 180,
      h: 60,
      mindMapId: r.mindMapId,
    });
    expect((obj(r.id) as WhiteboardMindMapNode).parentNodeId).toBeUndefined();
  });

  it("puts a child in its parent's map, unless a map id is given", async () => {
    useWorkspaceStore.setState({
      whiteboardObjects: [mindMapNodeFixture({ id: "p", boardId: "b1", mindMapId: "mm-7" })],
    });
    const child = await run<{ id: string; mindMapId: string }>("add_mind_map_node", {
      boardId: "b1",
      text: "Child",
      x: 0,
      y: 0,
      parentNodeId: "p",
    });
    expect(child.mindMapId).toBe("mm-7");
    expect(obj(child.id)).toMatchObject({ parentNodeId: "p", mindMapId: "mm-7" });

    const explicit = await run<{ mindMapId: string }>("add_mind_map_node", {
      boardId: "b1",
      text: "X",
      x: 0,
      y: 0,
      parentNodeId: "p",
      mindMapId: "mm-other",
    });
    expect(explicit.mindMapId).toBe("mm-other");
  });

  it("starts a fresh map when the parent isn't a mind-map node", async () => {
    useWorkspaceStore.setState({ whiteboardObjects: [stickyFixture({ id: "s", boardId: "b1" })] });
    const r = await run<{ mindMapId: string }>("add_mind_map_node", {
      boardId: "b1",
      text: "X",
      x: 0,
      y: 0,
      parentNodeId: "s",
    });
    expect(r.mindMapId).toMatch(/^mindmap_/);
  });

  it("inherits the parent's map from the server store on the MCP path", async () => {
    get.mockResolvedValue(mindMapNodeFixture({ id: "p", mindMapId: "mm-srv" }) as never);
    const r = await runMcp<{ mindMapId: string }>("add_mind_map_node", {
      boardId: "b1",
      text: "C",
      x: 0,
      y: 0,
      parentNodeId: "p",
    });
    expect(get).toHaveBeenCalledWith("user-1", KIND_OBJECT, "p");
    expect(r.mindMapId).toBe("mm-srv");
    expect(upsert).toHaveBeenCalledWith(
      "user-1",
      KIND_OBJECT,
      expect.objectContaining({ parentNodeId: "p", mindMapId: "mm-srv" })
    );
  });
});

describe("tool.canvas.list_objects", () => {
  const seed: WhiteboardObject[] = [
    stickyFixture({ id: "s1", boardId: "b1" }),
    textFixture({ id: "t1", boardId: "b1" }),
    stickyFixture({ id: "s2", boardId: "b2" }),
  ];

  it("lists one board's objects, optionally of one type", async () => {
    useWorkspaceStore.setState({ whiteboardObjects: seed });
    const all = await run<{ items: WhiteboardObject[] }>("list_objects", { boardId: "b1" });
    expect(all.items.map((o) => o.id)).toEqual(["s1", "t1"]);
    const stickies = await run<{ items: WhiteboardObject[] }>("list_objects", {
      boardId: "b1",
      type: "sticky",
    });
    expect(stickies.items.map((o) => o.id)).toEqual(["s1"]);
    expect((await run<{ items: unknown[] }>("list_objects", { boardId: "nope" })).items).toEqual(
      []
    );
  });

  it("filters the server's objects the same way on the MCP path", async () => {
    list.mockResolvedValue(seed as never);
    const r = await runMcp<{ items: WhiteboardObject[] }>("list_objects", {
      boardId: "b1",
      type: "text",
    });
    expect(list).toHaveBeenCalledWith("user-1", KIND_OBJECT);
    expect(r.items.map((o) => o.id)).toEqual(["t1"]);
  });
});

describe("tool.canvas.create_board", () => {
  it("creates a named board and returns its id", async () => {
    const { boardId } = await run<{ boardId: string }>("create_board", {
      name: "Q4 planning",
      template: "retro",
    });
    expect(boardId).toMatch(/^wb_/);
    expect(useWorkspaceStore.getState().whiteboards).toEqual([
      expect.objectContaining({ id: boardId, name: "Q4 planning", template: "retro" }),
    ]);
  });

  it("writes the board to the server store on the MCP path", async () => {
    const { boardId } = await runMcp<{ boardId: string }>("create_board", { name: "Agent board" });
    expect(upsert).toHaveBeenCalledWith(
      "user-1",
      KIND_BOARD,
      expect.objectContaining({ id: boardId, name: "Agent board" })
    );
  });
});

describe("tool.canvas.delete_object", () => {
  it("deletes an object along with connectors attached to it", async () => {
    const connector: WhiteboardConnector = {
      ...lineFixture("arrow", { id: "c1", boardId: "b1" }),
      type: "connector",
      fromId: "a",
      toId: "b",
      routing: "straight",
      stroke: "#fff",
      strokeWidth: 2,
    };
    useWorkspaceStore.setState({
      whiteboardObjects: [
        stickyFixture({ id: "a", boardId: "b1" }),
        stickyFixture({ id: "b", boardId: "b1" }),
        connector,
      ],
    });
    expect(await run("delete_object", { id: "a" })).toEqual({ deleted: true });
    expect(objects().map((o) => o.id)).toEqual(["b"]);
    expect(await run("delete_object", { id: "a" })).toEqual({ deleted: false });
  });

  it("only tombstones an object the server has, on the MCP path", async () => {
    expect(await runMcp("delete_object", { id: "ghost" })).toEqual({ deleted: false });
    expect(del).not.toHaveBeenCalled();
    get.mockResolvedValue(stickyFixture({ id: "s1" }) as never);
    expect(await runMcp("delete_object", { id: "s1" })).toEqual({ deleted: true });
    expect(del).toHaveBeenCalledWith("user-1", KIND_OBJECT, "s1");
  });
});

describe("tool.canvas.set_object_text", () => {
  it("writes the text into each kind's own field and bumps the version", async () => {
    const cases: [WhiteboardObject, string][] = [
      [stickyFixture({ id: "sticky" }), "content"],
      [textFixture({ id: "text" }), "content"],
      [shapeFixture("ellipse", { id: "shape" }), "content"],
      [frameFixture({ id: "frame" }), "label"],
      [kanbanFixture({ id: "kanban" }), "label"],
      [diagramShapeFixture({ id: "diagram" }), "label"],
      [cardFixture({ id: "card" }), "title"],
      [votingFixture({ id: "voting" }), "question"],
      [mindMapNodeFixture({ id: "mind" }), "text"],
    ];
    useWorkspaceStore.setState({ whiteboardObjects: cases.map(([o]) => o) });
    for (const [o, field] of cases) {
      expect(await run("set_object_text", { id: o.id, text: `new ${o.id}` }), o.id).toEqual({
        updated: true,
      });
      expect(obj(o.id), o.id).toMatchObject({ [field]: `new ${o.id}`, version: o.version + 1 });
    }
  });

  it("refuses kinds with no text slot, and unknown ids", async () => {
    const noSlot = [
      lineFixture("line", { id: "line" }),
      imageFixture({ id: "image" }),
      tableFixture({ id: "table" }),
      timerFixture({ id: "timer" }),
      embedFixture({ id: "embed" }),
      freehandFixture({ id: "ink" }),
    ];
    useWorkspaceStore.setState({ whiteboardObjects: noSlot });
    for (const o of noSlot) {
      expect(await run("set_object_text", { id: o.id, text: "x" }), o.id).toEqual({
        updated: false,
      });
    }
    expect(objects()).toEqual(noSlot);
    expect(await run("set_object_text", { id: "ghost", text: "x" })).toEqual({ updated: false });
  });
});

describe("tool.canvas.add_connector", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      whiteboardObjects: [
        stickyFixture({ id: "a", boardId: "b1", x: 11, y: 22, z: 3 }),
        stickyFixture({ id: "b", boardId: "b1", z: 5 }),
        stickyFixture({ id: "far", boardId: "b2" }),
      ],
    });
  });

  it("joins two objects with an orthogonal arrow by default", async () => {
    const { id } = await run<{ id: string }>("add_connector", { fromId: "a", toId: "b" });
    expect(obj(id)).toMatchObject({
      type: "connector",
      boardId: "b1",
      fromId: "a",
      toId: "b",
      x: 11,
      y: 22,
      w: 0,
      h: 0,
      z: 6,
      routing: "orthogonal",
      arrowStart: false,
      arrowEnd: true,
      stroke: "#94a3b8",
      strokeWidth: 2,
    });
  });

  it("takes routing, arrows, style and a label", async () => {
    const { id } = await run<{ id: string }>("add_connector", {
      fromId: "a",
      toId: "b",
      routing: "curved",
      arrowStart: true,
      arrowEnd: false,
      stroke: "#ff0000",
      strokeWidth: 4,
      label: "depends on",
      dashed: true,
    });
    expect(obj(id)).toMatchObject({
      routing: "curved",
      arrowStart: true,
      arrowEnd: false,
      stroke: "#ff0000",
      strokeWidth: 4,
      label: "depends on",
      dashed: true,
    });
  });

  it("refuses a missing endpoint or two different boards", async () => {
    await expect(run("add_connector", { fromId: "ghost", toId: "b" })).rejects.toThrow(
      /source object ghost not found/
    );
    await expect(run("add_connector", { fromId: "a", toId: "ghost" })).rejects.toThrow(
      /target object ghost not found/
    );
    await expect(run("add_connector", { fromId: "a", toId: "far" })).rejects.toThrow(/same board/);
    expect(objects()).toHaveLength(3);
  });

  it("validates against the server store on the MCP path", async () => {
    const a = stickyFixture({ id: "a", boardId: "b1" });
    const far = stickyFixture({ id: "far", boardId: "b2" });
    get.mockImplementation((async (_u: string, _k: string, id: string) =>
      id === "a" ? a : id === "far" ? far : null) as never);
    await expect(runMcp("add_connector", { fromId: "a", toId: "far" })).rejects.toThrow(
      /same board/
    );
    await expect(runMcp("add_connector", { fromId: "a", toId: "ghost" })).rejects.toThrow(
      /not found/
    );
    expect(upsert).not.toHaveBeenCalled();

    nextZ.mockResolvedValue(12);
    get.mockImplementation((async (_u: string, _k: string, id: string) =>
      id === "a" ? a : { ...a, id }) as never);
    const { id } = await runMcp<{ id: string }>("add_connector", { fromId: "a", toId: "b" });
    expect(upsert).toHaveBeenCalledWith(
      "user-1",
      KIND_OBJECT,
      expect.objectContaining({ id, type: "connector", fromId: "a", toId: "b", z: 12 })
    );
  });
});
