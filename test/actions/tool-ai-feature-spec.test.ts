/**
 * tool.ai_feature_spec.* coverage (singleton doc).
 *
 *   1. registration — list_state read; update_spec write + mcpHandler + no
 *      confirm.
 *   2. list_state — blanks + completeness 0 when no spec saved.
 *   3. update_spec — creates the singleton, merges partial fields, and
 *      bumps completeness.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/ai-feature-spec";

const SPEC_ID = "aiFeatureSpec:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.ai_feature_spec — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.ai_feature_spec.list_state")?.category).toBe("read");
    expect(registry.get("tool.ai_feature_spec.update_spec")?.category).toBe("write");
    expect(registry.get("tool.ai_feature_spec.update_spec")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.ai_feature_spec.update_spec")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.ai_feature_spec.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ aiFeatureSpecs: [] }));

  it("returns blanks with completeness 0 when nothing saved", async () => {
    const r = (await registry.get("tool.ai_feature_spec.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      filledFields: number;
      totalFields: number;
      completeness: number;
      spec: { featureName: string };
    };
    expect(r.exists).toBe(false);
    expect(r.filledFields).toBe(0);
    expect(r.totalFields).toBe(11);
    expect(r.completeness).toBe(0);
    expect(r.spec.featureName).toBe("");
  });
});

describe("tool.ai_feature_spec.update_spec", () => {
  beforeEach(() => useWorkspaceStore.setState({ aiFeatureSpecs: [] }));

  it("creates the singleton and merges partial fields", async () => {
    const r = (await registry
      .get("tool.ai_feature_spec.update_spec")!
      .handler({ featureName: "Smart triage", problem: "sort the inbox" }, ctx())) as {
      updated: boolean;
    };
    expect(r.updated).toBe(true);

    const specs = useWorkspaceStore.getState().aiFeatureSpecs ?? [];
    expect(specs).toHaveLength(1);
    expect(specs[0].id).toBe(SPEC_ID);
    expect(specs[0].featureName).toBe("Smart triage");

    // A second partial update merges (doesn't wipe the first field).
    await registry.get("tool.ai_feature_spec.update_spec")!.handler({ modelChoice: "opus" }, ctx());
    const after = (useWorkspaceStore.getState().aiFeatureSpecs ?? [])[0];
    expect(after.featureName).toBe("Smart triage"); // preserved
    expect(after.modelChoice).toBe("opus");

    const state = (await registry.get("tool.ai_feature_spec.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      filledFields: number;
      completeness: number;
    };
    expect(state.exists).toBe(true);
    expect(state.filledFields).toBe(3); // featureName, problem, modelChoice
    expect(state.completeness).toBe(0.27); // 3/11
  });
});
