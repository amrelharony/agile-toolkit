/**
 * tool.estimation_guide.* action coverage.
 *
 *   1. get_reference is a read action
 *   2. with no scale → returns all scales, each point carrying a description
 *      where one is defined
 *   3. filtering by name (case-insensitive) returns just that scale
 *   4. an unknown scale name falls back to all scales (never empty)
 */

import { describe, it, expect } from "vitest";
import { registry } from "@/lib/actions/registry";

import "@/lib/actions/tools/estimation-guide";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Ref = {
  scales: { name: string; points: { value: string | number; description: string }[] }[];
};

describe("tool.estimation_guide.get_reference", () => {
  it("is registered as a read action", () => {
    expect(registry.get("tool.estimation_guide.get_reference")?.category).toBe("read");
  });

  it("returns all scales when none is specified", async () => {
    const action = registry.get("tool.estimation_guide.get_reference");
    const r = (await action!.handler({}, ctx())) as Ref;
    const names = r.scales.map((s) => s.name);
    expect(names).toContain("Fibonacci");
    expect(names).toContain("T-Shirt");
    expect(r.scales.length).toBeGreaterThanOrEqual(4);
  });

  it("pairs known point values with a description", async () => {
    const action = registry.get("tool.estimation_guide.get_reference");
    const r = (await action!.handler({ scale: "fibonacci" }, ctx())) as Ref;
    expect(r.scales).toHaveLength(1);
    expect(r.scales[0].name).toBe("Fibonacci");
    const eight = r.scales[0].points.find((p) => p.value === 8);
    expect(eight?.description).toMatch(/complex/i);
  });

  it("falls back to all scales for an unknown name", async () => {
    const action = registry.get("tool.estimation_guide.get_reference");
    const r = (await action!.handler({ scale: "nope" }, ctx())) as Ref;
    expect(r.scales.length).toBeGreaterThanOrEqual(4);
  });
});
