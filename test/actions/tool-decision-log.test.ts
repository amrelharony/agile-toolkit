/**
 * tool.decision_log.* action coverage (Wave 2 — CRUD-backed tools).
 *
 * Follows the wsjf canonical test pattern, adapted for the CRUD-backed
 * (no calculator) shape:
 *   - list_state instead of compute_score/compute_and_rank
 *   - set_status instead of persist_*
 *   - tool-specific lifecycle verbs (supersede, add_alternative)
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Decision } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/decision-log";

const EXPECTED_ACTIONS = [
  "tool.decision_log.list_state",
  "tool.decision_log.set_status",
  "tool.decision_log.supersede",
  "tool.decision_log.add_alternative",
] as const;

function ctx() {
  // Lightweight context for handler tests. Browser-path handlers don't
  // touch ctx.userId at all, but we supply a value so the type is happy.
  // Tests needing different values (e.g. attaching a confirm fn) can
  // spread: { ...ctx(), confirm: async () => false }.
  return {
    userId: "test-user",
    source: "agent" as const,
    squadProfileIds: [] as string[],
  };
}

/** Build a baseline ADR row with the required fields populated and the
 *  optional ones at their natural defaults. Tests override only what
 *  they're exercising to keep the assertions terse. */
function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: overrides.id ?? "dec_test_1",
    title: overrides.title ?? "Use Postgres for event log",
    context: overrides.context,
    decision: overrides.decision ?? "We will use Postgres.",
    consequences: overrides.consequences,
    alternatives: overrides.alternatives,
    status: overrides.status ?? "proposed",
    date: overrides.date ?? "2026-05-28",
  };
}

describe("tool.decision_log — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("list_state is category=read; mutating actions are category=write", () => {
    expect(registry.get("tool.decision_log.list_state")?.category).toBe("read");
    expect(registry.get("tool.decision_log.set_status")?.category).toBe("write");
    expect(registry.get("tool.decision_log.supersede")?.category).toBe("write");
    expect(registry.get("tool.decision_log.add_alternative")?.category).toBe("write");
  });

  it("write actions are statically requiresConfirmation:false", () => {
    // Per task design: set_status delegates confirmation to ctx.confirm
    // only for lifecycle-terminal transitions, so static is false.
    expect(registry.get("tool.decision_log.set_status")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.decision_log.supersede")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.decision_log.add_alternative")?.requiresConfirmation).toBe(false);
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.decision_log.set_status")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.decision_log.supersede")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.decision_log.add_alternative")?.mcpHandler).toBeTypeOf("function");
  });

  it("list_state also has an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.decision_log.list_state")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.decision_log.list_state — summary + byStatus", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ decisions: [] });
  });

  it("returns zeroed byStatus + empty items when the workspace is empty", async () => {
    const action = registry.get("tool.decision_log.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      byStatus: Record<Decision["status"], number>;
      items: Decision[];
    };
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    // Every status key is initialised so the agent can index without
    // an existence check — critical for "is byStatus.accepted > 0?"
    // patterns the agent uses in planning.
    expect(result.byStatus).toEqual({
      proposed: 0,
      accepted: 0,
      deprecated: 0,
      superseded: 0,
    });
  });

  it("counts decisions by status and returns all items", async () => {
    const seeds: Decision[] = [
      makeDecision({ id: "d1", status: "proposed" }),
      makeDecision({ id: "d2", status: "accepted" }),
      makeDecision({ id: "d3", status: "accepted" }),
      makeDecision({ id: "d4", status: "deprecated" }),
      makeDecision({ id: "d5", status: "superseded" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertDecision(s);

    const action = registry.get("tool.decision_log.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      byStatus: Record<Decision["status"], number>;
      items: Decision[];
    };
    expect(result.total).toBe(5);
    expect(result.byStatus).toEqual({
      proposed: 1,
      accepted: 2,
      deprecated: 1,
      superseded: 1,
    });
    expect(result.items).toHaveLength(5);
  });

  it("silently skips items with an out-of-enum status (defensive)", async () => {
    // Hand-crafted legacy / imported row with a bogus status — would
    // otherwise NaN the byStatus bucket. Mirrors the same defensive
    // guard in decision-log-client.tsx:122.
    const seeds = [
      makeDecision({ id: "d1", status: "proposed" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...makeDecision({ id: "d2" }), status: "weird" as any } as Decision,
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertDecision(s);

    const action = registry.get("tool.decision_log.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      byStatus: Record<Decision["status"], number>;
      items: Decision[];
    };
    // Total includes the bogus row (it IS in the workspace), but
    // byStatus only buckets known statuses.
    expect(result.total).toBe(2);
    expect(result.byStatus.proposed).toBe(1);
    expect(Object.values(result.byStatus).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("tool.decision_log.set_status — lifecycle transition", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ decisions: [] });
  });

  it("updates status and writes back to the store", async () => {
    useWorkspaceStore.getState().upsertDecision(makeDecision({ id: "d1", status: "proposed" }));

    const action = registry.get("tool.decision_log.set_status");
    const result = (await action!.handler({ id: "d1", status: "accepted" }, ctx())) as {
      updated: boolean;
    };

    expect(result.updated).toBe(true);
    const stored = useWorkspaceStore.getState().decisions.find((d) => d.id === "d1");
    expect(stored?.status).toBe("accepted");
  });

  it("returns {updated:false} for an unknown id without throwing", async () => {
    const action = registry.get("tool.decision_log.set_status");
    const result = (await action!.handler({ id: "missing", status: "accepted" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(false);
  });

  it("does NOT call ctx.confirm for non-terminal transitions (proposed → accepted)", async () => {
    useWorkspaceStore.getState().upsertDecision(makeDecision({ id: "d1", status: "proposed" }));
    let confirmCalls = 0;
    const action = registry.get("tool.decision_log.set_status");
    const result = (await action!.handler(
      { id: "d1", status: "accepted" },
      {
        ...ctx(),
        confirm: async () => {
          confirmCalls += 1;
          return true;
        },
      }
    )) as { updated: boolean };
    expect(result.updated).toBe(true);
    expect(confirmCalls).toBe(0);
  });

  it("DOES call ctx.confirm for transitions to 'deprecated' and writes when approved", async () => {
    useWorkspaceStore.getState().upsertDecision(makeDecision({ id: "d1", status: "accepted" }));
    let lastSummary = "";
    const action = registry.get("tool.decision_log.set_status");
    const result = (await action!.handler(
      { id: "d1", status: "deprecated" },
      {
        ...ctx(),
        confirm: async (summary) => {
          lastSummary = summary;
          return true;
        },
      }
    )) as { updated: boolean };
    expect(result.updated).toBe(true);
    expect(lastSummary).toMatch(/deprecated/);
    expect(useWorkspaceStore.getState().decisions.find((d) => d.id === "d1")?.status).toBe(
      "deprecated"
    );
  });

  it("DOES call ctx.confirm for 'superseded' and aborts when denied", async () => {
    useWorkspaceStore.getState().upsertDecision(makeDecision({ id: "d1", status: "accepted" }));
    const action = registry.get("tool.decision_log.set_status");
    const result = (await action!.handler(
      { id: "d1", status: "superseded" },
      {
        ...ctx(),
        confirm: async () => false,
      }
    )) as { updated: boolean; confirmed?: boolean };
    expect(result.updated).toBe(false);
    expect(result.confirmed).toBe(false);
    // Store is unchanged — the deny path must not write.
    expect(useWorkspaceStore.getState().decisions.find((d) => d.id === "d1")?.status).toBe(
      "accepted"
    );
  });
});

describe("tool.decision_log.supersede — lifecycle verb", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ decisions: [] });
  });

  it("marks the old ADR superseded and appends a forward-reference note", async () => {
    useWorkspaceStore
      .getState()
      .upsertDecision(
        makeDecision({ id: "old", status: "accepted", consequences: "Prior consequences text." })
      );

    const action = registry.get("tool.decision_log.supersede");
    const result = (await action!.handler({ id: "old", supersededBy: "new" }, ctx())) as {
      superseded: boolean;
    };

    expect(result.superseded).toBe(true);
    const stored = useWorkspaceStore.getState().decisions.find((d) => d.id === "old");
    expect(stored?.status).toBe("superseded");
    expect(stored?.consequences).toMatch(/Prior consequences text\./);
    expect(stored?.consequences).toMatch(/Superseded by new/);
  });

  it("includes the optional reason in the appended note", async () => {
    useWorkspaceStore.getState().upsertDecision(makeDecision({ id: "old", status: "accepted" }));

    const action = registry.get("tool.decision_log.supersede");
    await action!.handler(
      { id: "old", supersededBy: "new", reason: "Replaced after performance review." },
      ctx()
    );
    const stored = useWorkspaceStore.getState().decisions.find((d) => d.id === "old");
    expect(stored?.consequences).toMatch(/Superseded by new\. Replaced after performance review\./);
  });

  it("handles empty consequences without a leading newline", async () => {
    // Regression: prior shape was `\n\nSuperseded by ...` when there
    // was no prior text. The leading blank lines would render as a
    // weird gap in markdown. Builder collapses to bare note when
    // existing consequences is empty.
    useWorkspaceStore
      .getState()
      .upsertDecision(makeDecision({ id: "old", status: "accepted", consequences: undefined }));
    const action = registry.get("tool.decision_log.supersede");
    await action!.handler({ id: "old", supersededBy: "new" }, ctx());
    const stored = useWorkspaceStore.getState().decisions.find((d) => d.id === "old");
    expect(stored?.consequences).toBe("Superseded by new");
  });

  it("is idempotent — second call with the same supersededBy is a no-op", async () => {
    useWorkspaceStore.getState().upsertDecision(makeDecision({ id: "old", status: "accepted" }));
    const action = registry.get("tool.decision_log.supersede");

    const first = (await action!.handler({ id: "old", supersededBy: "new" }, ctx())) as {
      superseded: boolean;
    };
    expect(first.superseded).toBe(true);

    const consequencesAfterFirst = useWorkspaceStore
      .getState()
      .decisions.find((d) => d.id === "old")?.consequences;

    const second = (await action!.handler({ id: "old", supersededBy: "new" }, ctx())) as {
      superseded: boolean;
      alreadySuperseded?: boolean;
    };
    expect(second.superseded).toBe(false);
    expect(second.alreadySuperseded).toBe(true);

    // Consequences MUST be byte-identical — no double-append.
    const consequencesAfterSecond = useWorkspaceStore
      .getState()
      .decisions.find((d) => d.id === "old")?.consequences;
    expect(consequencesAfterSecond).toBe(consequencesAfterFirst);
  });

  it("returns {superseded:false, reason:'not_found'} for an unknown id", async () => {
    const action = registry.get("tool.decision_log.supersede");
    const result = (await action!.handler({ id: "missing", supersededBy: "new" }, ctx())) as {
      superseded: boolean;
      reason?: string;
    };
    expect(result.superseded).toBe(false);
    expect(result.reason).toBe("not_found");
  });
});

describe("tool.decision_log.add_alternative — idempotent append", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ decisions: [] });
  });

  it("appends to alternatives[] and reports added:true", async () => {
    useWorkspaceStore.getState().upsertDecision(makeDecision({ id: "d1", alternatives: ["A"] }));
    const action = registry.get("tool.decision_log.add_alternative");
    const result = (await action!.handler(
      { id: "d1", alternative: "B — rejected because Y" },
      ctx()
    )) as { added: boolean };
    expect(result.added).toBe(true);
    const stored = useWorkspaceStore.getState().decisions.find((d) => d.id === "d1");
    expect(stored?.alternatives).toEqual(["A", "B — rejected because Y"]);
  });

  it("initialises alternatives[] when the field was undefined", async () => {
    useWorkspaceStore
      .getState()
      .upsertDecision(makeDecision({ id: "d1", alternatives: undefined }));
    const action = registry.get("tool.decision_log.add_alternative");
    await action!.handler({ id: "d1", alternative: "first" }, ctx());
    const stored = useWorkspaceStore.getState().decisions.find((d) => d.id === "d1");
    expect(stored?.alternatives).toEqual(["first"]);
  });

  it("is idempotent — duplicate alternative returns added:false and does not double", async () => {
    useWorkspaceStore
      .getState()
      .upsertDecision(makeDecision({ id: "d1", alternatives: ["Option A"] }));
    const action = registry.get("tool.decision_log.add_alternative");
    const result = (await action!.handler({ id: "d1", alternative: "Option A" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(false);
    expect(useWorkspaceStore.getState().decisions.find((d) => d.id === "d1")?.alternatives).toEqual(
      ["Option A"]
    );
  });

  it("returns added:false for an unknown id", async () => {
    const action = registry.get("tool.decision_log.add_alternative");
    const result = (await action!.handler({ id: "missing", alternative: "X" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(false);
  });
});
