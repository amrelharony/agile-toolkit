/**
 * tool.prompt_registry.* action coverage.
 *
 * CRUD-backed variant (squad S12a, Wave 3). Mirrors the squad-13 DACI
 * test pattern but adds a CRITICAL coverage area unique to this tool:
 * the single-production-per-name invariant enforced by
 * promote_to_production. The in-app UI does NOT enforce this — only
 * the agent surface does — so the test below explicitly seeds a
 * multi-production starting state and asserts the auto-demote behaviour.
 *
 * Coverage outline:
 *   1. all 5 actions registered with the right category split
 *   2. write actions all expose an mcpHandler (server-side path)
 *   3. requiresConfirmation defaults: promote_to_production stays
 *      confirmable (true); deprecate + record_eval opt out (false)
 *   4. list_state returns initialised byStatus + grouped shape on empty
 *      AND aggregates correctly across mixed-name/status seeds, with
 *      semver-desc ordering inside each group and pointers to the
 *      production + latest-draft rows
 *   5. get_production_prompt resolves a name → its production row,
 *      returns null when none, and applies the latest-publishedAt
 *      tiebreaker when (defensively) multiple are tagged production
 *   6. promote_to_production:
 *        - sets target to production
 *        - auto-demotes a sibling production version to deprecated
 *          (the single-production invariant — load-bearing test)
 *        - does NOT touch sibling versions of OTHER names
 *        - returns {promoted: false} for an unknown id
 *        - stamps publishedAt when missing; preserves it when present
 *   7. deprecate sets status, appends reason to changeNote (preserving
 *      prior note), is idempotent on already-deprecated rows
 *   8. record_eval writes the score and returns {updated: false} for
 *      an unknown id
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PromptVersion } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/prompt-registry";

const EXPECTED_ACTIONS = [
  "tool.prompt_registry.list_state",
  "tool.prompt_registry.get_production_prompt",
  "tool.prompt_registry.promote_to_production",
  "tool.prompt_registry.deprecate",
  "tool.prompt_registry.record_eval",
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

/** Build a fully-formed PromptVersion for seeding the store. id / name /
 *  version / body / status are required; everything else is optional. */
function seed(
  partial: Partial<PromptVersion> & Pick<PromptVersion, "id" | "name" | "version">
): PromptVersion {
  return {
    body: "stub body",
    status: "draft",
    ...partial,
  };
}

describe("tool.prompt_registry — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("read actions are category=read; mutation actions are category=write", () => {
    expect(registry.get("tool.prompt_registry.list_state")?.category).toBe("read");
    expect(registry.get("tool.prompt_registry.get_production_prompt")?.category).toBe("read");
    expect(registry.get("tool.prompt_registry.promote_to_production")?.category).toBe("write");
    expect(registry.get("tool.prompt_registry.deprecate")?.category).toBe("write");
    expect(registry.get("tool.prompt_registry.record_eval")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.prompt_registry.promote_to_production")?.mcpHandler).toBeTypeOf(
      "function"
    );
    expect(registry.get("tool.prompt_registry.deprecate")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.prompt_registry.record_eval")?.mcpHandler).toBeTypeOf("function");
  });

  it("read actions also expose an mcpHandler for MCP listing", () => {
    expect(registry.get("tool.prompt_registry.list_state")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.prompt_registry.get_production_prompt")?.mcpHandler).toBeTypeOf(
      "function"
    );
  });

  it("requiresConfirmation defaults: promote stays confirmable; deprecate + record_eval opt out", () => {
    // `write` defaults to requiresConfirmation:true when unspecified, so
    // promote_to_production's value is `undefined` in the registered
    // action object — we assert it's NOT explicitly set to false (the
    // executor reads the default).
    expect(
      registry.get("tool.prompt_registry.promote_to_production")?.requiresConfirmation
    ).not.toBe(false);
    expect(registry.get("tool.prompt_registry.deprecate")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.prompt_registry.record_eval")?.requiresConfirmation).toBe(false);
  });
});

type ListStateResult = {
  totalPrompts: number;
  totalVersions: number;
  byStatus: Record<PromptVersion["status"], number>;
  groups: Array<{
    name: string;
    versions: PromptVersion[];
    productionVersion: PromptVersion | null;
    latestDraftVersion: PromptVersion | null;
  }>;
};

describe("tool.prompt_registry.list_state — grouped summary", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prompts: [] });
  });

  it("returns zeroed buckets and empty groups when the workspace is empty", async () => {
    const action = registry.get("tool.prompt_registry.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;
    expect(result.totalPrompts).toBe(0);
    expect(result.totalVersions).toBe(0);
    expect(result.groups).toEqual([]);
    // Every bucket initialised — agent can read byStatus.production
    // without an existence check even on an empty workspace.
    expect(result.byStatus).toEqual({
      draft: 0,
      review: 0,
      production: 0,
      deprecated: 0,
    });
  });

  it("groups by name, sorts versions by semver desc, and surfaces production + latest-draft pointers", async () => {
    const seeds: PromptVersion[] = [
      // "summarizer" with three versions — production sits on 1.4.0,
      // 1.5.0 is a fresh draft, 1.3.0 is deprecated history.
      seed({ id: "p1", name: "summarizer", version: "1.3.0", status: "deprecated" }),
      seed({
        id: "p2",
        name: "summarizer",
        version: "1.4.0",
        status: "production",
        publishedAt: "2026-01-15T00:00:00.000Z",
      }),
      seed({ id: "p3", name: "summarizer", version: "1.5.0", status: "draft" }),
      // "classifier" — single version, in review.
      seed({ id: "p4", name: "classifier", version: "0.9.0", status: "review" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertPrompt(s);

    const action = registry.get("tool.prompt_registry.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;

    expect(result.totalPrompts).toBe(2); // unique names
    expect(result.totalVersions).toBe(4);
    expect(result.byStatus).toEqual({
      draft: 1,
      review: 1,
      production: 1,
      deprecated: 1,
    });

    // Groups are sorted by name alphabetically: classifier, summarizer.
    expect(result.groups.map((g) => g.name)).toEqual(["classifier", "summarizer"]);

    const summarizer = result.groups.find((g) => g.name === "summarizer")!;
    // Semver descending: 1.5.0, 1.4.0, 1.3.0 (not lexicographic).
    expect(summarizer.versions.map((v) => v.version)).toEqual(["1.5.0", "1.4.0", "1.3.0"]);
    expect(summarizer.productionVersion?.id).toBe("p2");
    expect(summarizer.latestDraftVersion?.id).toBe("p3");

    const classifier = result.groups.find((g) => g.name === "classifier")!;
    // Single version, in review — no production or draft pointers.
    expect(classifier.productionVersion).toBeNull();
    expect(classifier.latestDraftVersion).toBeNull();
  });

  it("semver compare orders 1.10.0 above 1.9.0 (not lexicographic)", async () => {
    useWorkspaceStore.getState().upsertPrompt(seed({ id: "a", name: "x", version: "1.9.0" }));
    useWorkspaceStore.getState().upsertPrompt(seed({ id: "b", name: "x", version: "1.10.0" }));

    const action = registry.get("tool.prompt_registry.list_state");
    const result = (await action!.handler({}, ctx())) as ListStateResult;
    expect(result.groups[0].versions.map((v) => v.version)).toEqual(["1.10.0", "1.9.0"]);
  });
});

describe("tool.prompt_registry.get_production_prompt — name → production lookup", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prompts: [] });
  });

  it("returns the single production version for a known name", async () => {
    useWorkspaceStore
      .getState()
      .upsertPrompt(seed({ id: "p1", name: "summarizer", version: "1.0.0", status: "draft" }));
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "p2",
        name: "summarizer",
        version: "1.1.0",
        status: "production",
        publishedAt: "2026-01-15T00:00:00.000Z",
      })
    );

    const action = registry.get("tool.prompt_registry.get_production_prompt");
    const result = (await action!.handler({ name: "summarizer" }, ctx())) as {
      prompt: PromptVersion | null;
    };
    expect(result.prompt?.id).toBe("p2");
    expect(result.prompt?.version).toBe("1.1.0");
  });

  it("returns null when no version of the name is in production", async () => {
    useWorkspaceStore
      .getState()
      .upsertPrompt(seed({ id: "p1", name: "summarizer", version: "1.0.0", status: "draft" }));

    const action = registry.get("tool.prompt_registry.get_production_prompt");
    const result = (await action!.handler({ name: "summarizer" }, ctx())) as {
      prompt: PromptVersion | null;
    };
    expect(result.prompt).toBeNull();
  });

  it("returns null for an unknown name", async () => {
    const action = registry.get("tool.prompt_registry.get_production_prompt");
    const result = (await action!.handler({ name: "does-not-exist" }, ctx())) as {
      prompt: PromptVersion | null;
    };
    expect(result.prompt).toBeNull();
  });

  it("picks the latest-publishedAt row when multiple are inexplicably tagged production (defensive)", async () => {
    // The in-app dropdown lets a user park two versions in production
    // simultaneously. get_production_prompt must remain deterministic.
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "old",
        name: "summarizer",
        version: "1.0.0",
        status: "production",
        publishedAt: "2025-06-01T00:00:00.000Z",
      })
    );
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "new",
        name: "summarizer",
        version: "1.1.0",
        status: "production",
        publishedAt: "2026-01-15T00:00:00.000Z",
      })
    );

    const action = registry.get("tool.prompt_registry.get_production_prompt");
    const result = (await action!.handler({ name: "summarizer" }, ctx())) as {
      prompt: PromptVersion | null;
    };
    expect(result.prompt?.id).toBe("new"); // latest publishedAt wins
  });
});

describe("tool.prompt_registry.promote_to_production — single-production invariant", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prompts: [] });
  });

  it("promotes a draft to production and stamps publishedAt when missing", async () => {
    useWorkspaceStore
      .getState()
      .upsertPrompt(seed({ id: "p1", name: "summarizer", version: "1.0.0", status: "draft" }));

    const action = registry.get("tool.prompt_registry.promote_to_production");
    const before = Date.now();
    const result = (await action!.handler({ id: "p1" }, ctx())) as {
      promoted: boolean;
      demoted: string[];
    };
    expect(result.promoted).toBe(true);
    expect(result.demoted).toEqual([]); // no peer to demote

    const stored = (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === "p1");
    expect(stored?.status).toBe("production");
    // publishedAt got stamped — should be a fresh ISO string parseable
    // as a timestamp at or after the call.
    expect(stored?.publishedAt).toBeDefined();
    expect(Date.parse(stored!.publishedAt!)).toBeGreaterThanOrEqual(before);
  });

  it("preserves an existing publishedAt when promoting (no clobber)", async () => {
    const original = "2025-06-01T00:00:00.000Z";
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "p1",
        name: "summarizer",
        version: "1.0.0",
        status: "draft",
        publishedAt: original, // historical timestamp, e.g. from a previous production stint
      })
    );

    const action = registry.get("tool.prompt_registry.promote_to_production");
    await action!.handler({ id: "p1" }, ctx());

    const stored = (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === "p1");
    expect(stored?.publishedAt).toBe(original);
  });

  // ─── LOAD-BEARING INVARIANT TEST ────────────────────────────────────
  it("auto-demotes a sibling production version of the same name to deprecated", async () => {
    // Seed a fully-formed multi-version registry for "summarizer":
    // - v1.0.0 is the currently-deployed production version
    // - v1.1.0 is the freshly-reviewed candidate we're about to promote
    // Promoting v1.1.0 MUST also demote v1.0.0 — that's the entire
    // reason this verb exists vs the generic workspace.prompt.update.
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "old-prod",
        name: "summarizer",
        version: "1.0.0",
        status: "production",
        publishedAt: "2025-06-01T00:00:00.000Z",
      })
    );
    useWorkspaceStore
      .getState()
      .upsertPrompt(
        seed({ id: "new-cand", name: "summarizer", version: "1.1.0", status: "review" })
      );

    const action = registry.get("tool.prompt_registry.promote_to_production");
    const result = (await action!.handler({ id: "new-cand" }, ctx())) as {
      promoted: boolean;
      demoted: string[];
    };
    expect(result.promoted).toBe(true);
    expect(result.demoted).toEqual(["old-prod"]);

    const all = useWorkspaceStore.getState().prompts ?? [];
    const oldRow = all.find((p) => p.id === "old-prod");
    const newRow = all.find((p) => p.id === "new-cand");
    // Invariant satisfied: exactly one row of name="summarizer" is now production.
    expect(oldRow?.status).toBe("deprecated");
    expect(newRow?.status).toBe("production");
    const stillProd = all.filter((p) => p.name === "summarizer" && p.status === "production");
    expect(stillProd).toHaveLength(1);
    expect(stillProd[0].id).toBe("new-cand");
  });

  it("does NOT touch production versions of OTHER prompt names", async () => {
    // Critical: the demote sweep filters by name, not just status —
    // promoting summarizer must NOT cascade-demote the unrelated
    // classifier's production row.
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "sum-old",
        name: "summarizer",
        version: "1.0.0",
        status: "production",
        publishedAt: "2025-06-01T00:00:00.000Z",
      })
    );
    useWorkspaceStore
      .getState()
      .upsertPrompt(
        seed({ id: "sum-new", name: "summarizer", version: "1.1.0", status: "review" })
      );
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "cls-prod",
        name: "classifier",
        version: "0.9.0",
        status: "production",
        publishedAt: "2025-08-01T00:00:00.000Z",
      })
    );

    const action = registry.get("tool.prompt_registry.promote_to_production");
    await action!.handler({ id: "sum-new" }, ctx());

    const all = useWorkspaceStore.getState().prompts ?? [];
    expect(all.find((p) => p.id === "cls-prod")?.status).toBe("production"); // untouched
    expect(all.find((p) => p.id === "sum-old")?.status).toBe("deprecated"); // demoted
    expect(all.find((p) => p.id === "sum-new")?.status).toBe("production"); // promoted
  });

  it("returns {promoted: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.prompt_registry.promote_to_production");
    const result = (await action!.handler({ id: "does-not-exist" }, ctx())) as {
      promoted: boolean;
      demoted: string[];
    };
    expect(result.promoted).toBe(false);
    expect(result.demoted).toEqual([]);
  });

  it("is a no-op for a target already in production (no self-demote)", async () => {
    // The id-not-equal guard in the demote filter exists precisely so
    // calling promote on an already-production version doesn't first
    // demote then re-promote the same row.
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "p1",
        name: "summarizer",
        version: "1.0.0",
        status: "production",
        publishedAt: "2025-06-01T00:00:00.000Z",
      })
    );

    const action = registry.get("tool.prompt_registry.promote_to_production");
    const result = (await action!.handler({ id: "p1" }, ctx())) as {
      promoted: boolean;
      demoted: string[];
    };
    expect(result.promoted).toBe(true);
    expect(result.demoted).toEqual([]); // critically, NOT ["p1"]

    const stored = (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === "p1");
    expect(stored?.status).toBe("production");
  });
});

describe("tool.prompt_registry.deprecate — append-with-reason + idempotent", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prompts: [] });
  });

  it("marks a non-deprecated version as deprecated", async () => {
    useWorkspaceStore
      .getState()
      .upsertPrompt(seed({ id: "p1", name: "summarizer", version: "1.0.0", status: "production" }));

    const action = registry.get("tool.prompt_registry.deprecate");
    const result = (await action!.handler({ id: "p1" }, ctx())) as { updated: boolean };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === "p1");
    expect(stored?.status).toBe("deprecated");
  });

  it("appends the reason to changeNote, preserving prior history", async () => {
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "p1",
        name: "summarizer",
        version: "1.0.0",
        status: "production",
        changeNote: "Initial release.",
      })
    );

    const action = registry.get("tool.prompt_registry.deprecate");
    await action!.handler({ id: "p1", reason: "Replaced by v1.1.0" }, ctx());

    const stored = (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === "p1");
    expect(stored?.changeNote).toBe("Initial release.\n[deprecated] Replaced by v1.1.0");
  });

  it("uses the reason as the changeNote when one was absent", async () => {
    useWorkspaceStore
      .getState()
      .upsertPrompt(seed({ id: "p1", name: "summarizer", version: "1.0.0", status: "production" }));

    const action = registry.get("tool.prompt_registry.deprecate");
    await action!.handler({ id: "p1", reason: "Hallucinates on edge cases" }, ctx());

    const stored = (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === "p1");
    expect(stored?.changeNote).toBe("[deprecated] Hallucinates on edge cases");
  });

  it("is idempotent — repeated calls on an already-deprecated row are no-ops", async () => {
    useWorkspaceStore
      .getState()
      .upsertPrompt(seed({ id: "p1", name: "summarizer", version: "1.0.0", status: "deprecated" }));

    const action = registry.get("tool.prompt_registry.deprecate");
    const result = (await action!.handler({ id: "p1" }, ctx())) as { updated: boolean };
    expect(result.updated).toBe(false);
  });

  it("still appends a reason on an already-deprecated row when one is supplied", async () => {
    // Idempotent on status, but a new reason is a real new piece of
    // information — record it.
    useWorkspaceStore.getState().upsertPrompt(
      seed({
        id: "p1",
        name: "summarizer",
        version: "1.0.0",
        status: "deprecated",
        changeNote: "[deprecated] First reason",
      })
    );

    const action = registry.get("tool.prompt_registry.deprecate");
    const result = (await action!.handler({ id: "p1", reason: "Second reason" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === "p1");
    expect(stored?.changeNote).toBe("[deprecated] First reason\n[deprecated] Second reason");
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.prompt_registry.deprecate");
    const result = (await action!.handler({ id: "does-not-exist" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(false);
  });
});

describe("tool.prompt_registry.record_eval — score write-back", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prompts: [] });
  });

  it("sets evalScore on a known version", async () => {
    useWorkspaceStore
      .getState()
      .upsertPrompt(seed({ id: "p1", name: "summarizer", version: "1.0.0" }));

    const action = registry.get("tool.prompt_registry.record_eval");
    const result = (await action!.handler({ id: "p1", evalScore: 0.87 }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === "p1");
    expect(stored?.evalScore).toBe(0.87);
  });

  it("overwrites a prior score (this is a metric, not append-only state)", async () => {
    useWorkspaceStore
      .getState()
      .upsertPrompt(seed({ id: "p1", name: "summarizer", version: "1.0.0", evalScore: 0.5 }));

    const action = registry.get("tool.prompt_registry.record_eval");
    await action!.handler({ id: "p1", evalScore: 0.9 }, ctx());

    const stored = (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === "p1");
    expect(stored?.evalScore).toBe(0.9);
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.prompt_registry.record_eval");
    const result = (await action!.handler({ id: "does-not-exist", evalScore: 0.5 }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(false);
  });

  it("rejects an evalScore outside [0, 1] via the Zod schema", async () => {
    const action = registry.get("tool.prompt_registry.record_eval");
    // Zod parse happens at the action boundary in production via
    // dispatch; here we hit the schema directly to confirm the bounds.
    const parsed = action!.paramsSchema.safeParse({ id: "p1", evalScore: 1.5 });
    expect(parsed.success).toBe(false);
  });
});
