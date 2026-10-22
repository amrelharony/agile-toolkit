/**
 * tool.flaky_tests.* coverage (singleton doc, S10).
 *
 *   1. registration — list_state read; add_test/set_status write + mcpHandler.
 *   2. add_test + list_state — byStatus, avgFailureRate (active), worstOffenders.
 *   3. set_status — stamps fixedAt on "fixed"; unknown → {updated:false}.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FlakyTestBoard } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/flaky-tests";

const FB_ID = "flakyTestBoard:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.flaky_tests — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.flaky_tests.list_state")?.category).toBe("read");
    for (const verb of ["add_test", "set_status"]) {
      expect(registry.get(`tool.flaky_tests.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.flaky_tests.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.flaky_tests.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.flaky_tests.add_test + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ flakyTestBoards: [] }));

  it("appends with default status 'active' and firstSeenAt", async () => {
    const r = (await registry
      .get("tool.flaky_tests.add_test")!
      .handler({ name: "spec.login", failureRate: 0.3 }, ctx())) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    const board = (useWorkspaceStore.getState().flakyTestBoards ?? [])[0];
    expect(board.id).toBe(FB_ID);
    expect(board.tests[0].status).toBe("active");
    expect(board.tests[0].firstSeenAt).toBeTruthy();
  });

  it("averages active failure rate and ranks worst offenders", async () => {
    await registry
      .get("tool.flaky_tests.add_test")!
      .handler({ name: "a", failureRate: 0.4 }, ctx());
    await registry
      .get("tool.flaky_tests.add_test")!
      .handler({ name: "b", failureRate: 0.6 }, ctx());
    // fixed test excluded from avg (not active)
    await registry
      .get("tool.flaky_tests.add_test")!
      .handler({ name: "c", failureRate: 0.9, status: "fixed" }, ctx());

    const r = (await registry.get("tool.flaky_tests.list_state")!.handler({}, ctx())) as {
      total: number;
      byStatus: Record<string, number>;
      avgFailureRate: number;
      worstOffenders: { name: string; failureRate: number }[];
    };
    expect(r.total).toBe(3);
    expect(r.byStatus.active).toBe(2);
    expect(r.byStatus.fixed).toBe(1);
    expect(r.avgFailureRate).toBe(0.5); // (0.4+0.6)/2 active only
    expect(r.worstOffenders[0].name).toBe("c"); // 0.9 highest overall
  });
});

describe("tool.flaky_tests.set_status", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      flakyTestBoards: [
        {
          id: FB_ID,
          tests: [
            { id: "t1", name: "a", failureRate: 0.5, status: "active", firstSeenAt: "2026-01-01" },
          ],
        } as FlakyTestBoard,
      ],
    })
  );

  it("stamps fixedAt when set to 'fixed'", async () => {
    const r = (await registry
      .get("tool.flaky_tests.set_status")!
      .handler({ testId: "t1", status: "fixed" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    const t = (useWorkspaceStore.getState().flakyTestBoards ?? [])[0].tests[0];
    expect(t.status).toBe("fixed");
    expect(t.fixedAt).toBeTruthy();
  });

  it("returns updated:false for an unknown test id", async () => {
    const r = (await registry
      .get("tool.flaky_tests.set_status")!
      .handler({ testId: "nope", status: "quarantined" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});

// Bug: "today" was the UTC date (toISOString), while the scoreboard shows and
// buckets local days — near midnight away from UTC an agent's write landed on
// the wrong day.
describe("tool.flaky_tests — dates are the user's local day", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    useWorkspaceStore.setState({ flakyTestBoards: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["just after local midnight", new Date(2026, 9, 23, 0, 30)],
    ["just before local midnight", new Date(2026, 9, 23, 23, 30)],
  ])("stamps firstSeenAt and fixedAt %s", async (_when, now) => {
    vi.setSystemTime(now);
    const r = (await registry
      .get("tool.flaky_tests.add_test")!
      .handler({ name: "late", failureRate: 0.2 }, ctx())) as { id: string };
    await registry
      .get("tool.flaky_tests.set_status")!
      .handler({ testId: r.id, status: "fixed" }, ctx());
    const t = (useWorkspaceStore.getState().flakyTestBoards ?? [])[0].tests[0];
    expect(t.firstSeenAt).toBe("2026-10-23");
    expect(t.fixedAt).toBe("2026-10-23");
  });
});
