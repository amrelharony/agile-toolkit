/**
 * tool.ice_score.* action coverage.
 *
 * Follows the squad-13 canonical test pattern from tool-wsjf.test.ts.
 * See that file for the rationale on registry-singleton imports and
 * the four-block structure (registration / pure compute / list filter /
 * persist roundtrip).
 *
 * Note the id namespace is `ice_score` (snake_case) not `ice-score`
 * (kebab) — see src/lib/actions/tools/ice-score.ts for why.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/ice-score";

const EXPECTED_ACTIONS = [
  "tool.ice_score.compute_score",
  "tool.ice_score.compute_and_rank",
  "tool.ice_score.list_scored",
  "tool.ice_score.score_and_persist",
  "tool.ice_score.persist_to_prioritization",
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

describe("tool.ice_score — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("compute actions are category=read; persist actions are category=write", () => {
    expect(registry.get("tool.ice_score.compute_score")?.category).toBe("read");
    expect(registry.get("tool.ice_score.compute_and_rank")?.category).toBe("read");
    expect(registry.get("tool.ice_score.list_scored")?.category).toBe("read");
    expect(registry.get("tool.ice_score.score_and_persist")?.category).toBe("write");
    expect(registry.get("tool.ice_score.persist_to_prioritization")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.ice_score.score_and_persist")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.ice_score.persist_to_prioritization")?.mcpHandler).toBeTypeOf(
      "function"
    );
  });
});

describe("tool.ice_score.compute_score — pure formula", () => {
  it("matches the shared iceScore helper exactly", async () => {
    const action = registry.get("tool.ice_score.compute_score");
    const result = (await action!.handler({ impact: 8, confidence: 5, ease: 3 }, ctx())) as {
      score: number;
    };
    // 8 * 5 * 3 = 120
    expect(result.score).toBe(120);
  });

  it("clamps each input into [1, 10] (defuses out-of-range user values)", async () => {
    const action = registry.get("tool.ice_score.compute_score");
    // Inputs outside [1,10] are clamped: 0 → 1, 100 → 10.
    // Schema would reject these before the handler runs, but the helper
    // is the second line of defence — assert that calling the handler
    // directly (bypassing the schema) still returns a finite, clamped score.
    const result = (await action!.handler({ impact: 100, confidence: 0, ease: 5 }, ctx())) as {
      score: number;
    };
    // 10 * 1 * 5 = 50
    expect(result.score).toBe(50);
    expect(Number.isFinite(result.score)).toBe(true);
  });
});

describe("tool.ice_score.compute_and_rank — batch + dense rank", () => {
  it("ranks items descending with dense rank on ties", async () => {
    const action = registry.get("tool.ice_score.compute_and_rank");
    const result = (await action!.handler(
      {
        items: [
          { id: "a", title: "A", fields: { impact: 8, confidence: 5, ease: 3 } }, // score 120
          { id: "b", title: "B", fields: { impact: 8, confidence: 5, ease: 3 } }, // tie with A → rank 1
          { id: "c", title: "C", fields: { impact: 2, confidence: 1, ease: 1 } }, // score 2
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

describe("tool.ice_score.list_scored — framework filter + roundtrip", () => {
  beforeEach(() => {
    // Reset the prioritization slice so prior tests don't bleed in.
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("returns [] when the workspace is empty", async () => {
    const action = registry.get("tool.ice_score.list_scored");
    const result = (await action!.handler({}, ctx())) as { items: unknown[]; count: number };
    expect(result.count).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("filters out non-ice framework items", async () => {
    const seeds: PrioritizationItem[] = [
      {
        id: "p1",
        framework: "ice",
        title: "ICE item",
        score: 120,
        fields: { impact: 8, confidence: 5, ease: 3 },
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

    const action = registry.get("tool.ice_score.list_scored");
    const result = (await action!.handler({}, ctx())) as {
      items: Array<{ id: string; title: string }>;
      count: number;
    };
    expect(result.count).toBe(1);
    expect(result.items[0].id).toBe("p1");
    expect(result.items[0].title).toBe("ICE item");
  });
});

describe("tool.ice_score.score_and_persist — compute + write roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("computes the score and stores the item with framework='ice'", async () => {
    const action = registry.get("tool.ice_score.score_and_persist");
    const result = (await action!.handler(
      {
        title: "Add inline AI suggestions",
        fields: { impact: 8, confidence: 5, ease: 3 },
      },
      ctx()
    )) as { id: string; score: number };

    expect(result.score).toBe(120);
    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    expect(stored![0].framework).toBe("ice");
    expect(stored![0].title).toBe("Add inline AI suggestions");
    expect(stored![0].score).toBe(120);
  });

  it("uses the supplied id when provided", async () => {
    const action = registry.get("tool.ice_score.score_and_persist");
    const result = (await action!.handler(
      {
        id: "explicit-id",
        title: "X",
        fields: { impact: 1, confidence: 1, ease: 1 },
      },
      ctx()
    )) as { id: string };
    expect(result.id).toBe("explicit-id");
  });
});

describe("tool.ice_score.persist_to_prioritization — bulk write", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("writes N items in one call and returns their ids", async () => {
    const action = registry.get("tool.ice_score.persist_to_prioritization");
    const result = (await action!.handler(
      {
        items: [
          {
            id: "i1",
            title: "Experiment 1",
            score: 120,
            fields: { impact: 8, confidence: 5, ease: 3 },
          },
          {
            title: "Experiment 2 (auto-id)",
            score: 30,
            fields: { impact: 5, confidence: 3, ease: 2 },
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
