/**
 * tool.rice_scoring.* action coverage.
 *
 * Copied from the canonical wsjf test pattern (squad-13 reference).
 * Mirrors the same assertions — registration, pure compute, batch rank,
 * framework-filtered list, persist roundtrip — with the only deltas
 * being the formula inputs (reach/impact/confidencePct/effort) and the
 * framework tag ("rice").
 *
 * The registry is a process-wide singleton; the side-effect import
 * registers the actions once and we don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/rice-scoring";

const EXPECTED_ACTIONS = [
  "tool.rice_scoring.compute_score",
  "tool.rice_scoring.compute_and_rank",
  "tool.rice_scoring.list_scored",
  "tool.rice_scoring.score_and_persist",
  "tool.rice_scoring.persist_to_prioritization",
] as const;

function ctx(userId: string = "test-user") {
  // Lightweight context for handler tests. Browser-path handlers don't
  // touch ctx.userId at all, but we supply a value so the type is happy.
  // NB: the canonical wsjf test's `Partial<Parameters<...>[0]>` helper
  // resolves to `Partial<string>` ≡ `{}`, which TS then refuses to
  // assign to the `userId: string` field. Simplified here while leaving
  // the wsjf reference untouched per squad-13 ground rules.
  return {
    userId,
    source: "agent" as const,
    squadProfileIds: [] as string[],
  };
}

describe("tool.rice_scoring — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("compute actions are category=read; persist actions are category=write", () => {
    expect(registry.get("tool.rice_scoring.compute_score")?.category).toBe("read");
    expect(registry.get("tool.rice_scoring.compute_and_rank")?.category).toBe("read");
    expect(registry.get("tool.rice_scoring.list_scored")?.category).toBe("read");
    expect(registry.get("tool.rice_scoring.score_and_persist")?.category).toBe("write");
    expect(registry.get("tool.rice_scoring.persist_to_prioritization")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.rice_scoring.score_and_persist")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.rice_scoring.persist_to_prioritization")?.mcpHandler).toBeTypeOf(
      "function"
    );
  });
});

describe("tool.rice_scoring.compute_score — pure formula", () => {
  it("matches the shared riceScore helper exactly", async () => {
    const action = registry.get("tool.rice_scoring.compute_score");
    const result = (await action!.handler(
      { reach: 100, impact: 2, confidencePct: 80, effort: 4 },
      ctx()
    )) as { score: number };
    // (100 * 2 * 0.8) / 4 = 40
    expect(result.score).toBe(40);
  });

  // Phase 7 decision: effort is at least 0.5 person-months. An effort of 0
  // is Not scored (it was floored to 0.5); a legacy value under 0.5 counts
  // as 0.5 and says so.
  it("scores an effort of 0 as Not scored, and under 0.5 as 0.5 with a warning", async () => {
    const action = registry.get("tool.rice_scoring.compute_score");
    const zero = (await action!.handler(
      { reach: 50, impact: 1, confidencePct: 50, effort: 0 },
      ctx()
    )) as { score: number | null; missing: string[] };
    expect(zero.score).toBeNull();
    expect(zero.missing).toEqual(["effort"]);
    const low = (await action!.handler(
      { reach: 50, impact: 1, confidencePct: 50, effort: 0.25 },
      ctx()
    )) as { score: number; warnings: string[] };
    // (50 * 1 * 0.5) / 0.5 = 50 (NOT 100)
    expect(low.score).toBe(50);
    expect(low.warnings).toHaveLength(1);
  });

  it("treats confidencePct as a 0-100 percentage (not a 0-1 fraction)", async () => {
    const action = registry.get("tool.rice_scoring.compute_score");
    // confidencePct=100 means full confidence → score = reach*impact/effort
    const full = (await action!.handler(
      { reach: 10, impact: 1, confidencePct: 100, effort: 1 },
      ctx()
    )) as { score: number };
    expect(full.score).toBe(10);
    // confidencePct=0 → score = 0
    const none = (await action!.handler(
      { reach: 10, impact: 1, confidencePct: 0, effort: 1 },
      ctx()
    )) as { score: number };
    expect(none.score).toBe(0);
  });
});

describe("tool.rice_scoring.compute_and_rank — batch + dense rank", () => {
  it("ranks items descending with dense rank on ties", async () => {
    const action = registry.get("tool.rice_scoring.compute_and_rank");
    const result = (await action!.handler(
      {
        items: [
          { id: "a", title: "A", fields: { reach: 100, impact: 2, confidencePct: 80, effort: 4 } }, // score 40
          { id: "b", title: "B", fields: { reach: 100, impact: 2, confidencePct: 80, effort: 4 } }, // tie with A → rank 1
          { id: "c", title: "C", fields: { reach: 10, impact: 1, confidencePct: 50, effort: 4 } }, // score 1.25
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

describe("tool.rice_scoring.list_scored — framework filter + roundtrip", () => {
  beforeEach(() => {
    // Reset the prioritization slice so prior tests don't bleed in.
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("returns [] when the workspace is empty", async () => {
    const action = registry.get("tool.rice_scoring.list_scored");
    const result = (await action!.handler({}, ctx())) as { items: unknown[]; count: number };
    expect(result.count).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("filters out non-rice framework items", async () => {
    const seeds: PrioritizationItem[] = [
      {
        id: "p1",
        framework: "rice",
        title: "RICE item",
        score: 40,
        fields: { reach: 100, impact: 2, confidencePct: 80, effort: 4 },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p2",
        framework: "wsjf",
        title: "WSJF noise",
        score: 4,
        fields: {},
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertPrioritization(s);

    const action = registry.get("tool.rice_scoring.list_scored");
    const result = (await action!.handler({}, ctx())) as {
      items: Array<{ id: string; title: string }>;
      count: number;
    };
    expect(result.count).toBe(1);
    expect(result.items[0].id).toBe("p1");
    expect(result.items[0].title).toBe("RICE item");
  });
});

describe("tool.rice_scoring.score_and_persist — compute + write roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("computes the score and stores the item with framework='rice'", async () => {
    const action = registry.get("tool.rice_scoring.score_and_persist");
    const result = (await action!.handler(
      {
        title: "Launch self-serve onboarding",
        fields: { reach: 100, impact: 2, confidencePct: 80, effort: 4 },
      },
      ctx()
    )) as { id: string; score: number };

    expect(result.score).toBe(40);
    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    expect(stored![0].framework).toBe("rice");
    expect(stored![0].title).toBe("Launch self-serve onboarding");
    expect(stored![0].score).toBe(40);
  });

  it("uses the supplied id when provided", async () => {
    const action = registry.get("tool.rice_scoring.score_and_persist");
    const result = (await action!.handler(
      {
        id: "explicit-id",
        title: "X",
        fields: { reach: 1, impact: 1, confidencePct: 100, effort: 1 },
      },
      ctx()
    )) as { id: string };
    expect(result.id).toBe("explicit-id");
  });
});

describe("tool.rice_scoring.persist_to_prioritization — bulk write", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("writes N items in one call and returns their ids", async () => {
    const action = registry.get("tool.rice_scoring.persist_to_prioritization");
    const result = (await action!.handler(
      {
        items: [
          {
            id: "i1",
            title: "Initiative 1",
            score: 40,
            fields: { reach: 100, impact: 2, confidencePct: 80, effort: 4 },
          },
          {
            title: "Initiative 2 (auto-id)",
            score: 10,
            fields: { reach: 50, impact: 1, confidencePct: 80, effort: 4 },
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
