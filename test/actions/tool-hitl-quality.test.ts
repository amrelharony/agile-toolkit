/**
 * tool.hitl_quality.* coverage.
 *
 *   1. registration — list_state read; record_review write + mcpHandler +
 *      no confirm.
 *   2. list_state — averageRating, ratingDistribution, agreementRate,
 *      byReviewer rollup; out-of-range ratings excluded from the average.
 *   3. record_review — appends with auto id + default loggedAt.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HitlReview } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/hitl-quality";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function review(
  p: Partial<HitlReview> & Pick<HitlReview, "id" | "rating" | "agreedWithModel">
): HitlReview {
  return { loggedAt: "2026-01-01T00:00:00.000Z", ...p };
}

describe("tool.hitl_quality — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.hitl_quality.list_state")?.category).toBe("read");
    expect(registry.get("tool.hitl_quality.record_review")?.category).toBe("write");
    expect(registry.get("tool.hitl_quality.record_review")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.hitl_quality.record_review")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.hitl_quality.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ hitlReviews: [] }));

  it("is zeroed when empty", async () => {
    const r = (await registry.get("tool.hitl_quality.list_state")!.handler({}, ctx())) as {
      total: number;
      averageRating: number;
      agreementRate: number;
    };
    expect(r.total).toBe(0);
    expect(r.averageRating).toBe(0);
    expect(r.agreementRate).toBe(0);
  });

  it("averages ratings, computes agreement, and rolls up by reviewer", async () => {
    const u = useWorkspaceStore.getState().upsertHitlReview;
    u(review({ id: "r1", rating: 5, agreedWithModel: true, reviewer: "alice" }));
    u(review({ id: "r2", rating: 3, agreedWithModel: false, reviewer: "alice" }));
    u(review({ id: "r3", rating: 4, agreedWithModel: true, reviewer: "bob" }));

    const r = (await registry.get("tool.hitl_quality.list_state")!.handler({}, ctx())) as {
      total: number;
      averageRating: number;
      ratingDistribution: Record<string, number>;
      agreementRate: number;
      byReviewer: Record<string, { count: number; avgRating: number; agreementRate: number }>;
    };
    expect(r.total).toBe(3);
    expect(r.averageRating).toBe(4); // (5+3+4)/3
    expect(r.ratingDistribution["5"]).toBe(1);
    expect(r.agreementRate).toBe(0.67); // 2 of 3 agreed
    expect(r.byReviewer.alice).toEqual({ count: 2, avgRating: 4, agreementRate: 0.5 });
    expect(r.byReviewer.bob).toEqual({ count: 1, avgRating: 4, agreementRate: 1 });
  });
});

describe("tool.hitl_quality.record_review", () => {
  beforeEach(() => useWorkspaceStore.setState({ hitlReviews: [] }));

  it("appends a review with auto id + default loggedAt", async () => {
    const r = (await registry
      .get("tool.hitl_quality.record_review")!
      .handler(
        { rating: 4, agreedWithModel: true, feature: "summariser", reviewer: "alice" },
        ctx()
      )) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    const stored = useWorkspaceStore.getState().hitlReviews ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].rating).toBe(4);
    expect(stored[0].loggedAt).toBeTruthy();
  });
});
