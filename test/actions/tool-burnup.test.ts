import { describe, it, expect } from "vitest";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/burnup";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Result = {
  currentScope: number;
  currentCompleted: number;
  remaining: number;
  percentComplete: number;
  scopeCreep: number;
  completedPerDay: number;
  forecastDoneDay: number | null;
};

describe("tool.burnup.compute", () => {
  it("is a read action", () => {
    expect(registry.get("tool.burnup.compute")?.category).toBe("read");
  });

  it("computes progress + a forecast meet-day for a steady burnup", async () => {
    const action = registry.get("tool.burnup.compute");
    const r = (await action!.handler(
      { scope: [50, 50, 50, 50], completed: [0, 15, 30, 45] },
      ctx()
    )) as Result;
    expect(r.currentScope).toBe(50);
    expect(r.currentCompleted).toBe(45);
    expect(r.remaining).toBe(5);
    expect(r.percentComplete).toBe(90);
    expect(r.scopeCreep).toBe(0);
    expect(r.completedPerDay).toBe(15);
    // completed line: y = 15x → meets 50 at x ≈ 3.33
    expect(r.forecastDoneDay).toBeCloseTo(3.33, 1);
  });

  it("surfaces scope creep", async () => {
    const action = registry.get("tool.burnup.compute");
    const r = (await action!.handler(
      { scope: [40, 45, 50], completed: [10, 20, 30] },
      ctx()
    )) as Result;
    expect(r.scopeCreep).toBe(10);
  });

  it("forecasts the last day when scope is already met", async () => {
    const action = registry.get("tool.burnup.compute");
    const r = (await action!.handler(
      { scope: [30, 30, 30], completed: [10, 20, 30] },
      ctx()
    )) as Result;
    expect(r.remaining).toBe(0);
    expect(r.forecastDoneDay).toBe(2);
  });
});
