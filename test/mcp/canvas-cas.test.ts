/**
 * Canvas MCP write handlers use optimistic concurrency (CAS).
 *
 * WhiteboardObject carries a monotonic `version` and is edited by both the
 * browser canvas (version-guarded multiplayer upserts) and agents. The MCP
 * `move_object` and `set_object_text` handlers therefore MUST go through
 * `serverVersionedUpdate` (compare-and-set) rather than a blind
 * get → mutate → upsert, or a concurrent edit to a different field of the
 * same object is silently clobbered (lost update).
 *
 * server-store is mocked so we can assert which write primitive each handler
 * reaches for, without touching Supabase.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverUpsertEntity: vi.fn(async () => {}),
    serverVersionedUpdate: vi.fn(async () => null),
    serverNextZForBoard: vi.fn(async () => 1),
  };
});

import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import * as serverStore from "@/lib/actions/server-store";
// Side-effect import: registers the tool.canvas.* actions.
import "@/lib/actions/tools/canvas";

const get = vi.mocked(serverStore.serverGetEntity);
const upsert = vi.mocked(serverStore.serverUpsertEntity);
const versioned = vi.mocked(serverStore.serverVersionedUpdate);

const ctx = () => makeContext("user-1", "mcp");

const sticky = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  type: "sticky",
  boardId: "b1",
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  z: 1,
  version: 3,
  content: "old",
  color: "#fff",
  createdAt: "t",
  updatedAt: "t",
  ...over,
});

beforeEach(() => {
  get.mockReset();
  upsert.mockReset();
  versioned.mockReset();
  get.mockResolvedValue(null);
  upsert.mockResolvedValue();
  versioned.mockResolvedValue(null);
});

describe("tool.canvas.move_object — CAS", () => {
  it("routes through serverVersionedUpdate, never a blind upsert", async () => {
    versioned.mockResolvedValue({ id: "s1" } as never);
    const action = registry.resolve("tool.canvas.move_object");
    const res = await action!.mcpHandler!({ id: "s1", x: 99, y: 88 }, ctx());
    expect(res).toEqual({ moved: true });
    expect(versioned).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
    // The mutate updates x/y on the row it's handed.
    const mutate = versioned.mock.calls[0][3] as unknown as (o: Record<string, unknown>) => {
      x: number;
      y: number;
    };
    const out = mutate(sticky());
    expect(out.x).toBe(99);
    expect(out.y).toBe(88);
  });

  it("returns moved:false when CAS reports the row missing/deleted", async () => {
    versioned.mockResolvedValue(null);
    const action = registry.resolve("tool.canvas.move_object");
    expect(await action!.mcpHandler!({ id: "ghost", x: 0, y: 0 }, ctx())).toEqual({ moved: false });
  });
});

describe("tool.canvas.set_object_text — CAS + slot detection", () => {
  it("routes a text-bearing object through serverVersionedUpdate", async () => {
    get.mockResolvedValue(sticky() as never);
    versioned.mockResolvedValue({ id: "s1" } as never);
    const action = registry.resolve("tool.canvas.set_object_text");
    const res = await action!.mcpHandler!({ id: "s1", text: "new" }, ctx());
    expect(res).toEqual({ updated: true });
    expect(versioned).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("no-ops (updated:false) for a type with no text slot, without writing", async () => {
    get.mockResolvedValue({
      id: "l1",
      type: "line",
      boardId: "b1",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      z: 1,
      version: 1,
    } as never);
    const action = registry.resolve("tool.canvas.set_object_text");
    const res = await action!.mcpHandler!({ id: "l1", text: "x" }, ctx());
    expect(res).toEqual({ updated: false });
    expect(versioned).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns updated:false when the object is missing", async () => {
    get.mockResolvedValue(null);
    const action = registry.resolve("tool.canvas.set_object_text");
    expect(await action!.mcpHandler!({ id: "ghost", text: "x" }, ctx())).toEqual({
      updated: false,
    });
    expect(versioned).not.toHaveBeenCalled();
  });
});
