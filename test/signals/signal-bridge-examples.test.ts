import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installSignalBridge, uninstallSignalBridge } from "@/lib/signals/signal-bridge";
import { subscribeSignals, __resetSignalBus, type Signal } from "@/lib/signals/signal-bus";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk, TechDebtItem } from "@/lib/stores/workspace-types";

/**
 * The Risk Register's and Tech Debt's examples are saved into
 * workspace.risks / techDebt since Phase 8: they aren't the team's risks
 * or debt, so they raise no risk.opened / techDebt.added (the cross-tool
 * correlations and the canvas read those).
 */

const flush = () => new Promise<void>((res) => setTimeout(res, 16));

const risk = (id: string): Risk =>
  ({
    id,
    title: `Risk ${id}`,
    probability: 4,
    impact: 4,
    status: "open",
    raisedAt: "2026-10-01",
  }) as Risk;
const debt = (id: string): TechDebtItem =>
  ({ id, title: `Debt ${id}`, impact: 4, effort: 2, raisedAt: "2026-10-01" }) as TechDebtItem;

describe("signal-bridge — example risks and debt", () => {
  let collected: Signal[];
  let unsubscribe: (() => void) | null = null;

  beforeEach(async () => {
    __resetSignalBus();
    useWorkspaceStore.setState({ risks: [], techDebt: [] });
    installSignalBridge();
    // The first change is the bridge's baseline.
    useWorkspaceStore.setState((s) => ({ ...s }));
    await flush();
    collected = [];
    unsubscribe = subscribeSignals(["risk.opened", "techDebt.added"], (s) => collected.push(s));
  });

  afterEach(() => {
    unsubscribe?.();
    uninstallSignalBridge();
    useWorkspaceStore.setState({ risks: [], techDebt: [] });
  });

  it("stays quiet for example rows and speaks for the team's", async () => {
    useWorkspaceStore.setState({
      risks: [risk("example-risk-1"), risk("r1")],
      techDebt: [debt("example-debt-1"), debt("d1")],
    });
    await flush();
    expect(collected.map((s) => s.kind).sort()).toEqual(["risk.opened", "techDebt.added"]);
  });
});
