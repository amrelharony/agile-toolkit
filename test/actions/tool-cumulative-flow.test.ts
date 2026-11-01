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
import "@/lib/actions/tools/cumulative-flow";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Result = {
  days: number;
  elapsedDays: number;
  avgWip: number | null;
  throughputPerDay: number | null;
  littlesLawCycleTimeDays: number | null;
  leadTimeDays: number | null;
  wipControlLimits: { centerLine: number; ucl: number; lcl: number } | null;
  wipStable: boolean | null;
};

const compute = (params: Record<string, unknown>) =>
  registry.get("tool.cumulative_flow.compute")!.handler(params, ctx()) as Promise<Result>;

describe("tool.cumulative_flow.compute", () => {
  it("is a read action", () => {
    expect(registry.get("tool.cumulative_flow.compute")?.category).toBe("read");
  });

  it("derives throughput, avg WIP, and Little's-Law cycle time", async () => {
    const r = await compute({ wip: [5, 5, 5, 5, 5], done: [0, 3, 6, 9, 12] });
    expect(r.days).toBe(5);
    expect(r.elapsedDays).toBe(4);
    expect(r.avgWip).toBe(5);
    expect(r.throughputPerDay).toBe(3); // 12 done over 4 elapsed days
    expect(r.littlesLawCycleTimeDays).toBeCloseTo(1.67, 1);
    // The page's reading: one more day, as a same-day item counts 1.
    expect(r.leadTimeDays).toBeCloseTo(2.67, 1);
    // Control limits wait for MIN_SAMPLE.changePoint (8) points, as on the page.
    expect(r.wipControlLimits).toBeNull();
    expect(r.wipStable).toBeNull();
  });

  it("returns null cycle time when there is no throughput", async () => {
    const r = await compute({ wip: [4, 4, 4], done: [3, 3, 3] });
    expect(r.throughputPerDay).toBe(0);
    expect(r.littlesLawCycleTimeDays).toBeNull();
    expect(r.leadTimeDays).toBeNull();
  });

  it("quotes nothing from two points, as the page shows —", async () => {
    const r = await compute({ wip: [4, 6], done: [0, 4] });
    expect(r.avgWip).toBeNull();
    expect(r.throughputPerDay).toBeNull();
    expect(r.littlesLawCycleTimeDays).toBeNull();
  });

  it("divides by the elapsed days between uneven dates, not the point count", async () => {
    // 1, 2 and 30 October: 29 elapsed days, not 2.
    const r = await compute({
      wip: [3, 3, 3],
      done: [0, 1, 29],
      dates: ["2026-10-01", "2026-10-02", "2026-10-30"],
    });
    expect(r.elapsedDays).toBe(29);
    expect(r.throughputPerDay).toBe(1);
    expect(r.littlesLawCycleTimeDays).toBe(3);
  });

  it("rejects dates of the wrong length", () => {
    const schema = registry.get("tool.cumulative_flow.compute")!.paramsSchema;
    expect(
      schema.safeParse({ wip: [1, 2, 3], done: [0, 1, 2], dates: ["2026-10-01"] }).success
    ).toBe(false);
  });

  it("gives control limits and a stability verdict from 8 points", async () => {
    const r = await compute({ wip: [5, 6, 5, 5, 6, 5, 6, 5], done: [0, 1, 2, 3, 4, 5, 6, 7] });
    expect(r.wipControlLimits).not.toBeNull();
    expect(r.wipStable).toBe(true);
  });
});

/* ── list_state ─────────────────────────────────────────────────────── */

const TODAY = todayIso();
const day = (n: number) => addDays(TODAY, -n) as string;
const at = (n: number) => new Date(`${day(n)}T12:00:00`).toISOString();

type ListResult = {
  source: string;
  sprintId: string | null;
  range: { from: string; to: string } | null;
  itemCount: number;
  stages: { id: string; kind: string }[];
  days: { date: string; counts: Record<string, number> }[];
  latest: { total: number; wip: number; done: number } | null;
  enoughDays: boolean;
  avgWip: number | null;
  throughputPerDay: number | null;
  littlesLawDays: number | null;
  measuredCycleTime: { count: number; averageDays: number | null };
  approximateItems: number;
  wipLimit: number | null;
};

const list = (params: Record<string, unknown> = {}) =>
  registry.get("tool.cumulative_flow.list_state")!.handler(params, ctx()) as Promise<ListResult>;

const SPRINT: Sprint = {
  id: "s-1",
  name: "Sprint 1",
  startDate: day(4),
  endDate: day(-9),
  pointsPlanned: 10,
  status: "active",
};

function story(id: string, moves: [Story["status"], number][]): Story {
  const history = [{ status: "todo" as const, from: "backlog" as const, at: at(4) }];
  let prev: Story["status"] = "todo";
  for (const [status, n] of moves) {
    history.push({ status: status as "todo", from: prev as "backlog", at: at(n) });
    prev = status;
  }
  const started = moves[0];
  const done = moves.find(([s]) => s === "done");
  return {
    id,
    title: id,
    status: prev,
    sprintId: SPRINT.id,
    statusHistory: history,
    ...(started ? { startedAt: at(started[1]) } : {}),
    ...(done ? { doneAt: at(done[1]) } : {}),
  };
}

describe("tool.cumulative_flow.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ stories: [], sprints: [], kanbanBoards: [] });
  });

  it("is a read action with a server handler", () => {
    expect(registry.get("tool.cumulative_flow.list_state")?.category).toBe("read");
    expect(registry.get("tool.cumulative_flow.list_state")?.mcpHandler).toBeTypeOf("function");
  });

  it("charts the active sprint's stories by day, from its start to today", async () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      stories: [
        story("a", [
          ["in_progress", 4],
          ["done", 2],
        ]),
        story("b", [
          ["in_progress", 3],
          ["review", 1],
        ]),
        story("c", []),
      ],
    });
    const r = await list();
    expect(r.source).toBe("sprint");
    expect(r.sprintId).toBe("s-1");
    expect(r.range).toEqual({ from: day(4), to: TODAY });
    expect(r.days).toHaveLength(5);
    expect(r.stages.map((s) => s.id)).toEqual(["todo", "in_progress", "review", "done"]);
    expect(r.days[r.days.length - 1].counts).toEqual({
      todo: 1,
      in_progress: 0,
      review: 1,
      done: 1,
    });
    expect(r.latest).toMatchObject({ total: 3, wip: 1, done: 1 });
    expect(r.enoughDays).toBe(true);
    // 1 finished over 4 elapsed days.
    expect(r.throughputPerDay).toBe(0.25);
    expect(r.measuredCycleTime.count).toBe(1);
    // A single finished item isn't enough to quote an average.
    expect(r.measuredCycleTime.averageDays).toBeNull();
  });

  it("falls back to the Flow board, and reads the board's WIP limits", async () => {
    const cards: KanbanCard[] = [
      {
        id: "k1",
        title: "k1",
        column: "done",
        class: "standard",
        createdAt: at(10),
        startedAt: at(8),
        completedAt: at(6),
      },
      {
        id: "k2",
        title: "k2",
        column: "in_progress",
        class: "standard",
        createdAt: at(9),
        startedAt: at(3),
      },
    ];
    useWorkspaceStore.setState({
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          cards,
          wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
        },
      ],
    });
    const r = await list({ days: 7 });
    expect(r.source).toBe("flow");
    expect(r.range).toEqual({ from: day(6), to: TODAY });
    expect(r.days).toHaveLength(7);
    expect(r.wipLimit).toBe(5);
    // Rebuilt from the stamps: no history was kept on these cards.
    expect(r.approximateItems).toBe(2);
  });

  it("returns an empty chart, not an error, with nothing on either board", async () => {
    const r = await list();
    expect(r.source).toBe("flow");
    expect(r.range).toBeNull();
    expect(r.days).toEqual([]);
    expect(r.throughputPerDay).toBeNull();
    expect(r.littlesLawDays).toBeNull();
  });

  it("charts nothing before a planned sprint starts", async () => {
    const future: Sprint = {
      ...SPRINT,
      id: "s-2",
      startDate: day(-3),
      endDate: day(-16),
      status: "planned",
    };
    useWorkspaceStore.setState({
      sprints: [future],
      stories: [{ ...story("x", []), sprintId: "s-2" }],
    });
    const r = await list({ sprintId: "s-2" });
    expect(r.source).toBe("sprint");
    expect(r.range).toBeNull();
  });

  it("says a sprint asked for by id isn't there, rather than charting another", async () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      stories: [story("a", [["in_progress", 2]])],
    });
    expect(await list({ sprintId: "s-typo" })).toEqual({
      found: false,
      reason: "sprint_not_found",
      sprintId: "s-typo",
    });
    // The Flow board takes no sprint: the id is ignored there.
    expect(await list({ sprintId: "s-typo", source: "flow" })).toMatchObject({
      found: true,
      source: "flow",
    });
    expect(await list({ sprintId: "s-1" })).toMatchObject({ found: true, sprintId: "s-1" });
  });

  it("puts Little's Law on the cycle-time day rule, as the page does", async () => {
    // Started and finished the same day, every day: ≈ 1 day, not 0.
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      stories: [3, 2, 1, 0].map((n) =>
        story(`s${n}`, [
          ["in_progress", n],
          ["done", n],
        ])
      ),
    });
    const r = await list();
    expect(r.avgWip).toBe(0);
    expect(r.littlesLawDays).toBe(1);
    expect(r.measuredCycleTime.averageDays).toBe(1);
  });
});
