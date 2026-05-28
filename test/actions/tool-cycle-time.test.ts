import { describe, it, expect } from "vitest";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/cycle-time";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Result = {
  count: number;
  average: number;
  min: number;
  max: number;
  p50: number;
  p85: number;
  p95: number;
  sleTarget: number;
  outliers: number[];
};

describe("tool.cycle_time.compute_percentiles", () => {
  it("is a read action", () => {
    expect(registry.get("tool.cycle_time.compute_percentiles")?.category).toBe("read");
  });

  it("computes ordered percentiles, average, min/max, and SLE = P85", async () => {
    const action = registry.get("tool.cycle_time.compute_percentiles");
    const r = (await action!.handler(
      { durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      ctx()
    )) as Result;
    expect(r.count).toBe(10);
    expect(r.min).toBe(1);
    expect(r.max).toBe(10);
    expect(r.average).toBe(5.5);
    expect(r.p50).toBeLessThanOrEqual(r.p85);
    expect(r.p85).toBeLessThanOrEqual(r.p95);
    expect(r.sleTarget).toBe(r.p85);
  });

  it("flags IQR outliers", async () => {
    const action = registry.get("tool.cycle_time.compute_percentiles");
    const r = (await action!.handler(
      { durations: [2, 2, 3, 3, 3, 3, 3, 2, 2, 100] },
      ctx()
    )) as Result;
    expect(r.outliers).toContain(100);
  });
});
