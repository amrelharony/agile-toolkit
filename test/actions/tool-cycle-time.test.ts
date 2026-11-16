import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  type KanbanCard,
  type Sprint,
  type Story,
} from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import { CYCLE_TIME_STORE_KEY } from "@/lib/actions/tools/cycle-time";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Result = {
  count: number;
  average: number;
  min: number;
  max: number;
  p50: number;
  p85: number;
  p95: number;
  sleTarget: number;
  outliers: number[];
};

describe("tool.cycle_time.compute_percentiles", () => {
  it("is a read action", () => {
    expect(registry.get("tool.cycle_time.compute_percentiles")?.category).toBe("read");
  });

  it("computes ordered percentiles, average, min/max, and SLE = P85", async () => {
    const action = registry.get("tool.cycle_time.compute_percentiles");
    const r = (await action!.handler(
      { durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      ctx()
    )) as Result;
    expect(r.count).toBe(10);
    expect(r.min).toBe(1);
    expect(r.max).toBe(10);
    expect(r.average).toBe(5.5);
    expect(r.p50).toBeLessThanOrEqual(r.p85);
    expect(r.p85).toBeLessThanOrEqual(r.p95);
    expect(r.sleTarget).toBe(r.p85);
  });

  it("uses the page's nearest-rank percentiles, not interpolation", async () => {
    const r = (await registry
      .get("tool.cycle_time.compute_percentiles")!
      .handler({ durations: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }, ctx())) as Result;
    // Interpolated, P85 of 1..10 was 8.7; the page and the Flow board say 9.
    expect(r.p50).toBe(5);
    expect(r.p85).toBe(9);
    expect(r.p95).toBe(10);
  });

  it("flags IQR outliers", async () => {
    const action = registry.get("tool.cycle_time.compute_percentiles");
    const r = (await action!.handler(
      { durations: [2, 2, 3, 3, 3, 3, 3, 2, 2, 100] },
      ctx()
    )) as Result;
    expect(r.outliers).toContain(100);
  });

  it("documents the same-day = 1 rule", () => {
    expect(registry.get("tool.cycle_time.compute_percentiles")?.description).toMatch(
      /same day is 1/
    );
  });
});

/* ── list_state ─────────────────────────────────────────────────────── */

const TODAY = todayIso();
const day = (n: number) => addDays(TODAY, -n) as string;
const at = (n: number) => new Date(`${day(n)}T12:00:00`).toISOString();

type ListResult = {
  found: boolean;
  count: number;
  average: number | null;
  median: number | null;
  p85: number | null;
  p95: number | null;
  sleDays: number | null;
  items: { id: string; source: string; days: number; doneOn: string }[];
  ageing: {
    id: string;
    ageDays: number;
    overP85: boolean | null;
    blocked: boolean;
    source: string;
  }[];
};

const list = (params: Record<string, unknown> = {}) =>
  registry.get("tool.cycle_time.list_state")!.handler(params, ctx()) as Promise<ListResult>;

const doneStory = (id: string, started: number, done: number, sprintId = "s-1"): Story => ({
  id,
  title: id,
  status: "done",
  sprintId,
  startedAt: at(started),
  doneAt: at(done),
  statusHistory: [
    { status: "in_progress", from: "todo", at: at(started) },
    { status: "done", from: "in_progress", at: at(done) },
  ],
});

const card = (id: string, extra: Partial<KanbanCard>): KanbanCard => ({
  id,
  title: id,
  column: "done",
  class: "standard",
  createdAt: at(30),
  ...extra,
});

const SPRINT: Sprint = {
  id: "s-1",
  name: "Sprint 1",
  startDate: day(20),
  endDate: day(7),
  pointsPlanned: 10,
  status: "completed",
};

describe("tool.cycle_time.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ stories: [], sprints: [], kanbanBoards: [] });
  });

  it("is a read action with a server handler", () => {
    expect(registry.get("tool.cycle_time.list_state")?.category).toBe("read");
    expect(registry.get("tool.cycle_time.list_state")?.mcpHandler).toBeTypeOf("function");
  });

  it("reads finished stories and Done cards, counting a same-day item as 1", async () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      stories: [doneStory("s1", 3, 3), doneStory("s2", 10, 8)],
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          wipLimits: { backlog: 0, ready: 0, in_progress: 0, review: 0, done: 0 },
          cards: [
            card("k1", { startedAt: at(6), completedAt: at(2) }),
            // Moved back out of Done: a stale completion doesn't count.
            card("k2", { column: "review", startedAt: at(9), completedAt: at(4) }),
          ],
        },
      ],
    });
    const r = await list();
    expect(r.count).toBe(3);
    expect(r.items.map((i) => [i.id, i.days])).toEqual([
      ["k1", 5],
      ["s1", 1],
      ["s2", 3],
    ]);
    // Three finished: enough for the average (MIN_SAMPLE.average), not the percentiles (5).
    expect(r.average).toBe(3);
    expect(r.p85).toBeNull();
    expect(r.sleDays).toBeNull();
    // The card back in Review is ageing work in progress, unflagged without a P85.
    expect(r.ageing.map((a) => [a.id, a.ageDays, a.overP85])).toEqual([["k2", 10, null]]);
  });

  it("quotes the P85 from 5 items and flags ageing work past it", async () => {
    useWorkspaceStore.setState({
      stories: [
        doneStory("a", 5, 4),
        doneStory("b", 6, 4),
        doneStory("c", 7, 5),
        doneStory("d", 8, 5),
        doneStory("e", 12, 6),
        {
          id: "w",
          title: "w",
          status: "in_progress",
          startedAt: at(9),
          blocked: true,
          statusHistory: [{ status: "in_progress", from: "todo", at: at(9) }],
        },
      ],
    });
    const r = await list({ source: "sprint" });
    expect(r.count).toBe(5);
    expect(r.p85).toBe(7);
    expect(r.sleDays).toBe(7);
    expect(r.ageing).toEqual([
      expect.objectContaining({
        id: "w",
        ageDays: 10,
        overP85: true,
        blocked: true,
        source: "sprint",
      }),
    ]);
  });

  it("narrows to a sprint, a board and a window", async () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      stories: [doneStory("in", 10, 9), doneStory("out", 40, 35, "s-other")],
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          wipLimits: { backlog: 0, ready: 0, in_progress: 0, review: 0, done: 0 },
          cards: [card("k", { startedAt: at(3), completedAt: at(1) })],
        },
      ],
    });
    expect((await list({ sprintId: "s-1" })).items.map((i) => i.id)).toEqual(["in"]);
    expect((await list({ source: "flow" })).items.map((i) => i.id)).toEqual(["k"]);
    expect((await list({ sinceDays: 10 })).items.map((i) => i.id)).toEqual(["k", "in"]);
    expect(await list({ sprintId: "nope" })).toEqual({ found: false, reason: "sprint_not_found" });
  });
});

/* ── by_stage ───────────────────────────────────────────────────────── */

type ByStageResult = {
  found: boolean;
  count: number;
  approximate: number;
  waiting: string[];
  stages: {
    stage: string;
    items: number;
    median: number | null;
    p85: number | null;
    share: number | null;
    waiting: boolean;
  }[];
  flowEfficiency: { pct: number | null; reason: string; waitingDays: number };
  items: {
    id: string;
    source: string;
    cycleDays: number;
    elapsedDays: number;
    stages: { stage: string; days: number }[];
    efficiency: number | null;
  }[];
};

const byStage = (params: Record<string, unknown> = {}) =>
  registry.get("tool.cycle_time.by_stage")!.handler(params, ctx()) as Promise<ByStageResult>;

/**
 * Noon on a day of July 2026, local time: fixed days in a month no time
 * zone changes its clocks in, so elapsed days are whole on any machine.
 */
const jul = (d: number) => new Date(2026, 6, d, 12).toISOString();

/** A story worked `progress` days, then in Review `review` days, done on July `done`. */
const reviewed = (id: string, progress: number, review: number, done: number): Story => {
  const started = done - review - progress;
  return {
    id,
    title: id,
    status: "done",
    sprintId: "s-1",
    startedAt: jul(started),
    doneAt: jul(done),
    statusHistory: [
      { status: "in_progress", from: "todo", at: jul(started) },
      { status: "review", from: "in_progress", at: jul(done - review) },
      { status: "done", from: "review", at: jul(done) },
    ],
  };
};

describe("tool.cycle_time.by_stage", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ stories: [], sprints: [], kanbanBoards: [] });
  });

  it("is a read action with a server handler", () => {
    const action = registry.get("tool.cycle_time.by_stage");
    expect(action?.category).toBe("read");
    expect(action?.mcpHandler).toBeTypeOf("function");
  });

  it("splits finished work into the time in each status, with each status's median and P85", async () => {
    useWorkspaceStore.setState({
      stories: [1, 2, 3, 4, 5].map((n) => reviewed(`s${n}`, n, 2, 20)),
    });
    const r = await byStage();
    expect(r.count).toBe(5);
    const progress = r.stages.find((s) => s.stage === "in_progress")!;
    expect(r.stages.map((s) => s.stage)).toEqual(["in_progress", "review"]);
    const review = r.stages.find((s) => s.stage === "review")!;
    expect([progress.median, progress.p85]).toEqual([3, 5]);
    expect([review.median, review.p85]).toEqual([2, 2]);
    expect(progress.share! + review.share!).toBeCloseTo(100, 0);
    // Newest first; a story's stages add up to the time it took.
    expect(r.items[0].stages).toEqual([
      { stage: "in_progress", days: 5 },
      { stage: "review", days: 2 },
    ]);
    expect(r.items[0]).toMatchObject({ id: "s5", cycleDays: 8, elapsedDays: 7 });
    expect(r.items.every((i) => i.source === "sprint")).toBe(true);
  });

  it("reads the flow efficiency by default, with Review and a stint in Done waiting", async () => {
    useWorkspaceStore.setState({
      stories: [1, 2, 3].map((n) => reviewed(`s${n}`, 2, 2, 20 + n)),
    });
    const plain = await byStage();
    expect(plain.waiting).toEqual(["review", "done"]);
    expect(plain.flowEfficiency).toMatchObject({ pct: 50, reason: "ok", waitingDays: 6 });
    expect(plain.stages.find((s) => s.stage === "review")!.waiting).toBe(true);
    expect(plain.items[0].efficiency).toBe(50);
    // Nothing marked waiting: all the time is active, so the two can't be told apart.
    const none = await byStage({ waiting: [] });
    expect(none.flowEfficiency).toMatchObject({ pct: null, reason: "one_kind" });
    // Below 3 items there's no efficiency to quote.
    useWorkspaceStore.setState({ stories: [reviewed("a", 2, 2, 20)] });
    expect((await byStage()).flowEfficiency.reason).toBe("not_enough");
  });

  it("reads the statuses the person marked on the page, in the browser", async () => {
    useWorkspaceStore.setState({
      stories: [1, 2, 3].map((n) => reviewed(`s${n}`, 2, 2, 20 + n)),
    });
    try {
      // The page's store keeps its marking under this key: here, nothing waits.
      window.localStorage.setItem(
        CYCLE_TIME_STORE_KEY,
        JSON.stringify({ state: { waitingStages: ["lunch"] }, version: 1 })
      );
      const r = await byStage();
      expect(r.waiting).toEqual([]);
      expect(r.flowEfficiency.reason).toBe("one_kind");
      // Statuses passed in win over the page's.
      expect((await byStage({ waiting: ["review"] })).flowEfficiency.pct).toBe(50);
      // A blob that can't be read counts as nothing saved: the default.
      window.localStorage.setItem(CYCLE_TIME_STORE_KEY, "{not json");
      expect((await byStage()).waiting).toEqual(["review", "done"]);
      window.localStorage.setItem(CYCLE_TIME_STORE_KEY, JSON.stringify({ state: {} }));
      expect((await byStage()).waiting).toEqual(["review", "done"]);
    } finally {
      window.localStorage.removeItem(CYCLE_TIME_STORE_KEY);
    }
  });

  it("leaves out items with no recorded moves, and narrows like list_state", async () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      stories: [reviewed("in", 1, 1, 9), { ...reviewed("out", 1, 1, 9), sprintId: "s-other" }],
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          wipLimits: { backlog: 0, ready: 0, in_progress: 0, review: 0, done: 0 },
          // From before the board kept a card's moves: its stages aren't known.
          cards: [card("k", { startedAt: at(3), completedAt: at(1) })],
        },
      ],
    });
    const all = await byStage();
    expect(all.count).toBe(2);
    expect(all.approximate).toBe(1);
    expect((await byStage({ sprintId: "s-1" })).items.map((i) => i.id)).toEqual(["in"]);
    expect((await byStage({ source: "flow" })).count).toBe(0);
    expect((await byStage({ sinceDays: 5 })).count).toBe(0);
    expect(await byStage({ sprintId: "nope" })).toEqual({
      found: false,
      reason: "sprint_not_found",
    });
  });

  it("refuses a status it doesn't know", () => {
    const schema = registry.get("tool.cycle_time.by_stage")!.paramsSchema;
    expect(schema.safeParse({ waiting: ["review"] }).success).toBe(true);
    expect(schema.safeParse({ waiting: ["lunch"] }).success).toBe(false);
  });
});
