import { describe, it, expect } from "vitest";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/cumulative-flow";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Result = {
  days: number;
  avgWip: number;
  throughputPerDay: number;
  littlesLawCycleTimeDays: number | null;
  wipControlLimits: { centerLine: number; ucl: number; lcl: number };
  wipStable: boolean;
};

describe("tool.cumulative_flow.compute", () => {
  it("is a read action", () => {
    expect(registry.get("tool.cumulative_flow.compute")?.category).toBe("read");
  });

  it("derives throughput, avg WIP, and Little's-Law cycle time", async () => {
    const action = registry.get("tool.cumulative_flow.compute");
    const r = (await action!.handler(
      { wip: [5, 5, 5, 5, 5], done: [0, 3, 6, 9, 12] },
      ctx()
    )) as Result;
    expect(r.days).toBe(5);
    expect(r.avgWip).toBe(5);
    expect(r.throughputPerDay).toBe(3); // 12 done over 4 elapsed days
    expect(r.littlesLawCycleTimeDays).toBeCloseTo(1.67, 1);
    expect(r.wipStable).toBe(true);
  });

  it("flags a WIP spike beyond the control limits, with the LCL clamped at 0", async () => {
    const action = registry.get("tool.cumulative_flow.compute");
    const r = (await action!.handler(
      { wip: [5, 5, 5, 5, 5, 5, 5, 30], done: [0, 1, 2, 3, 4, 5, 6, 7] },
      ctx()
    )) as Result;
    expect(r.wipStable).toBe(false);
    expect(r.wipControlLimits.lcl).toBe(0);
    expect(r.wipControlLimits.ucl).toBeLessThan(30);
    expect(r.avgWip).toBe(8.13);
    expect(r.throughputPerDay).toBe(1);
  });

  it("returns null cycle time when there is no throughput", async () => {
    const action = registry.get("tool.cumulative_flow.compute");
    const r = (await action!.handler({ wip: [4, 4, 4], done: [3, 3, 3] }, ctx())) as Result;
    expect(r.throughputPerDay).toBe(0);
    expect(r.littlesLawCycleTimeDays).toBeNull();
  });
});
