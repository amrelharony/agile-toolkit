/**
 * tool.flaky_tests.* with failures and runs (Phase 8), on both transports:
 *
 *   1. add_test — failures / runs, a bare rate for legacy-style rows,
 *      inline-error refusals, the local day, status dates.
 *   2. the server's day — the day after it is taken (a person ahead of
 *      UTC), and no status is stamped before the first-seen day.
 *   3. update_test — counts checked with the stored ones; clears; dates,
 *      never after the quarantine or the fix.
 *   4. set_status — lib/quality/flaky's rule: fixedAt kept on reopen.
 *   5. remove_test.
 *   6. list_state — the weighted rate, long quarantines, open-only worst
 *      offenders, all equal to flakySummary; both transports agree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FlakyTest, FlakyTestBoard } from "@/lib/stores/workspace-types";
import { FLAKY_BOARD_ID, FLAKY_BOARD_KIND, flakySummary, flakyVerdict } from "@/lib/quality/flaky";
import { FLAKY_BOARD } from "../stores/phase8-fixtures";

import "@/lib/actions/tools/flaky-tests";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
type Path = "handler" | "mcpHandler";
const PATHS: Path[] = ["handler", "mcpHandler"];
const run = <T>(path: Path, verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.flaky_tests.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

const TODAY = "2026-10-27";
const TOMORROW = "2026-10-28";
/** The first day each path refuses: the server also takes the day after its own (latestDay). */
const tooLate = (path: Path) => (path === "handler" ? TOMORROW : "2026-10-29");

function seed(path: Path, doc: FlakyTestBoard) {
  if (path === "handler") useWorkspaceStore.setState({ flakyTestBoards: [doc] });
  else rows.set(`${FLAKY_BOARD_KIND}/${FLAKY_BOARD_ID}`, doc);
}

function tests(path: Path): FlakyTest[] {
  const doc =
    path === "handler"
      ? (useWorkspaceStore.getState().flakyTestBoards ?? []).find((d) => d.id === FLAKY_BOARD_ID)
      : (rows.get(`${FLAKY_BOARD_KIND}/${FLAKY_BOARD_ID}`) as FlakyTestBoard | undefined);
  return doc?.tests ?? [];
}

const byId = (path: Path, id: string) => tests(path).find((t) => t.id === id);

beforeEach(() => {
  vi.useFakeTimers();
  // Late evening locally: the local day, never the UTC one.
  vi.setSystemTime(new Date(2026, 9, 27, 23, 30));
  rows.clear();
  useWorkspaceStore.setState({ flakyTestBoards: [] });
});
afterEach(() => vi.useRealTimers());

describe("tool.flaky_tests — registration", () => {
  it("update_test and remove_test write, without confirmation, on both paths", () => {
    for (const verb of ["update_test", "remove_test"]) {
      const action = registry.get(`tool.flaky_tests.${verb}`);
      expect(action?.category, verb).toBe("write");
      expect(action?.mcpHandler, verb).toBeTypeOf("function");
      expect(action?.requiresConfirmation, verb).toBe(false);
    }
  });
});

describe.each(PATHS)("tool.flaky_tests.add_test (%s)", (path) => {
  it("logs failures out of runs, with the rate kept equal, first seen today", async () => {
    const r = await run<{ added: boolean; id: string }>(path, "add_test", {
      name: "  checkout › VAT ",
      failures: 3,
      runs: 40,
      suite: "e2e",
    });
    expect(r.added).toBe(true);
    expect(byId(path, r.id)).toEqual({
      id: r.id,
      name: "checkout › VAT",
      suite: "e2e",
      failures: 3,
      runs: 40,
      failureRate: 0.075,
      status: "active",
      firstSeenAt: TODAY,
    });
  });

  it("keeps a bare rate for a test without run counts", async () => {
    const r = await run<{ id: string }>(path, "add_test", { name: "a", failureRate: 0.3 });
    expect(byId(path, r.id)).toMatchObject({ failureRate: 0.3 });
    expect(byId(path, r.id)?.runs).toBeUndefined();
  });

  it("refuses what the page refuses, naming the field", async () => {
    expect(await run(path, "add_test", { name: "a", failures: 5, runs: 4 })).toEqual({
      added: false,
      reason: "invalid_runs",
      message: "failures: It can't fail more often than it ran.",
    });
    expect(await run(path, "add_test", { name: "a", failures: 2 })).toMatchObject({
      reason: "invalid_runs",
      message: "runs: Enter how many times it ran.",
    });
    expect(await run(path, "add_test", { name: "a" })).toMatchObject({ reason: "missing_rate" });
    expect(
      await run(path, "add_test", { name: "a", failures: 1, runs: 2, firstSeenAt: tooLate(path) })
    ).toEqual({
      added: false,
      reason: "invalid_date",
      message: "firstSeenAt: The day can't be after today.",
    });
    expect(
      await run(path, "add_test", {
        name: "a",
        failureRate: 0.1,
        status: "quarantined",
        quarantinedAt: tooLate(path),
      })
    ).toEqual({
      added: false,
      reason: "invalid_date",
      message: "quarantinedAt: The day can't be after today.",
    });
    expect(tests(path)).toEqual([]);
  });

  it("dates a quarantined or fixed test, backdated or today", async () => {
    const q = await run<{ id: string }>(path, "add_test", {
      name: "q",
      failures: 1,
      runs: 20,
      status: "quarantined",
      firstSeenAt: "2026-09-01",
      quarantinedAt: "2026-09-20",
    });
    expect(byId(path, q.id)).toMatchObject({ quarantinedAt: "2026-09-20" });
    const f = await run<{ id: string }>(path, "add_test", {
      name: "f",
      failureRate: 0.1,
      status: "fixed",
    });
    expect(byId(path, f.id)).toMatchObject({ status: "fixed", fixedAt: TODAY });
    expect(
      await run(path, "add_test", {
        name: "bad",
        failureRate: 0.1,
        status: "fixed",
        firstSeenAt: "2026-10-10",
        fixedAt: "2026-10-01",
      })
    ).toMatchObject({
      reason: "invalid_date",
      message: "fixedAt: It can't come before firstSeenAt.",
    });
  });
});

describe("tool.flaky_tests — the server's day can be behind the person's", () => {
  // On a UTC server, a person ahead of UTC is already on the server's tomorrow.
  it("add_test takes the day after the server's, and stamps no status before it", async () => {
    const r = await run<{ added: boolean; id: string }>("mcpHandler", "add_test", {
      name: "q",
      failures: 1,
      runs: 20,
      status: "quarantined",
      firstSeenAt: TOMORROW,
    });
    expect(r.added).toBe(true);
    // Left out, the quarantine day is the first-seen day, not the server's earlier today.
    expect(byId("mcpHandler", r.id)).toMatchObject({
      firstSeenAt: TOMORROW,
      quarantinedAt: TOMORROW,
    });
    // Left out entirely, the first-seen day is still the server's today.
    const plain = await run<{ id: string }>("mcpHandler", "add_test", {
      name: "p",
      failureRate: 0.1,
    });
    expect(byId("mcpHandler", plain.id)?.firstSeenAt).toBe(TODAY);
  });

  it("the browser keeps its own today as the latest day", async () => {
    expect(
      await run("handler", "add_test", { name: "a", failureRate: 0.1, firstSeenAt: TOMORROW })
    ).toMatchObject({ added: false, reason: "invalid_date" });
  });

  it("set_status stamps the test's own later day, never a day before it was first seen", async () => {
    const r = await run<{ id: string }>("mcpHandler", "add_test", {
      name: "late",
      failures: 1,
      runs: 20,
      firstSeenAt: TOMORROW,
    });
    expect(await run("mcpHandler", "set_status", { testId: r.id, status: "quarantined" })).toEqual({
      updated: true,
      status: "quarantined",
      fixedAt: null,
      quarantinedAt: TOMORROW,
    });
    // A test first seen in the past is stamped with the server's today, as before.
    seed("mcpHandler", FLAKY_BOARD);
    await run("mcpHandler", "set_status", { testId: "ft_legacy", status: "fixed" });
    expect(byId("mcpHandler", "ft_legacy")?.fixedAt).toBe(TODAY);
  });
});

describe.each(PATHS)("tool.flaky_tests.update_test (%s)", (path) => {
  beforeEach(() => seed(path, FLAKY_BOARD));

  it("edits in place and clears an optional field", async () => {
    expect(
      await run(path, "update_test", {
        testId: "ft_1",
        patch: { name: "checkout › VAT", owner: null, description: "  " },
      })
    ).toEqual({ updated: true });
    const t = byId(path, "ft_1");
    expect(t?.name).toBe("checkout › VAT");
    expect(t?.owner).toBeUndefined();
    expect(t?.description).toBeUndefined();
    // Everything else stays, the hand-off link included.
    expect(t).toMatchObject({ suite: "e2e", quarantinedAt: "2026-10-05", failures: 30 });
    expect(t?.sentTo).toHaveLength(1);
  });

  it("checks new counts with the stored ones and keeps the rate equal", async () => {
    await run(path, "update_test", { testId: "ft_1", patch: { runs: 300 } });
    expect(byId(path, "ft_1")).toMatchObject({ failures: 30, runs: 300, failureRate: 0.1 });
    expect(await run(path, "update_test", { testId: "ft_1", patch: { runs: 20 } })).toMatchObject({
      updated: false,
      reason: "invalid_runs",
      message: "failures: It can't fail more often than it ran.",
    });
    // A legacy rate-only row needs both.
    expect(
      await run(path, "update_test", { testId: "ft_legacy", patch: { failures: 3 } })
    ).toMatchObject({ reason: "invalid_runs", message: "runs: Enter how many times it ran." });
    await run(path, "update_test", { testId: "ft_legacy", patch: { failures: 3, runs: 12 } });
    expect(byId(path, "ft_legacy")).toMatchObject({ failures: 3, runs: 12, failureRate: 0.25 });
  });

  it("backdates the first-seen day, never into the future", async () => {
    await run(path, "update_test", { testId: "ft_2", patch: { firstSeenAt: "2026-07-01" } });
    expect(byId(path, "ft_2")?.firstSeenAt).toBe("2026-07-01");
    expect(
      await run(path, "update_test", { testId: "ft_legacy", patch: { firstSeenAt: tooLate(path) } })
    ).toEqual({
      updated: false,
      reason: "invalid_date",
      message: "firstSeenAt: The day can't be after today.",
    });
  });

  it("never moves the first-seen day after the quarantine or the fix it carries", async () => {
    // ft_1 went into quarantine on 2026-10-05.
    expect(
      await run(path, "update_test", { testId: "ft_1", patch: { firstSeenAt: "2026-10-06" } })
    ).toEqual({
      updated: false,
      reason: "invalid_date",
      message: "firstSeenAt: It can't come after the day it went into quarantine (2026-10-05).",
    });
    await run(path, "update_test", { testId: "ft_1", patch: { firstSeenAt: "2026-10-05" } });
    expect(byId(path, "ft_1")?.firstSeenAt).toBe("2026-10-05");
    // ft_2 was fixed on 2026-10-10; reopened, it keeps that day, and the order with it.
    await run(path, "set_status", { testId: "ft_2", status: "active" });
    expect(
      await run(path, "update_test", { testId: "ft_2", patch: { firstSeenAt: "2026-10-11" } })
    ).toEqual({
      updated: false,
      reason: "invalid_date",
      message: "firstSeenAt: It can't come after the day it was fixed (2026-10-10).",
    });
    expect(byId(path, "ft_2")?.firstSeenAt).toBe("2026-08-01");
  });

  it("says when the test isn't there", async () => {
    expect(await run(path, "update_test", { testId: "nope", patch: { name: "x" } })).toEqual({
      updated: false,
      reason: "not_found",
    });
  });
});

describe.each(PATHS)("tool.flaky_tests.set_status and remove_test (%s)", (path) => {
  beforeEach(() => seed(path, FLAKY_BOARD));

  it("keeps fixedAt when a fixed test is reopened, and stamps quarantine days", async () => {
    expect(await run(path, "set_status", { testId: "ft_2", status: "active" })).toEqual({
      updated: true,
      status: "active",
      fixedAt: "2026-10-10",
      quarantinedAt: null,
    });
    await run(path, "set_status", { testId: "ft_2", status: "quarantined" });
    expect(byId(path, "ft_2")).toMatchObject({ quarantinedAt: TODAY, fixedAt: "2026-10-10" });
    await run(path, "set_status", { testId: "ft_1", status: "fixed" });
    expect(byId(path, "ft_1")).toMatchObject({ status: "fixed", fixedAt: TODAY });
    expect(byId(path, "ft_1")?.quarantinedAt).toBeUndefined();
  });

  it("removes a test by id", async () => {
    expect(await run(path, "remove_test", { testId: "ft_legacy" })).toEqual({ removed: true });
    expect(tests(path).map((t) => t.id)).toEqual(["ft_1", "ft_2"]);
    expect(await run(path, "remove_test", { testId: "ft_legacy" })).toEqual({
      removed: false,
      reason: "not_found",
    });
  });
});

describe.each(PATHS)("tool.flaky_tests.list_state (%s)", (path) => {
  it("reports what flakySummary does", async () => {
    seed(path, FLAKY_BOARD);
    const r = await run<{
      avgFailureRate: number | null;
      weightedFailureRate: {
        rate: number | null;
        failures: number;
        runs: number;
        rateOnly: number;
      };
      fixedThisQuarter: number;
      longQuarantined: { id: string; days: number }[];
      worstOffenders: { id: string; failureRate: number }[];
      verdict: string;
    }>(path, "list_state");
    const s = flakySummary(FLAKY_BOARD.tests, TODAY);
    expect(r.weightedFailureRate).toEqual({ rate: 0.15, failures: 30, runs: 200, rateOnly: 1 });
    expect(r.avgFailureRate).toBe(0.225);
    expect(r.fixedThisQuarter).toBe(s.fixedThisQuarter);
    expect(r.longQuarantined).toEqual([{ id: "ft_1", name: "checkout › VAT rounding", days: 22 }]);
    // Open tests only: the fixed ft_2 is out.
    expect(r.worstOffenders.map((o) => o.id)).toEqual(["ft_legacy", "ft_1"]);
    expect(r.verdict).toBe(flakyVerdict(s));
  });

  it("has no rates on an empty board", async () => {
    const r = await run<{ avgFailureRate: null; weightedFailureRate: { rate: null } }>(
      path,
      "list_state"
    );
    expect(r.avgFailureRate).toBeNull();
    expect(r.weightedFailureRate.rate).toBeNull();
  });
});

describe("tool.flaky_tests — both transports agree", () => {
  it("list_state reads the same board the same way", async () => {
    seed("handler", FLAKY_BOARD);
    seed("mcpHandler", FLAKY_BOARD);
    expect(await run("handler", "list_state")).toEqual(await run("mcpHandler", "list_state"));
  });
});
