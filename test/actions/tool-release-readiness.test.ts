/**
 * tool.release_readiness.* coverage (singleton doc, S8).
 *
 *   1. registration — list_state read; add/toggle/ship/set_status/remove write.
 *   2. add_release — starts in planning with all 9 gates open.
 *   3. toggle_gate — flips a gate; unknown release/gate → {updated:false}.
 *   4. ship_release — snapshots gatesOpenAtShip; unknown id → {shipped:false}.
 *   5. set_status — planning/rolled_back transitions; remove_release.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/release-readiness";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const add = (name: string) =>
  registry.get("tool.release_readiness.add_release")!.handler({ name }, ctx()) as Promise<{
    added: boolean;
    id: string;
  }>;
const list = () =>
  registry.get("tool.release_readiness.list_state")!.handler({}, ctx()) as Promise<{
    exists: boolean;
    total: number;
    byStatus: Record<string, number>;
    releases: {
      id: string;
      status: string;
      gatesPassed: number;
      gatesTotal: number;
      allGatesPassed: boolean;
      gatesOpenAtShip?: number;
    }[];
  }>;

describe("tool.release_readiness — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.release_readiness.list_state")?.category).toBe("read");
    for (const verb of [
      "add_release",
      "toggle_gate",
      "ship_release",
      "set_status",
      "remove_release",
    ]) {
      expect(registry.get(`tool.release_readiness.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.release_readiness.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.release_readiness.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.release_readiness — gates, ship, status", () => {
  beforeEach(() => useWorkspaceStore.setState({ releaseReadinesses: [] }));

  it("adds a release with all gates open, toggles, and ships with a snapshot", async () => {
    const a = await add("v2.0");

    let r = await list();
    expect(r.exists).toBe(true);
    expect(r.total).toBe(1);
    expect(r.byStatus.planning).toBe(1);
    const rel = r.releases[0];
    expect(rel.gatesTotal).toBe(9);
    expect(rel.gatesPassed).toBe(0);
    expect(rel.allGatesPassed).toBe(false);

    // toggle one gate on
    const tg = (await registry
      .get("tool.release_readiness.toggle_gate")!
      .handler({ releaseId: a.id, gate: "a11y_audit", passed: true }, ctx())) as {
      updated: boolean;
    };
    expect(tg.updated).toBe(true);
    r = await list();
    expect(r.releases[0].gatesPassed).toBe(1);

    // unknown release / unknown gate → not updated
    const badRel = (await registry
      .get("tool.release_readiness.toggle_gate")!
      .handler({ releaseId: "nope", gate: "a11y_audit", passed: true }, ctx())) as {
      updated: boolean;
    };
    expect(badRel.updated).toBe(false);
    const badGate = (await registry
      .get("tool.release_readiness.toggle_gate")!
      .handler({ releaseId: a.id, gate: "not_a_gate", passed: true }, ctx())) as {
      updated: boolean;
    };
    expect(badGate.updated).toBe(false);

    // ship with 8 gates still open
    const shipped = (await registry
      .get("tool.release_readiness.ship_release")!
      .handler({ releaseId: a.id }, ctx())) as { shipped: boolean; gatesOpenAtShip: number };
    expect(shipped.shipped).toBe(true);
    expect(shipped.gatesOpenAtShip).toBe(8);
    r = await list();
    expect(r.releases[0].status).toBe("shipped");
    expect(r.releases[0].gatesOpenAtShip).toBe(8);

    const shipBad = (await registry
      .get("tool.release_readiness.ship_release")!
      .handler({ releaseId: "nope" }, ctx())) as { shipped: boolean };
    expect(shipBad.shipped).toBe(false);

    // roll back, then reopen for planning
    const rb = (await registry
      .get("tool.release_readiness.set_status")!
      .handler({ releaseId: a.id, status: "rolled_back" }, ctx())) as { updated: boolean };
    expect(rb.updated).toBe(true);
    r = await list();
    expect(r.releases[0].status).toBe("rolled_back");

    // remove
    const rm = (await registry
      .get("tool.release_readiness.remove_release")!
      .handler({ releaseId: a.id }, ctx())) as { removed: boolean };
    expect(rm.removed).toBe(true);
    r = await list();
    expect(r.total).toBe(0);
  });
});

describe("tool.release_readiness — reopen and planned date", () => {
  beforeEach(() => useWorkspaceStore.setState({ releaseReadinesses: [] }));

  const doc = () => (useWorkspaceStore.getState().releaseReadinesses ?? [])[0];

  it("reopening for planning clears the ship date; rolling back keeps it", async () => {
    const a = await add("v2.1");
    await registry.get("tool.release_readiness.ship_release")!.handler({ releaseId: a.id }, ctx());
    const shippedDate = doc().releases[0].shippedDate;
    expect(shippedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await registry
      .get("tool.release_readiness.set_status")!
      .handler({ releaseId: a.id, status: "rolled_back" }, ctx());
    expect(doc().releases[0]).toMatchObject({ status: "rolled_back", shippedDate });

    await registry
      .get("tool.release_readiness.set_status")!
      .handler({ releaseId: a.id, status: "planning" }, ctx());
    expect(doc().releases[0].status).toBe("planning");
    expect(doc().releases[0].shippedDate).toBeUndefined();
  });

  it("keeps an explicit planned date and description", async () => {
    await registry
      .get("tool.release_readiness.add_release")!
      .handler({ name: "v3", plannedDate: "2026-12-01", description: "Q4 train" }, ctx());
    expect(doc().releases[0]).toMatchObject({
      name: "v3",
      plannedDate: "2026-12-01",
      description: "Q4 train",
      status: "planning",
    });
  });

  it("returns updated:false / removed:false for an unknown id", async () => {
    await add("v4");
    const st = (await registry
      .get("tool.release_readiness.set_status")!
      .handler({ releaseId: "nope", status: "planning" }, ctx())) as { updated: boolean };
    const rm = (await registry
      .get("tool.release_readiness.remove_release")!
      .handler({ releaseId: "nope" }, ctx())) as { removed: boolean };
    expect(st.updated).toBe(false);
    expect(rm.removed).toBe(false);
    expect(doc().releases).toHaveLength(1);
  });
});

// Bug: "today" was the UTC date (toISOString), while the tool compares local
// planned and ship dates — near midnight away from UTC an agent's ship landed
// on the wrong day and could flip "% on time".
describe("tool.release_readiness — dates are the user's local day", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    useWorkspaceStore.setState({ releaseReadinesses: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["just after local midnight", new Date(2026, 9, 23, 0, 30)],
    ["just before local midnight", new Date(2026, 9, 23, 23, 30)],
  ])("defaults plannedDate and stamps shippedDate %s", async (_when, now) => {
    vi.setSystemTime(now);
    const a = await add("late night");
    await registry.get("tool.release_readiness.ship_release")!.handler({ releaseId: a.id }, ctx());
    const r = (useWorkspaceStore.getState().releaseReadinesses ?? [])[0].releases[0];
    expect(r.plannedDate).toBe("2026-10-23");
    expect(r.shippedDate).toBe("2026-10-23");
  });
});
