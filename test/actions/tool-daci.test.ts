/**
 * tool.daci.* action coverage.
 *
 * Decision-CRUD variant of the squad-13 test pattern. Unlike the
 * calculator tools (WSJF / RICE / ICE), DACI has no pure score formula
 * to assert — it's a record-keeping entity. Instead we cover:
 *
 *   1. all 4 actions registered with the right category split
 *   2. write actions all expose an mcpHandler (server-side path)
 *   3. list_state returns initialised byStatus buckets even when empty
 *      AND aggregates correctly across mixed-status seeds
 *   4. set_status updates an existing decision AND returns {updated:false}
 *      for an unknown id (no throw)
 *   5. add_contributor is idempotent — second call with same name is a no-op
 *      AND returns {added:false} for an unknown id
 *   6. add_informed mirrors add_contributor's semantics on its own slot
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DACIDecision } from "@/lib/stores/workspace-types";
import { allDecisions } from "@/lib/decisions/model";
import { daciView } from "@/lib/actions/tools/daci";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/daci";

const EXPECTED_ACTIONS = [
  "tool.daci.list_state",
  "tool.daci.set_status",
  "tool.daci.add_contributor",
  "tool.daci.add_informed",
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

/** Build a fully-formed DACIDecision for seeding the store. The required
 *  fields are id / title / status / date; everything else is optional. */
function seed(partial: Partial<DACIDecision> & Pick<DACIDecision, "id" | "title">): DACIDecision {
  return {
    status: "open",
    date: new Date().toISOString(),
    ...partial,
  };
}

/**
 * The record as the DACI alias reads it: the merged decision (a Decision
 * saved under the id shadows the old row) in DACI's old shape.
 */
function stored(id: string) {
  const ws = useWorkspaceStore.getState();
  const d = allDecisions(ws.decisions, ws.daciDecisions, ws.rapidDecisions).find(
    (x) => x.id === id
  );
  return d ? daciView(d, "2026-10-27") : undefined;
}

describe("tool.daci — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("list_state is category=read; mutation actions are category=write", () => {
    expect(registry.get("tool.daci.list_state")?.category).toBe("read");
    expect(registry.get("tool.daci.set_status")?.category).toBe("write");
    expect(registry.get("tool.daci.add_contributor")?.category).toBe("write");
    expect(registry.get("tool.daci.add_informed")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.daci.set_status")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.daci.add_contributor")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.daci.add_informed")?.mcpHandler).toBeTypeOf("function");
  });

  it("add_* actions are requiresConfirmation=false (additive, no destruction)", () => {
    expect(registry.get("tool.daci.add_contributor")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.daci.add_informed")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.daci.list_state — summary + roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ decisions: [], daciDecisions: [] });
  });

  it("returns zeroed buckets and empty items when the workspace is empty", async () => {
    const action = registry.get("tool.daci.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      byStatus: { open: number; decided: number; implemented: number; revisit: number };
      items: DACIDecision[];
    };
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    // Every bucket initialised — agent can read byStatus.open without
    // an existence check even on an empty workspace.
    expect(result.byStatus).toEqual({
      open: 0,
      decided: 0,
      implemented: 0,
      revisit: 0,
    });
  });

  it("aggregates byStatus correctly across mixed-status seeds", async () => {
    const seeds: DACIDecision[] = [
      seed({ id: "d1", title: "Pricing model", status: "open" }),
      seed({ id: "d2", title: "Region launch", status: "open" }),
      seed({ id: "d3", title: "Vendor choice", status: "decided" }),
      seed({ id: "d4", title: "Migration plan", status: "implemented" }),
      seed({ id: "d5", title: "Old hire policy", status: "revisit" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertDACIDecision(s);

    const action = registry.get("tool.daci.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      byStatus: Record<DACIDecision["status"], number>;
      items: DACIDecision[];
    };
    expect(result.total).toBe(5);
    expect(result.byStatus.open).toBe(2);
    expect(result.byStatus.decided).toBe(1);
    expect(result.byStatus.implemented).toBe(1);
    expect(result.byStatus.revisit).toBe(1);
    expect(result.items).toHaveLength(5);
  });
});

describe("tool.daci.set_status — convenience update", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ decisions: [], daciDecisions: [] });
  });

  it("updates an existing decision's status and returns {updated: true}", async () => {
    // Deciding needs the Approver named, as on the page.
    useWorkspaceStore
      .getState()
      .upsertDACIDecision(seed({ id: "d1", title: "Pricing", status: "open", approver: "Bob" }));

    const action = registry.get("tool.daci.set_status");
    const result = (await action!.handler({ id: "d1", status: "decided" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);

    expect(stored("d1")?.status).toBe("decided");
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.daci.set_status");
    const result = (await action!.handler({ id: "does-not-exist", status: "decided" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(false);
  });

  it("preserves all other fields when setting status (no patch leak)", async () => {
    useWorkspaceStore.getState().upsertDACIDecision(
      seed({
        id: "d2",
        title: "Vendor choice",
        status: "open",
        driver: "Alice",
        approver: "Bob",
        contributors: ["Carol"],
        recommendation: "Pick Vendor X",
      })
    );

    const action = registry.get("tool.daci.set_status");
    await action!.handler({ id: "d2", status: "decided" }, ctx());

    const updated = stored("d2");
    expect(updated?.driver).toBe("Alice");
    expect(updated?.approver).toBe("Bob");
    expect(updated?.contributors).toEqual(["Carol"]);
    expect(updated?.recommendation).toBe("Pick Vendor X");
  });
});

describe("tool.daci.add_contributor — idempotent append", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ decisions: [], daciDecisions: [] });
  });

  it("appends to an empty contributors list and returns {added: true}", async () => {
    useWorkspaceStore
      .getState()
      .upsertDACIDecision(seed({ id: "d1", title: "Pricing", contributors: [] }));

    const action = registry.get("tool.daci.add_contributor");
    const result = (await action!.handler({ id: "d1", contributor: "Alice" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(true);

    const row = stored("d1");
    expect(row?.contributors).toEqual(["Alice"]);
  });

  it("is idempotent — second call with same name returns {added: false}", async () => {
    useWorkspaceStore
      .getState()
      .upsertDACIDecision(seed({ id: "d1", title: "Pricing", contributors: ["Alice"] }));

    const action = registry.get("tool.daci.add_contributor");
    const result = (await action!.handler({ id: "d1", contributor: "Alice" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(false);

    const row = stored("d1");
    expect(row?.contributors).toEqual(["Alice"]); // not duplicated
  });

  it("appends to an absent contributors slot (undefined → [name])", async () => {
    // The DACI type has contributors?: string[] — a freshly-created
    // decision may omit it entirely. add_contributor must still work.
    useWorkspaceStore.getState().upsertDACIDecision(seed({ id: "d2", title: "Vendor choice" })); // no contributors

    const action = registry.get("tool.daci.add_contributor");
    const result = (await action!.handler({ id: "d2", contributor: "Dan" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(true);

    const row = stored("d2");
    expect(row?.contributors).toEqual(["Dan"]);
  });

  it("returns {added: false} for an unknown id", async () => {
    const action = registry.get("tool.daci.add_contributor");
    const result = (await action!.handler(
      { id: "does-not-exist", contributor: "Alice" },
      ctx()
    )) as { added: boolean };
    expect(result.added).toBe(false);
  });
});

describe("tool.daci.add_informed — idempotent append", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ decisions: [], daciDecisions: [] });
  });

  it("appends to an empty informed list and returns {added: true}", async () => {
    useWorkspaceStore
      .getState()
      .upsertDACIDecision(seed({ id: "d1", title: "Pricing", informed: [] }));

    const action = registry.get("tool.daci.add_informed");
    const result = (await action!.handler({ id: "d1", informed: "Eve" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(true);

    const row = stored("d1");
    expect(row?.informed).toEqual(["Eve"]);
  });

  it("is idempotent — second call with same name returns {added: false}", async () => {
    useWorkspaceStore
      .getState()
      .upsertDACIDecision(seed({ id: "d1", title: "Pricing", informed: ["Eve"] }));

    const action = registry.get("tool.daci.add_informed");
    const result = (await action!.handler({ id: "d1", informed: "Eve" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(false);

    const row = stored("d1");
    expect(row?.informed).toEqual(["Eve"]); // not duplicated
  });

  it("returns {added: false} for an unknown id", async () => {
    const action = registry.get("tool.daci.add_informed");
    const result = (await action!.handler({ id: "does-not-exist", informed: "Eve" }, ctx())) as {
      added: boolean;
    };
    expect(result.added).toBe(false);
  });
});
