/**
 * tool.threat_model.* coverage (singleton doc, S9).
 *
 *   1. registration — list_state read; add_threat/set_status write +
 *      mcpHandler + no confirm.
 *   2. list_state — empty before any write; byCategory/byStatus/avgSeverity
 *      after.
 *   3. add_threat — appends with auto id, default status "open", raisedAt.
 *   4. set_status — updates + stamps mitigatedAt on "mitigated"; unknown
 *      threat → {updated:false}.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ThreatModel } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/threat-model";

const TM_ID = "threatModel:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.threat_model — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.threat_model.list_state")?.category).toBe("read");
    for (const verb of ["add_threat", "set_status"]) {
      expect(registry.get(`tool.threat_model.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.threat_model.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.threat_model.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.threat_model.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ threatModels: [] }));

  it("is empty before any write", async () => {
    const r = (await registry.get("tool.threat_model.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      openCount: number;
      avgSeverity: number;
    };
    expect(r.exists).toBe(false);
    expect(r.total).toBe(0);
    expect(r.openCount).toBe(0);
    expect(r.avgSeverity).toBe(0);
  });
});

describe("tool.threat_model.add_threat", () => {
  beforeEach(() => useWorkspaceStore.setState({ threatModels: [] }));

  it("appends with default status 'open' and a raisedAt date", async () => {
    const r = (await registry
      .get("tool.threat_model.add_threat")!
      .handler({ service: "auth-api", category: "spoofing", severity: 5 }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(r.added).toBe(true);

    const models = useWorkspaceStore.getState().threatModels ?? [];
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe(TM_ID);
    expect(models[0].threats[0].status).toBe("open");
    expect(models[0].threats[0].raisedAt).toBeTruthy();
  });

  it("summarises category/status/severity across threats", async () => {
    await registry
      .get("tool.threat_model.add_threat")!
      .handler({ service: "auth-api", category: "spoofing", severity: 4 }, ctx());
    await registry
      .get("tool.threat_model.add_threat")!
      .handler({ service: "db", category: "tampering", severity: 2, status: "mitigating" }, ctx());

    const r = (await registry.get("tool.threat_model.list_state")!.handler({}, ctx())) as {
      total: number;
      byCategory: Record<string, number>;
      byStatus: Record<string, number>;
      openCount: number;
      avgSeverity: number;
    };
    expect(r.total).toBe(2);
    expect(r.byCategory.spoofing).toBe(1);
    expect(r.byCategory.tampering).toBe(1);
    expect(r.byStatus.open).toBe(1);
    expect(r.byStatus.mitigating).toBe(1);
    expect(r.openCount).toBe(2); // neither mitigated nor accepted
    expect(r.avgSeverity).toBe(3); // (4+2)/2
  });
});

describe("tool.threat_model.set_status", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      threatModels: [
        {
          id: TM_ID,
          threats: [
            {
              id: "t1",
              service: "auth-api",
              category: "spoofing",
              severity: 5,
              status: "open",
              raisedAt: "2026-01-01",
            },
          ],
        } as ThreatModel,
      ],
    })
  );

  it("stamps mitigatedAt when set to 'mitigated'", async () => {
    const r = (await registry
      .get("tool.threat_model.set_status")!
      .handler({ threatId: "t1", status: "mitigated" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    const t = (useWorkspaceStore.getState().threatModels ?? [])[0].threats[0];
    expect(t.status).toBe("mitigated");
    expect(t.mitigatedAt).toBeTruthy();
  });

  it("returns updated:false for an unknown threat id", async () => {
    const r = (await registry
      .get("tool.threat_model.set_status")!
      .handler({ threatId: "nope", status: "accepted" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});
