/**
 * tool.weighted_decision.* action coverage.
 *
 * Adapts the squad-13 calc-tool canonical pattern (see tool-wsjf.test.ts /
 * tool-cost-of-delay.test.ts) for a CRUD-backed compute tool whose
 * storage diverges from the prioritization-table convention:
 *
 *   - Storage shape:   WeightedOption {id, name, scores}
 *                      (NOT PrioritizationItem; the Pugh/MCDA backing
 *                      collection is workspace.weighted_option)
 *   - Score semantics: rubric-dependent (criteriaWeights are per-call,
 *                      not per-row). Persisted rows hold raw scores
 *                      only; totals come from compute_option_score
 *                      or compute_and_rank at read time.
 *
 * Five assertion buckets mirror the canonical pattern, retuned for the
 * compute_option_score / compute_and_rank / list_options / persist
 * surface:
 *   - registration  : all 5 actions present, categories correct, write
 *                     actions carry mcpHandlers.
 *   - compute_option_score : matches `weightedScore(scores, weights)`
 *                            from the shared rubric helper.
 *   - compute_and_rank : dense rank — ties share rank.
 *   - list_options  : reads workspace.weighted_options; ranked output
 *                     when criteriaWeights supplied, raw otherwise.
 *   - score_and_persist_option : single write roundtrip; stores raw
 *                                scores without computing a total.
 *   - persist_options : bulk write returns ids in order.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { weightedScore } from "@/lib/analytics/scoring-rubric";
import type { WeightedOption } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/weighted-decision";

const EXPECTED_ACTIONS = [
  "tool.weighted_decision.compute_option_score",
  "tool.weighted_decision.compute_and_rank",
  "tool.weighted_decision.list_options",
  "tool.weighted_decision.score_and_persist_option",
  "tool.weighted_decision.persist_options",
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

describe("tool.weighted_decision — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("compute + list actions are category=read; persist actions are category=write", () => {
    expect(registry.get("tool.weighted_decision.compute_option_score")?.category).toBe("read");
    expect(registry.get("tool.weighted_decision.compute_and_rank")?.category).toBe("read");
    expect(registry.get("tool.weighted_decision.list_options")?.category).toBe("read");
    expect(registry.get("tool.weighted_decision.score_and_persist_option")?.category).toBe("write");
    expect(registry.get("tool.weighted_decision.persist_options")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.weighted_decision.score_and_persist_option")?.mcpHandler).toBeTypeOf(
      "function"
    );
    expect(registry.get("tool.weighted_decision.persist_options")?.mcpHandler).toBeTypeOf(
      "function"
    );
  });

  it("list_options also has an mcpHandler (reads from server-store on MCP)", () => {
    // list_options is read-only but its server backing must hit
    // Supabase, not the empty browser singleton — verify wiring.
    expect(registry.get("tool.weighted_decision.list_options")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.weighted_decision.compute_option_score — pure formula", () => {
  it("matches weightedScore(optionScores, criteriaWeights) exactly", async () => {
    const action = registry.get("tool.weighted_decision.compute_option_score");
    const optionScores = { cost: 8, speed: 6, quality: 9 };
    const criteriaWeights = { cost: 0.5, speed: 0.3, quality: 0.2 };
    const result = (await action!.handler({ optionScores, criteriaWeights }, ctx())) as {
      score: number;
    };
    // 8*0.5 + 6*0.3 + 9*0.2 = 4 + 1.8 + 1.8 = 7.6
    expect(result.score).toBeCloseTo(7.6, 10);
    expect(result.score).toBe(weightedScore(optionScores, criteriaWeights));
  });

  it("missing criteria in scores contribute 0 (rubric drives the sum, not the option)", async () => {
    const action = registry.get("tool.weighted_decision.compute_option_score");
    const result = (await action!.handler(
      {
        // Score only one of two weighted criteria.
        optionScores: { cost: 10 },
        criteriaWeights: { cost: 0.6, speed: 0.4 },
      },
      ctx()
    )) as { score: number };
    // 10*0.6 + 0*0.4 = 6.0 — the missing `speed` score is treated as 0,
    // not as "skip this criterion". Pugh matrices conventionally treat
    // an un-entered cell as not-yet-evaluated, so the agent should see
    // a lower score, not a misleadingly high partial-rubric total.
    expect(result.score).toBeCloseTo(6, 10);
  });

  it("scores keyed by criteria not in the weights map are ignored", async () => {
    // The rubric (weights) defines what counts. Extra scores keyed by
    // unknown criterion ids are silently dropped — they wouldn't have a
    // weight to multiply by anyway. This matches the in-app behaviour
    // where removing a criterion cascades to dropping its score from
    // every option (see weighted-decision-client.tsx:51-63).
    const action = registry.get("tool.weighted_decision.compute_option_score");
    const result = (await action!.handler(
      {
        optionScores: { cost: 8, speed: 6, deprecated_dimension: 999 },
        criteriaWeights: { cost: 0.5, speed: 0.5 },
      },
      ctx()
    )) as { score: number };
    // 8*0.5 + 6*0.5 = 7 (deprecated_dimension contributes nothing)
    expect(result.score).toBeCloseTo(7, 10);
  });
});

describe("tool.weighted_decision.compute_and_rank — batch + dense rank", () => {
  it("ranks options descending with dense rank on ties", async () => {
    const action = registry.get("tool.weighted_decision.compute_and_rank");
    const weights = { cost: 0.5, speed: 0.5 };
    const result = (await action!.handler(
      {
        options: [
          // 10*0.5 + 10*0.5 = 10 (tie with B)
          { id: "a", name: "Alpha", scores: { cost: 10, speed: 10 } },
          // 10*0.5 + 10*0.5 = 10 (tie with A → rank 1)
          { id: "b", name: "Bravo", scores: { cost: 10, speed: 10 } },
          // 5*0.5 + 5*0.5 = 5
          { id: "c", name: "Charlie", scores: { cost: 5, speed: 5 } },
        ],
        criteriaWeights: weights,
      },
      ctx()
    )) as {
      ranked: Array<{
        id: string;
        name: string;
        scores: Record<string, number>;
        score: number;
        rank: number;
      }>;
      count: number;
    };

    expect(result.count).toBe(3);
    const byId = new Map(result.ranked.map((r) => [r.id, r]));
    expect(byId.get("a")!.rank).toBe(1);
    expect(byId.get("b")!.rank).toBe(1); // dense rank: ties share
    expect(byId.get("c")!.rank).toBe(2);
    expect(byId.get("a")!.score).toBe(10);
    expect(byId.get("c")!.score).toBe(5);
    // The agent surface MUST preserve `name` (canonical WeightedOption
    // label). The internal rank() helper expects `title`; we re-key on
    // the way out — guard against a regression where `name` is silently
    // renamed to `title` and the agent loses its handle on the option.
    expect(byId.get("a")!.name).toBe("Alpha");
    expect(byId.get("b")!.name).toBe("Bravo");
    expect(byId.get("c")!.name).toBe("Charlie");
  });

  it("auto-generates an id for options without one", async () => {
    const action = registry.get("tool.weighted_decision.compute_and_rank");
    const result = (await action!.handler(
      {
        options: [{ name: "No-id option", scores: { x: 1 } }],
        criteriaWeights: { x: 1 },
      },
      ctx()
    )) as { ranked: Array<{ id: string }> };
    expect(result.ranked[0].id).toMatch(/^weightedOpt_/);
  });
});

describe("tool.weighted_decision.list_options — workspace read", () => {
  beforeEach(() => {
    // Reset the slice so prior tests don't bleed in.
    useWorkspaceStore.setState({ weightedOptions: [] });
  });

  it("returns [] with ranked=false when the workspace is empty", async () => {
    const action = registry.get("tool.weighted_decision.list_options");
    const result = (await action!.handler({}, ctx())) as {
      options: unknown[];
      count: number;
      ranked: boolean;
    };
    expect(result.count).toBe(0);
    expect(result.options).toEqual([]);
    expect(result.ranked).toBe(false);
  });

  it("returns raw options (no score) when criteriaWeights are omitted", async () => {
    const seeds: WeightedOption[] = [
      { id: "o1", name: "Option 1", scores: { cost: 8, speed: 6 } },
      { id: "o2", name: "Option 2", scores: { cost: 3, speed: 9 } },
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertWeightedOption(s);

    const action = registry.get("tool.weighted_decision.list_options");
    const result = (await action!.handler({}, ctx())) as {
      options: WeightedOption[];
      count: number;
      ranked: boolean;
    };
    expect(result.count).toBe(2);
    expect(result.ranked).toBe(false);
    // Raw shape: no `score` / `rank` injected; preserves the storage
    // format so callers can decide whether to score at all.
    const ids = result.options.map((o) => o.id).sort();
    expect(ids).toEqual(["o1", "o2"]);
    expect((result.options[0] as unknown as { score?: number }).score).toBeUndefined();
  });

  it("returns ranked, scored options when criteriaWeights are supplied", async () => {
    const seeds: WeightedOption[] = [
      // 8*0.5 + 6*0.5 = 7
      { id: "o1", name: "Cost-heavy", scores: { cost: 8, speed: 6 } },
      // 3*0.5 + 9*0.5 = 6
      { id: "o2", name: "Speed-heavy", scores: { cost: 3, speed: 9 } },
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertWeightedOption(s);

    const action = registry.get("tool.weighted_decision.list_options");
    const result = (await action!.handler(
      { criteriaWeights: { cost: 0.5, speed: 0.5 } },
      ctx()
    )) as {
      options: Array<{ id: string; name: string; score: number; rank: number }>;
      count: number;
      ranked: boolean;
    };
    expect(result.count).toBe(2);
    expect(result.ranked).toBe(true);
    // Order is rank-descending; o1 (score 7) tops o2 (score 6).
    expect(result.options[0].id).toBe("o1");
    expect(result.options[0].score).toBeCloseTo(7, 10);
    expect(result.options[0].rank).toBe(1);
    expect(result.options[1].id).toBe("o2");
    expect(result.options[1].score).toBeCloseTo(6, 10);
    expect(result.options[1].rank).toBe(2);
  });
});

describe("tool.weighted_decision.score_and_persist_option — single-write roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ weightedOptions: [] });
  });

  it("stores the option with raw scores and no derived total", async () => {
    const action = registry.get("tool.weighted_decision.score_and_persist_option");
    const result = (await action!.handler(
      { name: "Vendor A", scores: { cost: 8, speed: 6, quality: 9 } },
      ctx()
    )) as { id: string };

    expect(result.id).toMatch(/^weightedOpt_/);
    const stored = useWorkspaceStore.getState().weightedOptions;
    expect(stored).toHaveLength(1);
    expect(stored![0].name).toBe("Vendor A");
    expect(stored![0].scores).toEqual({ cost: 8, speed: 6, quality: 9 });
    // No score / weights persisted with the option — that's the whole
    // design point (see file header for why).
    expect((stored![0] as unknown as { score?: number }).score).toBeUndefined();
    expect((stored![0] as unknown as { weights?: unknown }).weights).toBeUndefined();
  });

  it("uses the supplied id when provided", async () => {
    const action = registry.get("tool.weighted_decision.score_and_persist_option");
    const result = (await action!.handler(
      { id: "explicit-id", name: "X", scores: { a: 1 } },
      ctx()
    )) as { id: string };
    expect(result.id).toBe("explicit-id");
    const stored = useWorkspaceStore.getState().weightedOptions;
    expect(stored![0].id).toBe("explicit-id");
  });

  it("upserts (overwrites) when called twice with the same id", async () => {
    const action = registry.get("tool.weighted_decision.score_and_persist_option");
    await action!.handler({ id: "same", name: "First", scores: { a: 1 } }, ctx());
    await action!.handler({ id: "same", name: "Updated", scores: { a: 2, b: 3 } }, ctx());
    const stored = useWorkspaceStore.getState().weightedOptions;
    expect(stored).toHaveLength(1);
    expect(stored![0].name).toBe("Updated");
    expect(stored![0].scores).toEqual({ a: 2, b: 3 });
  });
});

describe("tool.weighted_decision.persist_options — bulk write", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ weightedOptions: [] });
  });

  it("writes N options in one call and returns their ids", async () => {
    const action = registry.get("tool.weighted_decision.persist_options");
    const result = (await action!.handler(
      {
        options: [
          { id: "v1", name: "Vendor 1", scores: { cost: 8, speed: 6 } },
          { name: "Vendor 2 (auto-id)", scores: { cost: 5, speed: 9 } },
          { id: "v3", name: "Vendor 3", scores: { cost: 9, speed: 4 } },
        ],
      },
      ctx()
    )) as { written: string[]; count: number };

    expect(result.count).toBe(3);
    expect(result.written[0]).toBe("v1");
    expect(result.written[1]).toMatch(/^weightedOpt_/);
    expect(result.written[2]).toBe("v3");
    expect(useWorkspaceStore.getState().weightedOptions).toHaveLength(3);
  });

  it("does NOT clear the existing collection — only the payload's items are touched", async () => {
    // Seed an unrelated option that should survive the bulk write.
    useWorkspaceStore.getState().upsertWeightedOption({
      id: "existing",
      name: "Existing",
      scores: { x: 1 },
    });
    const action = registry.get("tool.weighted_decision.persist_options");
    await action!.handler({ options: [{ id: "new", name: "New", scores: { y: 2 } }] }, ctx());
    const stored = useWorkspaceStore.getState().weightedOptions!;
    expect(stored).toHaveLength(2);
    expect(stored.map((o) => o.id).sort()).toEqual(["existing", "new"]);
  });
});
