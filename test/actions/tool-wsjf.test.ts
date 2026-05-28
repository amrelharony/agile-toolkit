/**
 * tool.wsjf.* action coverage.
 *
 * This file doubles as the squad-13 canonical test pattern for every
 * calculator tool (ICE, RICE, MoSCoW, Eisenhower, Kano, etc.). When a
 * squad member writes the next calc tool, they should:
 *   1. Copy this file → test/actions/tool-{their-tool}.test.ts
 *   2. Swap `wsjf` for their tool id, `wsjfScore` for their formula
 *   3. Keep the "registered" + "compute is pure" + "list filters by
 *      framework" + "persist roundtrips through workspace" assertions
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/wsjf";

const EXPECTED_ACTIONS = [
  "tool.wsjf.compute_score",
  "tool.wsjf.compute_and_rank",
  "tool.wsjf.list_scored",
  "tool.wsjf.score_and_persist",
  "tool.wsjf.persist_to_prioritization",
] as const;

function ctx() {
  // Lightweight context for handler tests. Browser-path handlers don't
  // touch ctx.userId at all, but we supply a value so the type is happy.
  // Tests needing different values can spread: { ...ctx(), userId: "u1" }.
  return {
    userId: "test-user",
    source: "agent" as const,
    squadProfileIds: [] as string[],
  };
}

describe("tool.wsjf — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("compute actions are category=read; persist actions are category=write", () => {
    expect(registry.get("tool.wsjf.compute_score")?.category).toBe("read");
    expect(registry.get("tool.wsjf.compute_and_rank")?.category).toBe("read");
    expect(registry.get("tool.wsjf.list_scored")?.category).toBe("read");
    expect(registry.get("tool.wsjf.score_and_persist")?.category).toBe("write");
    expect(registry.get("tool.wsjf.persist_to_prioritization")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.wsjf.score_and_persist")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.wsjf.persist_to_prioritization")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.wsjf.compute_score — pure formula", () => {
  it("matches the shared wsjfScore helper exactly", async () => {
    const action = registry.get("tool.wsjf.compute_score");
    const result = (await action!.handler(
      { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
      ctx()
    )) as { score: number };
    // (8 + 5 + 3) / 4 = 4
    expect(result.score).toBe(4);
  });

  it("floors jobSize at 0.5 (defuses user-entered 0)", async () => {
    const action = registry.get("tool.wsjf.compute_score");
    const result = (await action!.handler(
      { businessValue: 5, timeCriticality: 5, rrOe: 0, jobSize: 0 },
      ctx()
    )) as { score: number };
    // (5 + 5 + 0) / 0.5 = 20 (NOT Infinity)
    expect(result.score).toBe(20);
    expect(Number.isFinite(result.score)).toBe(true);
  });
});

describe("tool.wsjf.compute_and_rank — batch + dense rank", () => {
  it("ranks items descending with dense rank on ties", async () => {
    const action = registry.get("tool.wsjf.compute_and_rank");
    const result = (await action!.handler(
      {
        items: [
          {
            id: "a",
            title: "A",
            fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
          }, // score 4
          {
            id: "b",
            title: "B",
            fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
          }, // tie with A → rank 1
          {
            id: "c",
            title: "C",
            fields: { businessValue: 2, timeCriticality: 1, rrOe: 1, jobSize: 4 },
          }, // score 1
        ],
      },
      ctx()
    )) as { ranked: Array<{ id: string; rank: number; score: number }>; count: number };

    expect(result.count).toBe(3);
    const byId = new Map(result.ranked.map((r) => [r.id, r]));
    expect(byId.get("a")!.rank).toBe(1);
    expect(byId.get("b")!.rank).toBe(1); // dense rank: ties share
    expect(byId.get("c")!.rank).toBe(2);
  });
});

describe("tool.wsjf.list_scored — framework filter + roundtrip", () => {
  beforeEach(() => {
    // Reset the prioritization slice so prior tests don't bleed in.
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("returns [] when the workspace is empty", async () => {
    const action = registry.get("tool.wsjf.list_scored");
    const result = (await action!.handler({}, ctx())) as { items: unknown[]; count: number };
    expect(result.count).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("filters out non-wsjf framework items", async () => {
    const seeds: PrioritizationItem[] = [
      {
        id: "p1",
        framework: "wsjf",
        title: "WSJF item",
        score: 5,
        fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p2",
        framework: "rice",
        title: "RICE noise",
        score: 100,
        fields: {},
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertPrioritization(s);

    const action = registry.get("tool.wsjf.list_scored");
    const result = (await action!.handler({}, ctx())) as {
      items: Array<{ id: string; title: string }>;
      count: number;
    };
    expect(result.count).toBe(1);
    expect(result.items[0].id).toBe("p1");
    expect(result.items[0].title).toBe("WSJF item");
  });
});

describe("tool.wsjf.score_and_persist — compute + write roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("computes the score and stores the item with framework='wsjf'", async () => {
    const action = registry.get("tool.wsjf.score_and_persist");
    const result = (await action!.handler(
      {
        title: "Pay down auth tech debt",
        fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
      },
      ctx()
    )) as { id: string; score: number };

    expect(result.score).toBe(4);
    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    expect(stored![0].framework).toBe("wsjf");
    expect(stored![0].title).toBe("Pay down auth tech debt");
    expect(stored![0].score).toBe(4);
  });

  it("uses the supplied id when provided", async () => {
    const action = registry.get("tool.wsjf.score_and_persist");
    const result = (await action!.handler(
      {
        id: "explicit-id",
        title: "X",
        fields: { businessValue: 1, timeCriticality: 1, rrOe: 1, jobSize: 1 },
      },
      ctx()
    )) as { id: string };
    expect(result.id).toBe("explicit-id");
  });
});

describe("tool.wsjf.persist_to_prioritization — bulk write", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("writes N items in one call and returns their ids", async () => {
    const action = registry.get("tool.wsjf.persist_to_prioritization");
    const result = (await action!.handler(
      {
        items: [
          {
            id: "i1",
            title: "Feature 1",
            score: 4,
            fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
          },
          {
            title: "Feature 2 (auto-id)",
            score: 2,
            fields: { businessValue: 4, timeCriticality: 2, rrOe: 2, jobSize: 4 },
          },
        ],
      },
      ctx()
    )) as { written: string[]; count: number };

    expect(result.count).toBe(2);
    expect(result.written[0]).toBe("i1");
    expect(result.written[1]).toMatch(/^prio_/);
    expect(useWorkspaceStore.getState().prioritizations).toHaveLength(2);
  });
});
