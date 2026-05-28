import { describe, it, expect } from "vitest";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/burndown";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Result = {
  sprintDays: number;
  currentDay: number;
  currentRemaining: number;
  idealRemainingNow: number;
  gap: number;
  onTrack: boolean;
  slopePerDay: number;
  projectedCompletionDay: number | null;
  willFinishOnTime: boolean;
};

describe("tool.burndown.compute", () => {
  it("is a read action", () => {
    expect(registry.get("tool.burndown.compute")?.category).toBe("read");
  });

  it("reports on-track for a perfectly linear burndown to zero", async () => {
    const action = registry.get("tool.burndown.compute");
    const r = (await action!.handler(
      { totalPoints: 50, remaining: [50, 37.5, 25, 12.5, 0] },
      ctx()
    )) as Result;
    expect(r.sprintDays).toBe(5);
    expect(r.currentRemaining).toBe(0);
    expect(r.idealRemainingNow).toBe(0);
    expect(r.gap).toBe(0);
    expect(r.onTrack).toBe(true);
    expect(r.slopePerDay).toBe(-12.5);
    expect(r.willFinishOnTime).toBe(true);
  });

  it("reports behind schedule when burning down too slowly", async () => {
    const action = registry.get("tool.burndown.compute");
    const r = (await action!.handler(
      { totalPoints: 50, remaining: [50, 48, 46], sprintDays: 10 },
      ctx()
    )) as Result;
    expect(r.gap).toBeGreaterThan(0); // actual above ideal
    expect(r.onTrack).toBe(false);
    expect(r.slopePerDay).toBeLessThan(0);
  });

  it("returns a null projected completion when not burning down", async () => {
    const action = registry.get("tool.burndown.compute");
    const r = (await action!.handler(
      { totalPoints: 30, remaining: [30, 30, 30] },
      ctx()
    )) as Result;
    expect(r.projectedCompletionDay).toBeNull();
    expect(r.willFinishOnTime).toBe(false);
  });
});
