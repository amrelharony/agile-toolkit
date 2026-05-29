/**
 * tool.maturity.* coverage (flat singleton doc, S4 — Team Health & Maturity).
 *
 *   1. registration — list_state read; set_score/set_target_level/reset write.
 *   2. set_score + list_state — average + percentage/label via getMaturityScore.
 *   3. set_score refuses an unknown dimension id.
 *   4. set_target_level — re-derives the improvement roadmap.
 *   5. reset — back to all-level-1 / target 4.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/maturity";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.maturity — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.maturity.list_state")?.category).toBe("read");
    for (const verb of ["set_score", "set_target_level", "reset"]) {
      expect(registry.get(`tool.maturity.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.maturity.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.maturity.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.maturity lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ maturityAssessments: [] }));

  it("scores a dimension and re-derives average/percentage", async () => {
    const r0 = (await registry
      .get("tool.maturity.set_score")!
      .handler({ dimensionId: "scrum-practices", level: 5 }, ctx())) as { set: boolean };
    expect(r0.set).toBe(true);

    const r = (await registry.get("tool.maturity.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      scores: Record<string, number>;
      targetLevel: number;
      averageLevel: number;
      percentage: number;
      label: string;
      roadmap: { dimensionId: string }[];
    };
    expect(r.exists).toBe(true);
    expect(r.scores["scrum-practices"]).toBe(5);
    expect(r.targetLevel).toBe(4); // default
    // one dim at 5, the other seven at 1 => 12/8 = 1.5 => 30% => "Emerging"
    // (getMaturityScore: <30 Ad-hoc, <50 Emerging, <65 Developing, ...).
    expect(r.averageLevel).toBeCloseTo(1.5, 5);
    expect(r.percentage).toBe(30);
    expect(r.label).toBe("Emerging");
    // 7 dims still below the target-4 line.
    expect(r.roadmap).toHaveLength(7);
    expect(r.roadmap.some((x) => x.dimensionId === "scrum-practices")).toBe(false);
  });

  it("set_score refuses an unknown dimension id", async () => {
    const r = (await registry
      .get("tool.maturity.set_score")!
      .handler({ dimensionId: "ghost-dimension", level: 3 }, ctx())) as { set: boolean };
    expect(r.set).toBe(false);
  });

  it("set_target_level re-derives the roadmap", async () => {
    const r0 = (await registry
      .get("tool.maturity.set_target_level")!
      .handler({ level: 2 }, ctx())) as { set: boolean; targetLevel: number };
    expect(r0.targetLevel).toBe(2);

    const r = (await registry.get("tool.maturity.list_state")!.handler({}, ctx())) as {
      targetLevel: number;
      roadmap: unknown[];
    };
    expect(r.targetLevel).toBe(2);
    // all eight dims default to level 1 (< 2) => all on the roadmap.
    expect(r.roadmap).toHaveLength(8);
  });

  it("reset restores all-level-1 / target 4", async () => {
    await registry
      .get("tool.maturity.set_score")!
      .handler({ dimensionId: "agile-culture", level: 5 }, ctx());
    const rr = (await registry.get("tool.maturity.reset")!.handler({}, ctx())) as {
      reset: boolean;
    };
    expect(rr.reset).toBe(true);

    const r = (await registry.get("tool.maturity.list_state")!.handler({}, ctx())) as {
      averageLevel: number;
      percentage: number;
      targetLevel: number;
    };
    expect(r.averageLevel).toBeCloseTo(1, 5);
    expect(r.percentage).toBe(20);
    expect(r.targetLevel).toBe(4);
  });
});
