/**
 * tool.maturity.* coverage (flat singleton doc, S4 — Team Health & Maturity).
 *
 *   1. registration — list_state read; set_score/set_target_level/reset write.
 *   2. set_score + list_state — average + percentage/label via getMaturityScore.
 *   3. set_score refuses an unknown dimension id.
 *   4. set_target_level — re-derives the improvement roadmap.
 *   5. reset — back to all-level-1 / target 4.
 *   6. out-of-range stored levels are clamped (the page agrees); the MCP
 *      path round-trips through the server store.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

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
      level: number;
      label: string;
      roadmap: { dimensionId: string }[];
    };
    expect(r.exists).toBe(true);
    expect(r.scores["scrum-practices"]).toBe(5);
    expect(r.targetLevel).toBe(4); // default
    // one dim at 5, the other seven at 1 => 12/8 = 1.5 => 30%, and the rounded
    // level 2 is named like the per-dimension levels: "Developing".
    expect(r.averageLevel).toBeCloseTo(1.5, 5);
    expect(r.percentage).toBe(30);
    expect(r.level).toBe(2);
    expect(r.label).toBe("Developing");
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

describe("tool.maturity — stored data and the MCP path", () => {
  beforeEach(() => {
    rows.clear();
    useWorkspaceStore.setState({ maturityAssessments: [] });
  });

  it("clamps out-of-range stored levels into 1-5 for the summary and roadmap", async () => {
    useWorkspaceStore.setState({
      maturityAssessments: [
        {
          id: "maturity:current",
          scores: {
            "scrum-practices": 9,
            "team-collaboration": 0,
            "technical-excellence": 5,
            "product-management": 5,
            "metrics-transparency": 5,
            "continuous-improvement": 5,
            "stakeholder-engagement": 5,
            "agile-culture": 5,
          },
          targetLevel: 4,
        },
      ],
    });
    const r = (await registry.get("tool.maturity.list_state")!.handler({}, ctx())) as {
      averageLevel: number;
      percentage: number;
      roadmap: { dimensionId: string; current: number }[];
    };
    // (5 + 1 + 6·5)/8 = 4.5
    expect(r.averageLevel).toBeCloseTo(4.5, 5);
    expect(r.percentage).toBe(90);
    expect(r.roadmap).toEqual([
      expect.objectContaining({ dimensionId: "team-collaboration", current: 1 }),
    ]);
  });

  it("reports a missing assessment as all level 1, target 4", async () => {
    const r = (await registry.get("tool.maturity.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      percentage: number;
      label: string;
      roadmap: unknown[];
    };
    expect(r).toMatchObject({ exists: false, percentage: 20, label: "Initial" });
    expect(r.roadmap).toHaveLength(8);
  });

  it("writes through the server store on the MCP path", async () => {
    await registry.get("tool.maturity.set_score")!.mcpHandler!(
      { dimensionId: "agile-culture", level: 4 },
      ctx()
    );
    await registry.get("tool.maturity.set_target_level")!.mcpHandler!({ level: 5 }, ctx());
    const unknown = (await registry.get("tool.maturity.set_score")!.mcpHandler!(
      { dimensionId: "ghost", level: 2 },
      ctx()
    )) as { set: boolean };
    expect(unknown.set).toBe(false);

    const row = rows.get("workspace:maturityAssessment/maturity:current") as {
      scores: Record<string, number>;
      targetLevel: number;
    };
    expect(row.scores["agile-culture"]).toBe(4);
    expect(row.scores["scrum-practices"]).toBe(1);
    expect(row.targetLevel).toBe(5);
    expect(useWorkspaceStore.getState().maturityAssessments).toEqual([]);

    const r = (await registry.get("tool.maturity.list_state")!.mcpHandler!({}, ctx())) as {
      exists: boolean;
      averageLevel: number;
      roadmap: unknown[];
    };
    expect(r.exists).toBe(true);
    expect(r.averageLevel).toBeCloseTo(11 / 8, 5);
    expect(r.roadmap).toHaveLength(8);

    await registry.get("tool.maturity.reset")!.mcpHandler!({}, ctx());
    expect(
      (rows.get("workspace:maturityAssessment/maturity:current") as { targetLevel: number })
        .targetLevel
    ).toBe(4);
  });
});
