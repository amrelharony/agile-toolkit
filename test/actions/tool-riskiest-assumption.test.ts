/**
 * tool.riskiest_assumption.* coverage (singleton doc, S11).
 *
 *   1. registration — list_state read; add_assumption/set_status write.
 *   2. add_assumption + list_state — picks the riskiest (risk × (6 − evidence)).
 *   3. set_status — updates; unknown id → {updated:false}.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/riskiest-assumption";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.riskiest_assumption — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.riskiest_assumption.list_state")?.category).toBe("read");
    for (const verb of ["add_assumption", "set_status"]) {
      expect(registry.get(`tool.riskiest_assumption.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.riskiest_assumption.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.riskiest_assumption.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.riskiest_assumption.add_assumption + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ riskiestAssumptions: [] }));

  it("surfaces the riskiest (highest risk × (6 − evidence))", async () => {
    await registry
      .get("tool.riskiest_assumption.add_assumption")!
      .handler({ statement: "Users want X", riskLevel: 5, evidenceLevel: 1 }, ctx());
    await registry
      .get("tool.riskiest_assumption.add_assumption")!
      .handler({ statement: "Pricing is fine", riskLevel: 2, evidenceLevel: 2 }, ctx());

    const r = (await registry.get("tool.riskiest_assumption.list_state")!.handler({}, ctx())) as {
      total: number;
      riskiest: { statement: string } | null;
    };
    expect(r.total).toBe(2);
    expect(r.riskiest?.statement).toBe("Users want X"); // 5 × 5 = 25 beats 2 × 4 = 8
  });
});

describe("tool.riskiest_assumption.set_status", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      riskiestAssumptions: [
        {
          id: "riskiestAssumption:current",
          assumptions: [
            {
              id: "a1",
              statement: "s",
              riskLevel: 4,
              evidenceLevel: 2,
              status: "untested",
            },
          ],
        },
      ],
    })
  );

  it("updates status; unknown id → false", async () => {
    const ok = (await registry
      .get("tool.riskiest_assumption.set_status")!
      .handler({ assumptionId: "a1", status: "validated" }, ctx())) as { updated: boolean };
    expect(ok.updated).toBe(true);
    const r = (await registry.get("tool.riskiest_assumption.list_state")!.handler({}, ctx())) as {
      byStatus: Record<string, number>;
    };
    expect(r.byStatus.validated).toBe(1);

    const bad = (await registry
      .get("tool.riskiest_assumption.set_status")!
      .handler({ assumptionId: "nope", status: "testing" }, ctx())) as { updated: boolean };
    expect(bad.updated).toBe(false);
  });
});
