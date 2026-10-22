/**
 * tool.riskiest_assumption.* coverage (singleton doc, S11).
 *
 *   1. registration — list_state read; add_assumption/set_status write.
 *   2. add_assumption + list_state — picks the riskiest (high risk − evidence).
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

  it("surfaces the riskiest (highest risk minus evidence)", async () => {
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
    expect(r.riskiest?.statement).toBe("Users want X"); // 5-1=4 beats 2-2=0
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

describe("tool.riskiest_assumption riskiest pick", () => {
  beforeEach(() => useWorkspaceStore.setState({ riskiestAssumptions: [] }));

  const add = (statement: string, riskLevel: number, evidenceLevel: number, status?: string) =>
    registry
      .get("tool.riskiest_assumption.add_assumption")!
      .handler({ statement, riskLevel, evidenceLevel, status }, ctx());
  const riskiest = async () =>
    (
      (await registry.get("tool.riskiest_assumption.list_state")!.handler({}, ctx())) as {
        riskiest: { statement: string } | null;
      }
    ).riskiest;

  it("ignores resolved assumptions and breaks ties by higher risk", async () => {
    await add("validated already", 5, 1, "validated");
    await add("tie, lower risk", 3, 1);
    await add("tie, higher risk", 4, 2, "testing");
    expect((await riskiest())?.statement).toBe("tie, higher risk");
  });

  it("is null when every assumption is resolved", async () => {
    await add("done", 5, 1, "invalidated");
    expect(await riskiest()).toBeNull();
  });

  it("stores the optional fields and the given status", async () => {
    await registry.get("tool.riskiest_assumption.add_assumption")!.handler(
      {
        statement: "s",
        riskLevel: 2,
        evidenceLevel: 3,
        status: "testing",
        testIdea: "t",
        description: "d",
      },
      ctx()
    );
    expect(
      (useWorkspaceStore.getState().riskiestAssumptions ?? [])[0].assumptions[0]
    ).toMatchObject({
      statement: "s",
      riskLevel: 2,
      evidenceLevel: 3,
      status: "testing",
      testIdea: "t",
      description: "d",
    });
  });
});
