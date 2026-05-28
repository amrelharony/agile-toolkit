/**
 * tool.hallucination_log.* action coverage.
 *
 * CRUD-backed variant of the squad-13 test pattern (mirrors tool-daci).
 * Hallucinations are a record-keeping entity — generic create / list /
 * update / delete exist via the auto-generated workspace.hallucination.*
 * surface. This file covers the tool-specific verbs the agent speaks:
 *
 *   1. all 4 actions registered with the right category split
 *      (3 reads incl. one pure compute, 1 write only mark_resolved /
 *      set_root_cause — both writes have mcpHandler)
 *   2. list_state returns fully-initialised bySeverity + byRootCause
 *      buckets even when empty, and aggregates correctly across mixed
 *      seeds (open vs resolved, with/without rootCause/feature)
 *   3. compute_severity_burden uses the documented weights, ignores
 *      resolved items, and only emits byFeature when ≥1 item has a
 *      feature tag
 *   4. set_root_cause tags the cause on an existing row, returns
 *      {updated:false} on unknown id, and preserves all other fields
 *   5. mark_resolved stamps resolvedAt + fixApplied, defaults resolvedAt
 *      to now when omitted, accepts an explicit ISO override, and
 *      returns {updated:false} on unknown id
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Hallucination } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/hallucination-log";

const EXPECTED_ACTIONS = [
  "tool.hallucination_log.list_state",
  "tool.hallucination_log.compute_severity_burden",
  "tool.hallucination_log.set_root_cause",
  "tool.hallucination_log.mark_resolved",
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

/** Build a fully-formed Hallucination for seeding the store. id, input,
 *  actual, severity, and loggedAt are required by the type; everything
 *  else is optional. */
function seed(partial: Partial<Hallucination> & Pick<Hallucination, "id">): Hallucination {
  return {
    input: "what time is it",
    actual: "the year 1492",
    severity: "medium",
    loggedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("tool.hallucination_log — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("read actions are category=read; mutation actions are category=write", () => {
    expect(registry.get("tool.hallucination_log.list_state")?.category).toBe("read");
    expect(registry.get("tool.hallucination_log.compute_severity_burden")?.category).toBe("read");
    expect(registry.get("tool.hallucination_log.set_root_cause")?.category).toBe("write");
    expect(registry.get("tool.hallucination_log.mark_resolved")?.category).toBe("write");
  });

  it("list_state has an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.hallucination_log.list_state")?.mcpHandler).toBeTypeOf("function");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.hallucination_log.set_root_cause")?.mcpHandler).toBeTypeOf(
      "function"
    );
    expect(registry.get("tool.hallucination_log.mark_resolved")?.mcpHandler).toBeTypeOf("function");
  });

  it("compute_severity_burden is pure (no mcpHandler) — identical server/client", () => {
    expect(
      registry.get("tool.hallucination_log.compute_severity_burden")?.mcpHandler
    ).toBeUndefined();
  });

  it("write actions are requiresConfirmation=false (additive, no destruction)", () => {
    expect(registry.get("tool.hallucination_log.set_root_cause")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.hallucination_log.mark_resolved")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.hallucination_log.list_state — summary + roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ hallucinations: [] });
  });

  it("returns zeroed buckets and empty items when the workspace is empty", async () => {
    const action = registry.get("tool.hallucination_log.list_state");
    const result = (await action!.handler({}, ctx())) as {
      bySeverity: Record<Hallucination["severity"], number>;
      byRootCause: Record<NonNullable<Hallucination["rootCause"]>, number>;
      byFeature: Record<string, number>;
      openCount: number;
      resolvedCount: number;
      items: Hallucination[];
    };
    expect(result.items).toEqual([]);
    expect(result.openCount).toBe(0);
    expect(result.resolvedCount).toBe(0);
    expect(result.byFeature).toEqual({});
    // Every severity bucket initialised — agent can read bySeverity.high
    // without an existence check even on an empty workspace.
    expect(result.bySeverity).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
    // Every root-cause bucket initialised, including hyphenated keys.
    expect(result.byRootCause).toEqual({
      "rag-miss": 0,
      prompt: 0,
      model: 0,
      "context-window": 0,
      other: 0,
    });
  });

  it("aggregates bySeverity / byRootCause / byFeature / open vs resolved", async () => {
    const seeds: Hallucination[] = [
      seed({ id: "h1", severity: "low", rootCause: "rag-miss", feature: "search" }),
      seed({ id: "h2", severity: "high", rootCause: "model", feature: "search" }),
      seed({
        id: "h3",
        severity: "critical",
        rootCause: "prompt",
        feature: "summarizer",
      }),
      seed({
        id: "h4",
        severity: "medium",
        // no rootCause — excluded from byRootCause but still in items + bySeverity
        feature: "summarizer",
      }),
      seed({
        id: "h5",
        severity: "low",
        rootCause: "other",
        // no feature — excluded from byFeature
        resolvedAt: new Date().toISOString(),
        fixApplied: "tuned the prompt",
      }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertHallucination(s);

    const action = registry.get("tool.hallucination_log.list_state");
    const result = (await action!.handler({}, ctx())) as {
      bySeverity: Record<Hallucination["severity"], number>;
      byRootCause: Record<NonNullable<Hallucination["rootCause"]>, number>;
      byFeature: Record<string, number>;
      openCount: number;
      resolvedCount: number;
      items: Hallucination[];
    };
    expect(result.items).toHaveLength(5);
    expect(result.openCount).toBe(4);
    expect(result.resolvedCount).toBe(1);
    expect(result.bySeverity).toEqual({
      low: 2,
      medium: 1,
      high: 1,
      critical: 1,
    });
    expect(result.byRootCause).toEqual({
      "rag-miss": 1,
      prompt: 1,
      model: 1,
      "context-window": 0,
      other: 1,
    });
    expect(result.byFeature).toEqual({
      search: 2,
      summarizer: 2,
    });
  });
});

describe("tool.hallucination_log.compute_severity_burden — pure burden formula", () => {
  it("returns burdenScore=0 for an empty list", async () => {
    const action = registry.get("tool.hallucination_log.compute_severity_burden");
    const result = (await action!.handler({ items: [] }, ctx())) as {
      burdenScore: number;
      byFeature?: Record<string, number>;
    };
    expect(result.burdenScore).toBe(0);
    // No item had a feature, so byFeature is omitted entirely.
    expect(result.byFeature).toBeUndefined();
  });

  it("uses the documented weights (low=1, medium=3, high=7, critical=15)", async () => {
    const action = registry.get("tool.hallucination_log.compute_severity_burden");
    const result = (await action!.handler(
      {
        items: [
          { severity: "low" },
          { severity: "medium" },
          { severity: "high" },
          { severity: "critical" },
        ],
      },
      ctx()
    )) as { burdenScore: number };
    // 1 + 3 + 7 + 15 = 26
    expect(result.burdenScore).toBe(26);
  });

  it("treats resolved items as 0-burden regardless of severity", async () => {
    const action = registry.get("tool.hallucination_log.compute_severity_burden");
    const result = (await action!.handler(
      {
        items: [
          { severity: "critical", resolvedAt: "2026-01-01T00:00:00.000Z" }, // 0
          { severity: "high" }, // 7
          { severity: "medium", resolvedAt: "2026-01-02T00:00:00.000Z" }, // 0
          { severity: "low" }, // 1
        ],
      },
      ctx()
    )) as { burdenScore: number };
    // 0 + 7 + 0 + 1 = 8
    expect(result.burdenScore).toBe(8);
  });

  it("returns byFeature with per-feature burdens when items carry a feature", async () => {
    const action = registry.get("tool.hallucination_log.compute_severity_burden");
    const result = (await action!.handler(
      {
        items: [
          { severity: "critical", feature: "search" }, // 15 → search
          { severity: "high", feature: "search" }, // 7 → search
          { severity: "medium", feature: "summarizer" }, // 3 → summarizer
          { severity: "low", feature: "summarizer", resolvedAt: "2026-01-01T00:00:00.000Z" }, // 0
        ],
      },
      ctx()
    )) as { burdenScore: number; byFeature?: Record<string, number> };
    // 15 + 7 + 3 + 0 = 25
    expect(result.burdenScore).toBe(25);
    expect(result.byFeature).toEqual({
      search: 22,
      summarizer: 3,
    });
  });

  it("compute_severity_burden has no mcpHandler — pure compute reaches the same code", () => {
    // Sanity check that the registration didn't accidentally wire a
    // server handler. (The pure formula must NOT round-trip Supabase.)
    expect(
      registry.get("tool.hallucination_log.compute_severity_burden")?.mcpHandler
    ).toBeUndefined();
  });
});

describe("tool.hallucination_log.set_root_cause — convenience tag", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ hallucinations: [] });
  });

  it("tags the root cause on an existing row and returns {updated: true}", async () => {
    useWorkspaceStore.getState().upsertHallucination(seed({ id: "h1", severity: "high" }));

    const action = registry.get("tool.hallucination_log.set_root_cause");
    const result = (await action!.handler({ id: "h1", rootCause: "context-window" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().hallucinations ?? []).find((h) => h.id === "h1");
    expect(stored?.rootCause).toBe("context-window");
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.hallucination_log.set_root_cause");
    const result = (await action!.handler(
      { id: "does-not-exist", rootCause: "rag-miss" },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(false);
  });

  it("preserves all other fields when tagging the cause (no patch leak)", async () => {
    useWorkspaceStore.getState().upsertHallucination(
      seed({
        id: "h2",
        feature: "search",
        input: "who won the 2026 Super Bowl",
        actual: "the Houston Texans",
        expected: "n/a — the game is in the future",
        severity: "critical",
      })
    );

    const action = registry.get("tool.hallucination_log.set_root_cause");
    await action!.handler({ id: "h2", rootCause: "model" }, ctx());

    const updated = (useWorkspaceStore.getState().hallucinations ?? []).find((h) => h.id === "h2");
    expect(updated?.feature).toBe("search");
    expect(updated?.input).toBe("who won the 2026 Super Bowl");
    expect(updated?.actual).toBe("the Houston Texans");
    expect(updated?.expected).toBe("n/a — the game is in the future");
    expect(updated?.severity).toBe("critical");
    expect(updated?.rootCause).toBe("model");
  });

  it("overwrites a previously-set rootCause (re-diagnosis is fine)", async () => {
    useWorkspaceStore.getState().upsertHallucination(seed({ id: "h3", rootCause: "rag-miss" }));

    const action = registry.get("tool.hallucination_log.set_root_cause");
    await action!.handler({ id: "h3", rootCause: "prompt" }, ctx());

    const stored = (useWorkspaceStore.getState().hallucinations ?? []).find((h) => h.id === "h3");
    expect(stored?.rootCause).toBe("prompt");
  });
});

describe("tool.hallucination_log.mark_resolved — close-out with required fixApplied", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ hallucinations: [] });
  });

  it("stamps resolvedAt + fixApplied and returns {updated: true}", async () => {
    useWorkspaceStore.getState().upsertHallucination(seed({ id: "h1" }));

    const explicit = "2026-03-15T12:00:00.000Z";
    const action = registry.get("tool.hallucination_log.mark_resolved");
    const result = (await action!.handler(
      { id: "h1", fixApplied: "tuned the system prompt", resolvedAt: explicit },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().hallucinations ?? []).find((h) => h.id === "h1");
    expect(stored?.fixApplied).toBe("tuned the system prompt");
    expect(stored?.resolvedAt).toBe(explicit);
  });

  it("defaults resolvedAt to now when the caller omits it", async () => {
    useWorkspaceStore.getState().upsertHallucination(seed({ id: "h2" }));

    const before = Date.now();
    const action = registry.get("tool.hallucination_log.mark_resolved");
    await action!.handler({ id: "h2", fixApplied: "upgraded the model" }, ctx());
    const after = Date.now();

    const stored = (useWorkspaceStore.getState().hallucinations ?? []).find((h) => h.id === "h2");
    const stamped = new Date(stored?.resolvedAt ?? 0).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
    expect(stored?.fixApplied).toBe("upgraded the model");
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.hallucination_log.mark_resolved");
    const result = (await action!.handler(
      { id: "does-not-exist", fixApplied: "anything" },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(false);
  });

  it("rejects an empty fixApplied at the Zod boundary — closing without a fix is an anti-pattern", () => {
    const action = registry.get("tool.hallucination_log.mark_resolved");
    const parsed = action!.paramsSchema.safeParse({ id: "h1", fixApplied: "" });
    expect(parsed.success).toBe(false);
  });

  it("preserves all other fields when closing out (no patch leak)", async () => {
    useWorkspaceStore.getState().upsertHallucination(
      seed({
        id: "h3",
        feature: "qa-bot",
        rootCause: "prompt",
        severity: "high",
        input: "what is 2+2",
        actual: "5",
        expected: "4",
      })
    );

    const action = registry.get("tool.hallucination_log.mark_resolved");
    await action!.handler({ id: "h3", fixApplied: "added explicit arithmetic guard" }, ctx());

    const updated = (useWorkspaceStore.getState().hallucinations ?? []).find((h) => h.id === "h3");
    expect(updated?.feature).toBe("qa-bot");
    expect(updated?.rootCause).toBe("prompt");
    expect(updated?.severity).toBe("high");
    expect(updated?.input).toBe("what is 2+2");
    expect(updated?.actual).toBe("5");
    expect(updated?.expected).toBe("4");
    expect(updated?.fixApplied).toBe("added explicit arithmetic guard");
    expect(updated?.resolvedAt).toBeTruthy();
  });
});
