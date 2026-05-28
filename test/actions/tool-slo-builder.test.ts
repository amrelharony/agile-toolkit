/**
 * tool.slo_builder.* coverage (singleton doc, S7).
 *
 *   1. registration — list_state/compute read (compute is pure); add_slo/
 *      record_burn write + mcpHandler.
 *   2. compute_error_budget — (1-target)*windowDays*24*60.
 *   3. add_slo + record_burn + list_state — per-SLO budget/burn math.
 *   4. record_burn refuses an unknown sloId.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/slo-builder";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.slo_builder — registration", () => {
  it("read/write categories + compute is pure", () => {
    expect(registry.get("tool.slo_builder.list_state")?.category).toBe("read");
    expect(registry.get("tool.slo_builder.compute_error_budget")?.category).toBe("read");
    expect(registry.get("tool.slo_builder.compute_error_budget")?.mcpHandler).toBeUndefined();
    for (const verb of ["add_slo", "record_burn"]) {
      expect(registry.get(`tool.slo_builder.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.slo_builder.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.slo_builder.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.slo_builder.compute_error_budget", () => {
  it("computes allowed error minutes", async () => {
    const r = (await registry
      .get("tool.slo_builder.compute_error_budget")!
      .handler({ target: 0.99, windowDays: 30 }, ctx())) as { budgetMinutes: number };
    expect(r.budgetMinutes).toBe(432); // 0.01 * 30 * 24 * 60
  });
});

describe("tool.slo_builder.add_slo + record_burn + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ sloBuilders: [] }));

  it("tracks per-SLO budget and burn", async () => {
    const added = (await registry
      .get("tool.slo_builder.add_slo")!
      .handler(
        { name: "API uptime", sliDescription: "2xx ratio", target: 0.99, windowDays: 30 },
        ctx()
      )) as {
      added: boolean;
      id: string;
    };
    expect(added.added).toBe(true);

    await registry
      .get("tool.slo_builder.record_burn")!
      .handler({ sloId: added.id, errorMinutes: 100 }, ctx());

    const r = (await registry.get("tool.slo_builder.list_state")!.handler({}, ctx())) as {
      sloCount: number;
      burnCount: number;
      perSlo: {
        sloId: string;
        budgetMinutes: number;
        burnedMinutes: number;
        budgetRemainingMinutes: number;
        budgetBurnedPct: number;
      }[];
    };
    expect(r.sloCount).toBe(1);
    expect(r.burnCount).toBe(1);
    expect(r.perSlo[0].budgetMinutes).toBe(432);
    expect(r.perSlo[0].burnedMinutes).toBe(100);
    expect(r.perSlo[0].budgetRemainingMinutes).toBe(332);
    expect(r.perSlo[0].budgetBurnedPct).toBe(0.23); // 100/432
  });

  it("refuses a burn against an unknown SLO", async () => {
    await registry
      .get("tool.slo_builder.add_slo")!
      .handler({ name: "x", sliDescription: "y", target: 0.99, windowDays: 30 }, ctx());
    const r = (await registry
      .get("tool.slo_builder.record_burn")!
      .handler({ sloId: "ghost", errorMinutes: 10 }, ctx())) as { added: boolean };
    expect(r.added).toBe(false);
  });
});
