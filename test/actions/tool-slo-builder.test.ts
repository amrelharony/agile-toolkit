/**
 * tool.slo_builder.* coverage (singleton doc, S7).
 *
 *   1. registration — list_state/compute read (compute is pure); add_slo/
 *      record_burn write + mcpHandler.
 *   2. compute_error_budget — (1-target)*windowDays*24*60.
 *   3. add_slo + record_burn + list_state — per-SLO budget/burn math.
 *   4. record_burn refuses an unknown sloId.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/slo-builder";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.slo_builder — registration", () => {
  it("read/write categories + compute is pure", () => {
    expect(registry.get("tool.slo_builder.list_state")?.category).toBe("read");
    expect(registry.get("tool.slo_builder.compute_error_budget")?.category).toBe("read");
    expect(registry.get("tool.slo_builder.compute_error_budget")?.mcpHandler).toBeUndefined();
    for (const verb of ["add_slo", "record_burn"]) {
      expect(registry.get(`tool.slo_builder.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.slo_builder.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.slo_builder.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.slo_builder.compute_error_budget", () => {
  it("computes allowed error minutes", async () => {
    const r = (await registry
      .get("tool.slo_builder.compute_error_budget")!
      .handler({ target: 0.99, windowDays: 30 }, ctx())) as { budgetMinutes: number };
    expect(r.budgetMinutes).toBe(432); // 0.01 * 30 * 24 * 60
  });
});

describe("tool.slo_builder.add_slo + record_burn + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ sloBuilders: [] }));

  it("tracks per-SLO budget and burn", async () => {
    const added = (await registry
      .get("tool.slo_builder.add_slo")!
      .handler(
        { name: "API uptime", sliDescription: "2xx ratio", target: 0.99, windowDays: 30 },
        ctx()
      )) as {
      added: boolean;
      id: string;
    };
    expect(added.added).toBe(true);

    await registry
      .get("tool.slo_builder.record_burn")!
      .handler({ sloId: added.id, errorMinutes: 100 }, ctx());

    const r = (await registry.get("tool.slo_builder.list_state")!.handler({}, ctx())) as {
      sloCount: number;
      burnCount: number;
      perSlo: {
        sloId: string;
        budgetMinutes: number;
        burnedMinutes: number;
        budgetRemainingMinutes: number;
        budgetBurnedPct: number;
      }[];
    };
    expect(r.sloCount).toBe(1);
    expect(r.burnCount).toBe(1);
    expect(r.perSlo[0].budgetMinutes).toBe(432);
    expect(r.perSlo[0].burnedMinutes).toBe(100);
    expect(r.perSlo[0].budgetRemainingMinutes).toBe(332);
    expect(r.perSlo[0].budgetBurnedPct).toBe(0.23); // 100/432
  });

  it("refuses a burn against an unknown SLO", async () => {
    await registry
      .get("tool.slo_builder.add_slo")!
      .handler({ name: "x", sliDescription: "y", target: 0.99, windowDays: 30 }, ctx());
    const r = (await registry
      .get("tool.slo_builder.record_burn")!
      .handler({ sloId: "ghost", errorMinutes: 10 }, ctx())) as { added: boolean };
    expect(r.added).toBe(false);
  });
});

describe("tool.slo_builder — edges", () => {
  beforeEach(() => useWorkspaceStore.setState({ sloBuilders: [] }));
  afterEach(() => vi.useRealTimers());

  it("reports no doc before anything is added", async () => {
    const r = (await registry.get("tool.slo_builder.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      sloCount: number;
      perSlo: unknown[];
    };
    expect(r).toMatchObject({ exists: false, sloCount: 0, burnCount: 0, perSlo: [] });
  });

  it("gives a 100 % target a zero budget and a 0 burned share", async () => {
    const budget = (await registry
      .get("tool.slo_builder.compute_error_budget")!
      .handler({ target: 1, windowDays: 30 }, ctx())) as { budgetMinutes: number };
    expect(budget.budgetMinutes).toBe(0);

    await registry
      .get("tool.slo_builder.add_slo")!
      .handler({ name: "strict", sliDescription: "2xx", target: 1, windowDays: 30 }, ctx());
    const r = (await registry.get("tool.slo_builder.list_state")!.handler({}, ctx())) as {
      perSlo: { budgetBurnedPct: number }[];
    };
    expect(r.perSlo[0].budgetBurnedPct).toBe(0);
  });

  it("keeps an explicit burn date", async () => {
    const { id } = (await registry
      .get("tool.slo_builder.add_slo")!
      .handler({ name: "api", sliDescription: "2xx", target: 0.999, windowDays: 30 }, ctx())) as {
      id: string;
    };
    await registry
      .get("tool.slo_builder.record_burn")!
      .handler({ sloId: id, errorMinutes: 2, date: "2026-10-01" }, ctx());
    expect(useWorkspaceStore.getState().sloBuilders?.[0].burns[0]).toMatchObject({
      sloId: id,
      date: "2026-10-01",
      errorMinutes: 2,
    });
  });

  // Bug: the default burn date was the UTC day, while the SLO builder dates
  // and windows burns by the local calendar day.
  it("dates a burn without a date on the local calendar day", async () => {
    // 00:30 local is still the previous day in UTC east of Greenwich, and
    // 23:30 local is already the next day in UTC west of it.
    const east = new Date(2026, 9, 18, 0, 30).getTimezoneOffset() < 0;
    const now = east ? new Date(2026, 9, 18, 0, 30) : new Date(2026, 9, 18, 23, 30);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const { id } = (await registry
      .get("tool.slo_builder.add_slo")!
      .handler({ name: "api", sliDescription: "2xx", target: 0.999, windowDays: 30 }, ctx())) as {
      id: string;
    };
    await registry
      .get("tool.slo_builder.record_burn")!
      .handler({ sloId: id, errorMinutes: 1 }, ctx());
    expect(useWorkspaceStore.getState().sloBuilders?.[0].burns[0].date).toBe("2026-10-18");
  });
});

describe("tool.slo_builder.add_slo — blank text", () => {
  beforeEach(() => useWorkspaceStore.setState({ sloBuilders: [] }));

  // Bug: a whitespace-only name / SLI passed `min(1)` and was stored blank;
  // the UI trims and requires both.
  it("refuses a whitespace-only name or SLI and trims real ones", async () => {
    const add = (name: string, sliDescription: string) =>
      registry
        .get("tool.slo_builder.add_slo")!
        .handler({ name, sliDescription, target: 0.99, windowDays: 30 }, ctx()) as Promise<{
        added: boolean;
      }>;
    expect((await add("   ", "2xx")).added).toBe(false);
    expect((await add("api", "  ")).added).toBe(false);
    expect((await add("  api  ", " 2xx ")).added).toBe(true);
    expect(useWorkspaceStore.getState().sloBuilders?.[0].slos).toEqual([
      expect.objectContaining({ name: "api", sliDescription: "2xx" }),
    ]);
  });
});
