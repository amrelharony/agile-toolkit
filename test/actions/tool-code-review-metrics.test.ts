/**
 * tool.code_review_metrics.* coverage (singleton doc, S10).
 *
 *   1. registration — list_state read; add_sample write + mcpHandler.
 *   2. list_state — null averages when empty; cycle-time + averages after.
 *   3. add_sample — appends with auto id.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/code-review-metrics";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.code_review_metrics — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.code_review_metrics.list_state")?.category).toBe("read");
    expect(registry.get("tool.code_review_metrics.add_sample")?.category).toBe("write");
    expect(registry.get("tool.code_review_metrics.add_sample")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.code_review_metrics.add_sample")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.code_review_metrics.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ codeReviewLogs: [] }));

  it("returns null averages when empty", async () => {
    const r = (await registry.get("tool.code_review_metrics.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      avgCycleTimeHours: number | null;
      avgReviewers: number | null;
    };
    expect(r.exists).toBe(false);
    expect(r.total).toBe(0);
    expect(r.avgCycleTimeHours).toBeNull();
    expect(r.avgReviewers).toBeNull();
  });

  it("computes cycle time over merged PRs and averages", async () => {
    await registry.get("tool.code_review_metrics.add_sample")!.handler(
      {
        author: "alice",
        openedAt: "2026-01-01T00:00:00.000Z",
        mergedAt: "2026-01-02T00:00:00.000Z", // 24h
        reviewerCount: 2,
        commentCount: 5,
        linesChanged: 100,
      },
      ctx()
    );
    // open PR (no mergedAt) — excluded from cycle time, counted in averages
    await registry
      .get("tool.code_review_metrics.add_sample")!
      .handler(
        {
          author: "bob",
          openedAt: "2026-01-03T00:00:00.000Z",
          reviewerCount: 4,
          commentCount: 1,
          linesChanged: 50,
        },
        ctx()
      );

    const r = (await registry.get("tool.code_review_metrics.list_state")!.handler({}, ctx())) as {
      total: number;
      mergedCount: number;
      avgCycleTimeHours: number;
      avgReviewers: number;
      avgComments: number;
    };
    expect(r.total).toBe(2);
    expect(r.mergedCount).toBe(1);
    expect(r.avgCycleTimeHours).toBe(24); // only the merged PR
    expect(r.avgReviewers).toBe(3); // (2+4)/2
    expect(r.avgComments).toBe(3); // (5+1)/2
  });
});

describe("tool.code_review_metrics.add_sample", () => {
  beforeEach(() => useWorkspaceStore.setState({ codeReviewLogs: [] }));

  it("appends a sample with auto id", async () => {
    const r = (await registry
      .get("tool.code_review_metrics.add_sample")!
      .handler(
        {
          author: "alice",
          openedAt: "2026-01-01",
          reviewerCount: 1,
          commentCount: 0,
          linesChanged: 10,
        },
        ctx()
      )) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    expect((useWorkspaceStore.getState().codeReviewLogs ?? [])[0].samples).toHaveLength(1);
  });
});
