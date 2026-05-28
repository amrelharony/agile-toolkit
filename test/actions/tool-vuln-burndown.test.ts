/**
 * tool.vuln_burndown.* coverage (singleton doc, S9).
 *
 *   1. registration — list_state read; add_vuln/set_status write + mcpHandler
 *      + no confirm.
 *   2. list_state — bySeverity/byStatus/openCount + overdue (active past SLA).
 *   3. add_vuln — appends with default status "open" + openedAt.
 *   4. set_status — stamps resolvedAt on "resolved"; unknown → {updated:false}.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { VulnBurndown } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/vuln-burndown";

const VB_ID = "vulnBurndown:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.vuln_burndown — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.vuln_burndown.list_state")?.category).toBe("read");
    for (const verb of ["add_vuln", "set_status"]) {
      expect(registry.get(`tool.vuln_burndown.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.vuln_burndown.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.vuln_burndown.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.vuln_burndown.add_vuln + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ vulnBurndowns: [] }));

  it("appends with default status 'open' and openedAt", async () => {
    const r = (await registry
      .get("tool.vuln_burndown.add_vuln")!
      .handler({ severity: "high", slaTargetDays: 30 }, ctx())) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    const docs = useWorkspaceStore.getState().vulnBurndowns ?? [];
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(VB_ID);
    expect(docs[0].vulns[0].status).toBe("open");
    expect(docs[0].vulns[0].openedAt).toBeTruthy();
  });

  it("counts severity/status, open, and overdue (active past SLA)", async () => {
    useWorkspaceStore.setState({
      vulnBurndowns: [
        {
          id: VB_ID,
          vulns: [
            // active + opened long ago with a 7-day SLA → overdue
            {
              id: "v1",
              severity: "critical",
              status: "open",
              openedAt: "2020-01-01",
              slaTargetDays: 7,
            },
            // resolved → not open, not overdue
            {
              id: "v2",
              severity: "low",
              status: "resolved",
              openedAt: "2020-01-01",
              slaTargetDays: 7,
              resolvedAt: "2020-02-01",
            },
          ],
        } as VulnBurndown,
      ],
    });
    const r = (await registry.get("tool.vuln_burndown.list_state")!.handler({}, ctx())) as {
      total: number;
      bySeverity: Record<string, number>;
      byStatus: Record<string, number>;
      openCount: number;
      overdueCount: number;
    };
    expect(r.total).toBe(2);
    expect(r.bySeverity.critical).toBe(1);
    expect(r.byStatus.resolved).toBe(1);
    expect(r.openCount).toBe(1); // only v1
    expect(r.overdueCount).toBe(1); // v1 past SLA; v2 resolved
  });
});

describe("tool.vuln_burndown.set_status", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      vulnBurndowns: [
        {
          id: VB_ID,
          vulns: [
            {
              id: "v1",
              severity: "high",
              status: "open",
              openedAt: "2026-01-01",
              slaTargetDays: 30,
            },
          ],
        } as VulnBurndown,
      ],
    })
  );

  it("stamps resolvedAt when set to 'resolved'", async () => {
    const r = (await registry
      .get("tool.vuln_burndown.set_status")!
      .handler({ vulnId: "v1", status: "resolved" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    const v = (useWorkspaceStore.getState().vulnBurndowns ?? [])[0].vulns[0];
    expect(v.status).toBe("resolved");
    expect(v.resolvedAt).toBeTruthy();
  });

  it("returns updated:false for an unknown vuln id", async () => {
    const r = (await registry
      .get("tool.vuln_burndown.set_status")!
      .handler({ vulnId: "nope", status: "accepted" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});
