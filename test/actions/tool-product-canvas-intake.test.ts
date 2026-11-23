/**
 * tool.product_canvas.* for the idea inbox, the business case and the
 * betting table (P2.3b).
 *
 *   1. registration: log_idea, triage_idea, set_decision and place_bet
 *      write without a confirmation, each with an MCP handler, none kept
 *      from visitors (it's their own data), no "board" or "sticky"
 *   2. log_idea: an idea asked for once, with the open ideas like it (the
 *      team's, never the example's)
 *   3. triage_idea: assess, accept, decline with a note, merge into the
 *      root of a chain (never into itself, never across the example), and
 *      out of a merge again with its demand given back
 *   4. set_decision: a business case's verdict, stamped when it changes
 *   5. place_bet: a known cycle's dates taken, a conflict refused, a new
 *      cycle's start needed
 *   6. list_state: the inbox's counts, the cycles, and each format's fields
 *   7. the MCP path reads and writes the user's rows
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
    serverUpsertEntity: vi.fn(async () => {}),
    serverGetUserStateBlob: vi.fn(async () => null),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  PRODUCT_CANVAS_KIND,
  PRODUCT_GOAL_KIND,
  type ProductCanvas,
  type ProductGoal,
  type ProductIdeaIntake,
  type ProductPitchBet,
} from "@/lib/stores/workspace-types";
import { PRODUCT_CANVAS_ID_PREFIX, readCanvas } from "@/lib/product-canvas/model";

import "@/lib/actions/tools/product-canvas";
import "@/lib/actions/workspace";

const ctx = () => ({
  userId: "test-user",
  source: "agent" as const,
  squadProfileIds: [] as string[],
});
const ws = () => useWorkspaceStore.getState();
const run = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.handler(a.paramsSchema.parse(params), ctx())) as T;
};
const runMcp = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.mcpHandler!(a.paramsSchema.parse(params), ctx())) as T;
};
const parses = (id: string, params: Record<string, unknown>) =>
  registry.get(id)!.paramsSchema.safeParse(params).success;

const STAMP = "2026-11-20T09:00:00.000Z";
const goal: ProductGoal = {
  id: "goal_1",
  statement: "Shop owners take every payment on their own phone.",
  measures: [],
  status: "active",
  createdAt: STAMP,
  updatedAt: STAMP,
};
const idea = (
  id: string,
  title: string,
  intake: Partial<ProductIdeaIntake> = {}
): ProductCanvas => ({
  id,
  format: "idea",
  title,
  sections: {},
  intake: { requesters: [], source: "customer", demand: 1, status: "new", ...intake },
  createdAt: STAMP,
  updatedAt: STAMP,
});
const pitch = (id: string, bet?: ProductPitchBet): ProductCanvas => ({
  id,
  format: "shape-up",
  title: `Pitch ${id}`,
  sections: {},
  ...(bet ? { bet } : {}),
  createdAt: STAMP,
  updatedAt: STAMP,
});
const bizCase = (id: string): ProductCanvas => ({
  id,
  format: "business-case",
  title: "Card-free shops",
  sections: {},
  createdAt: STAMP,
  updatedAt: STAMP,
});
const stored = (id: string) => readCanvas((ws().productCanvases ?? []).find((c) => c.id === id));

const VERBS = ["log_idea", "triage_idea", "set_decision", "place_bet"];

beforeEach(() => {
  useWorkspaceStore.setState({
    productCanvases: [],
    productGoals: [],
    stories: [],
    hypothesisTrackers: [],
  });
  window.localStorage.clear();
  vi.mocked(serverStore.serverGetEntity).mockReset().mockResolvedValue(null);
  vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
  vi.mocked(serverStore.serverUpsertEntity)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(serverStore.serverGetUserStateBlob).mockReset().mockResolvedValue(null);
});

describe("registration", () => {
  it("writes with the four verbs, each with an MCP handler, the visitor's own data", () => {
    for (const name of VERBS) {
      const a = registry.get(`tool.product_canvas.${name}`)!;
      expect(a, name).toBeDefined();
      expect(a.category).toBe("write");
      expect(a.requiresConfirmation).toBe(false);
      expect(a.mcpHandler, name).toBeTypeOf("function");
      expect(a.visitor, name).not.toBe(false);
      // The whiteboard's words: a "canvas board" ask must still rank the Canvas tool.
      expect(a.description, name).not.toMatch(/\b(board|sticky)\b/i);
    }
  });

  it("caps what each verb takes", () => {
    expect(parses("tool.product_canvas.log_idea", { title: "" })).toBe(false);
    expect(parses("tool.product_canvas.log_idea", { title: "x".repeat(201) })).toBe(false);
    expect(parses("tool.product_canvas.log_idea", { title: "Tips", source: "press" })).toBe(false);
    expect(parses("tool.product_canvas.triage_idea", { canvasId: "x", status: "new" })).toBe(false);
    expect(parses("tool.product_canvas.set_decision", { canvasId: "x", verdict: "maybe" })).toBe(
      false
    );
    expect(
      parses("tool.product_canvas.place_bet", { canvasId: "x", status: "bet", cycle: 61 })
    ).toBe(false);
    expect(
      parses("tool.product_canvas.place_bet", { canvasId: "x", status: "bet", weeks: 13 })
    ).toBe(false);
  });
});

describe("log_idea", () => {
  it("logs an idea asked for once, tied to the goal, with the open ideas like it", async () => {
    useWorkspaceStore.setState({
      productGoals: [goal],
      productCanvases: [
        idea("pcanvas_split", "Split a bill between two cards", { demand: 2 }),
        idea("example-pc-split", "Split a bill between two cards"),
        idea("pcanvas_gone", "Split a bill between two cards", { status: "declined", note: "x" }),
      ],
    });
    const out = await run<{ logged: true; id: string; similar: { id: string; title: string }[] }>(
      "tool.product_canvas.log_idea",
      { title: "Split the bill between two cards", requester: "Support inbox", problem: "Halves" }
    );
    expect(out.logged).toBe(true);
    expect(out.id.startsWith(PRODUCT_CANVAS_ID_PREFIX)).toBe(true);
    expect(out.similar).toEqual([{ id: "pcanvas_split", title: "Split a bill between two cards" }]);
    expect(stored(out.id)).toMatchObject({
      format: "idea",
      productGoalId: "goal_1",
      intake: { requesters: ["Support inbox"], source: "other", demand: 1, status: "new" },
    });
    expect(stored(out.id)?.sections.problem?.[0].text).toBe("Halves");
  });
});

describe("triage_idea", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      productCanvases: [
        idea("pcanvas_a", "Tips"),
        idea("pcanvas_b", "Split a bill", { demand: 2, requesters: ["Support"] }),
        idea("pcanvas_c", "Pay with two cards", {
          demand: 3,
          requesters: ["Sales"],
          status: "merged",
          mergedInto: "pcanvas_b",
        }),
        idea("example-pc-idea", "Example"),
        pitch("pcanvas_pitch"),
      ],
    });
  });

  it("sets a status, and needs a note to decline", async () => {
    expect(
      await run("tool.product_canvas.triage_idea", { canvasId: "pcanvas_a", status: "assessing" })
    ).toEqual({ triaged: true, status: "assessing" });
    expect(stored("pcanvas_a")?.intake?.status).toBe("assessing");
    expect(
      await run("tool.product_canvas.triage_idea", { canvasId: "pcanvas_a", status: "declined" })
    ).toMatchObject({ triaged: false, reason: "needs_note" });
    expect(
      await run("tool.product_canvas.triage_idea", {
        canvasId: "pcanvas_a",
        status: "declined",
        note: "Not for stalls",
      })
    ).toEqual({ triaged: true, status: "declined" });
    expect(stored("pcanvas_a")?.intake).toMatchObject({
      status: "declined",
      note: "Not for stalls",
    });
  });

  it("merges into the root of a chain, moving the demand and who asked", async () => {
    const out = await run("tool.product_canvas.triage_idea", {
      canvasId: "pcanvas_a",
      status: "merged",
      mergeInto: "pcanvas_c",
    });
    expect(out).toEqual({ triaged: true, status: "merged", into: "pcanvas_b", demand: 3 });
    expect(stored("pcanvas_a")?.intake).toMatchObject({
      status: "merged",
      mergedInto: "pcanvas_b",
    });
    expect(stored("pcanvas_b")?.intake?.demand).toBe(3);
  });

  it("takes a merged idea out of its merge, its demand given back, so merging again counts it once", async () => {
    useWorkspaceStore.setState({
      productCanvases: [
        idea("pcanvas_r", "Split a bill", { demand: 4 }),
        idea("pcanvas_d", "Pay with two cards", { demand: 2 }),
      ],
    });
    const merge = { canvasId: "pcanvas_d", status: "merged", mergeInto: "pcanvas_r" };
    expect(await run("tool.product_canvas.triage_idea", merge)).toMatchObject({ demand: 6 });
    expect(
      await run("tool.product_canvas.triage_idea", { canvasId: "pcanvas_d", status: "assessing" })
    ).toEqual({ triaged: true, status: "assessing", outOf: "pcanvas_r" });
    expect(stored("pcanvas_r")?.intake?.demand).toBe(4);
    expect(stored("pcanvas_d")?.intake).toMatchObject({ status: "assessing", demand: 2 });
    expect(stored("pcanvas_d")?.intake).not.toHaveProperty("mergedInto");
    expect(await run("tool.product_canvas.triage_idea", merge)).toMatchObject({ demand: 6 });
    expect(stored("pcanvas_r")?.intake?.demand).toBe(6);
  });

  it("refuses a merge with no target, into itself, across the example, or of a canvas that isn't an idea", async () => {
    expect(
      await run("tool.product_canvas.triage_idea", { canvasId: "pcanvas_a", status: "merged" })
    ).toMatchObject({ triaged: false, reason: "needs_target" });
    expect(
      await run("tool.product_canvas.triage_idea", {
        canvasId: "pcanvas_b",
        status: "merged",
        mergeInto: "pcanvas_c",
      })
    ).toMatchObject({ triaged: false, reason: "self_merge" });
    expect(
      await run("tool.product_canvas.triage_idea", {
        canvasId: "pcanvas_a",
        status: "merged",
        mergeInto: "example-pc-idea",
      })
    ).toMatchObject({ triaged: false, reason: "wrong_format" });
    expect(
      await run("tool.product_canvas.triage_idea", {
        canvasId: "pcanvas_pitch",
        status: "accepted",
      })
    ).toMatchObject({ triaged: false, reason: "wrong_format" });
    expect(
      await run("tool.product_canvas.triage_idea", { canvasId: "pcanvas_nope", status: "accepted" })
    ).toEqual({ triaged: false, reason: "not_found" });
  });
});

describe("set_decision", () => {
  it("records a business case's verdict, stamped when it changes, with its note", async () => {
    useWorkspaceStore.setState({ productCanvases: [bizCase("pcanvas_case"), pitch("pcanvas_p")] });
    const out = await run<{ decided: true; decidedAt: string }>(
      "tool.product_canvas.set_decision",
      {
        canvasId: "pcanvas_case",
        verdict: "go",
        note: "Worth a pilot",
      }
    );
    expect(out.decided).toBe(true);
    expect(stored("pcanvas_case")?.decision).toEqual({
      verdict: "go",
      note: "Worth a pilot",
      decidedAt: out.decidedAt,
    });
    await run("tool.product_canvas.set_decision", {
      canvasId: "pcanvas_case",
      verdict: "go",
      note: null,
    });
    expect(stored("pcanvas_case")?.decision).toEqual({ verdict: "go", decidedAt: out.decidedAt });
    expect(
      await run("tool.product_canvas.set_decision", { canvasId: "pcanvas_p", verdict: "go" })
    ).toMatchObject({ decided: false, reason: "wrong_format" });
  });
});

describe("place_bet", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      productCanvases: [
        pitch("pcanvas_p1", {
          status: "bet",
          cycle: 4,
          start: "2026-10-05",
          weeks: 6,
          decidedAt: STAMP,
        }),
        pitch("pcanvas_p2"),
        bizCase("pcanvas_case"),
      ],
    });
  });

  it("takes a known cycle's dates", async () => {
    expect(
      await run("tool.product_canvas.place_bet", {
        canvasId: "pcanvas_p2",
        status: "bet",
        cycle: 4,
      })
    ).toEqual({
      placed: true,
      status: "bet",
      cycle: 4,
      start: "2026-10-05",
      weeks: 6,
      end: "2026-11-15",
    });
  });

  it("refuses dates that disagree, and a new cycle with no start", async () => {
    expect(
      await run("tool.product_canvas.place_bet", {
        canvasId: "pcanvas_p2",
        status: "bet",
        cycle: 4,
        start: "2026-10-12",
      })
    ).toMatchObject({
      placed: false,
      reason: "bad_bet",
      message: expect.stringMatching(/^Cycle 4 runs/),
    });
    expect(
      await run("tool.product_canvas.place_bet", {
        canvasId: "pcanvas_p2",
        status: "bet",
        cycle: 5,
      })
    ).toMatchObject({ placed: false, reason: "bad_bet" });
    expect(
      await run("tool.product_canvas.place_bet", {
        canvasId: "pcanvas_p2",
        status: "bet",
        cycle: 5,
        start: "2026-11-16",
      })
    ).toMatchObject({ placed: true, weeks: 6, end: "2026-12-27" });
  });

  it("ships, cuts or puts a pitch back on the table, and refuses anything but a pitch", async () => {
    expect(
      await run("tool.product_canvas.place_bet", { canvasId: "pcanvas_p1", status: "shipped" })
    ).toMatchObject({ placed: true, status: "shipped", cycle: 4 });
    expect(
      await run("tool.product_canvas.place_bet", { canvasId: "pcanvas_p1", status: "table" })
    ).toMatchObject({ placed: true, status: "table", cycle: null });
    expect(stored("pcanvas_p1")).not.toHaveProperty("bet");
    expect(
      await run("tool.product_canvas.place_bet", { canvasId: "pcanvas_case", status: "table" })
    ).toMatchObject({ placed: false, reason: "wrong_format" });
  });
});

describe("list_state", () => {
  it("counts the inbox and lists the cycles, examples left out, with each format's fields", async () => {
    useWorkspaceStore.setState({
      productCanvases: [
        idea("pcanvas_a", "Tips", { demand: 4, status: "assessing", requesters: ["Priya", "Sam"] }),
        idea("pcanvas_b", "Split a bill"),
        idea("pcanvas_c", "Two cards", { status: "merged", mergedInto: "pcanvas_b" }),
        idea("example-pc-idea", "Example idea"),
        pitch("pcanvas_p1", { status: "bet", cycle: 4, start: "2026-10-05", weeks: 6 }),
        pitch("example-pc-pitch", { status: "bet", cycle: 9, start: "2026-10-05", weeks: 6 }),
        { ...bizCase("pcanvas_case"), decision: { verdict: "change", note: "Smaller first" } },
      ],
    });
    const out = await run<{
      inbox: Record<string, number>;
      cycles: { number: number; end: string; bets: { id: string }[] }[];
      canvases: Record<string, unknown>[];
    }>("tool.product_canvas.list_state");
    expect(out.inbox).toEqual({
      open: 2,
      new: 1,
      assessing: 1,
      accepted: 0,
      declined: 0,
      merged: 1,
    });
    expect(out.cycles).toEqual([
      {
        number: 4,
        name: "Cycle 4",
        start: "2026-10-05",
        weeks: 6,
        end: "2026-11-15",
        bets: [{ id: "pcanvas_p1", title: "Pitch pcanvas_p1", status: "bet" }],
      },
    ]);
    const byId = (id: string) => out.canvases.find((c) => c.id === id)!;
    // The summary counts who asked; it never names them.
    expect(byId("pcanvas_a").intake).toEqual({
      status: "assessing",
      demand: 4,
      source: "customer",
      requesters: 2,
      mergedInto: null,
    });
    expect(byId("pcanvas_c").intake).toMatchObject({ status: "merged", mergedInto: "pcanvas_b" });
    expect(byId("pcanvas_case").decision).toEqual({ verdict: "change", note: "Smaller first" });
    expect(byId("pcanvas_p1")).toMatchObject({
      appetiteWeeks: null,
      bet: { status: "bet", cycle: 4, end: "2026-11-15" },
    });
  });

  it("reads one idea in full, with who asked and its look-alikes, and a pitch with its breaker", async () => {
    useWorkspaceStore.setState({
      productCanvases: [
        idea("pcanvas_a", "Split the bill between two cards", { requesters: ["Support inbox"] }),
        idea("pcanvas_b", "Split a bill between two cards"),
        pitch("pcanvas_p1", { status: "bet", cycle: 4, start: "2020-01-06", weeks: 2 }),
      ],
    });
    const one = await run<{ canvas: Record<string, unknown> }>("tool.product_canvas.list_state", {
      id: "pcanvas_a",
    });
    expect(one.canvas.requesters).toEqual(["Support inbox"]);
    expect(one.canvas.similar).toEqual([
      { id: "pcanvas_b", title: "Split a bill between two cards" },
    ]);
    const p = await run<{ canvas: Record<string, unknown> }>("tool.product_canvas.list_state", {
      id: "pcanvas_p1",
    });
    expect(p.canvas.circuitBreaker).toEqual({ due: true, end: "2020-01-19" });
    expect(
      (p.canvas.gapList as { text: string }[]).some((g) => /^Its cycle ended/.test(g.text))
    ).toBe(true);
  });
});

describe("over MCP", () => {
  it("logs an idea and places a bet in the user's rows", async () => {
    const rows: ProductCanvas[] = [
      pitch("pcanvas_p1", { status: "bet", cycle: 4, start: "2026-10-05", weeks: 6 }),
      pitch("pcanvas_p2"),
    ];
    vi.mocked(serverStore.serverListEntities).mockImplementation(async (_u, kind) =>
      kind === PRODUCT_CANVAS_KIND
        ? (rows as never)
        : kind === PRODUCT_GOAL_KIND
          ? ([goal] as never)
          : []
    );
    const logged = await runMcp<{ logged: true; id: string }>("tool.product_canvas.log_idea", {
      title: "Tips",
    });
    expect(logged.logged).toBe(true);
    const upsert = vi.mocked(serverStore.serverUpsertEntity);
    expect(upsert).toHaveBeenLastCalledWith(
      "test-user",
      PRODUCT_CANVAS_KIND,
      expect.objectContaining({ id: logged.id, format: "idea", productGoalId: "goal_1" })
    );
    const placed = await runMcp("tool.product_canvas.place_bet", {
      canvasId: "pcanvas_p2",
      status: "bet",
      cycle: 4,
    });
    expect(placed).toMatchObject({ placed: true, start: "2026-10-05", weeks: 6 });
    expect(upsert).toHaveBeenLastCalledWith(
      "test-user",
      PRODUCT_CANVAS_KIND,
      expect.objectContaining({
        id: "pcanvas_p2",
        bet: expect.objectContaining({ status: "bet", cycle: 4, start: "2026-10-05", weeks: 6 }),
      })
    );
  });
});
