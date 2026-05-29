/**
 * tool.incident_commander.* coverage (singleton doc, S8).
 *
 *   1. registration — list_state read; open/status/role/timeline/remove write.
 *   2. open_incident — active, severity tally, avgMttrHours null until resolved.
 *   3. add_timeline_entry — appends; unknown incident → {added:false}.
 *   4. set_status — resolved stamps resolvedAt; activeCount drops.
 *   5. assign_role / remove_incident — by id; unknown → false.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/incident-commander";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const call = (verb: string, params: Record<string, unknown>) =>
  registry.get(`tool.incident_commander.${verb}`)!.handler(params, ctx());
const list = () =>
  call("list_state", {}) as Promise<{
    exists: boolean;
    total: number;
    activeCount: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    avgMttrHours: number | null;
    incidents: {
      id: string;
      status: string;
      severity: string;
      commander?: string;
      timelineCount: number;
      resolvedAt?: string;
    }[];
  }>;

describe("tool.incident_commander — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.incident_commander.list_state")?.category).toBe("read");
    for (const verb of [
      "open_incident",
      "set_status",
      "assign_role",
      "add_timeline_entry",
      "remove_incident",
    ]) {
      expect(registry.get(`tool.incident_commander.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.incident_commander.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.incident_commander.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.incident_commander — lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ incidentCommanders: [] }));

  it("opens, logs timeline, resolves with MTTR, assigns roles, removes", async () => {
    const a = (await call("open_incident", {
      title: "API 500s",
      severity: "sev1",
      commander: "Ada",
    })) as { opened: boolean; id: string };
    expect(a.opened).toBe(true);

    let r = await list();
    expect(r.exists).toBe(true);
    expect(r.total).toBe(1);
    expect(r.activeCount).toBe(1);
    expect(r.byStatus.active).toBe(1);
    expect(r.bySeverity.sev1).toBe(1);
    expect(r.avgMttrHours).toBeNull(); // nothing resolved yet
    expect(r.incidents[0].commander).toBe("Ada");
    expect(r.incidents[0].timelineCount).toBe(0);

    // timeline
    const te = (await call("add_timeline_entry", {
      incidentId: a.id,
      text: "Paged on-call",
      author: "Ada",
    })) as { added: boolean; id: string };
    expect(te.added).toBe(true);
    const teBad = (await call("add_timeline_entry", {
      incidentId: "nope",
      text: "x",
    })) as { added: boolean };
    expect(teBad.added).toBe(false);
    r = await list();
    expect(r.incidents[0].timelineCount).toBe(1);

    // mitigate (still counts as active), then resolve
    await call("set_status", { incidentId: a.id, status: "mitigated" });
    r = await list();
    expect(r.activeCount).toBe(1);
    expect(r.byStatus.mitigated).toBe(1);

    const res = (await call("set_status", { incidentId: a.id, status: "resolved" })) as {
      updated: boolean;
    };
    expect(res.updated).toBe(true);
    r = await list();
    expect(r.activeCount).toBe(0);
    expect(r.byStatus.resolved).toBe(1);
    expect(r.incidents[0].resolvedAt).toBeTruthy();
    expect(typeof r.avgMttrHours).toBe("number");
    expect(r.avgMttrHours!).toBeGreaterThanOrEqual(0);

    const stBad = (await call("set_status", { incidentId: "nope", status: "active" })) as {
      updated: boolean;
    };
    expect(stBad.updated).toBe(false);

    // assign scribe; unknown id → false
    const role = (await call("assign_role", {
      incidentId: a.id,
      role: "scribe",
      value: "Grace",
    })) as { updated: boolean };
    expect(role.updated).toBe(true);
    const roleBad = (await call("assign_role", {
      incidentId: "nope",
      role: "commander",
      value: "x",
    })) as { updated: boolean };
    expect(roleBad.updated).toBe(false);

    // remove
    const rm = (await call("remove_incident", { incidentId: a.id })) as { removed: boolean };
    expect(rm.removed).toBe(true);
    const rmBad = (await call("remove_incident", { incidentId: a.id })) as { removed: boolean };
    expect(rmBad.removed).toBe(false);
    r = await list();
    expect(r.total).toBe(0);
  });
});
