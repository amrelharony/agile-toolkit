/**
 * tool.rlhf_log.* coverage.
 *
 *   1. registration — list_state read; record_comparison write + mcpHandler
 *      + no confirm.
 *   2. list_state — byWinner, winRateA (ties excluded from denominator),
 *      tieRate.
 *   3. record_comparison — appends with auto id + default loggedAt.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RlhfPair } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/rlhf-log";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function pair(p: Partial<RlhfPair> & Pick<RlhfPair, "id" | "winner">): RlhfPair {
  return {
    prompt: "p",
    responseA: "a",
    responseB: "b",
    loggedAt: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("tool.rlhf_log — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.rlhf_log.list_state")?.category).toBe("read");
    expect(registry.get("tool.rlhf_log.record_comparison")?.category).toBe("write");
    expect(registry.get("tool.rlhf_log.record_comparison")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.rlhf_log.record_comparison")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.rlhf_log.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ rlhfPairs: [] }));

  it("is zeroed when empty", async () => {
    const r = (await registry.get("tool.rlhf_log.list_state")!.handler({}, ctx())) as {
      total: number;
      winRateA: number;
      tieRate: number;
    };
    expect(r.total).toBe(0);
    expect(r.winRateA).toBe(0);
    expect(r.tieRate).toBe(0);
  });

  it("computes winRateA over decisive comparisons and tieRate over all", async () => {
    const u = useWorkspaceStore.getState().upsertRlhfPair;
    u(pair({ id: "p1", winner: "A" }));
    u(pair({ id: "p2", winner: "A" }));
    u(pair({ id: "p3", winner: "B" }));
    u(pair({ id: "p4", winner: "tie" }));

    const r = (await registry.get("tool.rlhf_log.list_state")!.handler({}, ctx())) as {
      total: number;
      byWinner: Record<string, number>;
      winRateA: number;
      tieRate: number;
    };
    expect(r.total).toBe(4);
    expect(r.byWinner).toEqual({ A: 2, B: 1, tie: 1 });
    expect(r.winRateA).toBe(0.67); // 2 / (2+1) decisive
    expect(r.tieRate).toBe(0.25); // 1 / 4
  });

  it("reports a zero A win rate, not NaN, when every comparison is a tie", async () => {
    const u = useWorkspaceStore.getState().upsertRlhfPair;
    u(pair({ id: "p1", winner: "tie" }));
    u(pair({ id: "p2", winner: "tie" }));

    const r = (await registry.get("tool.rlhf_log.list_state")!.handler({}, ctx())) as {
      winRateA: number;
      tieRate: number;
    };
    expect(r.winRateA).toBe(0);
    expect(r.tieRate).toBe(1);
  });
});

describe("tool.rlhf_log.record_comparison", () => {
  beforeEach(() => useWorkspaceStore.setState({ rlhfPairs: [] }));

  it("appends a pair with auto id + default loggedAt", async () => {
    const r = (await registry
      .get("tool.rlhf_log.record_comparison")!
      .handler(
        { prompt: "Summarise X", responseA: "good", responseB: "bad", winner: "A" },
        ctx()
      )) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    const stored = useWorkspaceStore.getState().rlhfPairs ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].winner).toBe("A");
    expect(stored[0].loggedAt).toBeTruthy();
  });
});
