import { describe, it, expect } from "vitest";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/sprint-compare";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Result = {
  dimensions: { dim: string; min: number; max: number; average: number; leader: string }[];
  perSprint: { name: string; total: number; average: number }[];
  overallLeader: string;
};

describe("tool.sprint_compare.compute", () => {
  it("is a read action", () => {
    expect(registry.get("tool.sprint_compare.compute")?.category).toBe("read");
  });

  it("computes per-dimension leaders and an overall leader", async () => {
    const action = registry.get("tool.sprint_compare.compute");
    const r = (await action!.handler(
      {
        sprints: [
          { name: "A", dimensions: { velocity: 8, quality: 8 } },
          { name: "B", dimensions: { velocity: 5, quality: 9 } },
        ],
      },
      ctx()
    )) as Result;

    const velocity = r.dimensions.find((d) => d.dim === "velocity")!;
    expect(velocity.min).toBe(5);
    expect(velocity.max).toBe(8);
    expect(velocity.leader).toBe("A");

    const quality = r.dimensions.find((d) => d.dim === "quality")!;
    expect(quality.leader).toBe("B");

    // A avg = 8, B avg = 7 → A leads overall
    expect(r.perSprint.find((s) => s.name === "A")!.average).toBe(8);
    expect(r.overallLeader).toBe("A");
  });
});
