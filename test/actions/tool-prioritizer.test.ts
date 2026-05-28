/**
 * tool.prioritizer.* action coverage.
 *
 *   1. list_state (read) + add_item (write, mcpHandler, no confirm)
 *   2. list_state computes WSJF + RICE with the same formulas as the UI,
 *      ranks by WSJF desc, and tallies MoSCoW buckets
 *   3. add_item appends with documented defaults
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/prioritizer";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

function item(partial: Partial<BacklogItem> & Pick<BacklogItem, "id" | "name">): BacklogItem {
  return {
    moscow: "should",
    businessValue: 5,
    timeCriticality: 5,
    riskReduction: 5,
    jobSize: 5,
    reach: 100,
    impact: 1,
    confidence: 80,
    effort: 1,
    value: 5,
    matrixEffort: 5,
    ...partial,
  };
}

describe("tool.prioritizer — registration", () => {
  it("registers list_state (read) and add_item (write, mcpHandler, no confirm)", () => {
    expect(registry.get("tool.prioritizer.list_state")?.category).toBe("read");
    expect(registry.get("tool.prioritizer.add_item")?.category).toBe("write");
    expect(registry.get("tool.prioritizer.add_item")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.prioritizer.add_item")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.prioritizer.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ backlogItems: [] });
  });

  it("returns zeros for an empty backlog", async () => {
    const action = registry.get("tool.prioritizer.list_state");
    const r = (await action!.handler({}, ctx())) as { total: number; rankedByWsjf: unknown[] };
    expect(r.total).toBe(0);
    expect(r.rankedByWsjf).toEqual([]);
  });

  it("computes WSJF/RICE and ranks by WSJF; tallies MoSCoW", async () => {
    // A: WSJF = (9+8+7)/3 = 8.0 ; RICE = 500*2*0.9/2 = 450
    // B: WSJF = (3+1+1)/1 = 5.0 ; RICE = 400*0.5*0.8/1 = 160
    useWorkspaceStore.getState().upsertBacklogItem(
      item({
        id: "a",
        name: "Auth",
        moscow: "must",
        businessValue: 9,
        timeCriticality: 8,
        riskReduction: 7,
        jobSize: 3,
        reach: 500,
        impact: 2,
        confidence: 90,
        effort: 2,
      })
    );
    useWorkspaceStore.getState().upsertBacklogItem(
      item({
        id: "b",
        name: "Dark mode",
        moscow: "could",
        businessValue: 3,
        timeCriticality: 1,
        riskReduction: 1,
        jobSize: 1,
        reach: 400,
        impact: 0.5,
        confidence: 80,
        effort: 1,
      })
    );

    const action = registry.get("tool.prioritizer.list_state");
    const r = (await action!.handler({}, ctx())) as {
      total: number;
      byMoscow: Record<string, number>;
      items: { id: string; wsjf: number; rice: number }[];
      rankedByWsjf: { id: string; wsjf: number }[];
    };
    expect(r.total).toBe(2);
    expect(r.byMoscow.must).toBe(1);
    expect(r.byMoscow.could).toBe(1);
    const a = r.items.find((i) => i.id === "a")!;
    expect(a.wsjf).toBeCloseTo(8.0, 2);
    expect(a.rice).toBeCloseTo(450, 0);
    const b = r.items.find((i) => i.id === "b")!;
    expect(b.wsjf).toBeCloseTo(5.0, 2);
    expect(b.rice).toBeCloseTo(160, 0);
    // A ranks above B by WSJF
    expect(r.rankedByWsjf[0].id).toBe("a");
  });
});

describe("tool.prioritizer.add_item", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ backlogItems: [] });
  });

  it("appends with defaults", async () => {
    const action = registry.get("tool.prioritizer.add_item");
    const r = (await action!.handler({ name: "Search" }, ctx())) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    const stored = (useWorkspaceStore.getState().backlogItems ?? []).find((i) => i.id === r.id);
    expect(stored?.name).toBe("Search");
    expect(stored?.moscow).toBe("should");
    expect(stored?.jobSize).toBe(5);
  });
});
