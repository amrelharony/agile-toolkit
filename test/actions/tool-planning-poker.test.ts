/**
 * tool.planning_poker.* coverage.
 *
 * The live session is realtime-only (no server state), so the agent surface is:
 *   - a persisted estimation LOG (record/list/remove) it can read + append, and
 *   - stateless compute helpers (consensus math + scale reference).
 *
 *   1. registration — list_state/compute_consensus/list_scales read;
 *      record_estimate/remove_estimate write.
 *   2. record_estimate + list_state — append + per-scale tally.
 *   3. remove_estimate refuses an unknown id.
 *   4. compute_consensus — average/median/mode/spread + consensus band.
 *   5. list_scales — fibonacci/t-shirt reference.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/planning-poker";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.planning_poker — registration", () => {
  it("read/compute vs write categories + write hardening", () => {
    for (const verb of ["list_state", "compute_consensus", "list_scales"]) {
      expect(registry.get(`tool.planning_poker.${verb}`)?.category).toBe("read");
    }
    for (const verb of ["record_estimate", "remove_estimate"]) {
      expect(registry.get(`tool.planning_poker.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.planning_poker.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.planning_poker.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.planning_poker estimation log", () => {
  beforeEach(() => useWorkspaceStore.setState({ pokerEstimationLogs: [] }));

  it("records an estimate and tallies by scale", async () => {
    const a = (await registry
      .get("tool.planning_poker.record_estimate")!
      .handler(
        {
          storyTitle: "Login flow",
          finalEstimate: "5",
          scaleType: "fibonacci",
          votes: ["3", "5", "5"],
        },
        ctx()
      )) as { added: boolean; id: string };
    expect(a.added).toBe(true);

    const r = (await registry.get("tool.planning_poker.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      totalEstimates: number;
      byScale: Record<string, number>;
      estimates: { storyTitle: string; finalEstimate: string }[];
    };
    expect(r.exists).toBe(true);
    expect(r.totalEstimates).toBe(1);
    expect(r.byScale["fibonacci"]).toBe(1);
    expect(r.estimates[0]).toMatchObject({ storyTitle: "Login flow", finalEstimate: "5" });
  });

  it("remove_estimate refuses an unknown id", async () => {
    const r = (await registry
      .get("tool.planning_poker.remove_estimate")!
      .handler({ id: "ghost" }, ctx())) as { removed: boolean };
    expect(r.removed).toBe(false);
  });
});

describe("tool.planning_poker compute helpers", () => {
  it("compute_consensus returns stats + a consensus band", async () => {
    const r = (await registry
      .get("tool.planning_poker.compute_consensus")!
      .handler({ votes: ["3", "3", "5"] }, ctx())) as {
      average: number;
      median: number;
      mode: string;
      spread: number;
      consensus: string;
      suggestion: string;
    };
    expect(r.average).toBeCloseTo(11 / 3, 5);
    expect(r.median).toBe(3);
    expect(r.mode).toBe("3");
    expect(r.spread).toBe(2);
    expect(r.consensus).toBe("close"); // spread <= 2
    expect(r.suggestion).toBe("3");

    const agree = (await registry
      .get("tool.planning_poker.compute_consensus")!
      .handler({ votes: ["5", "5", "5"] }, ctx())) as { consensus: string; spread: number };
    expect(agree.consensus).toBe("agree");
    expect(agree.spread).toBe(0);

    const wide = (await registry
      .get("tool.planning_poker.compute_consensus")!
      .handler({ votes: ["1", "13"] }, ctx())) as { consensus: string };
    expect(wide.consensus).toBe("spread"); // spread > 2
  });

  it("list_scales returns the fibonacci + t-shirt reference", async () => {
    const r = (await registry.get("tool.planning_poker.list_scales")!.handler({}, ctx())) as {
      scales: Record<string, string[]>;
    };
    expect(r.scales.fibonacci).toContain("8");
    expect(r.scales.tshirt).toContain("XL");
  });
});
