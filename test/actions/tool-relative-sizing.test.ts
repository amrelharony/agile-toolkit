/**
 * tool.relative_sizing.* action coverage.
 *
 *   1. registration: list_state reads; create_board, place and apply_sizes
 *      write without a confirmation, each with an MCP handler, none kept
 *      from visitors, and each write's description says what an open page
 *      with unsaved changes does
 *   2. the browser path: a board from the unsized backlog or titles, a
 *      card placed by its bucket's label with moves counted, Save sizes
 *      with what it skipped and why
 *   3. the MCP path: the user's synced row patched through the store's own
 *      normaliser (the whole blob, every key), a refusal writing nothing,
 *      and the stories written through the stamped story write
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ row: null as unknown, writes: [] as unknown[] }));
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
    serverUpsertEntity: vi.fn(async () => {}),
    serverGetUserStateBlob: vi.fn(async () => blob.row),
    serverPatchUserStateBlob: vi.fn(
      async (_u: string, _k: string, mutate: (cur: unknown) => unknown) => {
        const next = mutate(blob.row);
        if (next === null) return { written: false, reason: "unchanged" };
        blob.row = next;
        blob.writes.push(next);
        return { written: true, payload: next };
      }
    ),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import { bucketsFor, newBoard } from "@/lib/relative-sizing/model";
import {
  RELATIVE_SIZING_INITIAL,
  RELATIVE_SIZING_STORE_KEY,
  type RelativeSizingState,
} from "@/lib/relative-sizing/state";
import {
  hydrateRelativeSizing,
  relativeSizingState,
  useRelativeSizing,
} from "@/lib/relative-sizing/store";

import "@/lib/actions/tools/relative-sizing";

const ctx = () => ({
  userId: "test-user",
  source: "agent" as const,
  squadProfileIds: [] as string[],
});
const ws = () => useWorkspaceStore.getState();
const run = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.handler(params, ctx())) as T;
const runMcp = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.mcpHandler!(params, ctx())) as T;

const NOW = "2026-11-23T10:00:00.000Z";
const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "backlog",
  ...over,
});
const board = () =>
  newBoard(
    {
      title: "Checkout",
      bucketSet: "fibonacci",
      buckets: bucketsFor("fibonacci"),
      items: [
        { title: "Story a", storyId: "a" },
        { title: "Story b", storyId: "b" },
        { title: "Typed" },
      ],
    },
    "sizing_a",
    NOW,
    (i) => `c${i + 1}`
  );
const withBoard = (): RelativeSizingState => ({
  ...RELATIVE_SIZING_INITIAL,
  boards: [board()],
  activeBoardId: "sizing_a",
});

beforeEach(async () => {
  blob.row = null;
  blob.writes = [];
  await hydrateRelativeSizing();
  useRelativeSizing.setState({ ...RELATIVE_SIZING_INITIAL });
  useWorkspaceStore.setState({ stories: [] });
  vi.mocked(serverStore.serverGetEntity).mockReset().mockResolvedValue(null);
  vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
  vi.mocked(serverStore.serverUpsertEntity)
    .mockReset()
    .mockResolvedValue(undefined as never);
});

describe("tool.relative_sizing: registration", () => {
  it("reads with list_state and writes with three verbs, each with an MCP handler", () => {
    expect(registry.get("tool.relative_sizing.list_state")?.category).toBe("read");
    for (const name of ["create_board", "place", "apply_sizes"]) {
      const action = registry.get(`tool.relative_sizing.${name}`);
      expect(action?.category, name).toBe("write");
      expect(action?.requiresConfirmation, name).toBe(false);
      expect(action?.mcpHandler, name).toBeTypeOf("function");
      expect(action?.visitor, name).not.toBe(false);
      expect(action?.description, name).toContain("a page open with a change not yet saved");
    }
    // A live round starts only from the page.
    expect(
      registry
        .list()
        .some((a) => a.id.startsWith("tool.relative_sizing.") && /room|round/.test(a.id))
    ).toBe(false);
  });
});

describe("in the browser", () => {
  it("starts a board from the backlog's unsized stories, and lists it", async () => {
    useWorkspaceStore.setState({
      stories: [story("a"), story("b", { points: 3 }), story("c"), story("example-d")],
    });
    const r = await run<{ created: boolean; boardId: string; items: number; buckets: string[] }>(
      "tool.relative_sizing.create_board",
      { title: "Backlog", bucketSet: "fibonacci", fromUnsizedBacklog: true }
    );
    expect(r).toMatchObject({
      created: true,
      items: 2,
      buckets: ["1", "2", "3", "5", "8", "13", "21"],
    });
    const s = relativeSizingState();
    expect(s.activeBoardId).toBe(r.boardId);
    expect(s.boards[0].items.map((i) => i.storyId)).toEqual(["a", "c"]);
    const listed = await run<{ boards: { id: string; counts: { unplaced: number } }[] }>(
      "tool.relative_sizing.list_state"
    );
    expect(listed.boards[0]).toMatchObject({ id: r.boardId, counts: { unplaced: 2 } });
  });

  it("refuses a custom set with a repeat, and a board with nothing to size", async () => {
    expect(
      await run("tool.relative_sizing.create_board", {
        title: "X",
        bucketSet: "custom",
        buckets: ["S", "s"],
        titles: ["One"],
      })
    ).toMatchObject({ created: false, reason: expect.stringMatching(/twice/) });
    expect(
      await run("tool.relative_sizing.create_board", {
        title: "X",
        bucketSet: "fibonacci",
        fromUnsizedBacklog: true,
      })
    ).toMatchObject({ created: false });
  });

  it("places a card by its bucket's label, counting a move as the page does", async () => {
    useRelativeSizing.setState(withBoard());
    expect(
      await run("tool.relative_sizing.place", { boardId: "sizing_a", itemId: "c1", bucket: "5" })
    ).toMatchObject({ placed: true, moved: true, moves: 0 });
    expect(
      await run("tool.relative_sizing.place", { boardId: "sizing_a", itemId: "c1", bucket: "8" })
    ).toMatchObject({ placed: true, moves: 1 });
    expect(
      await run("tool.relative_sizing.place", { boardId: "sizing_a", itemId: "c1", bucket: "XL" })
    ).toMatchObject({ placed: false });
  });

  it("saves sizes to the workspace stories and says what it skipped", async () => {
    useWorkspaceStore.setState({ stories: [story("a"), story("b")] });
    useRelativeSizing.setState(withBoard());
    await run("tool.relative_sizing.place", { boardId: "sizing_a", itemId: "c1", bucket: "8" });
    const r = await run<{ written: number; skipped: { title: string; why: string }[] }>(
      "tool.relative_sizing.apply_sizes",
      { boardId: "sizing_a" }
    );
    expect(r.written).toBe(1);
    expect(r.skipped).toEqual([
      { title: "Story b", why: "not placed" },
      { title: "Typed", why: "not in the backlog yet" },
    ]);
    expect(ws().stories.find((s) => s.id === "a")?.points).toBe(8);
    expect(relativeSizingState().boards[0].appliedAt).toBeTruthy();
  });
});

describe("over MCP", () => {
  it("creates a board in the user's synced row, as the whole normalised blob", async () => {
    vi.mocked(serverStore.serverListEntities).mockResolvedValue([story("a"), story("b")] as never);
    const r = await runMcp<{ created: boolean }>("tool.relative_sizing.create_board", {
      title: "Backlog",
      bucketSet: "tshirt",
      fromUnsizedBacklog: true,
    });
    expect(r.created).toBe(true);
    expect(vi.mocked(serverStore.serverPatchUserStateBlob).mock.calls.at(-1)?.[1]).toBe(
      RELATIVE_SIZING_STORE_KEY
    );
    const row = blob.row as RelativeSizingState;
    expect(Object.keys(row).sort()).toEqual(["activeBoardId", "boards", "rounds"]);
    expect(row.boards[0].buckets.map((b) => b.label)).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
  });

  it("writes nothing for a refusal", async () => {
    blob.row = withBoard();
    const r = await runMcp("tool.relative_sizing.place", {
      boardId: "nope",
      itemId: "c1",
      bucket: "5",
    });
    expect(r).toMatchObject({ placed: false });
    expect(blob.writes).toEqual([]);
  });

  it("places a card and saves sizes through the stamped story write", async () => {
    blob.row = withBoard();
    await runMcp("tool.relative_sizing.place", { boardId: "sizing_a", itemId: "c2", bucket: "13" });
    vi.mocked(serverStore.serverListEntities).mockResolvedValue([story("a"), story("b")] as never);
    vi.mocked(serverStore.serverGetEntity).mockImplementation(
      async (_u, _k, id) => (id === "b" ? story("b") : null) as never
    );
    const r = await runMcp<{ written: number }>("tool.relative_sizing.apply_sizes", {
      boardId: "sizing_a",
    });
    expect(r.written).toBe(1);
    const write = vi.mocked(serverStore.serverUpsertEntity).mock.calls[0];
    expect(write[1]).toBe("workspace:story");
    expect(write[2]).toMatchObject({ id: "b", points: 13 });
    expect((write[2] as Story).refinedAt).toBeTruthy();
    expect((blob.row as RelativeSizingState).boards[0].appliedAt).toBeTruthy();
  });

  it("lists the user's row read back through the normaliser", async () => {
    blob.row = { boards: [board(), { id: 5 }], activeBoardId: "gone", rounds: "x" };
    const r = await runMcp<{ boards: unknown[]; activeBoardId: string | null }>(
      "tool.relative_sizing.list_state"
    );
    expect(r.boards).toHaveLength(1);
    expect(r.activeBoardId).toBeNull();
  });
});
