/**
 * tool.cost_of_delay.* action coverage.
 *
 * Mirrors test/actions/tool-wsjf.test.ts — the squad-13 canonical test
 * pattern for calculator tools. Same five assertion buckets:
 *   - registration  : all 5 actions are present, categories correct,
 *                     write actions have mcpHandlers.
 *   - compute_cd3   : pure formula matches the inlined helper exactly
 *                     and floors jobSize at 0.5 (defuses user-entered 0).
 *   - compute_and_rank : dense rank — ties share rank.
 *   - list_scored   : framework filter excludes other prioritization
 *                     frameworks (e.g. WSJF noise).
 *   - score_and_persist : roundtrip — compute, write, read back.
 *   - persist_to_prioritization : bulk write returns ids in order.
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
import "@/lib/actions/tools/cost-of-delay";

const EXPECTED_ACTIONS = [
  "tool.cost_of_delay.compute_cd3",
  "tool.cost_of_delay.compute_and_rank",
  "tool.cost_of_delay.list_scored",
  "tool.cost_of_delay.score_and_persist",
  "tool.cost_of_delay.persist_to_prioritization",
] as const;

function ctx() {
  // Lightweight context for handler tests. Browser-path handlers don't
  // touch ctx.userId at all, but we supply a value so the type is happy.
  return {
    userId: "test-user",
    source: "agent" as const,
    squadProfileIds: [] as string[],
  };
}

describe("tool.cost_of_delay — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("compute actions are category=read; persist actions are category=write", () => {
    expect(registry.get("tool.cost_of_delay.compute_cd3")?.category).toBe("read");
    expect(registry.get("tool.cost_of_delay.compute_and_rank")?.category).toBe("read");
    expect(registry.get("tool.cost_of_delay.list_scored")?.category).toBe("read");
    expect(registry.get("tool.cost_of_delay.score_and_persist")?.category).toBe("write");
    expect(registry.get("tool.cost_of_delay.persist_to_prioritization")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.cost_of_delay.score_and_persist")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.cost_of_delay.persist_to_prioritization")?.mcpHandler).toBeTypeOf(
      "function"
    );
  });
});

describe("tool.cost_of_delay.compute_cd3 — pure formula", () => {
  it("computes (perWeekUsd * weeksDelayed) / jobSize", async () => {
    const action = registry.get("tool.cost_of_delay.compute_cd3");
    const result = (await action!.handler(
      { perWeekUsd: 10000, weeksDelayed: 4, jobSize: 8 },
      ctx()
    )) as { score: number; costOfDelay: number };
    // (10000 * 4) / 8 = 5000
    expect(result.score).toBe(5000);
    expect(result.costOfDelay).toBe(40000);
  });

  it("defaults jobSize to 1 (raw cost-of-delay) when omitted", async () => {
    const action = registry.get("tool.cost_of_delay.compute_cd3");
    const result = (await action!.handler({ perWeekUsd: 2500, weeksDelayed: 6 }, ctx())) as {
      score: number;
    };
    // (2500 * 6) / 1 = 15000
    expect(result.score).toBe(15000);
  });

  it("floors jobSize at 0.5 (defuses user-entered 0)", async () => {
    const action = registry.get("tool.cost_of_delay.compute_cd3");
    const result = (await action!.handler(
      { perWeekUsd: 1000, weeksDelayed: 2, jobSize: 0 },
      ctx()
    )) as { score: number };
    // (1000 * 2) / 0.5 = 4000 (NOT Infinity)
    expect(result.score).toBe(4000);
    expect(Number.isFinite(result.score)).toBe(true);
  });
});

describe("tool.cost_of_delay.compute_and_rank — batch + dense rank", () => {
  it("ranks items descending with dense rank on ties", async () => {
    const action = registry.get("tool.cost_of_delay.compute_and_rank");
    const result = (await action!.handler(
      {
        items: [
          // (10000 * 4) / 8 = 5000
          { id: "a", title: "A", fields: { perWeekUsd: 10000, weeksDelayed: 4, jobSize: 8 } },
          // (10000 * 4) / 8 = 5000 — tie with A → rank 1
          { id: "b", title: "B", fields: { perWeekUsd: 10000, weeksDelayed: 4, jobSize: 8 } },
          // (1000 * 2) / 4 = 500
          { id: "c", title: "C", fields: { perWeekUsd: 1000, weeksDelayed: 2, jobSize: 4 } },
        ],
      },
      ctx()
    )) as {
      ranked: Array<{ id: string; rank: number; score: number }>;
      count: number;
    };

    expect(result.count).toBe(3);
    const byId = new Map(result.ranked.map((r) => [r.id, r]));
    expect(byId.get("a")!.rank).toBe(1);
    expect(byId.get("b")!.rank).toBe(1); // dense rank: ties share
    expect(byId.get("c")!.rank).toBe(2);
    expect(byId.get("a")!.score).toBe(5000);
    expect(byId.get("c")!.score).toBe(500);
  });
});

describe("tool.cost_of_delay.list_scored — framework filter + roundtrip", () => {
  beforeEach(() => {
    // Reset the prioritization slice so prior tests don't bleed in.
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("returns [] when the workspace is empty", async () => {
    const action = registry.get("tool.cost_of_delay.list_scored");
    const result = (await action!.handler({}, ctx())) as { items: unknown[]; count: number };
    expect(result.count).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("filters out non-cost-of-delay framework items", async () => {
    const seeds: PrioritizationItem[] = [
      {
        id: "p1",
        framework: "cost-of-delay",
        title: "Migrate billing",
        score: 5000,
        fields: { perWeekUsd: 10000, weeksDelayed: 4, jobSize: 8, totalCost: 40000 },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p2",
        framework: "wsjf",
        title: "WSJF noise",
        score: 4,
        fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertPrioritization(s);

    const action = registry.get("tool.cost_of_delay.list_scored");
    const result = (await action!.handler({}, ctx())) as {
      items: Array<{ id: string; title: string }>;
      count: number;
    };
    expect(result.count).toBe(1);
    expect(result.items[0].id).toBe("p1");
    expect(result.items[0].title).toBe("Migrate billing");
  });
});

describe("tool.cost_of_delay.score_and_persist — compute + write roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("computes the score and stores the item with framework='cost-of-delay'", async () => {
    const action = registry.get("tool.cost_of_delay.score_and_persist");
    const result = (await action!.handler(
      {
        title: "Migrate billing platform",
        fields: { perWeekUsd: 10000, weeksDelayed: 4, jobSize: 8 },
      },
      ctx()
    )) as { id: string; score: number };

    expect(result.score).toBe(5000);
    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    expect(stored![0].framework).toBe("cost-of-delay");
    expect(stored![0].title).toBe("Migrate billing platform");
    expect(stored![0].score).toBe(5000);
    // The form-compatibility totalCost field is preserved so rows added
    // via the agent surface render identically in the existing UI table.
    expect(stored![0].fields?.totalCost).toBe(40000);
  });

  it("uses the supplied id when provided", async () => {
    const action = registry.get("tool.cost_of_delay.score_and_persist");
    const result = (await action!.handler(
      {
        id: "explicit-id",
        title: "X",
        fields: { perWeekUsd: 100, weeksDelayed: 1, jobSize: 1 },
      },
      ctx()
    )) as { id: string };
    expect(result.id).toBe("explicit-id");
  });
});

describe("tool.cost_of_delay.persist_to_prioritization — bulk write", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("writes N items in one call and returns their ids", async () => {
    const action = registry.get("tool.cost_of_delay.persist_to_prioritization");
    const result = (await action!.handler(
      {
        items: [
          {
            id: "i1",
            title: "Initiative 1",
            score: 5000,
            fields: { perWeekUsd: 10000, weeksDelayed: 4, jobSize: 8 },
          },
          {
            title: "Initiative 2 (auto-id)",
            score: 500,
            fields: { perWeekUsd: 1000, weeksDelayed: 2, jobSize: 4 },
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
