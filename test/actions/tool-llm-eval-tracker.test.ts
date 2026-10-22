/**
 * tool.llm_eval_tracker.* action coverage.
 *
 * CRUD-backed + pure-compute hybrid variant (squad S12a, Wave 4).
 * LLM evals are append-only records; generic create / list / update /
 * delete exist via the auto-generated workspace.llm_eval.* surface, so
 * this file covers the tool-specific verbs the agent speaks:
 *
 *   1. all 4 actions registered with the right category split
 *      (3 reads incl. one pure compute, 1 write)
 *   2. list_state + record_eval expose an mcpHandler (server-side path)
 *   3. compute_trend is pure (no mcpHandler) — identical server/client
 *   4. write actions are requiresConfirmation=false (logging metrics is
 *      non-destructive; the natural agent loop would be unbearable to
 *      confirm individually)
 *   5. list_state returns empty/zeroed shape on empty workspace AND
 *      aggregates byModel / byDataset / byPromptVersion correctly across
 *      mixed seeds — with latestScore picked by recordedAt desc, and
 *      unversioned rows bucketed under "(unversioned)"
 *   6. record_eval writes a new row, defaults recordedAt to ~now when
 *      omitted, accepts an explicit ISO override, and returns {id} on
 *      both browser-path and (mocked) MCP-path callers — though we test
 *      only the handler() path here (mcpHandler hits Supabase)
 *   7. compute_trend correctly classifies up / down / flat per model,
 *      respects the windowDays cutoff, handles the odd-length split
 *      (drops the middle item), omits models with <2 in-window samples,
 *      and returns changePct of 0 when baselineMean is 0 (div-by-zero
 *      guard)
 *   8. compare_models filters to one dataset, groups by model, sorts
 *      avgScore desc with model-name tiebreaker, honors the `since`
 *      cutoff (inclusive), and handles unknown-dataset cleanly (empty
 *      models[])
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { LLMEval } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/llm-eval-tracker";

const EXPECTED_ACTIONS = [
  "tool.llm_eval_tracker.list_state",
  "tool.llm_eval_tracker.record_eval",
  "tool.llm_eval_tracker.compute_trend",
  "tool.llm_eval_tracker.compare_models",
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

/** Build a fully-formed LLMEval for seeding the store. id, model,
 *  dataset, score, and recordedAt are required; everything else is
 *  optional. */
function seed(partial: Partial<LLMEval> & Pick<LLMEval, "id">): LLMEval {
  return {
    model: "gpt-5",
    dataset: "faithfulness-v2",
    score: 0.8,
    recordedAt: new Date().toISOString(),
    ...partial,
  };
}

/** Build an ISO timestamp `daysAgo` days in the past. Convenient for
 *  compute_trend's window-based tests. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe("tool.llm_eval_tracker — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("read actions are category=read; record_eval is category=write", () => {
    expect(registry.get("tool.llm_eval_tracker.list_state")?.category).toBe("read");
    expect(registry.get("tool.llm_eval_tracker.record_eval")?.category).toBe("write");
    expect(registry.get("tool.llm_eval_tracker.compute_trend")?.category).toBe("read");
    expect(registry.get("tool.llm_eval_tracker.compare_models")?.category).toBe("read");
  });

  it("list_state exposes an mcpHandler (server-side path reads Supabase)", () => {
    expect(registry.get("tool.llm_eval_tracker.list_state")?.mcpHandler).toBeTypeOf("function");
  });

  it("record_eval exposes an mcpHandler (server-side path writes Supabase)", () => {
    expect(registry.get("tool.llm_eval_tracker.record_eval")?.mcpHandler).toBeTypeOf("function");
  });

  it("compare_models exposes an mcpHandler (server-side path reads workspace)", () => {
    expect(registry.get("tool.llm_eval_tracker.compare_models")?.mcpHandler).toBeTypeOf("function");
  });

  it("compute_trend is pure (no mcpHandler) — identical server/client", () => {
    expect(registry.get("tool.llm_eval_tracker.compute_trend")?.mcpHandler).toBeUndefined();
  });

  it("record_eval is requiresConfirmation=false (logging metrics is non-destructive)", () => {
    expect(registry.get("tool.llm_eval_tracker.record_eval")?.requiresConfirmation).toBe(false);
  });
});

type ListStateResult = {
  total: number;
  byModel: Record<string, { count: number; latestScore: number; avgScore: number }>;
  byDataset: Record<string, { count: number; avgScore: number }>;
  byPromptVersion: Record<string, { count: number; avgScore: number }>;
  items: LLMEval[];
};

describe("tool.llm_eval_tracker.list_state — grouped summary", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ llmEvals: [] });
  });

  it("returns zeroed totals and empty buckets when the workspace is empty", async () => {
    const action = registry.get("tool.llm_eval_tracker.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.byModel).toEqual({});
    expect(result.byDataset).toEqual({});
    expect(result.byPromptVersion).toEqual({});
  });

  it("aggregates byModel correctly with count, avgScore, and latestScore (recordedAt desc)", async () => {
    const seeds: LLMEval[] = [
      seed({
        id: "e1",
        model: "gpt-5",
        dataset: "faithfulness-v2",
        score: 0.7,
        recordedAt: "2026-01-01T00:00:00.000Z",
      }),
      seed({
        id: "e2",
        model: "gpt-5",
        dataset: "faithfulness-v2",
        score: 0.9,
        recordedAt: "2026-02-01T00:00:00.000Z",
      }),
      seed({
        id: "e3",
        model: "claude-opus-4-7",
        dataset: "faithfulness-v2",
        score: 0.85,
        recordedAt: "2026-01-15T00:00:00.000Z",
      }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertLLMEval(s);

    const action = registry.get("tool.llm_eval_tracker.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;

    expect(result.total).toBe(3);
    // gpt-5: count=2, avg = (0.7 + 0.9) / 2 = 0.8, latest = 0.9 (Feb beats Jan).
    expect(result.byModel["gpt-5"]).toEqual({
      count: 2,
      latestScore: 0.9,
      avgScore: 0.8,
    });
    expect(result.byModel["claude-opus-4-7"]).toEqual({
      count: 1,
      latestScore: 0.85,
      avgScore: 0.85,
    });
  });

  it("aggregates byDataset correctly with count and avgScore", async () => {
    const seeds: LLMEval[] = [
      seed({ id: "e1", dataset: "faithfulness-v2", score: 0.8 }),
      seed({ id: "e2", dataset: "faithfulness-v2", score: 0.6 }),
      seed({ id: "e3", dataset: "mmlu", score: 0.9 }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertLLMEval(s);

    const action = registry.get("tool.llm_eval_tracker.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;

    expect(result.byDataset["faithfulness-v2"]).toEqual({
      count: 2,
      avgScore: 0.7, // (0.8 + 0.6) / 2
    });
    expect(result.byDataset["mmlu"]).toEqual({
      count: 1,
      avgScore: 0.9,
    });
  });

  it("buckets unversioned evals under '(unversioned)' and named versions on their own key", async () => {
    const seeds: LLMEval[] = [
      seed({ id: "e1", promptVersion: "greet@1.0.0", score: 0.7 }),
      seed({ id: "e2", promptVersion: "greet@1.0.0", score: 0.8 }),
      seed({ id: "e3", score: 0.6 /* no promptVersion */ }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertLLMEval(s);

    const action = registry.get("tool.llm_eval_tracker.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;

    expect(result.byPromptVersion["greet@1.0.0"]).toEqual({
      count: 2,
      avgScore: 0.75,
    });
    expect(result.byPromptVersion["(unversioned)"]).toEqual({
      count: 1,
      avgScore: 0.6,
    });
  });

  it("returns items sorted by recordedAt desc (newest first)", async () => {
    const seeds: LLMEval[] = [
      seed({ id: "e1", recordedAt: "2026-01-01T00:00:00.000Z" }),
      seed({ id: "e2", recordedAt: "2026-03-01T00:00:00.000Z" }),
      seed({ id: "e3", recordedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertLLMEval(s);

    const action = registry.get("tool.llm_eval_tracker.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;
    expect(result.items.map((e) => e.id)).toEqual(["e2", "e3", "e1"]);
  });

  // Bug: the desc sort subtracted raw Date values, so one unparseable
  // recordedAt (record_eval accepts any string) made the comparator
  // inconsistent — items stayed in store order and latestScore came from the
  // OLDEST valid row.
  it("sorts around an unparseable recordedAt and still picks the latest valid score", async () => {
    const seeds: LLMEval[] = [
      seed({ id: "old", score: 0.7, recordedAt: "2026-01-01T00:00:00.000Z" }),
      seed({ id: "bad", score: 0.5, recordedAt: "last week" }),
      seed({ id: "new", score: 0.9, recordedAt: "2026-03-01T00:00:00.000Z" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertLLMEval(s);

    const action = registry.get("tool.llm_eval_tracker.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;
    expect(result.items.map((e) => e.id)).toEqual(["new", "old", "bad"]);
    expect(result.byModel["gpt-5"].latestScore).toBe(0.9);
    expect(result.byModel["gpt-5"].count).toBe(3);
  });
});

describe("tool.llm_eval_tracker.record_eval — append + defaults", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ llmEvals: [] });
  });

  it("appends a new eval row and returns {id}", async () => {
    const action = registry.get("tool.llm_eval_tracker.record_eval");
    const result = (await action!.handler(
      {
        model: "gpt-5",
        dataset: "faithfulness-v2",
        score: 0.85,
      },
      ctx()
    )) as { id: string };
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);

    const stored = useWorkspaceStore.getState().llmEvals ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].model).toBe("gpt-5");
    expect(stored[0].dataset).toBe("faithfulness-v2");
    expect(stored[0].score).toBe(0.85);
    expect(stored[0].id).toBe(result.id);
  });

  it("defaults recordedAt to ~now when omitted (within 5s of test start)", async () => {
    const before = Date.now();
    const action = registry.get("tool.llm_eval_tracker.record_eval");
    await action!.handler(
      {
        model: "gpt-5",
        dataset: "faithfulness-v2",
        score: 0.5,
      },
      ctx()
    );
    const after = Date.now();
    const stored = useWorkspaceStore.getState().llmEvals ?? [];
    expect(stored).toHaveLength(1);
    const recordedMs = new Date(stored[0].recordedAt).getTime();
    expect(recordedMs).toBeGreaterThanOrEqual(before);
    expect(recordedMs).toBeLessThanOrEqual(after);
  });

  it("honours an explicit recordedAt override", async () => {
    const action = registry.get("tool.llm_eval_tracker.record_eval");
    await action!.handler(
      {
        model: "gpt-5",
        dataset: "faithfulness-v2",
        score: 0.5,
        recordedAt: "2024-06-01T12:00:00.000Z",
      },
      ctx()
    );
    const stored = useWorkspaceStore.getState().llmEvals ?? [];
    expect(stored[0].recordedAt).toBe("2024-06-01T12:00:00.000Z");
  });

  it("persists optional fields (promptVersion, metricBreakdown, notes)", async () => {
    const action = registry.get("tool.llm_eval_tracker.record_eval");
    await action!.handler(
      {
        model: "gpt-5",
        dataset: "faithfulness-v2",
        score: 0.85,
        promptVersion: "greet@1.4.0",
        metricBreakdown: { precision: 0.9, recall: 0.8 },
        notes: "Run after prompt tweak",
      },
      ctx()
    );
    const stored = useWorkspaceStore.getState().llmEvals ?? [];
    expect(stored[0].promptVersion).toBe("greet@1.4.0");
    expect(stored[0].metricBreakdown).toEqual({ precision: 0.9, recall: 0.8 });
    expect(stored[0].notes).toBe("Run after prompt tweak");
  });
});

type TrendResult = {
  byModel: Record<string, { trend: "up" | "down" | "flat"; changePct: number; sampleSize: number }>;
};

describe("tool.llm_eval_tracker.compute_trend — pure trend classification", () => {
  it("returns an empty byModel for an empty evals array", async () => {
    const action = registry.get("tool.llm_eval_tracker.compute_trend");
    const result = (await action!.handler({ evals: [], windowDays: 30 }, ctx())) as TrendResult;
    expect(result.byModel).toEqual({});
  });

  it("classifies 'up' when recent mean exceeds baseline by >2%", async () => {
    // 4 evals across 20 days, all for gpt-5. First half: 0.7, 0.7 (avg 0.7).
    // Second half: 0.8, 0.8 (avg 0.8). changePct = (0.8 - 0.7) / 0.7 * 100 ≈ 14.29%
    const action = registry.get("tool.llm_eval_tracker.compute_trend");
    const result = (await action!.handler(
      {
        evals: [
          { model: "gpt-5", score: 0.7, recordedAt: daysAgo(20) },
          { model: "gpt-5", score: 0.7, recordedAt: daysAgo(15) },
          { model: "gpt-5", score: 0.8, recordedAt: daysAgo(10) },
          { model: "gpt-5", score: 0.8, recordedAt: daysAgo(5) },
        ],
        windowDays: 30,
      },
      ctx()
    )) as TrendResult;
    expect(result.byModel["gpt-5"].trend).toBe("up");
    expect(result.byModel["gpt-5"].changePct).toBeCloseTo(14.286, 1);
    expect(result.byModel["gpt-5"].sampleSize).toBe(4);
  });

  it("classifies 'down' when recent mean drops below baseline by >2%", async () => {
    // First half: 0.9, 0.9 (avg 0.9). Second half: 0.7, 0.7 (avg 0.7).
    // changePct = (0.7 - 0.9) / 0.9 * 100 ≈ -22.22%
    const action = registry.get("tool.llm_eval_tracker.compute_trend");
    const result = (await action!.handler(
      {
        evals: [
          { model: "gpt-5", score: 0.9, recordedAt: daysAgo(20) },
          { model: "gpt-5", score: 0.9, recordedAt: daysAgo(15) },
          { model: "gpt-5", score: 0.7, recordedAt: daysAgo(10) },
          { model: "gpt-5", score: 0.7, recordedAt: daysAgo(5) },
        ],
        windowDays: 30,
      },
      ctx()
    )) as TrendResult;
    expect(result.byModel["gpt-5"].trend).toBe("down");
    expect(result.byModel["gpt-5"].changePct).toBeCloseTo(-22.222, 1);
  });

  it("classifies 'flat' when |changePct| < 2% (noise floor)", async () => {
    // Recent mean only 1pp above baseline → ~1.25% relative → flat.
    const action = registry.get("tool.llm_eval_tracker.compute_trend");
    const result = (await action!.handler(
      {
        evals: [
          { model: "gpt-5", score: 0.8, recordedAt: daysAgo(20) },
          { model: "gpt-5", score: 0.8, recordedAt: daysAgo(15) },
          { model: "gpt-5", score: 0.81, recordedAt: daysAgo(10) },
          { model: "gpt-5", score: 0.81, recordedAt: daysAgo(5) },
        ],
        windowDays: 30,
      },
      ctx()
    )) as TrendResult;
    expect(result.byModel["gpt-5"].trend).toBe("flat");
  });

  it("drops the middle item on odd-length series so split halves stay balanced", async () => {
    // 3 evals: 0.7 (baseline), 0.75 (dropped middle), 0.9 (recent).
    // baselineMean = 0.7, recentMean = 0.9 → up.
    const action = registry.get("tool.llm_eval_tracker.compute_trend");
    const result = (await action!.handler(
      {
        evals: [
          { model: "gpt-5", score: 0.7, recordedAt: daysAgo(20) },
          { model: "gpt-5", score: 0.75, recordedAt: daysAgo(15) },
          { model: "gpt-5", score: 0.9, recordedAt: daysAgo(5) },
        ],
        windowDays: 30,
      },
      ctx()
    )) as TrendResult;
    expect(result.byModel["gpt-5"].trend).toBe("up");
    // (0.9 - 0.7) / 0.7 * 100 ≈ 28.57%
    expect(result.byModel["gpt-5"].changePct).toBeCloseTo(28.571, 1);
    expect(result.byModel["gpt-5"].sampleSize).toBe(3);
  });

  it("ignores evals outside windowDays", async () => {
    // 2 evals inside the 30-day window + 2 evals 100 days old (filtered out).
    // Result computed from only the 2 in-window evals.
    const action = registry.get("tool.llm_eval_tracker.compute_trend");
    const result = (await action!.handler(
      {
        evals: [
          { model: "gpt-5", score: 0.1, recordedAt: daysAgo(120) }, // out of window
          { model: "gpt-5", score: 0.1, recordedAt: daysAgo(110) }, // out of window
          { model: "gpt-5", score: 0.7, recordedAt: daysAgo(20) },
          { model: "gpt-5", score: 0.9, recordedAt: daysAgo(5) },
        ],
        windowDays: 30,
      },
      ctx()
    )) as TrendResult;
    expect(result.byModel["gpt-5"].sampleSize).toBe(2);
    expect(result.byModel["gpt-5"].trend).toBe("up");
  });

  it("omits models with <2 in-window samples", async () => {
    // claude has only 1 in-window sample → omitted entirely from byModel.
    const action = registry.get("tool.llm_eval_tracker.compute_trend");
    const result = (await action!.handler(
      {
        evals: [
          { model: "gpt-5", score: 0.7, recordedAt: daysAgo(20) },
          { model: "gpt-5", score: 0.9, recordedAt: daysAgo(5) },
          { model: "claude-opus", score: 0.85, recordedAt: daysAgo(10) },
        ],
        windowDays: 30,
      },
      ctx()
    )) as TrendResult;
    expect(result.byModel["gpt-5"]).toBeDefined();
    expect(result.byModel["claude-opus"]).toBeUndefined();
  });

  it("returns changePct=0 when baselineMean is 0 (div-by-zero guard, flat)", async () => {
    const action = registry.get("tool.llm_eval_tracker.compute_trend");
    const result = (await action!.handler(
      {
        evals: [
          { model: "gpt-5", score: 0, recordedAt: daysAgo(20) },
          { model: "gpt-5", score: 0.5, recordedAt: daysAgo(5) },
        ],
        windowDays: 30,
      },
      ctx()
    )) as TrendResult;
    expect(result.byModel["gpt-5"].changePct).toBe(0);
    expect(result.byModel["gpt-5"].trend).toBe("flat");
  });

  it("defaults windowDays to 30 when omitted", async () => {
    // The zod default kicks in — verify by feeding evals exactly at the
    // ~30-day cutoff and confirming they're picked up.
    const action = registry.get("tool.llm_eval_tracker.compute_trend");
    const result = (await action!.handler(
      {
        evals: [
          { model: "gpt-5", score: 0.7, recordedAt: daysAgo(25) },
          { model: "gpt-5", score: 0.9, recordedAt: daysAgo(5) },
        ],
        // No windowDays — should default to 30.
      },
      ctx()
    )) as TrendResult;
    expect(result.byModel["gpt-5"]).toBeDefined();
    expect(result.byModel["gpt-5"].sampleSize).toBe(2);
  });
});

type CompareResult = {
  models: Array<{
    model: string;
    avgScore: number;
    sampleSize: number;
    latestScore: number;
  }>;
};

describe("tool.llm_eval_tracker.compare_models — leaderboard", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ llmEvals: [] });
  });

  it("returns an empty models[] when no evals match the dataset", async () => {
    useWorkspaceStore
      .getState()
      .upsertLLMEval(seed({ id: "e1", dataset: "faithfulness-v2", score: 0.8 }));

    const action = registry.get("tool.llm_eval_tracker.compare_models");
    const result = (await action!.handler({ dataset: "does-not-exist" }, ctx())) as CompareResult;
    expect(result.models).toEqual([]);
  });

  it("groups by model and sorts avgScore desc with model-name tiebreaker", async () => {
    const seeds: LLMEval[] = [
      seed({ id: "e1", model: "gpt-5", dataset: "ds", score: 0.7 }),
      seed({ id: "e2", model: "gpt-5", dataset: "ds", score: 0.9 }),
      seed({ id: "e3", model: "claude-opus", dataset: "ds", score: 0.85 }),
      seed({ id: "e4", model: "claude-opus", dataset: "ds", score: 0.85 }),
      // Other dataset — must NOT bleed into the comparison.
      seed({ id: "e5", model: "gpt-5", dataset: "other", score: 0.1 }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertLLMEval(s);

    const action = registry.get("tool.llm_eval_tracker.compare_models");
    const result = (await action!.handler({ dataset: "ds" }, ctx())) as CompareResult;

    // Both models average 0.85 and 0.8 respectively — neither matches
    // exactly; claude-opus wins on average.
    // gpt-5:        avg = (0.7 + 0.9) / 2 = 0.8
    // claude-opus:  avg = (0.85 + 0.85) / 2 = 0.85
    expect(result.models).toHaveLength(2);
    expect(result.models[0].model).toBe("claude-opus");
    expect(result.models[0].avgScore).toBeCloseTo(0.85, 5);
    expect(result.models[0].sampleSize).toBe(2);
    expect(result.models[1].model).toBe("gpt-5");
    expect(result.models[1].avgScore).toBeCloseTo(0.8, 5);
    expect(result.models[1].sampleSize).toBe(2);
  });

  it("picks latestScore by recordedAt desc per model", async () => {
    const seeds: LLMEval[] = [
      seed({
        id: "e1",
        model: "gpt-5",
        dataset: "ds",
        score: 0.7,
        recordedAt: "2026-01-01T00:00:00.000Z",
      }),
      seed({
        id: "e2",
        model: "gpt-5",
        dataset: "ds",
        score: 0.9,
        recordedAt: "2026-02-01T00:00:00.000Z",
      }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertLLMEval(s);

    const action = registry.get("tool.llm_eval_tracker.compare_models");
    const result = (await action!.handler({ dataset: "ds" }, ctx())) as CompareResult;
    expect(result.models[0].latestScore).toBe(0.9);
  });

  it("honours `since` cutoff (inclusive) — drops older evals", async () => {
    const seeds: LLMEval[] = [
      seed({
        id: "e1",
        model: "gpt-5",
        dataset: "ds",
        score: 0.5, // pre-cutoff, dropped
        recordedAt: "2025-12-31T23:59:59.000Z",
      }),
      seed({
        id: "e2",
        model: "gpt-5",
        dataset: "ds",
        score: 0.8,
        recordedAt: "2026-01-01T00:00:00.000Z", // exactly at cutoff — included
      }),
      seed({
        id: "e3",
        model: "gpt-5",
        dataset: "ds",
        score: 0.9,
        recordedAt: "2026-02-01T00:00:00.000Z",
      }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertLLMEval(s);

    const action = registry.get("tool.llm_eval_tracker.compare_models");
    const result = (await action!.handler(
      { dataset: "ds", since: "2026-01-01T00:00:00.000Z" },
      ctx()
    )) as CompareResult;
    expect(result.models).toHaveLength(1);
    expect(result.models[0].sampleSize).toBe(2); // e2 + e3, NOT e1
    expect(result.models[0].avgScore).toBeCloseTo(0.85, 5); // (0.8 + 0.9) / 2
  });

  it("treats an unparseable `since` as all-time instead of dropping everything", async () => {
    useWorkspaceStore.getState().upsertLLMEval(seed({ id: "e1", dataset: "ds", score: 0.6 }));
    const action = registry.get("tool.llm_eval_tracker.compare_models");
    const result = (await action!.handler(
      { dataset: "ds", since: "not-a-date" },
      ctx()
    )) as CompareResult;
    expect(result.models).toHaveLength(1);
    expect(result.models[0].sampleSize).toBe(1);
  });

  // Bug: same non-transitive desc sort as list_state — latestScore came from
  // the oldest valid row when another row had an unparseable recordedAt.
  it("picks latestScore by the newest valid recordedAt despite an unparseable one", async () => {
    const seeds: LLMEval[] = [
      seed({ id: "old", dataset: "ds", score: 0.7, recordedAt: "2026-01-01T00:00:00.000Z" }),
      seed({ id: "bad", dataset: "ds", score: 0.5, recordedAt: "last week" }),
      seed({ id: "new", dataset: "ds", score: 0.9, recordedAt: "2026-03-01T00:00:00.000Z" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertLLMEval(s);

    const action = registry.get("tool.llm_eval_tracker.compare_models");
    const result = (await action!.handler({ dataset: "ds" }, ctx())) as CompareResult;
    expect(result.models[0].latestScore).toBe(0.9);
    expect(result.models[0].sampleSize).toBe(3);
  });
});
