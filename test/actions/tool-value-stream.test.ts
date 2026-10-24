/**
 * tool.value_stream.* coverage.
 *
 *   1. list_state (read) + add_stage / move_stage / start_future_state
 *      (write, mcpHandler, no confirm)
 *   2. flow efficiency = totalProcess/totalLead (capped at 100, times
 *      clamped at 0, as on the page); rolled %C/A = product of per-stage rates
 *   3. the bottleneck, the future map and the comparison
 *   4. add_stage appends with an order; move_stage renumbers the map
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ValueStreamStage } from "@/lib/stores/workspace-types";
import { orderedStages, vsmSummary } from "@/lib/value-stream/summary";

import "@/lib/actions/tools/value-stream";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function stage(p: Partial<ValueStreamStage> & Pick<ValueStreamStage, "id">): ValueStreamStage {
  return { name: p.id, processTime: 1, leadTime: 2, completeAccurate: 100, ...p };
}

const run = <T>(id: string, params: Record<string, unknown> = {}) =>
  registry.get(`tool.value_stream.${id}`)!.handler(params, ctx()) as Promise<T>;

type State = {
  stageCount: number;
  totalProcessTime: number;
  totalLeadTime: number;
  totalWaitTime: number;
  flowEfficiencyPct: number;
  rolledCompleteAccuratePct: number;
  verdict: string;
  bottleneck: { id: string; name: string; waitDays: number; sharePct: number } | null;
  future: { stageCount: number; totalLeadTime: number; flowEfficiencyPct: number } | null;
  comparison: {
    leadDeltaDays: number;
    flowEfficiencyDeltaPts: number | null;
    verdict: string;
  } | null;
  stages: { id: string; state: string; order: number; waitTime: number }[];
};

describe("tool.value_stream — registration", () => {
  it("list_state read; the writes have server handlers and no confirm", () => {
    expect(registry.get("tool.value_stream.list_state")?.category).toBe("read");
    for (const id of ["add_stage", "move_stage", "start_future_state"]) {
      const a = registry.get(`tool.value_stream.${id}`);
      expect(a?.category, id).toBe("write");
      expect(a?.mcpHandler, id).toBeTypeOf("function");
      expect(a?.requiresConfirmation, id).toBe(false);
    }
  });
});

describe("tool.value_stream.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ valueStreamStages: [] }));

  it("is zeroed when empty", async () => {
    const r = await run<State>("list_state");
    expect(r.stageCount).toBe(0);
    expect(r.flowEfficiencyPct).toBe(0);
    expect(r.bottleneck).toBeNull();
    expect(r.future).toBeNull();
    expect(r.verdict).toBe("No stages mapped yet.");
  });

  it("computes flow efficiency and rolled %C/A", async () => {
    // process 2+3=5, lead 10+10=20 → flow eff 25%. C/A 90% × 80% = 72%.
    useWorkspaceStore
      .getState()
      .upsertValueStreamStage(
        stage({ id: "s1", processTime: 2, leadTime: 10, completeAccurate: 90 })
      );
    useWorkspaceStore
      .getState()
      .upsertValueStreamStage(
        stage({ id: "s2", processTime: 3, leadTime: 10, completeAccurate: 80 })
      );

    const r = await run<State>("list_state");
    expect(r.stageCount).toBe(2);
    expect(r.totalProcessTime).toBe(5);
    expect(r.totalLeadTime).toBe(20);
    expect(r.totalWaitTime).toBe(15);
    expect(r.flowEfficiencyPct).toBe(25);
    expect(r.rolledCompleteAccuratePct).toBe(72);
    // s1 waits 8, s2 waits 7.
    expect(r.bottleneck).toEqual({ id: "s1", name: "s1", waitDays: 8, sharePct: 40 });
    expect(r.verdict).toBe("Waiting is 75% of the 20-day lead time; s1 waits longest (8 days).");
  });

  it("clamps bad stored values as the page does", async () => {
    useWorkspaceStore.setState({
      valueStreamStages: [
        stage({ id: "a", processTime: 9, leadTime: 3, completeAccurate: 140 }),
        stage({ id: "b", processTime: -2, leadTime: 1, completeAccurate: -5 }),
      ],
    });
    const r = await run<State>("list_state");
    // Process 9 of lead 4 would read 225%: capped.
    expect(r.flowEfficiencyPct).toBe(100);
    expect(r.totalProcessTime).toBe(9);
    expect(r.rolledCompleteAccuratePct).toBe(0);
    // The agent and the page read one summary.
    expect(r.flowEfficiencyPct).toBe(
      Math.round(
        vsmSummary(orderedStages(useWorkspaceStore.getState().valueStreamStages)).flowEfficiency!
      )
    );
  });

  it("lists both maps in order and compares them", async () => {
    useWorkspaceStore.setState({
      valueStreamStages: [
        stage({ id: "c2", processTime: 2, leadTime: 8, order: 1 }),
        stage({ id: "c1", processTime: 1, leadTime: 2, order: 0 }),
        stage({ id: "f1", processTime: 1, leadTime: 2, order: 0, state: "future" }),
        stage({ id: "f2", processTime: 2, leadTime: 3, order: 1, state: "future" }),
      ],
    });
    const r = await run<State>("list_state");
    expect(r.stages.map((s) => [s.id, s.state, s.order])).toEqual([
      ["c1", "current", 0],
      ["c2", "current", 1],
      ["f1", "future", 0],
      ["f2", "future", 1],
    ]);
    expect(r.future).toMatchObject({ stageCount: 2, totalLeadTime: 5, flowEfficiencyPct: 60 });
    expect(r.comparison).toMatchObject({ leadDeltaDays: -5, flowEfficiencyDeltaPts: 30 });
    expect(r.comparison?.verdict).toBe(
      "The future state cuts lead time from 10 to 5 days and lifts flow efficiency from 30% to 60%."
    );
  });

  it("leaves out example stages", async () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage({ id: "example-vsm-1" })] });
    expect((await run<State>("list_state")).stageCount).toBe(0);
  });
});

describe("tool.value_stream.add_stage", () => {
  beforeEach(() => useWorkspaceStore.setState({ valueStreamStages: [] }));

  it("appends a stage", async () => {
    const r = await run<{ added: boolean; id: string; order: number; state: string }>("add_stage", {
      name: "Build",
      processTime: 2,
      leadTime: 5,
      completeAccurate: 95,
    });
    expect(r.added).toBe(true);
    expect(r).toMatchObject({ state: "current", order: 0 });
    const stored = useWorkspaceStore.getState().valueStreamStages ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Build");
  });

  it("goes after the stages saved before reordering, numbering them", async () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage({ id: "old1" }), stage({ id: "old2" })],
    });
    const r = await run<{ order: number }>("add_stage", {
      name: "Release",
      processTime: 0,
      leadTime: 1,
      completeAccurate: 100,
    });
    expect(r.order).toBe(2);
    const ordered = orderedStages(useWorkspaceStore.getState().valueStreamStages);
    expect(ordered.map((s) => [s.name, s.order])).toEqual([
      ["old1", 0],
      ["old2", 1],
      ["Release", 2],
    ]);
  });

  it("adds to the future map when asked", async () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage({ id: "c1", order: 0 })] });
    const r = await run<{ state: string; order: number }>("add_stage", {
      name: "Pair review",
      processTime: 1,
      leadTime: 1,
      completeAccurate: 90,
      state: "future",
    });
    expect(r).toMatchObject({ state: "future", order: 0 });
  });
});

describe("tool.value_stream.move_stage", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      valueStreamStages: [stage({ id: "a" }), stage({ id: "b" }), stage({ id: "c" })],
    })
  );

  it("moves a stage and numbers the whole map", async () => {
    const r = await run<{ moved: boolean; index: number; order: string[] }>("move_stage", {
      id: "c",
      toIndex: 0,
    });
    expect(r).toMatchObject({ moved: true, index: 0, order: ["c", "a", "b"] });
    // Stored order is what a fresh device reads, whatever the row order.
    const shuffled = [...(useWorkspaceStore.getState().valueStreamStages ?? [])].sort((x, y) =>
      x.id.localeCompare(y.id)
    );
    expect(orderedStages(shuffled).map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("clamps past the end and reports unknown ids", async () => {
    const r = await run<{ index: number }>("move_stage", { id: "a", toIndex: 99 });
    expect(r.index).toBe(2);
    expect(await run("move_stage", { id: "nope", toIndex: 0 })).toEqual({
      moved: false,
      reason: "not_found",
    });
  });
});

describe("tool.value_stream.start_future_state", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      valueStreamStages: [stage({ id: "a", order: 1 }), stage({ id: "b", order: 0 })],
    })
  );

  it("copies the current map, in order, into an empty future map once", async () => {
    const r = await run<{ created: number; ids: string[] }>("start_future_state");
    expect(r.created).toBe(2);
    const future = orderedStages(useWorkspaceStore.getState().valueStreamStages, "future");
    expect(future.map((s) => s.name)).toEqual(["b", "a"]);
    expect(future.every((s) => !["a", "b"].includes(s.id))).toBe(true);
    expect(await run("start_future_state")).toEqual({
      created: 0,
      reason: "future_exists",
      ids: [],
    });
  });

  it("needs a current map", async () => {
    useWorkspaceStore.setState({ valueStreamStages: [] });
    expect(await run("start_future_state")).toEqual({
      created: 0,
      reason: "no_current_stages",
      ids: [],
    });
  });
});
