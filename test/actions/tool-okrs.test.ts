/**
 * tool.okrs.* coverage (WIRE over the synced okr entity).
 *
 *   1. list_state (read) + update_key_result (write, mcpHandler, no confirm)
 *   2. progress % = mean key-result attainment (clamped), overall = mean of those
 *   3. update_key_result sets a KR's current + returns new progress; unknown
 *      okr/kr → {updated:false}
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Okr } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/okrs";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function okr(id: string, krs: { id: string; target: number; current: number }[]): Okr {
  return {
    id,
    objective: `obj ${id}`,
    quarter: "2026-Q1",
    keyResults: krs.map((k) => ({ id: k.id, title: k.id, target: k.target, current: k.current })),
  };
}

describe("tool.okrs — registration", () => {
  it("list_state read; update_key_result write + mcpHandler + no confirm", () => {
    expect(registry.get("tool.okrs.list_state")?.category).toBe("read");
    expect(registry.get("tool.okrs.update_key_result")?.category).toBe("write");
    expect(registry.get("tool.okrs.update_key_result")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.okrs.update_key_result")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.okrs.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ okrs: [] }));

  it("is zeroed when empty", async () => {
    const r = (await registry.get("tool.okrs.list_state")!.handler({}, ctx())) as {
      total: number;
      overallProgressPct: number;
    };
    expect(r.total).toBe(0);
    expect(r.overallProgressPct).toBe(0);
  });

  it("computes per-OKR and overall progress", async () => {
    // OKR1: KRs at 50% and 100% → 75%. OKR2: KR at 50/100=50% → 50%. overall 63 (round).
    useWorkspaceStore.getState().upsertOkr(
      okr("o1", [
        { id: "k1", target: 100, current: 50 },
        { id: "k2", target: 10, current: 10 },
      ])
    );
    useWorkspaceStore.getState().upsertOkr(okr("o2", [{ id: "k3", target: 100, current: 50 }]));

    const r = (await registry.get("tool.okrs.list_state")!.handler({}, ctx())) as {
      total: number;
      overallProgressPct: number;
      items: { id: string; progressPct: number }[];
    };
    expect(r.total).toBe(2);
    expect(r.items.find((i) => i.id === "o1")!.progressPct).toBe(75);
    expect(r.items.find((i) => i.id === "o2")!.progressPct).toBe(50);
    expect(r.overallProgressPct).toBe(63); // round((75+50)/2)
  });

  it("clamps over-attainment to 100% per key result", async () => {
    useWorkspaceStore.getState().upsertOkr(okr("o1", [{ id: "k1", target: 10, current: 50 }]));
    const r = (await registry.get("tool.okrs.list_state")!.handler({}, ctx())) as {
      items: { progressPct: number }[];
    };
    expect(r.items[0].progressPct).toBe(100);
  });
});

describe("tool.okrs.update_key_result", () => {
  beforeEach(() => useWorkspaceStore.setState({ okrs: [] }));

  it("updates a key result's current and returns new progress", async () => {
    useWorkspaceStore.getState().upsertOkr(okr("o1", [{ id: "k1", target: 100, current: 0 }]));
    const r = (await registry
      .get("tool.okrs.update_key_result")!
      .handler({ okrId: "o1", keyResultId: "k1", current: 80 }, ctx())) as {
      updated: boolean;
      progressPct: number;
    };
    expect(r.updated).toBe(true);
    expect(r.progressPct).toBe(80);
    const stored = (useWorkspaceStore.getState().okrs ?? []).find((o) => o.id === "o1");
    expect(stored?.keyResults[0].current).toBe(80);
  });

  it("returns {updated:false} for unknown okr or key result", async () => {
    useWorkspaceStore.getState().upsertOkr(okr("o1", [{ id: "k1", target: 100, current: 0 }]));
    const action = registry.get("tool.okrs.update_key_result")!;
    expect(
      (
        (await action.handler({ okrId: "nope", keyResultId: "k1", current: 1 }, ctx())) as {
          updated: boolean;
        }
      ).updated
    ).toBe(false);
    expect(
      (
        (await action.handler({ okrId: "o1", keyResultId: "nope", current: 1 }, ctx())) as {
          updated: boolean;
        }
      ).updated
    ).toBe(false);
  });
});
