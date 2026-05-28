/**
 * tool.platform_maturity.* coverage (singleton doc, S7).
 *
 *   1. registration — list_state read; set_dimension write + mcpHandler.
 *   2. list_state — all 8 dimensions default to level 1; averageScore.
 *   3. set_dimension — sets level + note; unknown dimensionId → {updated:false}.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/platform-maturity";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.platform_maturity — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.platform_maturity.list_state")?.category).toBe("read");
    expect(registry.get("tool.platform_maturity.set_dimension")?.category).toBe("write");
    expect(registry.get("tool.platform_maturity.set_dimension")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.platform_maturity.set_dimension")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.platform_maturity.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ platformMaturities: [] }));

  it("reports all 8 dimensions defaulting to level 1", async () => {
    const r = (await registry.get("tool.platform_maturity.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      averageScore: number;
      byDimension: { id: string; score: number }[];
    };
    expect(r.exists).toBe(false);
    expect(r.byDimension).toHaveLength(8);
    expect(r.averageScore).toBe(1); // all default to 1
  });
});

describe("tool.platform_maturity.set_dimension", () => {
  beforeEach(() => useWorkspaceStore.setState({ platformMaturities: [] }));

  it("sets a dimension level + note and recomputes the average", async () => {
    const r = (await registry
      .get("tool.platform_maturity.set_dimension")!
      .handler({ dimensionId: "goldenPaths", score: 5, note: "mature" }, ctx())) as {
      updated: boolean;
    };
    expect(r.updated).toBe(true);

    const state = (await registry.get("tool.platform_maturity.list_state")!.handler({}, ctx())) as {
      averageScore: number;
      byDimension: { id: string; score: number; note: string }[];
    };
    const gp = state.byDimension.find((d) => d.id === "goldenPaths")!;
    expect(gp.score).toBe(5);
    expect(gp.note).toBe("mature");
    expect(state.averageScore).toBe(1.5); // (5 + 7*1) / 8
  });

  it("returns updated:false for an unknown dimensionId", async () => {
    const r = (await registry
      .get("tool.platform_maturity.set_dimension")!
      .handler({ dimensionId: "not-a-dimension", score: 3 }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});
