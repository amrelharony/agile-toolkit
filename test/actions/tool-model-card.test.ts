/**
 * tool.model_card.* action coverage.
 *
 * CRUD-backed variant (squad S12a, Wave 4). Mirrors the prompt-registry
 * test pattern (single-production invariant), but the invariant lives on
 * the `vendor` field instead of `name` — the model registry's analogue
 * to "one production version per prompt name" is "one production model
 * per vendor".
 *
 * Coverage outline:
 *   1. all 5 actions registered with the right category split
 *   2. write actions expose an mcpHandler; compute_cost_estimate
 *      intentionally does NOT (pure function, no server-side state)
 *   3. requiresConfirmation defaults: promote_to_production stays
 *      confirmable (true); deprecate + record_eval opt out (false)
 *   4. list_state returns initialised byStatus + byVendor + items on
 *      empty AND aggregates correctly across mixed-vendor/status seeds,
 *      with status-then-name ordering
 *   5. compute_cost_estimate: pure math, missing rates treated as 0,
 *      validates non-negative tokens via schema
 *   6. promote_to_production:
 *        - sets target to production
 *        - auto-demotes a sibling production model from the same vendor
 *          to deprecated (single-production-per-vendor invariant — the
 *          load-bearing test)
 *        - does NOT touch production models of OTHER vendors
 *        - returns {promoted: false} for an unknown id
 *        - is a no-op for an already-production target (no self-demote)
 *   7. deprecate sets status, appends reason to notes (preserving prior
 *      notes), is idempotent on already-deprecated rows
 *   8. record_eval writes the score and returns {updated: false} for
 *      an unknown id; Zod rejects scores outside [0, 1]
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelEntry } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/model-card";

const EXPECTED_ACTIONS = [
  "tool.model_card.list_state",
  "tool.model_card.compute_cost_estimate",
  "tool.model_card.promote_to_production",
  "tool.model_card.deprecate",
  "tool.model_card.record_eval",
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

/** Build a fully-formed ModelEntry for seeding the store. id / name /
 *  vendor / status are required; everything else is optional. */
function seed(
  partial: Partial<ModelEntry> & Pick<ModelEntry, "id" | "name" | "vendor">
): ModelEntry {
  return {
    status: "experimental",
    ...partial,
  };
}

describe("tool.model_card — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("read actions are category=read; mutation actions are category=write", () => {
    expect(registry.get("tool.model_card.list_state")?.category).toBe("read");
    expect(registry.get("tool.model_card.compute_cost_estimate")?.category).toBe("read");
    expect(registry.get("tool.model_card.promote_to_production")?.category).toBe("write");
    expect(registry.get("tool.model_card.deprecate")?.category).toBe("write");
    expect(registry.get("tool.model_card.record_eval")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.model_card.promote_to_production")?.mcpHandler).toBeTypeOf(
      "function"
    );
    expect(registry.get("tool.model_card.deprecate")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.model_card.record_eval")?.mcpHandler).toBeTypeOf("function");
  });

  it("list_state exposes an mcpHandler; compute_cost_estimate intentionally does not (pure)", () => {
    expect(registry.get("tool.model_card.list_state")?.mcpHandler).toBeTypeOf("function");
    // compute_cost_estimate is a pure function — there's no server-side
    // state to consult. Omitting mcpHandler makes the dispatch layer
    // fall back to `handler`, which is the correct behaviour for a
    // pure computation.
    expect(registry.get("tool.model_card.compute_cost_estimate")?.mcpHandler).toBeUndefined();
  });

  it("requiresConfirmation defaults: promote stays confirmable; deprecate + record_eval opt out", () => {
    // `write` defaults to requiresConfirmation:true when unspecified, so
    // promote_to_production's value is `undefined` in the registered
    // action object — we assert it's NOT explicitly set to false (the
    // executor reads the default).
    expect(registry.get("tool.model_card.promote_to_production")?.requiresConfirmation).not.toBe(
      false
    );
    expect(registry.get("tool.model_card.deprecate")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.model_card.record_eval")?.requiresConfirmation).toBe(false);
  });
});

type ListStateResult = {
  totalCount: number;
  byStatus: Record<ModelEntry["status"], number>;
  byVendor: Record<string, number>;
  items: ModelEntry[];
};

describe("tool.model_card.list_state — rollup summary", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ models: [] });
  });

  it("returns zeroed buckets and empty items when the workspace is empty", async () => {
    const action = registry.get("tool.model_card.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;
    expect(result.totalCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.byVendor).toEqual({});
    // Every status bucket initialised — agent can read byStatus.production
    // without an existence check even on an empty workspace.
    expect(result.byStatus).toEqual({
      production: 0,
      evaluation: 0,
      experimental: 0,
      deprecated: 0,
    });
  });

  it("aggregates counts across statuses and vendors, and sorts items production-first then name", async () => {
    const seeds: ModelEntry[] = [
      seed({ id: "m1", name: "claude-3-haiku", vendor: "anthropic", status: "deprecated" }),
      seed({ id: "m2", name: "claude-3-sonnet", vendor: "anthropic", status: "production" }),
      seed({ id: "m3", name: "claude-3-opus", vendor: "anthropic", status: "evaluation" }),
      seed({ id: "m4", name: "gpt-4o", vendor: "openai", status: "production" }),
      seed({ id: "m5", name: "gpt-4o-mini", vendor: "openai", status: "experimental" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertModel(s);

    const action = registry.get("tool.model_card.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;

    expect(result.totalCount).toBe(5);
    expect(result.byStatus).toEqual({
      production: 2,
      evaluation: 1,
      experimental: 1,
      deprecated: 1,
    });
    expect(result.byVendor).toEqual({ anthropic: 3, openai: 2 });

    // Sort order: production first (alpha within), then evaluation,
    // experimental, deprecated. Within status, names sort alphabetically.
    // production (claude-3-sonnet, gpt-4o) →
    // evaluation (claude-3-opus) →
    // experimental (gpt-4o-mini) →
    // deprecated (claude-3-haiku)
    expect(result.items.map((m) => m.id)).toEqual(["m2", "m4", "m3", "m5", "m1"]);
  });
});

describe("tool.model_card.compute_cost_estimate — pure cost math", () => {
  it("multiplies tokens by per-1k rates correctly", async () => {
    const action = registry.get("tool.model_card.compute_cost_estimate");
    const result = (await action!.handler(
      {
        model: {
          name: "claude-sonnet",
          vendor: "anthropic",
          inputCostPer1k: 0.003, // $3 per million in
          outputCostPer1k: 0.015, // $15 per million out
        },
        inputTokens: 10_000,
        outputTokens: 2_000,
      },
      ctx()
    )) as {
      inputCostUsd: number;
      outputCostUsd: number;
      totalUsd: number;
      costPer1kInput: number;
      costPer1kOutput: number;
    };
    // 10_000 / 1000 * 0.003 = 0.03
    expect(result.inputCostUsd).toBeCloseTo(0.03, 10);
    // 2_000 / 1000 * 0.015 = 0.03
    expect(result.outputCostUsd).toBeCloseTo(0.03, 10);
    expect(result.totalUsd).toBeCloseTo(0.06, 10);
    expect(result.costPer1kInput).toBe(0.003);
    expect(result.costPer1kOutput).toBe(0.015);
  });

  it("treats missing per-1k rates as 0 (agent can detect via returned costPer1k* fields)", async () => {
    const action = registry.get("tool.model_card.compute_cost_estimate");
    const result = (await action!.handler(
      {
        model: { name: "uninitialised", vendor: "unknown" },
        inputTokens: 1000,
        outputTokens: 1000,
      },
      ctx()
    )) as {
      inputCostUsd: number;
      outputCostUsd: number;
      totalUsd: number;
      costPer1kInput: number;
      costPer1kOutput: number;
    };
    expect(result.inputCostUsd).toBe(0);
    expect(result.outputCostUsd).toBe(0);
    expect(result.totalUsd).toBe(0);
    // The 0/0 fields are the breadcrumb that pricing was uninitialised.
    expect(result.costPer1kInput).toBe(0);
    expect(result.costPer1kOutput).toBe(0);
  });

  it("returns 0 totals for zero token counts (no division surprises)", async () => {
    const action = registry.get("tool.model_card.compute_cost_estimate");
    const result = (await action!.handler(
      {
        model: { name: "x", vendor: "y", inputCostPer1k: 1, outputCostPer1k: 1 },
        inputTokens: 0,
        outputTokens: 0,
      },
      ctx()
    )) as { totalUsd: number };
    expect(result.totalUsd).toBe(0);
  });

  it("rejects negative token counts via the Zod schema", () => {
    const action = registry.get("tool.model_card.compute_cost_estimate");
    const parsed = action!.paramsSchema.safeParse({
      model: { name: "x", vendor: "y" },
      inputTokens: -1,
      outputTokens: 0,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("tool.model_card.promote_to_production — single-production-per-vendor invariant", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ models: [] });
  });

  it("promotes an experimental model to production", async () => {
    useWorkspaceStore
      .getState()
      .upsertModel(
        seed({ id: "m1", name: "claude-3-sonnet", vendor: "anthropic", status: "experimental" })
      );

    const action = registry.get("tool.model_card.promote_to_production");
    const result = (await action!.handler({ id: "m1" }, ctx())) as {
      promoted: boolean;
      demoted: string[];
    };
    expect(result.promoted).toBe(true);
    expect(result.demoted).toEqual([]); // no peer to demote

    const stored = (useWorkspaceStore.getState().models ?? []).find((m) => m.id === "m1");
    expect(stored?.status).toBe("production");
  });

  // ─── LOAD-BEARING INVARIANT TEST ────────────────────────────────────
  it("auto-demotes a sibling production model from the same vendor to deprecated", async () => {
    // Seed a multi-model registry for vendor=anthropic:
    // - claude-3 is the currently-deployed production model
    // - claude-4 is the freshly-evaluated candidate we're about to promote
    // Promoting claude-4 MUST also demote claude-3 — that's the entire
    // reason this verb exists vs the generic workspace.model.update.
    useWorkspaceStore
      .getState()
      .upsertModel(
        seed({ id: "old-prod", name: "claude-3", vendor: "anthropic", status: "production" })
      );
    useWorkspaceStore
      .getState()
      .upsertModel(
        seed({ id: "new-cand", name: "claude-4", vendor: "anthropic", status: "evaluation" })
      );

    const action = registry.get("tool.model_card.promote_to_production");
    const result = (await action!.handler({ id: "new-cand" }, ctx())) as {
      promoted: boolean;
      demoted: string[];
    };
    expect(result.promoted).toBe(true);
    expect(result.demoted).toEqual(["old-prod"]);

    const all = useWorkspaceStore.getState().models ?? [];
    const oldRow = all.find((m) => m.id === "old-prod");
    const newRow = all.find((m) => m.id === "new-cand");
    // Invariant satisfied: exactly one row of vendor=anthropic is now production.
    expect(oldRow?.status).toBe("deprecated");
    expect(newRow?.status).toBe("production");
    const stillProd = all.filter((m) => m.vendor === "anthropic" && m.status === "production");
    expect(stillProd).toHaveLength(1);
    expect(stillProd[0].id).toBe("new-cand");
  });

  it("does NOT touch production models of OTHER vendors", async () => {
    // Critical: the demote sweep filters by vendor, not just status —
    // promoting an anthropic model must NOT cascade-demote OpenAI's
    // production model.
    useWorkspaceStore
      .getState()
      .upsertModel(
        seed({ id: "ant-old", name: "claude-3", vendor: "anthropic", status: "production" })
      );
    useWorkspaceStore
      .getState()
      .upsertModel(
        seed({ id: "ant-new", name: "claude-4", vendor: "anthropic", status: "evaluation" })
      );
    useWorkspaceStore
      .getState()
      .upsertModel(
        seed({ id: "oai-prod", name: "gpt-4o", vendor: "openai", status: "production" })
      );

    const action = registry.get("tool.model_card.promote_to_production");
    await action!.handler({ id: "ant-new" }, ctx());

    const all = useWorkspaceStore.getState().models ?? [];
    expect(all.find((m) => m.id === "oai-prod")?.status).toBe("production"); // untouched
    expect(all.find((m) => m.id === "ant-old")?.status).toBe("deprecated"); // demoted
    expect(all.find((m) => m.id === "ant-new")?.status).toBe("production"); // promoted
  });

  it("returns {promoted: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.model_card.promote_to_production");
    const result = (await action!.handler({ id: "does-not-exist" }, ctx())) as {
      promoted: boolean;
      demoted: string[];
    };
    expect(result.promoted).toBe(false);
    expect(result.demoted).toEqual([]);
  });

  it("is a no-op for a target already in production (no self-demote)", async () => {
    // The id-not-equal guard in the demote filter exists precisely so
    // calling promote on an already-production model doesn't first
    // demote then re-promote the same row.
    useWorkspaceStore
      .getState()
      .upsertModel(seed({ id: "m1", name: "claude-3", vendor: "anthropic", status: "production" }));

    const action = registry.get("tool.model_card.promote_to_production");
    const result = (await action!.handler({ id: "m1" }, ctx())) as {
      promoted: boolean;
      demoted: string[];
    };
    expect(result.promoted).toBe(true);
    expect(result.demoted).toEqual([]); // critically, NOT ["m1"]

    const stored = (useWorkspaceStore.getState().models ?? []).find((m) => m.id === "m1");
    expect(stored?.status).toBe("production");
  });
});

describe("tool.model_card.deprecate — append-with-reason + idempotent", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ models: [] });
  });

  it("marks a non-deprecated model as deprecated", async () => {
    useWorkspaceStore
      .getState()
      .upsertModel(seed({ id: "m1", name: "claude-3", vendor: "anthropic", status: "production" }));

    const action = registry.get("tool.model_card.deprecate");
    const result = (await action!.handler({ id: "m1" }, ctx())) as { updated: boolean };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().models ?? []).find((m) => m.id === "m1");
    expect(stored?.status).toBe("deprecated");
  });

  it("appends the reason to notes, preserving prior notes", async () => {
    useWorkspaceStore.getState().upsertModel(
      seed({
        id: "m1",
        name: "claude-3",
        vendor: "anthropic",
        status: "production",
        notes: "Initial release.",
      })
    );

    const action = registry.get("tool.model_card.deprecate");
    await action!.handler({ id: "m1", reason: "Superseded by claude-4" }, ctx());

    const stored = (useWorkspaceStore.getState().models ?? []).find((m) => m.id === "m1");
    expect(stored?.notes).toBe("Initial release.\n[deprecated] Superseded by claude-4");
  });

  it("uses the reason as the notes when none were present", async () => {
    useWorkspaceStore
      .getState()
      .upsertModel(seed({ id: "m1", name: "claude-3", vendor: "anthropic", status: "production" }));

    const action = registry.get("tool.model_card.deprecate");
    await action!.handler({ id: "m1", reason: "Hallucinates on edge cases" }, ctx());

    const stored = (useWorkspaceStore.getState().models ?? []).find((m) => m.id === "m1");
    expect(stored?.notes).toBe("[deprecated] Hallucinates on edge cases");
  });

  it("is idempotent — repeated calls on an already-deprecated row are no-ops", async () => {
    useWorkspaceStore
      .getState()
      .upsertModel(seed({ id: "m1", name: "claude-3", vendor: "anthropic", status: "deprecated" }));

    const action = registry.get("tool.model_card.deprecate");
    const result = (await action!.handler({ id: "m1" }, ctx())) as { updated: boolean };
    expect(result.updated).toBe(false);
  });

  it("still appends a reason on an already-deprecated row when one is supplied", async () => {
    // Idempotent on status, but a new reason is a real new piece of
    // information — record it.
    useWorkspaceStore.getState().upsertModel(
      seed({
        id: "m1",
        name: "claude-3",
        vendor: "anthropic",
        status: "deprecated",
        notes: "[deprecated] First reason",
      })
    );

    const action = registry.get("tool.model_card.deprecate");
    const result = (await action!.handler({ id: "m1", reason: "Second reason" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().models ?? []).find((m) => m.id === "m1");
    expect(stored?.notes).toBe("[deprecated] First reason\n[deprecated] Second reason");
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.model_card.deprecate");
    const result = (await action!.handler({ id: "does-not-exist" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(false);
  });
});

describe("tool.model_card.record_eval — score write-back", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ models: [] });
  });

  it("sets evalScore on a known model", async () => {
    useWorkspaceStore
      .getState()
      .upsertModel(seed({ id: "m1", name: "claude-3", vendor: "anthropic" }));

    const action = registry.get("tool.model_card.record_eval");
    const result = (await action!.handler({ id: "m1", evalScore: 0.87 }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().models ?? []).find((m) => m.id === "m1");
    expect(stored?.evalScore).toBe(0.87);
  });

  it("overwrites a prior score (this is a metric, not append-only state)", async () => {
    useWorkspaceStore
      .getState()
      .upsertModel(seed({ id: "m1", name: "claude-3", vendor: "anthropic", evalScore: 0.5 }));

    const action = registry.get("tool.model_card.record_eval");
    await action!.handler({ id: "m1", evalScore: 0.9 }, ctx());

    const stored = (useWorkspaceStore.getState().models ?? []).find((m) => m.id === "m1");
    expect(stored?.evalScore).toBe(0.9);
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.model_card.record_eval");
    const result = (await action!.handler({ id: "does-not-exist", evalScore: 0.5 }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(false);
  });

  it("rejects an evalScore outside [0, 1] via the Zod schema", () => {
    const action = registry.get("tool.model_card.record_eval");
    // Zod parse happens at the action boundary in production via
    // dispatch; here we hit the schema directly to confirm the bounds.
    const parsed = action!.paramsSchema.safeParse({ id: "m1", evalScore: 1.5 });
    expect(parsed.success).toBe(false);
  });
});
