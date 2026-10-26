/**
 * tool.adkar.* coverage (singleton doc, Outcomes & Pulse).
 *
 *   1. registration — list_state read; every write has an mcpHandler.
 *   2. add_initiative — a name, a start not in the future; history from the start.
 *   3. advance / step_back — dated moves, refused before the last move.
 *   4. set_group_scores — find or add a group, score it, the barrier point.
 *   5. update_initiative / remove_initiative.
 *   6. the old blob: read until the page moves it, carried by a write.
 *   7. the server handlers read the same rows and say the same.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdkarDoc } from "@/lib/stores/workspace-types";

const rows = vi.hoisted(() => new Map<string, unknown>());
const blobs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => rows.get(`${kind}/${id}`) ?? null
    ),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
    serverGetUserStateBlob: vi.fn(async (_u: string, key: string) => blobs.get(key) ?? null),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { ADKAR_DOC_ID, ADKAR_KIND, ADKAR_LEGACY_KEY, ADKAR_MOVED_KEY } from "@/lib/adkar/model";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/flow/days";

import "@/lib/actions/tools/adkar";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
// As the MCP and agent runtimes do: the params go through the schema first.
const run = <T>(
  verb: string,
  params: Record<string, unknown> = {},
  path: "handler" | "mcpHandler" = "handler"
) => {
  const action = registry.get(`tool.adkar.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};
const TODAY = todayLocalISO();
const ago = (n: number) => addDays(TODAY, -n) as string;

type State = {
  exists: boolean;
  pendingLegacy: number;
  initiatives: {
    id: string;
    name: string;
    owner: string | null;
    startDate: string;
    currentStage: string;
    daysInStage: number;
    stageDurations: { stage: string; from: string; to: string | null; days: number }[];
    groups: {
      id: string;
      name: string;
      scores: Record<string, number>;
      barrier: { element: string | null };
    }[];
    barrier: null | { element: string; groupName: string; score: number };
    pastBarrier: { groupName: string; barrier: string }[];
  }[];
  counts: Record<string, number>;
  held: number;
  medianDaysInStage: { days: number | null; periods: number };
  longestInCurrentStage: null | { id: string; days: number };
  verdict: string;
};
const list = (path: "handler" | "mcpHandler" = "handler") => run<State>("list_state", {}, path);
const stored = () => useWorkspaceStore.getState().adkarDocs?.find((d) => d.id === ADKAR_DOC_ID);

beforeEach(() => {
  rows.clear();
  blobs.clear();
  window.localStorage.removeItem(ADKAR_LEGACY_KEY);
  window.localStorage.removeItem(ADKAR_MOVED_KEY);
  useWorkspaceStore.setState({
    adkarDocs: [],
    teamMembers: [{ id: "member_priya", name: "Priya" }],
  });
});

describe("tool.adkar — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.adkar.list_state")?.category).toBe("read");
    for (const verb of [
      "add_initiative",
      "update_initiative",
      "set_group_scores",
      "advance",
      "step_back",
      "remove_initiative",
    ]) {
      const action = registry.get(`tool.adkar.${verb}`);
      expect(action?.category, verb).toBe("write");
      expect(action?.mcpHandler, verb).toBeTypeOf("function");
      expect(action?.requiresConfirmation, verb).toBe(false);
    }
  });
});

describe("tool.adkar lifecycle", () => {
  it("starts empty", async () => {
    expect(await list()).toMatchObject({
      exists: false,
      initiatives: [],
      held: 0,
      verdict: "No change initiatives yet.",
    });
  });

  it("adds an initiative from its start date, the owner in the roster's spelling", async () => {
    expect(await run("add_initiative", { name: " " })).toMatchObject({
      added: false,
      reason: "invalid_name",
    });
    expect(await run("add_initiative", { name: "X", startDate: addDays(TODAY, 1) })).toMatchObject({
      added: false,
      reason: "invalid_date",
    });
    const a = await run<{ added: boolean; id: string }>("add_initiative", {
      name: "Pairing",
      owner: "priya",
      startDate: ago(20),
    });
    expect(a.added).toBe(true);
    const r = await list();
    expect(r.initiatives[0]).toMatchObject({
      id: a.id,
      name: "Pairing",
      owner: "Priya",
      startDate: ago(20),
      currentStage: "awareness",
      daysInStage: 20,
    });
    const b = await run<{ id: string }>("add_initiative", { name: "Mobbing" });
    expect((await list()).initiatives.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it("moves on dated days, forward and back, never before the last move", async () => {
    const { id } = await run<{ id: string }>("add_initiative", {
      name: "Pairing",
      startDate: ago(30),
    });
    expect(await run("advance", { id, on: ago(31) })).toMatchObject({
      moved: false,
      reason: "invalid_date",
    });
    expect(await run("step_back", { id })).toEqual({ moved: false, reason: "at_first_stage" });
    expect(await run("advance", { id, on: ago(20) })).toMatchObject({
      moved: true,
      from: "awareness",
      stage: "desire",
      enteredAt: ago(20),
    });
    expect(await run("advance", { id, on: ago(10) })).toMatchObject({ stage: "knowledge" });
    expect(await run("step_back", { id, on: ago(5) })).toMatchObject({
      moved: true,
      stage: "desire",
    });
    const r = await list();
    expect(r.initiatives[0].stageDurations.map((d) => [d.stage, d.days])).toEqual([
      ["awareness", 10],
      ["desire", 10],
      ["knowledge", 5],
      ["desire", 5],
    ]);
    expect(r.medianDaysInStage).toEqual({ days: 10, periods: 3 });
    expect(await run("advance", { id: "nope" })).toEqual({ moved: false, reason: "not_found" });
  });

  it("scores groups found by name or added, and names the barrier point", async () => {
    const { id } = await run<{ id: string }>("add_initiative", {
      name: "Pairing",
      startDate: ago(30),
    });
    await run("advance", { id, on: ago(20) });
    await run("advance", { id, on: ago(10) });
    const first = await run<{ set: boolean; groupId: string; barrier: { element: string | null } }>(
      "set_group_scores",
      { id, name: "Support", scores: { awareness: 4, desire: 2 } }
    );
    expect(first).toMatchObject({ set: true, barrier: { element: "desire", score: 2 } });
    // Found again by name: the same group.
    const again = await run<{ groupId: string }>("set_group_scores", {
      id,
      name: "support",
      scores: { desire: null },
    });
    expect(again.groupId).toBe(first.groupId);
    expect(await run("set_group_scores", { id, groupId: "nope", scores: {} })).toMatchObject({
      set: false,
      reason: "group_not_found",
    });
    expect(await run("set_group_scores", { id, name: " ", scores: {} })).toMatchObject({
      set: false,
      reason: "invalid_name",
    });
    await run("set_group_scores", {
      id,
      groupId: first.groupId,
      scores: { desire: 3 },
      assessedAt: ago(2),
      note: "After the demo",
    });
    const r = await list();
    expect(r.initiatives[0].groups[0]).toMatchObject({
      name: "Support",
      scores: { awareness: 4, desire: 3 },
    });
    expect(r.initiatives[0].barrier).toMatchObject({
      element: "desire",
      groupName: "Support",
      score: 3,
    });
    expect(r.initiatives[0].pastBarrier).toEqual([
      { groupId: first.groupId, groupName: "Support", barrier: "desire", score: 3 },
    ]);
    expect(r.held).toBe(1);
    expect(r.verdict).toBe("1 of 1 initiative is held up: Pairing at Desire (Support scored 3).");
  });

  it("edits in place and removes", async () => {
    const { id } = await run<{ id: string }>("add_initiative", {
      name: "Pairing",
      startDate: ago(30),
      owner: "Sam",
    });
    await run("advance", { id, on: ago(20) });
    expect(await run("update_initiative", { id, startDate: ago(10) })).toMatchObject({
      updated: false,
      reason: "invalid_date",
    });
    expect(
      await run("update_initiative", {
        id,
        name: "Pair programming",
        owner: null,
        startDate: ago(40),
      })
    ).toEqual({ updated: true });
    const i = (await list()).initiatives[0];
    expect(i).toMatchObject({ name: "Pair programming", owner: null, startDate: ago(40) });
    expect(i.stageDurations[0]).toMatchObject({ stage: "awareness", from: ago(40), days: 20 });
    expect(await run("remove_initiative", { id })).toEqual({ removed: true });
    expect(await run("remove_initiative", { id })).toEqual({ removed: false });
  });

  it("reads the old blob until the page moves it, and a write carries it into the doc", async () => {
    const blob = [
      {
        id: "old1",
        name: "Legacy change",
        currentStage: "desire",
        stagesCompleted: ["awareness"],
        stageHistory: [
          { stage: "awareness", enteredAt: ago(5) },
          { stage: "desire", enteredAt: ago(3) },
        ],
        startDate: ago(15),
      },
    ];
    window.localStorage.setItem(ADKAR_LEGACY_KEY, JSON.stringify(blob));
    let r = await list();
    expect(r).toMatchObject({ exists: false, pendingLegacy: 1 });
    expect(r.initiatives[0]).toMatchObject({
      id: "old1",
      startDate: ago(15),
      currentStage: "desire",
    });
    await run("add_initiative", { name: "New one" });
    expect(stored()?.initiatives.map((i) => i.id)).toEqual([expect.any(String), "old1"]);
    r = await list();
    expect(r.pendingLegacy).toBe(0);
    // A recorded move is never planned again.
    window.localStorage.setItem(ADKAR_MOVED_KEY, JSON.stringify(["old1"]));
    useWorkspaceStore.setState({ adkarDocs: [{ id: ADKAR_DOC_ID, initiatives: [] }] });
    expect((await list()).initiatives).toEqual([]);
  });

  it("refuses a delete the page's move would undo, until the move is recorded", async () => {
    const blob = [{ id: "old1", name: "Legacy", currentStage: "awareness", startDate: ago(5) }];
    window.localStorage.setItem(ADKAR_LEGACY_KEY, JSON.stringify(blob));
    // Still only in the blob, or carried into the doc by an earlier write:
    // nothing would be left to show it moved, so the page would move it back.
    expect(await run("remove_initiative", { id: "old1" })).toMatchObject({
      removed: false,
      reason: "not_moved_yet",
    });
    await run("advance", { id: "old1", on: ago(1) });
    expect(stored()?.initiatives.map((i) => i.id)).toEqual(["old1"]);
    expect(await run("remove_initiative", { id: "old1" })).toMatchObject({
      reason: "not_moved_yet",
    });
    expect(stored()?.initiatives.map((i) => i.id)).toEqual(["old1"]);
    // Once the page has recorded the move, the delete stays deleted.
    window.localStorage.setItem(ADKAR_MOVED_KEY, JSON.stringify(["old1"]));
    expect(await run("remove_initiative", { id: "old1" })).toEqual({ removed: true });
    expect((await list()).initiatives).toEqual([]);
  });

  it("refuses an impossible or future day for a group's scores, as the page does", async () => {
    const { id } = await run<{ id: string }>("add_initiative", { name: "Pairing" });
    for (const assessedAt of ["2026-02-30", addDays(TODAY, 1) as string]) {
      expect(
        await run("set_group_scores", { id, name: "Ops", scores: { awareness: 4 }, assessedAt })
      ).toMatchObject({ set: false, reason: "invalid_date" });
    }
    expect((await list()).initiatives[0].groups).toEqual([]);
  });
});

describe("tool.adkar — the server handlers", () => {
  it("read the doc and the old blob from the user's rows and say what the browser says", async () => {
    const doc: AdkarDoc = {
      id: ADKAR_DOC_ID,
      initiatives: [
        {
          id: "i1",
          name: "Pairing",
          startDate: ago(30),
          currentStage: "desire",
          stageHistory: [
            { stage: "awareness", enteredAt: ago(30) },
            { stage: "desire", enteredAt: ago(10) },
          ],
          groups: [{ id: "g1", name: "Ops", scores: { awareness: 2 } }],
        },
      ],
    };
    rows.set(`${ADKAR_KIND}/${ADKAR_DOC_ID}`, doc);
    useWorkspaceStore.setState({ adkarDocs: [doc] });
    const server = await list("mcpHandler");
    expect(server).toEqual(await list());
    expect(server.initiatives[0].barrier).toMatchObject({ element: "awareness", groupName: "Ops" });

    blobs.set(ADKAR_LEGACY_KEY, [
      { id: "old", name: "Old", currentStage: "awareness", startDate: ago(3) },
    ]);
    expect((await list("mcpHandler")).pendingLegacy).toBe(1);
    await run("advance", { id: "i1" }, "mcpHandler");
    const written = rows.get(`${ADKAR_KIND}/${ADKAR_DOC_ID}`) as AdkarDoc;
    expect(written.initiatives.map((i) => [i.id, i.currentStage])).toEqual([
      ["i1", "knowledge"],
      ["old", "awareness"],
    ]);
  });
});
