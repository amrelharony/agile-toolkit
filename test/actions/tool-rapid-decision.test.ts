/**
 * tool.rapid_decision.* action coverage (squad S13, Wave 2).
 *
 * Mirrors the canonical wsjf test pattern but for a decision-CRUD tool
 * rather than a prioritization calculator. The key differences from the
 * calc-tool test shape:
 *
 *   - No pure-formula tests (RAPID has no scoring fn).
 *   - No framework-filter tests (rapidDecisions is its own collection).
 *   - Adds lifecycle + role-assignment assertions specific to RAPID.
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister, matching production's
 * one-time module load.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RAPIDDecision } from "@/lib/stores/workspace-types";
import { allDecisions } from "@/lib/decisions/model";
import { rapidView } from "@/lib/actions/tools/rapid-decision";
import { todayLocalISO } from "@/lib/utils/formatters";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/rapid-decision";

const EXPECTED_ACTIONS = [
  "tool.rapid_decision.list_state",
  "tool.rapid_decision.set_status",
  "tool.rapid_decision.assign_role",
  "tool.rapid_decision.set_decider",
  "tool.rapid_decision.set_recommend",
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

/**
 * The record as the RAPID alias reads it: the merged decision (a Decision
 * saved under the id shadows the old row) in RAPID's old shape.
 */
function stored(id = "d1") {
  const ws = useWorkspaceStore.getState();
  const d = allDecisions(ws.decisions, ws.daciDecisions, ws.rapidDecisions).find(
    (x) => x.id === id
  );
  return rapidView(d!, "2026-10-27");
}

/** Seed factory — a minimally-valid RAPIDDecision with sensible
 *  defaults the tests can override per-case. */
function seed(overrides: Partial<RAPIDDecision> = {}): RAPIDDecision {
  return {
    id: overrides.id ?? "rapid_seed",
    title: overrides.title ?? "Adopt new release-train cadence",
    context: overrides.context,
    recommend: overrides.recommend,
    agree: overrides.agree,
    perform: overrides.perform,
    input: overrides.input,
    decide: overrides.decide,
    status: overrides.status ?? "open",
    date: overrides.date ?? new Date().toISOString(),
  };
}

describe("tool.rapid_decision — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("list_state is category=read; mutators are category=write", () => {
    expect(registry.get("tool.rapid_decision.list_state")?.category).toBe("read");
    expect(registry.get("tool.rapid_decision.set_status")?.category).toBe("write");
    expect(registry.get("tool.rapid_decision.assign_role")?.category).toBe("write");
    expect(registry.get("tool.rapid_decision.set_decider")?.category).toBe("write");
    expect(registry.get("tool.rapid_decision.set_recommend")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.rapid_decision.set_status")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.rapid_decision.assign_role")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.rapid_decision.set_decider")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.rapid_decision.set_recommend")?.mcpHandler).toBeTypeOf("function");
  });

  it("additive write actions are NOT confirmation-gated by default", () => {
    // set_status uses a dynamic in-handler confirm for the implemented
    // transition, but the static flag stays false so other transitions
    // (open ↔ decided) don't gate. assign_role / set_decider /
    // set_recommend are pure appends/sets that the agent should be free
    // to chain without UI friction.
    expect(registry.get("tool.rapid_decision.set_status")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.rapid_decision.assign_role")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.rapid_decision.set_decider")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.rapid_decision.set_recommend")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.rapid_decision.list_state — snapshot + status histogram", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ decisions: [], rapidDecisions: [] });
  });

  it("returns empty state when the workspace has no decisions", async () => {
    const action = registry.get("tool.rapid_decision.list_state");
    const result = (await action!.handler({}, ctx())) as {
      items: RAPIDDecision[];
      byStatus: Record<string, number>;
      count: number;
    };
    expect(result.count).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.byStatus).toEqual({ open: 0, decided: 0, implemented: 0 });
  });

  it("computes a status histogram across all three lifecycle states", async () => {
    const seeds: RAPIDDecision[] = [
      seed({ id: "d1", status: "open" }),
      seed({ id: "d2", status: "open" }),
      seed({ id: "d3", status: "decided" }),
      seed({ id: "d4", status: "implemented" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertRAPIDDecision(s);

    const action = registry.get("tool.rapid_decision.list_state");
    const result = (await action!.handler({}, ctx())) as {
      items: RAPIDDecision[];
      byStatus: Record<string, number>;
      count: number;
    };
    expect(result.count).toBe(4);
    expect(result.byStatus).toEqual({ open: 2, decided: 1, implemented: 1 });
  });
});

describe("tool.rapid_decision.set_status — lifecycle transitions", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      decisions: [],
      // Deciding needs the Decide (D) named, as on the page.
      rapidDecisions: [seed({ id: "d1", status: "open", decide: "Morgan" })],
    });
  });

  it("transitions open → decided", async () => {
    const action = registry.get("tool.rapid_decision.set_status");
    const result = (await action!.handler({ id: "d1", status: "decided" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);
    expect(stored().status).toBe("decided");
  });

  it("open on a decided record reopens it today, as the page's Reopen does", async () => {
    useWorkspaceStore.setState({
      rapidDecisions: [
        seed({ id: "d1", status: "decided", decide: "Morgan", date: "2026-01-05T09:00:00.000Z" }),
      ],
    });
    const action = registry.get("tool.rapid_decision.set_status")!;
    const result = (await action.handler({ id: "d1", status: "open" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);
    const today = todayLocalISO();
    const saved = useWorkspaceStore.getState().decisions.find((d) => d.id === "d1")!;
    expect(saved).toMatchObject({ status: "proposed", reopenedAt: today });
    // Its wait counts from today, not from the day it was raised.
    expect(rapidView(saved, today).issues.map((i) => i.kind)).not.toContain("stale_proposed");
    expect(rapidView(saved, today).status).toBe("open");
  });

  it("returns updated=false for an unknown id (idempotent precheck-free)", async () => {
    const action = registry.get("tool.rapid_decision.set_status");
    const result = (await action!.handler({ id: "nonexistent", status: "decided" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(false);
  });

  it("returns updated=false (no-op) when status is unchanged", async () => {
    const action = registry.get("tool.rapid_decision.set_status");
    const result = (await action!.handler({ id: "d1", status: "open" }, ctx())) as {
      updated: boolean;
      reason?: string;
    };
    expect(result.updated).toBe(false);
    expect(result.reason).toBe("already-in-status");
  });

  it("transitions to 'implemented' when ctx.confirm approves", async () => {
    const action = registry.get("tool.rapid_decision.set_status");
    let confirmCalls = 0;
    const result = (await action!.handler(
      { id: "d1", status: "implemented" },
      {
        ...ctx(),
        confirm: async () => {
          confirmCalls++;
          return true;
        },
      }
    )) as { updated: boolean };
    expect(confirmCalls).toBe(1);
    expect(result.updated).toBe(true);
    expect(stored().status).toBe("implemented");
  });

  it("declines to transition to 'implemented' when ctx.confirm denies", async () => {
    const action = registry.get("tool.rapid_decision.set_status");
    const result = (await action!.handler(
      { id: "d1", status: "implemented" },
      { ...ctx(), confirm: async () => false }
    )) as { updated: boolean; reason?: string };
    expect(result.updated).toBe(false);
    expect(result.reason).toBe("declined");
    // Status must NOT have flipped.
    expect(stored().status).toBe("open");
  });
});

describe("tool.rapid_decision.assign_role — idempotent append to A/P/I roles", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      decisions: [],
      rapidDecisions: [seed({ id: "d1", agree: ["Sarah"], perform: [], input: [] })],
    });
  });

  it("appends a person to the agree role and returns added=true", async () => {
    const action = registry.get("tool.rapid_decision.assign_role");
    const result = (await action!.handler(
      { id: "d1", role: "agree", person: "Marcus" },
      ctx()
    )) as { added: boolean };
    expect(result.added).toBe(true);
    const row = stored();
    expect(row.agree).toEqual(["Sarah", "Marcus"]);
  });

  it("is idempotent: re-assigning the same person returns added=false", async () => {
    const action = registry.get("tool.rapid_decision.assign_role");
    const result = (await action!.handler({ id: "d1", role: "agree", person: "Sarah" }, ctx())) as {
      added: boolean;
      reason?: string;
    };
    expect(result.added).toBe(false);
    expect(result.reason).toBe("already-assigned");
    // Array must not have been mutated (no duplicate).
    const row = stored();
    expect(row.agree).toEqual(["Sarah"]);
  });

  it("works against each array role (perform, input)", async () => {
    const action = registry.get("tool.rapid_decision.assign_role");
    await action!.handler({ id: "d1", role: "perform", person: "Alice" }, ctx());
    await action!.handler({ id: "d1", role: "input", person: "Bob" }, ctx());
    const row = stored();
    expect(row.perform).toEqual(["Alice"]);
    expect(row.input).toEqual(["Bob"]);
  });

  it("trims whitespace before comparing, so '  Sarah  ' matches 'Sarah'", async () => {
    const action = registry.get("tool.rapid_decision.assign_role");
    const result = (await action!.handler(
      { id: "d1", role: "agree", person: "  Sarah  " },
      ctx()
    )) as { added: boolean; reason?: string };
    expect(result.added).toBe(false);
    expect(result.reason).toBe("already-assigned");
  });

  it("returns added=false with reason='not-found' for an unknown id", async () => {
    const action = registry.get("tool.rapid_decision.assign_role");
    const result = (await action!.handler(
      { id: "nonexistent", role: "agree", person: "Sarah" },
      ctx()
    )) as { added: boolean; reason?: string };
    expect(result.added).toBe(false);
    expect(result.reason).toBe("not-found");
  });

  it("rejects an empty / whitespace-only person at the schema layer", async () => {
    // z.string().min(1) catches truly empty; the trim check inside the
    // handler catches "   ". Both paths should be safe to call.
    const action = registry.get("tool.rapid_decision.assign_role");
    // Skip schema validation here (handler call bypasses paramsSchema)
    // and feed a whitespace-only string to exercise the handler guard.
    const result = (await action!.handler({ id: "d1", role: "agree", person: "   " }, ctx())) as {
      added: boolean;
      reason?: string;
    };
    expect(result.added).toBe(false);
    expect(result.reason).toBe("empty-person");
  });
});

describe("tool.rapid_decision.set_decider — overwrite singular D role", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      decisions: [],
      rapidDecisions: [seed({ id: "d1", decide: "Alice" })],
    });
  });

  it("overwrites the decide field with the new person", async () => {
    const action = registry.get("tool.rapid_decision.set_decider");
    const result = (await action!.handler({ id: "d1", person: "Bob" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);
    expect(stored().decide).toBe("Bob");
  });

  it("returns updated=false when the id is unknown", async () => {
    const action = registry.get("tool.rapid_decision.set_decider");
    const result = (await action!.handler({ id: "nonexistent", person: "Bob" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(false);
  });
});

describe("tool.rapid_decision.set_recommend — overwrite R field", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      decisions: [],
      rapidDecisions: [seed({ id: "d1", recommend: "Carol" })],
    });
  });

  it("overwrites the recommend field with the new value", async () => {
    const action = registry.get("tool.rapid_decision.set_recommend");
    const result = (await action!.handler(
      { id: "d1", recommendation: "Dana (Platform Eng)" },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(true);
    expect(stored().recommend).toBe("Dana (Platform Eng)");
  });

  it("returns updated=false when the id is unknown", async () => {
    const action = registry.get("tool.rapid_decision.set_recommend");
    const result = (await action!.handler(
      { id: "nonexistent", recommendation: "Dana" },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(false);
  });
});
