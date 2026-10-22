/**
 * tool.value_stream.* coverage.
 *
 *   1. list_state (read) + add_stage (write, mcpHandler, no confirm)
 *   2. flow efficiency = totalProcess/totalLead; rolled %C/A = product of
 *      per-stage rates
 *   3. add_stage appends a stage
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ValueStreamStage } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/value-stream";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function stage(p: Partial<ValueStreamStage> & Pick<ValueStreamStage, "id">): ValueStreamStage {
  return { name: p.id, processTime: 1, leadTime: 2, completeAccurate: 100, ...p };
}

describe("tool.value_stream — registration", () => {
  it("list_state read; add_stage write + mcpHandler + no confirm", () => {
    expect(registry.get("tool.value_stream.list_state")?.category).toBe("read");
    expect(registry.get("tool.value_stream.add_stage")?.category).toBe("write");
    expect(registry.get("tool.value_stream.add_stage")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.value_stream.add_stage")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.value_stream.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ valueStreamStages: [] }));

  it("is zeroed when empty", async () => {
    const r = (await registry.get("tool.value_stream.list_state")!.handler({}, ctx())) as {
      stageCount: number;
      flowEfficiencyPct: number;
    };
    expect(r.stageCount).toBe(0);
    expect(r.flowEfficiencyPct).toBe(0);
  });

  it("computes flow efficiency and rolled %C/A", async () => {
    // process 2+3=5, lead 10+10=20 → flow eff 25%. C/A 90% × 80% = 72%.
    useWorkspaceStore
      .getState()
      .upsertValueStreamStage(
        stage({ id: "s1", processTime: 2, leadTime: 10, completeAccurate: 90 })
      );
    useWorkspaceStore
      .getState()
      .upsertValueStreamStage(
        stage({ id: "s2", processTime: 3, leadTime: 10, completeAccurate: 80 })
      );

    const r = (await registry.get("tool.value_stream.list_state")!.handler({}, ctx())) as {
      stageCount: number;
      totalProcessTime: number;
      totalLeadTime: number;
      flowEfficiencyPct: number;
      rolledCompleteAccuratePct: number;
    };
    expect(r.stageCount).toBe(2);
    expect(r.totalProcessTime).toBe(5);
    expect(r.totalLeadTime).toBe(20);
    expect(r.flowEfficiencyPct).toBe(25);
    expect(r.rolledCompleteAccuratePct).toBe(72);
  });

  // Bug: process > lead (bad input) reported e.g. 183% flow efficiency to the
  // agent while the tool's UI caps the same figure at 100%.
  it("caps flow efficiency at 100% like the UI", async () => {
    useWorkspaceStore
      .getState()
      .upsertValueStreamStage(stage({ id: "s1", processTime: 11, leadTime: 6 }));
    const r = (await registry.get("tool.value_stream.list_state")!.handler({}, ctx())) as {
      flowEfficiencyPct: number;
    };
    expect(r.flowEfficiencyPct).toBe(100);
  });

  it("clamps an out-of-range %C/A into 0..100 and rounds totals to 1 decimal", async () => {
    useWorkspaceStore.setState({
      valueStreamStages: [
        stage({ id: "s1", processTime: 0.26, leadTime: 1.04, completeAccurate: 150 }),
        stage({ id: "s2", processTime: 0.1, leadTime: 1.02, completeAccurate: 50 }),
      ],
    });
    const r = (await registry.get("tool.value_stream.list_state")!.handler({}, ctx())) as {
      totalProcessTime: number;
      totalLeadTime: number;
      rolledCompleteAccuratePct: number;
    };
    expect(r.totalProcessTime).toBe(0.4);
    expect(r.totalLeadTime).toBe(2.1);
    expect(r.rolledCompleteAccuratePct).toBe(50);
  });
});

describe("tool.value_stream.add_stage", () => {
  beforeEach(() => useWorkspaceStore.setState({ valueStreamStages: [] }));

  it("appends a stage", async () => {
    const r = (await registry
      .get("tool.value_stream.add_stage")!
      .handler({ name: "Build", processTime: 2, leadTime: 5, completeAccurate: 95 }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(r.added).toBe(true);
    const stored = useWorkspaceStore.getState().valueStreamStages ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Build");
  });
});
