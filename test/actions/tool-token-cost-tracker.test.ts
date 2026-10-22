/**
 * tool.token_cost_tracker.* coverage.
 *
 *   1. registration — list_state/compute read; record_spend write +
 *      mcpHandler + no confirm.
 *   2. list_state — totals + byFeature/byModel rollups sorted by cost.
 *   3. compute_monthly_projection — linear forecast + budget comparison.
 *   4. record_spend — appends with auto id + default date.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TokenSpend } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/token-cost-tracker";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function spend(
  p: Partial<TokenSpend> & Pick<TokenSpend, "id" | "feature" | "model" | "costUsd">
): TokenSpend {
  return { date: "2026-01-01", inputTokens: 0, outputTokens: 0, ...p };
}

describe("tool.token_cost_tracker — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.token_cost_tracker.list_state")?.category).toBe("read");
    expect(registry.get("tool.token_cost_tracker.compute_monthly_projection")?.category).toBe(
      "read"
    );
    expect(registry.get("tool.token_cost_tracker.record_spend")?.category).toBe("write");
    expect(registry.get("tool.token_cost_tracker.record_spend")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.token_cost_tracker.record_spend")?.requiresConfirmation).toBe(false);
    expect(
      registry.get("tool.token_cost_tracker.compute_monthly_projection")?.mcpHandler
    ).toBeUndefined();
  });
});

describe("tool.token_cost_tracker.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ tokenSpend: [] }));

  it("is zeroed when empty", async () => {
    const r = (await registry.get("tool.token_cost_tracker.list_state")!.handler({}, ctx())) as {
      totalEntries: number;
      totalCostUsd: number;
      byFeature: unknown[];
    };
    expect(r.totalEntries).toBe(0);
    expect(r.totalCostUsd).toBe(0);
    expect(r.byFeature).toEqual([]);
  });

  it("totals and rolls up by feature + model, sorted by cost", async () => {
    const u = useWorkspaceStore.getState().upsertTokenSpend;
    u(
      spend({
        id: "s1",
        feature: "chat",
        model: "opus",
        costUsd: 1.5,
        inputTokens: 100,
        outputTokens: 50,
      })
    );
    u(
      spend({
        id: "s2",
        feature: "chat",
        model: "haiku",
        costUsd: 0.25,
        inputTokens: 80,
        outputTokens: 20,
      })
    );
    u(
      spend({
        id: "s3",
        feature: "search",
        model: "opus",
        costUsd: 3.0,
        inputTokens: 200,
        outputTokens: 100,
      })
    );

    const r = (await registry.get("tool.token_cost_tracker.list_state")!.handler({}, ctx())) as {
      totalEntries: number;
      totalCostUsd: number;
      totalInputTokens: number;
      byFeature: { name: string; costUsd: number }[];
      byModel: { name: string; costUsd: number }[];
    };
    expect(r.totalEntries).toBe(3);
    expect(r.totalCostUsd).toBe(4.75);
    expect(r.totalInputTokens).toBe(380);
    // search ($3) > chat ($1.75)
    expect(r.byFeature[0].name).toBe("search");
    expect(r.byFeature[1]).toMatchObject({ name: "chat", costUsd: 1.75 });
    // opus ($4.5) > haiku ($0.25)
    expect(r.byModel[0]).toMatchObject({ name: "opus", costUsd: 4.5 });
  });
});

describe("tool.token_cost_tracker.compute_monthly_projection", () => {
  it("projects linearly and compares to budget", async () => {
    const r = (await registry
      .get("tool.token_cost_tracker.compute_monthly_projection")!
      .handler(
        { spentUsd: 100, daysElapsed: 10, daysInMonth: 30, monthlyBudgetUsd: 250 },
        ctx()
      )) as {
      dailyRateUsd: number;
      projectedMonthEndUsd: number;
      pctOfBudget: number;
      overBudget: boolean;
    };
    expect(r.dailyRateUsd).toBe(10);
    expect(r.projectedMonthEndUsd).toBe(300); // 10/day * 30
    expect(r.pctOfBudget).toBe(1.2); // 300 / 250
    expect(r.overBudget).toBe(true);
  });

  it("omits budget fields when no budget supplied; defaults daysInMonth to 30", async () => {
    const r = (await registry
      .get("tool.token_cost_tracker.compute_monthly_projection")!
      .handler({ spentUsd: 60, daysElapsed: 6 }, ctx())) as Record<string, number>;
    expect(r.projectedMonthEndUsd).toBe(300); // (60/6) * 30
    expect(r.pctOfBudget).toBeUndefined();
    expect(r.overBudget).toBeUndefined();
  });
});

describe("tool.token_cost_tracker.record_spend", () => {
  beforeEach(() => useWorkspaceStore.setState({ tokenSpend: [] }));

  it("appends a spend entry with auto id + default date", async () => {
    const r = (await registry
      .get("tool.token_cost_tracker.record_spend")!
      .handler(
        { feature: "chat", model: "opus", inputTokens: 100, outputTokens: 50, costUsd: 1.25 },
        ctx()
      )) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    const stored = useWorkspaceStore.getState().tokenSpend ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].costUsd).toBe(1.25);
    expect(stored[0].date).toBeTruthy();
  });

  it("keeps an explicit date", async () => {
    await registry.get("tool.token_cost_tracker.record_spend")!.handler(
      {
        feature: "chat",
        model: "opus",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        date: "2026-09-30",
      },
      ctx()
    );
    expect((useWorkspaceStore.getState().tokenSpend ?? [])[0].date).toBe("2026-09-30");
  });

  // Bug: the default date was the UTC day, but the tracker shows and windows
  // spend by local day, so an entry recorded just after local midnight (or in
  // the evening west of UTC) landed on the neighbouring day.
  it("defaults the date to the local calendar day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const now of [new Date(2026, 9, 18, 0, 30), new Date(2026, 9, 18, 23, 30)]) {
        vi.setSystemTime(now);
        useWorkspaceStore.setState({ tokenSpend: [] });
        await registry
          .get("tool.token_cost_tracker.record_spend")!
          .handler(
            { feature: "chat", model: "opus", inputTokens: 0, outputTokens: 0, costUsd: 0 },
            ctx()
          );
        expect((useWorkspaceStore.getState().tokenSpend ?? [])[0].date).toBe("2026-10-18");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("tool.token_cost_tracker.compute_monthly_projection — edges", () => {
  it("is zero with no spend, and not over a budget", async () => {
    const r = (await registry
      .get("tool.token_cost_tracker.compute_monthly_projection")!
      .handler({ spentUsd: 0, daysElapsed: 3, monthlyBudgetUsd: 100 }, ctx())) as {
      dailyRateUsd: number;
      projectedMonthEndUsd: number;
      pctOfBudget: number;
      overBudget: boolean;
    };
    expect(r).toEqual({
      dailyRateUsd: 0,
      projectedMonthEndUsd: 0,
      pctOfBudget: 0,
      overBudget: false,
    });
  });

  it("is not over budget when the projection lands exactly on it", async () => {
    const r = (await registry
      .get("tool.token_cost_tracker.compute_monthly_projection")!
      .handler(
        { spentUsd: 50, daysElapsed: 15, daysInMonth: 30, monthlyBudgetUsd: 100 },
        ctx()
      )) as {
      pctOfBudget: number;
      overBudget: boolean;
    };
    expect(r.pctOfBudget).toBe(1);
    expect(r.overBudget).toBe(false);
  });

  it("rejects a zero day count and a negative spend", () => {
    const schema = registry.get("tool.token_cost_tracker.compute_monthly_projection")!.paramsSchema;
    expect(schema.safeParse({ spentUsd: 10, daysElapsed: 0 }).success).toBe(false);
    expect(schema.safeParse({ spentUsd: -1, daysElapsed: 1 }).success).toBe(false);
  });
});
