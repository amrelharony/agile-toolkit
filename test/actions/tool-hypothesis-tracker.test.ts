/**
 * tool.hypothesis_tracker.* coverage (singleton doc, S5).
 *
 *   1. registration — list_state read; add_hypothesis/set_status write.
 *   2. add_hypothesis + list_state — byStatus + validationRate.
 *   3. set_status — stamps resolvedAt on a terminal status; unknown → false.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/hypothesis-tracker";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const base = { believe: "b", willDo: "w", toLearn: "l", successMetric: "m" };

describe("tool.hypothesis_tracker — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.hypothesis_tracker.list_state")?.category).toBe("read");
    for (const verb of ["add_hypothesis", "set_status"]) {
      expect(registry.get(`tool.hypothesis_tracker.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.hypothesis_tracker.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.hypothesis_tracker.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.hypothesis_tracker lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ hypothesisTrackers: [] }));

  it("adds (default drafted) and computes validation rate over decisive", async () => {
    const a = (await registry
      .get("tool.hypothesis_tracker.add_hypothesis")!
      .handler({ ...base }, ctx())) as { added: boolean; id: string };
    const b = (await registry
      .get("tool.hypothesis_tracker.add_hypothesis")!
      .handler({ ...base }, ctx())) as { id: string };
    await registry.get("tool.hypothesis_tracker.add_hypothesis")!.handler({ ...base }, ctx()); // stays drafted

    await registry
      .get("tool.hypothesis_tracker.set_status")!
      .handler({ hypothesisId: a.id, status: "validated" }, ctx());
    await registry
      .get("tool.hypothesis_tracker.set_status")!
      .handler({ hypothesisId: b.id, status: "invalidated" }, ctx());

    const r = (await registry.get("tool.hypothesis_tracker.list_state")!.handler({}, ctx())) as {
      total: number;
      byStatus: Record<string, number>;
      validationRate: number;
    };
    expect(r.total).toBe(3);
    expect(r.byStatus.validated).toBe(1);
    expect(r.byStatus.invalidated).toBe(1);
    expect(r.byStatus.drafted).toBe(1);
    expect(r.validationRate).toBe(0.5); // 1 validated / 2 decisive

    // resolvedAt was stamped on the validated one
    const stored = (useWorkspaceStore.getState().hypothesisTrackers ?? [])[0].hypotheses.find(
      (h) => h.id === a.id
    )!;
    expect(stored.resolvedAt).toBeTruthy();
  });

  it("set_status returns false for an unknown id", async () => {
    const r = (await registry
      .get("tool.hypothesis_tracker.set_status")!
      .handler({ hypothesisId: "nope", status: "running" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});
