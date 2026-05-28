/**
 * tool.ooda_loop.* action coverage.
 *
 * Cycle-tracker variant of the squad-13 test pattern. OODA is a
 * record-keeping entity (like DACI) but with a phase-progression twist:
 * advance_phase to "act" auto-completes the cycle — that behaviour is
 * the most important invariant to lock in here, because it's the one
 * thing a future refactor could break silently.
 *
 * Coverage matrix:
 *   1. all 4 actions registered with the right category split
 *   2. write actions all expose an mcpHandler (server-side path)
 *   3. only complete_cycle is requiresConfirmation:true (matches the
 *      file header's invariant that completion is the destructive
 *      transition)
 *   4. list_state returns initialised {active, completed, stats} buckets
 *      even when empty AND splits / aggregates correctly across seeds
 *      (including a fully-documented cycle for the stats counter)
 *   5. advance_phase sets individual phases AND overwrites idempotently
 *      AND auto-completes on "act" (THE key invariant)
 *   6. advance_phase to "act" on an already-completed cycle is a content
 *      edit only — does NOT re-stamp completedAt (preserve the original
 *      completion timestamp as the historical record)
 *   7. complete_cycle stamps completedAt and respects a custom timestamp
 *   8. start_cycle creates a new cycle and returns the id; the new cycle
 *      is queryable via list_state immediately
 *   9. unknown-id paths on every write return {updated: false} / no throw
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { OODACycle } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/ooda-loop";

const EXPECTED_ACTIONS = [
  "tool.ooda_loop.list_state",
  "tool.ooda_loop.advance_phase",
  "tool.ooda_loop.complete_cycle",
  "tool.ooda_loop.start_cycle",
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

/** Build a fully-formed OODACycle for seeding the store. The required
 *  fields are id / topic / startedAt; everything else is optional. */
function seed(partial: Partial<OODACycle> & Pick<OODACycle, "id" | "topic">): OODACycle {
  return {
    startedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("tool.ooda_loop — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("list_state is category=read; mutation actions are category=write", () => {
    expect(registry.get("tool.ooda_loop.list_state")?.category).toBe("read");
    expect(registry.get("tool.ooda_loop.advance_phase")?.category).toBe("write");
    expect(registry.get("tool.ooda_loop.complete_cycle")?.category).toBe("write");
    expect(registry.get("tool.ooda_loop.start_cycle")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.ooda_loop.advance_phase")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.ooda_loop.complete_cycle")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.ooda_loop.start_cycle")?.mcpHandler).toBeTypeOf("function");
  });

  it("only complete_cycle is requiresConfirmation=true (destructive transition)", () => {
    expect(registry.get("tool.ooda_loop.advance_phase")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.ooda_loop.complete_cycle")?.requiresConfirmation).toBe(true);
    expect(registry.get("tool.ooda_loop.start_cycle")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.ooda_loop.list_state — split + stats", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ oodaCycles: [] });
  });

  it("returns zeroed stats and empty buckets when the workspace is empty", async () => {
    const action = registry.get("tool.ooda_loop.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      fullyDocumentedCycles: number;
      avgFilledPhases: number;
      active: OODACycle[];
      completed: OODACycle[];
    };
    expect(result.total).toBe(0);
    expect(result.fullyDocumentedCycles).toBe(0);
    // Empty workspace must report 0, NOT NaN — agent should be able to
    // assert numeric properties without a Number.isFinite guard.
    expect(result.avgFilledPhases).toBe(0);
    expect(result.active).toEqual([]);
    expect(result.completed).toEqual([]);
  });

  it("splits cycles into {active, completed} based on completedAt presence", async () => {
    const seeds: OODACycle[] = [
      seed({ id: "c1", topic: "Outage triage" }), // active
      seed({ id: "c2", topic: "Vendor pivot" }), // active
      seed({
        id: "c3",
        topic: "Old launch",
        completedAt: new Date().toISOString(),
      }), // completed
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertOODACycle(s);

    const action = registry.get("tool.ooda_loop.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      active: OODACycle[];
      completed: OODACycle[];
    };
    expect(result.total).toBe(3);
    expect(result.active).toHaveLength(2);
    expect(result.completed).toHaveLength(1);
    expect(result.active.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(result.completed[0]?.id).toBe("c3");
  });

  it("computes fullyDocumentedCycles and avgFilledPhases across mixed-fill seeds", async () => {
    // c1: 0 phases filled, c2: 2 phases filled, c3: 4 phases filled.
    // avg = (0 + 2 + 4) / 3 = 2.0; fullyDocumented = 1 (only c3).
    const seeds: OODACycle[] = [
      seed({ id: "c1", topic: "Nothing yet" }),
      seed({
        id: "c2",
        topic: "Half-baked",
        observe: "saw a spike",
        orient: "looks like the cache miss",
      }),
      seed({
        id: "c3",
        topic: "Wrapped up",
        observe: "all 4 phases",
        orient: "got the context",
        decide: "made the call",
        act: "shipped the fix",
        completedAt: new Date().toISOString(),
      }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertOODACycle(s);

    const action = registry.get("tool.ooda_loop.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      fullyDocumentedCycles: number;
      avgFilledPhases: number;
    };
    expect(result.total).toBe(3);
    expect(result.fullyDocumentedCycles).toBe(1);
    expect(result.avgFilledPhases).toBeCloseTo(2.0, 5);
  });

  it("treats whitespace-only phase strings as not-filled in the stats", async () => {
    // Phase set to "   " should not count as filled — matches the UI's
    // notion that whitespace text is effectively blank.
    useWorkspaceStore.getState().upsertOODACycle(
      seed({
        id: "c1",
        topic: "Spaces only",
        observe: "   ",
        orient: "",
      })
    );
    const action = registry.get("tool.ooda_loop.list_state");
    const result = (await action!.handler({}, ctx())) as {
      avgFilledPhases: number;
      fullyDocumentedCycles: number;
    };
    expect(result.avgFilledPhases).toBe(0);
    expect(result.fullyDocumentedCycles).toBe(0);
  });
});

describe("tool.ooda_loop.advance_phase — phase set + auto-complete on act", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ oodaCycles: [] });
  });

  it("sets the observe phase and returns {updated:true, completed:false}", async () => {
    useWorkspaceStore.getState().upsertOODACycle(seed({ id: "c1", topic: "Outage" }));

    const action = registry.get("tool.ooda_loop.advance_phase");
    const result = (await action!.handler(
      { id: "c1", phase: "observe", content: "Saw 500 errors spiking" },
      ctx()
    )) as { updated: boolean; completed: boolean };
    expect(result.updated).toBe(true);
    expect(result.completed).toBe(false);

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(stored?.observe).toBe("Saw 500 errors spiking");
    expect(stored?.completedAt).toBeUndefined();
  });

  it("sets each of the 4 phases by name", async () => {
    useWorkspaceStore.getState().upsertOODACycle(seed({ id: "c1", topic: "Test" }));
    const action = registry.get("tool.ooda_loop.advance_phase");

    await action!.handler({ id: "c1", phase: "observe", content: "O" }, ctx());
    await action!.handler({ id: "c1", phase: "orient", content: "R" }, ctx());
    await action!.handler({ id: "c1", phase: "decide", content: "D" }, ctx());
    // "act" auto-completes — that's tested separately; here we just check
    // the field is written.
    await action!.handler({ id: "c1", phase: "act", content: "A" }, ctx());

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(stored?.observe).toBe("O");
    expect(stored?.orient).toBe("R");
    expect(stored?.decide).toBe("D");
    expect(stored?.act).toBe("A");
  });

  it("is idempotent — setting a phase with existing content overwrites it", async () => {
    useWorkspaceStore
      .getState()
      .upsertOODACycle(seed({ id: "c1", topic: "Test", observe: "first draft" }));

    const action = registry.get("tool.ooda_loop.advance_phase");
    const result = (await action!.handler(
      { id: "c1", phase: "observe", content: "second draft" },
      ctx()
    )) as { updated: boolean; completed: boolean };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(stored?.observe).toBe("second draft");
  });

  it("AUTO-COMPLETES the cycle when phase=act is set on a not-yet-completed cycle", async () => {
    // THE key invariant — Boyd's loop closure. Setting "act" stamps
    // completedAt because once you've acted, the cycle is done and the
    // next observation starts a new cycle.
    useWorkspaceStore.getState().upsertOODACycle(seed({ id: "c1", topic: "Test" }));

    const action = registry.get("tool.ooda_loop.advance_phase");
    const result = (await action!.handler(
      { id: "c1", phase: "act", content: "Shipped the hotfix" },
      ctx()
    )) as { updated: boolean; completed: boolean };
    expect(result.updated).toBe(true);
    expect(result.completed).toBe(true);

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(stored?.act).toBe("Shipped the hotfix");
    expect(stored?.completedAt).toBeDefined();
    // Sanity check the timestamp is a valid ISO string in the recent past.
    expect(Number.isNaN(Date.parse(stored!.completedAt!))).toBe(false);
  });

  it("does NOT auto-complete on phases other than 'act' (observe/orient/decide)", async () => {
    useWorkspaceStore.getState().upsertOODACycle(seed({ id: "c1", topic: "Test" }));

    const action = registry.get("tool.ooda_loop.advance_phase");
    for (const phase of ["observe", "orient", "decide"] as const) {
      const result = (await action!.handler(
        { id: "c1", phase, content: `set ${phase}` },
        ctx()
      )) as { updated: boolean; completed: boolean };
      expect(result.completed, `phase ${phase} must not auto-complete`).toBe(false);
    }

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(stored?.completedAt).toBeUndefined();
  });

  it("re-setting 'act' on an already-completed cycle is a content-only edit (preserves original completedAt)", async () => {
    // If we re-stamped completedAt on every act-edit, the timestamp
    // would silently drift from the actual closure moment — losing the
    // historical signal of when this cycle ended.
    const originalCompletedAt = "2024-01-15T10:30:00.000Z";
    useWorkspaceStore.getState().upsertOODACycle(
      seed({
        id: "c1",
        topic: "Already done",
        act: "first action",
        completedAt: originalCompletedAt,
      })
    );

    const action = registry.get("tool.ooda_loop.advance_phase");
    const result = (await action!.handler(
      { id: "c1", phase: "act", content: "updated retrospective notes" },
      ctx()
    )) as { updated: boolean; completed: boolean };
    expect(result.updated).toBe(true);
    // completed:false because the cycle was ALREADY completed — the
    // returned flag tracks the auto-complete SIDE EFFECT, not the
    // current state of completedAt.
    expect(result.completed).toBe(false);

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(stored?.act).toBe("updated retrospective notes");
    expect(stored?.completedAt).toBe(originalCompletedAt); // unchanged
  });

  it("returns {updated:false, completed:false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.ooda_loop.advance_phase");
    const result = (await action!.handler(
      { id: "does-not-exist", phase: "observe", content: "anything" },
      ctx()
    )) as { updated: boolean; completed: boolean };
    expect(result.updated).toBe(false);
    expect(result.completed).toBe(false);
  });

  it("preserves all other fields when setting one phase (no patch leak)", async () => {
    useWorkspaceStore.getState().upsertOODACycle(
      seed({
        id: "c1",
        topic: "Multi-field cycle",
        observe: "keep me",
        orient: "keep me",
        decide: "keep me",
      })
    );

    const action = registry.get("tool.ooda_loop.advance_phase");
    await action!.handler({ id: "c1", phase: "orient", content: "new orient" }, ctx());

    const updated = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(updated?.topic).toBe("Multi-field cycle");
    expect(updated?.observe).toBe("keep me");
    expect(updated?.orient).toBe("new orient");
    expect(updated?.decide).toBe("keep me");
  });
});

describe("tool.ooda_loop.complete_cycle — manual completion", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ oodaCycles: [] });
  });

  it("stamps completedAt with the current time when no timestamp is supplied", async () => {
    useWorkspaceStore.getState().upsertOODACycle(seed({ id: "c1", topic: "Abandoned" }));

    const before = Date.now();
    const action = registry.get("tool.ooda_loop.complete_cycle");
    const result = (await action!.handler({ id: "c1" }, ctx())) as { updated: boolean };
    const after = Date.now();
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(stored?.completedAt).toBeDefined();
    const stampedAt = Date.parse(stored!.completedAt!);
    expect(stampedAt).toBeGreaterThanOrEqual(before);
    expect(stampedAt).toBeLessThanOrEqual(after);
  });

  it("respects a custom completedAt for backdating", async () => {
    useWorkspaceStore.getState().upsertOODACycle(seed({ id: "c1", topic: "Old" }));

    const backdated = "2023-06-01T12:00:00.000Z";
    const action = registry.get("tool.ooda_loop.complete_cycle");
    await action!.handler({ id: "c1", completedAt: backdated }, ctx());

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(stored?.completedAt).toBe(backdated);
  });

  it("returns {updated:false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.ooda_loop.complete_cycle");
    const result = (await action!.handler({ id: "does-not-exist" }, ctx())) as { updated: boolean };
    expect(result.updated).toBe(false);
  });

  it("does not clobber existing phase text", async () => {
    useWorkspaceStore.getState().upsertOODACycle(
      seed({
        id: "c1",
        topic: "Half done, giving up",
        observe: "saw it",
        orient: "understood it",
      })
    );

    const action = registry.get("tool.ooda_loop.complete_cycle");
    await action!.handler({ id: "c1" }, ctx());

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === "c1");
    expect(stored?.observe).toBe("saw it");
    expect(stored?.orient).toBe("understood it");
    expect(stored?.completedAt).toBeDefined();
  });
});

describe("tool.ooda_loop.start_cycle — convenience create", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ oodaCycles: [] });
  });

  it("creates a new cycle and returns its id", async () => {
    const action = registry.get("tool.ooda_loop.start_cycle");
    const result = (await action!.handler({ topic: "Surprise outage" }, ctx())) as { id: string };
    expect(result.id).toMatch(/^ooda_/);

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === result.id);
    expect(stored).toBeDefined();
    expect(stored?.topic).toBe("Surprise outage");
    // Phase fields not set by start_cycle — agent fills them via advance_phase.
    expect(stored?.observe).toBeUndefined();
    expect(stored?.completedAt).toBeUndefined();
  });

  it("defaults startedAt to the current time", async () => {
    const before = Date.now();
    const action = registry.get("tool.ooda_loop.start_cycle");
    const result = (await action!.handler({ topic: "Now" }, ctx())) as { id: string };
    const after = Date.now();

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === result.id);
    const startedAtMs = Date.parse(stored!.startedAt);
    expect(startedAtMs).toBeGreaterThanOrEqual(before);
    expect(startedAtMs).toBeLessThanOrEqual(after);
  });

  it("respects a custom startedAt", async () => {
    const earlier = "2024-03-10T08:00:00.000Z";
    const action = registry.get("tool.ooda_loop.start_cycle");
    const result = (await action!.handler({ topic: "Backfilled", startedAt: earlier }, ctx())) as {
      id: string;
    };

    const stored = (useWorkspaceStore.getState().oodaCycles ?? []).find((c) => c.id === result.id);
    expect(stored?.startedAt).toBe(earlier);
  });

  it("a freshly-started cycle shows up in list_state.active immediately", async () => {
    const start = registry.get("tool.ooda_loop.start_cycle");
    const { id } = (await start!.handler({ topic: "Round-trip check" }, ctx())) as { id: string };

    const list = registry.get("tool.ooda_loop.list_state");
    const result = (await list!.handler({}, ctx())) as {
      active: OODACycle[];
      completed: OODACycle[];
    };
    expect(result.active.some((c) => c.id === id)).toBe(true);
    expect(result.completed.some((c) => c.id === id)).toBe(false);
  });
});
