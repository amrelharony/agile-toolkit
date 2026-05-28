/**
 * tool.quality_cost.* coverage (pure compute, S10).
 *
 *   1. registration — compute_cost_of_quality is read + PURE (no mcpHandler).
 *   2. compute — conformance / non-conformance / total + ratios.
 *   3. zero inputs → 0 ratios (no NaN).
 */

import { describe, it, expect } from "vitest";
import { registry } from "@/lib/actions/registry";

import "@/lib/actions/tools/quality-cost";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.quality_cost — registration", () => {
  it("is a pure read action (no mcpHandler)", () => {
    const a = registry.get("tool.quality_cost.compute_cost_of_quality");
    expect(a?.category).toBe("read");
    expect(a?.mcpHandler).toBeUndefined();
  });
});

describe("tool.quality_cost.compute_cost_of_quality", () => {
  it("splits conformance vs non-conformance and ratios", async () => {
    const r = (await registry
      .get("tool.quality_cost.compute_cost_of_quality")!
      .handler(
        { preventionCost: 10, detectionCost: 20, internalFailureCost: 30, externalFailureCost: 40 },
        ctx()
      )) as {
      conformance: number;
      nonConformance: number;
      totalCoq: number;
      conformancePct: number;
      failurePct: number;
    };
    expect(r.conformance).toBe(30); // 10 + 20
    expect(r.nonConformance).toBe(70); // 30 + 40
    expect(r.totalCoq).toBe(100);
    expect(r.conformancePct).toBe(0.3);
    expect(r.failurePct).toBe(0.7);
  });

  it("returns 0 ratios for all-zero inputs (no NaN)", async () => {
    const r = (await registry
      .get("tool.quality_cost.compute_cost_of_quality")!
      .handler(
        { preventionCost: 0, detectionCost: 0, internalFailureCost: 0, externalFailureCost: 0 },
        ctx()
      )) as { totalCoq: number; conformancePct: number; failurePct: number };
    expect(r.totalCoq).toBe(0);
    expect(r.conformancePct).toBe(0);
    expect(r.failurePct).toBe(0);
  });
});
