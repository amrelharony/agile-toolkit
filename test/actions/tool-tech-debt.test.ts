/**
 * tool.tech_debt.* action coverage.
 *
 * CRUD-backed variant of the squad-13 test pattern (mirrors tool-daci).
 * Tech-debt is a record-keeping entity with a tool-specific compute
 * verb on top, so we cover:
 *
 *   1. all 5 actions registered with the right category split
 *   2. write actions all expose an mcpHandler (server-side path)
 *   3. compute_priority is pure and returns the right tier across the
 *      ratio buckets (must_fix / should_fix / defer)
 *   4. list_state returns initialised summary fields even when empty
 *      AND aggregates correctly across mixed seeds, sorted by priority
 *   5. mark_resolved sets resolvedAt (default = now-ish) AND returns
 *      {updated:false} for an unknown id (no throw)
 *   6. add_tag is idempotent — second call with same tag is a no-op
 *      AND returns {added:false} for an unknown id
 *   7. set_area overwrites the previous area value
 *
 * ─── KIND NOTE ──────────────────────────────────────────────────────
 * The server kind for this entity is "workspace:techDebt" (camelCase via
 * kindFromToolId), matching the browser sync engine — so MCP and browser
 * writes round-trip. Round-trip tests across that boundary are still
 * OMITTED here: every test below exercises EITHER the browser handler
 * (via useWorkspaceStore directly) OR the mcpHandler (which we can't
 * realistically unit-test without mocking Supabase, so we just assert
 * registration shape there).
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TechDebtItem } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/tech-debt";

const EXPECTED_ACTIONS = [
  "tool.tech_debt.compute_priority",
  "tool.tech_debt.list_state",
  "tool.tech_debt.mark_resolved",
  "tool.tech_debt.add_tag",
  "tool.tech_debt.set_area",
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

/** Build a fully-formed TechDebtItem for seeding the store. The
 *  required fields are id / title / impact / effort / raisedAt;
 *  everything else is optional. */
function seed(partial: Partial<TechDebtItem> & Pick<TechDebtItem, "id" | "title">): TechDebtItem {
  return {
    impact: 3,
    effort: 3,
    raisedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("tool.tech_debt — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("compute_priority + list_state are category=read; mutation actions are category=write", () => {
    expect(registry.get("tool.tech_debt.compute_priority")?.category).toBe("read");
    expect(registry.get("tool.tech_debt.list_state")?.category).toBe("read");
    expect(registry.get("tool.tech_debt.mark_resolved")?.category).toBe("write");
    expect(registry.get("tool.tech_debt.add_tag")?.category).toBe("write");
    expect(registry.get("tool.tech_debt.set_area")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.tech_debt.mark_resolved")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.tech_debt.add_tag")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.tech_debt.set_area")?.mcpHandler).toBeTypeOf("function");
  });

  it("compute_priority is pure — no mcpHandler needed", () => {
    // Pure compute runs identically on server and client; the registry
    // shape allows mcpHandler to be undefined for read-only actions
    // that have no environment-dependent behaviour.
    expect(registry.get("tool.tech_debt.compute_priority")?.mcpHandler).toBeUndefined();
  });

  it("additive actions are requiresConfirmation=false; mark_resolved is true", () => {
    expect(registry.get("tool.tech_debt.add_tag")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.tech_debt.set_area")?.requiresConfirmation).toBe(false);
    // mark_resolved represents a lifecycle transition the agent should
    // not perform on a whim — confirmation prompt warranted even though
    // the action is technically reversible via an update patch.
    expect(registry.get("tool.tech_debt.mark_resolved")?.requiresConfirmation).toBe(true);
  });
});

describe("tool.tech_debt.compute_priority — pure formula", () => {
  it("computes (impact / max(0.5, effort)) * (1 + interestRate) without interest", async () => {
    const action = registry.get("tool.tech_debt.compute_priority");
    const result = (await action!.handler({ impact: 4, effort: 2 }, ctx())) as {
      priority: number;
      rank_tier: string;
    };
    // 4 / 2 * (1 + 0) = 2
    expect(result.priority).toBe(2);
    expect(result.rank_tier).toBe("should_fix");
  });

  it("multiplies by (1 + interestRate) when interest is supplied", async () => {
    const action = registry.get("tool.tech_debt.compute_priority");
    const result = (await action!.handler({ impact: 4, effort: 2, interestRate: 1 }, ctx())) as {
      priority: number;
      rank_tier: string;
    };
    // 4 / 2 * (1 + 1) = 4
    expect(result.priority).toBe(4);
    expect(result.rank_tier).toBe("must_fix");
  });

  it("floors effort at 0.5 (defuses user-entered 0)", async () => {
    const action = registry.get("tool.tech_debt.compute_priority");
    const result = (await action!.handler({ impact: 3, effort: 0 }, ctx())) as {
      priority: number;
    };
    // 3 / max(0.5, 0) = 6  (NOT NaN/Infinity)
    expect(result.priority).toBe(6);
    expect(Number.isFinite(result.priority)).toBe(true);
  });

  it("classifies low impact / high effort as defer", async () => {
    const action = registry.get("tool.tech_debt.compute_priority");
    const result = (await action!.handler({ impact: 1, effort: 5 }, ctx())) as {
      priority: number;
      rank_tier: string;
    };
    // 1 / 5 * 1 = 0.2 → defer
    expect(result.priority).toBeCloseTo(0.2, 5);
    expect(result.rank_tier).toBe("defer");
  });

  it("includes the formula string for transparency", async () => {
    const action = registry.get("tool.tech_debt.compute_priority");
    const result = (await action!.handler({ impact: 1, effort: 1 }, ctx())) as {
      formula: string;
    };
    expect(result.formula).toContain("impact");
    expect(result.formula).toContain("effort");
    expect(result.formula).toContain("interestRate");
  });
});

describe("tool.tech_debt.list_state — summary + sort", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ techDebt: [] });
  });

  it("returns zeroed totals + empty maps when the workspace is empty", async () => {
    const action = registry.get("tool.tech_debt.list_state");
    const result = (await action!.handler({}, ctx())) as {
      totalImpact: number;
      totalEffort: number;
      openCount: number;
      resolvedCount: number;
      byArea: Record<string, number>;
      items: TechDebtItem[];
    };
    expect(result.totalImpact).toBe(0);
    expect(result.totalEffort).toBe(0);
    expect(result.openCount).toBe(0);
    expect(result.resolvedCount).toBe(0);
    expect(result.byArea).toEqual({});
    expect(result.items).toEqual([]);
  });

  it("aggregates totals and byArea correctly across mixed seeds", async () => {
    const seeds: TechDebtItem[] = [
      seed({ id: "d1", title: "Auth rewrite", impact: 5, effort: 3, area: "auth" }),
      seed({ id: "d2", title: "Cache invalidation", impact: 4, effort: 2, area: "infra" }),
      seed({ id: "d3", title: "Test flake", impact: 2, effort: 1, area: "ci" }),
      seed({
        id: "d4",
        title: "Legacy migration",
        impact: 3,
        effort: 5,
        area: "auth",
        resolvedAt: new Date().toISOString(),
      }),
      // No area — should bucket under __unassigned.
      seed({ id: "d5", title: "Unsorted debt", impact: 1, effort: 1 }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertTechDebt(s);

    const action = registry.get("tool.tech_debt.list_state");
    const result = (await action!.handler({}, ctx())) as {
      totalImpact: number;
      totalEffort: number;
      openCount: number;
      resolvedCount: number;
      byArea: Record<string, number>;
      items: TechDebtItem[];
    };
    expect(result.totalImpact).toBe(5 + 4 + 2 + 3 + 1);
    expect(result.totalEffort).toBe(3 + 2 + 1 + 5 + 1);
    expect(result.openCount).toBe(4);
    expect(result.resolvedCount).toBe(1);
    expect(result.byArea.auth).toBe(2);
    expect(result.byArea.infra).toBe(1);
    expect(result.byArea.ci).toBe(1);
    expect(result.byArea.__unassigned).toBe(1);
    expect(result.items).toHaveLength(5);
  });

  it("sorts items by priority descending (high impact / low effort first)", async () => {
    const seeds: TechDebtItem[] = [
      // Low priority: small impact, big effort.
      seed({ id: "d1", title: "Low", impact: 1, effort: 5 }),
      // High priority: big impact, small effort.
      seed({ id: "d2", title: "High", impact: 5, effort: 1 }),
      // Mid priority.
      seed({ id: "d3", title: "Mid", impact: 3, effort: 3 }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertTechDebt(s);

    const action = registry.get("tool.tech_debt.list_state");
    const result = (await action!.handler({}, ctx())) as { items: TechDebtItem[] };
    // Client-formula priority for fresh items (ageDays=0, interest=0):
    //   d1: 1*4 - 5 = -1
    //   d2: 5*4 - 1 = 19
    //   d3: 3*4 - 3 = 9
    expect(result.items.map((i) => i.id)).toEqual(["d2", "d3", "d1"]);
  });
});

describe("tool.tech_debt.mark_resolved — lifecycle transition", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ techDebt: [] });
  });

  it("sets resolvedAt to the current time when no timestamp is supplied", async () => {
    useWorkspaceStore.getState().upsertTechDebt(seed({ id: "d1", title: "Open debt" }));

    const before = Date.now();
    const action = registry.get("tool.tech_debt.mark_resolved");
    const result = (await action!.handler({ id: "d1" }, ctx())) as { updated: boolean };
    const after = Date.now();

    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().techDebt ?? []).find((d) => d.id === "d1");
    expect(stored?.resolvedAt).toBeDefined();
    const resolvedTs = new Date(stored!.resolvedAt!).getTime();
    // Within a sane window of the call site.
    expect(resolvedTs).toBeGreaterThanOrEqual(before);
    expect(resolvedTs).toBeLessThanOrEqual(after);
  });

  it("uses the supplied resolvedAt when provided (back-date support)", async () => {
    useWorkspaceStore.getState().upsertTechDebt(seed({ id: "d1", title: "Open debt" }));

    const backdated = "2024-01-15T10:30:00.000Z";
    const action = registry.get("tool.tech_debt.mark_resolved");
    await action!.handler({ id: "d1", resolvedAt: backdated }, ctx());

    const stored = (useWorkspaceStore.getState().techDebt ?? []).find((d) => d.id === "d1");
    expect(stored?.resolvedAt).toBe(backdated);
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.tech_debt.mark_resolved");
    const result = (await action!.handler({ id: "does-not-exist" }, ctx())) as { updated: boolean };
    expect(result.updated).toBe(false);
  });

  it("preserves all other fields when setting resolvedAt (no patch leak)", async () => {
    useWorkspaceStore.getState().upsertTechDebt(
      seed({
        id: "d2",
        title: "Cache invalidation",
        description: "We invalidate too aggressively.",
        area: "infra",
        impact: 4,
        effort: 2,
        interestRate: 1.5,
        tags: ["perf", "infra"],
      })
    );

    const action = registry.get("tool.tech_debt.mark_resolved");
    await action!.handler({ id: "d2" }, ctx());

    const updated = (useWorkspaceStore.getState().techDebt ?? []).find((d) => d.id === "d2");
    expect(updated?.title).toBe("Cache invalidation");
    expect(updated?.description).toBe("We invalidate too aggressively.");
    expect(updated?.area).toBe("infra");
    expect(updated?.impact).toBe(4);
    expect(updated?.effort).toBe(2);
    expect(updated?.interestRate).toBe(1.5);
    expect(updated?.tags).toEqual(["perf", "infra"]);
  });
});

describe("tool.tech_debt.add_tag — idempotent append", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ techDebt: [] });
  });

  it("appends to an empty tags list and returns {added: true}", async () => {
    useWorkspaceStore
      .getState()
      .upsertTechDebt(seed({ id: "d1", title: "Auth rewrite", tags: [] }));

    const action = registry.get("tool.tech_debt.add_tag");
    const result = (await action!.handler({ id: "d1", tag: "urgent" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(true);

    const stored = (useWorkspaceStore.getState().techDebt ?? []).find((d) => d.id === "d1");
    expect(stored?.tags).toEqual(["urgent"]);
  });

  it("is idempotent — second call with same tag returns {added: false}", async () => {
    useWorkspaceStore
      .getState()
      .upsertTechDebt(seed({ id: "d1", title: "Auth rewrite", tags: ["urgent"] }));

    const action = registry.get("tool.tech_debt.add_tag");
    const result = (await action!.handler({ id: "d1", tag: "urgent" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(false);

    const stored = (useWorkspaceStore.getState().techDebt ?? []).find((d) => d.id === "d1");
    expect(stored?.tags).toEqual(["urgent"]); // not duplicated
  });

  it("appends to an absent tags slot (undefined → [tag])", async () => {
    // The TechDebtItem type has tags?: string[] — a freshly-created
    // item may omit it entirely. add_tag must still work.
    useWorkspaceStore.getState().upsertTechDebt(seed({ id: "d2", title: "Cache invalidation" })); // no tags

    const action = registry.get("tool.tech_debt.add_tag");
    const result = (await action!.handler({ id: "d2", tag: "infra" }, ctx())) as { added: boolean };
    expect(result.added).toBe(true);

    const stored = (useWorkspaceStore.getState().techDebt ?? []).find((d) => d.id === "d2");
    expect(stored?.tags).toEqual(["infra"]);
  });

  it("returns {added: false} for an unknown id", async () => {
    const action = registry.get("tool.tech_debt.add_tag");
    const result = (await action!.handler({ id: "does-not-exist", tag: "urgent" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(false);
  });
});

describe("tool.tech_debt.set_area — overwrite categorisation", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ techDebt: [] });
  });

  it("sets area on an item without one and returns {updated: true}", async () => {
    useWorkspaceStore.getState().upsertTechDebt(seed({ id: "d1", title: "Unsorted debt" }));

    const action = registry.get("tool.tech_debt.set_area");
    const result = (await action!.handler({ id: "d1", area: "auth" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().techDebt ?? []).find((d) => d.id === "d1");
    expect(stored?.area).toBe("auth");
  });

  it("overwrites a previously-set area (categorisation move, not append)", async () => {
    useWorkspaceStore
      .getState()
      .upsertTechDebt(seed({ id: "d1", title: "Misplaced debt", area: "infra" }));

    const action = registry.get("tool.tech_debt.set_area");
    await action!.handler({ id: "d1", area: "auth" }, ctx());

    const stored = (useWorkspaceStore.getState().techDebt ?? []).find((d) => d.id === "d1");
    expect(stored?.area).toBe("auth");
  });

  it("returns {updated: false} for an unknown id", async () => {
    const action = registry.get("tool.tech_debt.set_area");
    const result = (await action!.handler({ id: "does-not-exist", area: "auth" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(false);
  });
});

describe("tool.tech_debt.list_state — matches the on-screen ranking", () => {
  beforeEach(() => useWorkspaceStore.setState({ techDebt: [] }));
  afterEach(() => vi.useRealTimers());

  const list = async () =>
    (
      (await registry.get("tool.tech_debt.list_state")!.handler({}, ctx())) as {
        items: TechDebtItem[];
      }
    ).items.map((i) => i.id);

  // Bug: the UI ranks resolved items below every open one, but list_state
  // sorted by score alone, so paid-off debt topped the agent's list.
  it("puts resolved items after open ones, whatever their score", async () => {
    for (const s of [
      seed({ id: "open-low", title: "Low", impact: 1, effort: 5 }),
      seed({ id: "done-high", title: "Done", impact: 5, effort: 1, resolvedAt: "2026-10-01" }),
      seed({ id: "open-mid", title: "Mid", impact: 3, effort: 3 }),
    ]) {
      useWorkspaceStore.getState().upsertTechDebt(s);
    }
    expect(await list()).toEqual(["open-mid", "open-low", "done-high"]);
  });

  // Bug: a YYYY-MM-DD raisedAt was aged in UTC days, so an item raised
  // today was −1 days old just after local midnight east of UTC and its
  // interest pulled it down the list.
  it("ages a YYYY-MM-DD raised date in local calendar days", async () => {
    const east = new Date(2026, 9, 19, 0, 30).getTimezoneOffset() < 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(east ? new Date(2026, 9, 19, 0, 30) : new Date(2026, 9, 19, 23, 30));
    for (const s of [
      // 3·4 − 1 + 10·0·½ = 11 when aged 0 days.
      seed({
        id: "interest",
        title: "A",
        impact: 3,
        effort: 1,
        interestRate: 10,
        raisedAt: "2026-10-19",
      }),
      // 3·4 − 2 = 10.
      seed({ id: "plain", title: "B", impact: 3, effort: 2, raisedAt: "2026-10-19" }),
    ]) {
      useWorkspaceStore.getState().upsertTechDebt(s);
    }
    expect(await list()).toEqual(["interest", "plain"]);
  });
});
