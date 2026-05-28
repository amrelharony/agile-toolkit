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

  it("returns null cycle time when there is no throughput", async () => {
    const action = registry.get("tool.cumulative_flow.compute");
    const r = (await action!.handler({ wip: [4, 4, 4], done: [3, 3, 3] }, ctx())) as Result;
    expect(r.throughputPerDay).toBe(0);
    expect(r.littlesLawCycleTimeDays).toBeNull();
  });
});
