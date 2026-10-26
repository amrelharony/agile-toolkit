/**
 * tool.prioritizer.* action coverage.
 *
 *   1. list_state (read) + add_item (write, mcpHandler, no confirm)
 *   2. list_state computes WSJF + RICE with the same formulas as the UI,
 *      ranks by WSJF desc, and tallies MoSCoW buckets
 *   3. list_state adds each item's frameworkScores: the embedded methods
 *      from its inputs, ICE / Kano / Cost of Delay from the latest linked row
 *   4. add_item appends with nothing scored it wasn't given
 *   5. list_state gives each item's place per method (ties averaged), the
 *      Borda consensus and the disagreement flag decide_order reports
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

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
    useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
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

describe("tool.prioritizer.list_state frameworkScores", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
  });

  const row = (
    id: string,
    framework: PrioritizationItem["framework"],
    extra: Partial<PrioritizationItem>
  ): PrioritizationItem => ({
    id,
    framework,
    title: id,
    status: "scored",
    updatedAt: "2026-10-01T09:00:00.000Z",
    ...extra,
  });

  it("gives every method's score per item, reading linked rows for ICE, Kano and Cost of Delay", async () => {
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
        value: 9,
        matrixEffort: 3,
      })
    );
    useWorkspaceStore.getState().upsertBacklogItem(item({ id: "b", name: "Dark mode" }));
    useWorkspaceStore.setState({
      prioritizations: [
        // Scores come from the fields (the engine recomputes; a cached score is never read).
        row("ice-1", "ice", {
          backlogItemId: "a",
          score: 100,
          fields: { impact: 5, confidence: 5, ease: 4 },
        }),
        row("ice-2", "ice", {
          backlogItemId: "a",
          score: 320,
          fields: { impact: 8, confidence: 8, ease: 5 },
          updatedAt: "2026-10-09T00:00:00Z",
        }),
        row("kano-1", "kano", { backlogItemId: "a", fields: { category: "attractive" } }),
        row("cod-1", "cost-of-delay", {
          backlogItemId: "a",
          score: 12000,
          fields: { perWeekUsd: 3000, durationWeeks: 4, urgency: "standard" },
        }),
        row("cod-unlinked", "cost-of-delay", { score: 99 }),
      ],
    });

    const action = registry.get("tool.prioritizer.list_state");
    const r = (await action!.handler({}, ctx())) as {
      items: { id: string; wsjf: number; frameworkScores: Record<string, unknown> }[];
      rankedByWsjf: { id: string; frameworkScores: unknown }[];
    };
    const a = r.items.find((i) => i.id === "a")!;
    // Phase 7: one quadrant rule with snake_case keys; Cost of Delay is CD3
    // (per week ÷ duration) with its urgency, costOfDelay the deprecated old total.
    expect(a.frameworkScores).toEqual({
      moscow: "must",
      wsjf: 8,
      rice: 450,
      valueEffort: { value: 9, effort: 3, quadrant: "quick_wins" },
      ice: 320,
      kano: "attractive",
      costOfDelay: null,
      cd3: 750,
      urgency: "standard",
    });
    // The existing fields are unchanged.
    expect(a.wsjf).toBeCloseTo(8.0, 2);
    const b = r.items.find((i) => i.id === "b")!;
    expect(b.frameworkScores).toMatchObject({ ice: null, kano: null, costOfDelay: null });
    expect(r.rankedByWsjf[0].frameworkScores).toBeDefined();
  });
});

describe("tool.prioritizer.add_item", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ backlogItems: [] });
  });

  // Phase 7 decision: no mid-range defaults; a method it isn't given is Not scored.
  it("appends with nothing scored it wasn't given", async () => {
    const action = registry.get("tool.prioritizer.add_item");
    const r = (await action!.handler({ name: "Search" }, ctx())) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    const stored = (useWorkspaceStore.getState().backlogItems ?? []).find((i) => i.id === r.id);
    expect(stored?.name).toBe("Search");
    expect(stored?.moscow).toBeUndefined();
    expect(stored?.jobSize).toBeUndefined();
  });
});

describe("tool.prioritizer.list_state per-method places and consensus", () => {
  const stamp = "2026-10-26T09:00:00.000Z";
  const wsjf = (bv: number, js: number): Partial<BacklogItem> => ({
    businessValue: bv,
    timeCriticality: 1,
    riskReduction: 1,
    jobSize: js,
  });

  beforeEach(() => {
    useWorkspaceStore.setState({
      backlogItems: [
        { id: "a", name: "A", moscow: "could", ...wsjf(8, 1), updatedAt: stamp },
        { id: "b", name: "B", moscow: "must", ...wsjf(3, 1), updatedAt: stamp },
        { id: "c", name: "C", moscow: "must", ...wsjf(2, 1), rank: 1, updatedAt: stamp },
        { id: "d", name: "D", updatedAt: stamp },
      ],
      prioritizations: [],
    });
  });

  type Listed = {
    items: {
      id: string;
      rank: number | null;
      methodRanks: Record<string, number>;
      consensus: number | null;
      coverage: number;
      disagree: boolean;
    }[];
    rankedMethods: string[];
  };

  it("gives each item its place in every method that ranks 2 or more, tied places averaged", async () => {
    const r = (await registry.get("tool.prioritizer.list_state")!.handler({}, ctx())) as Listed;
    expect(r.rankedMethods).toEqual(["moscow", "wsjf"]);
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    // MoSCoW: B and C tie as Musts (places 1 and 2 → 1.5); A is a Could (3).
    expect(by.b.methodRanks).toEqual({ moscow: 1.5, wsjf: 2 });
    expect(by.a.methodRanks).toEqual({ moscow: 3, wsjf: 1 });
    expect(by.d.methodRanks).toEqual({});
    expect(by.c.rank).toBe(1);
    expect(by.d.rank).toBeNull();
  });

  it("gives the Borda consensus (0-100), its coverage and the disagreement flag", async () => {
    const r = (await registry.get("tool.prioritizer.list_state")!.handler({}, ctx())) as Listed;
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    // A: MoSCoW last (0), WSJF first (1) → 50, and the methods split on it.
    expect(by.a).toMatchObject({ consensus: 50, coverage: 2, disagree: true });
    // B: MoSCoW 1.5 of 3 → 0.75, WSJF 2nd → 0.5 → 62.5.
    expect(by.b).toMatchObject({ consensus: 62.5, coverage: 2, disagree: false });
    expect(by.d).toMatchObject({ consensus: null, coverage: 0, disagree: false });
    // The same numbers decide_order reports.
    const d = (await registry.get("tool.prioritizer.decide_order")!.handler({}, ctx())) as {
      consensus: { id: string; borda: number | null; disagree: boolean }[];
    };
    for (const c of d.consensus) {
      expect(by[c.id].consensus).toBe(c.borda);
      expect(by[c.id].disagree).toBe(c.disagree);
    }
  });
});
