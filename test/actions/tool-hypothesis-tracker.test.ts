/**
 * tool.hypothesis_tracker.* coverage (singleton doc, S5).
 *
 *   1. registration — list_state read; add_hypothesis/set_status write.
 *   2. add_hypothesis + list_state — byStatus + validationRate.
 *   3. set_status — stamps resolvedAt on a terminal status; unknown → false.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("tool.hypothesis_tracker dates + resolution", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ hypothesisTrackers: [] });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A local time whose UTC calendar day differs from the local one (when TZ ≠ UTC). */
  const dayEdge = () =>
    new Date(2026, 9, 18, 12).getTimezoneOffset() < 0
      ? new Date(2026, 9, 18, 0, 30)
      : new Date(2026, 9, 18, 23, 30);

  const stored = () => (useWorkspaceStore.getState().hypothesisTrackers ?? [])[0].hypotheses;

  // Bug: dates were stamped with the UTC day, so near midnight an agent-added
  // hypothesis was "raised" a day off from the local day the tool shows.
  it("stamps raisedAt and resolvedAt with the local calendar day", async () => {
    vi.setSystemTime(dayEdge());
    const a = (await registry
      .get("tool.hypothesis_tracker.add_hypothesis")!
      .handler({ ...base }, ctx())) as { id: string };
    expect(stored()[0].raisedAt).toBe("2026-10-18");
    await registry
      .get("tool.hypothesis_tracker.set_status")!
      .handler({ hypothesisId: a.id, status: "validated" }, ctx());
    expect(stored()[0].resolvedAt).toBe("2026-10-18");
  });

  // Bug: adding straight into a terminal status left resolvedAt unset, so the
  // tool treated the hypothesis as still open (no outcome field, no resolved date).
  it("stamps resolvedAt when a hypothesis is added already resolved", async () => {
    vi.setSystemTime(new Date(2026, 9, 18, 10));
    await registry
      .get("tool.hypothesis_tracker.add_hypothesis")!
      .handler({ ...base, status: "invalidated" }, ctx());
    await registry
      .get("tool.hypothesis_tracker.add_hypothesis")!
      .handler({ ...base, status: "running" }, ctx());
    expect(stored()[0]).toMatchObject({ status: "invalidated", resolvedAt: "2026-10-18" });
    expect(stored()[1].resolvedAt).toBeUndefined();
  });

  it("keeps the first resolution date across terminal moves and clears it on reopen", async () => {
    vi.setSystemTime(new Date(2026, 9, 18, 10));
    const a = (await registry
      .get("tool.hypothesis_tracker.add_hypothesis")!
      .handler({ ...base }, ctx())) as { id: string };
    const setStatus = (status: string) =>
      registry
        .get("tool.hypothesis_tracker.set_status")!
        .handler({ hypothesisId: a.id, status }, ctx());
    await setStatus("validated");
    vi.setSystemTime(new Date(2026, 9, 20, 10));
    await setStatus("inconclusive");
    expect(stored()[0]).toMatchObject({ status: "inconclusive", resolvedAt: "2026-10-18" });
    await setStatus("running");
    expect(stored()[0].status).toBe("running");
    expect(stored()[0].resolvedAt).toBeUndefined();
  });

  it("list_state on an empty workspace reports no tracker and a 0 rate", async () => {
    const r = (await registry.get("tool.hypothesis_tracker.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      validationRate: number;
    };
    expect(r).toMatchObject({ exists: false, total: 0, validationRate: 0 });
  });
});
