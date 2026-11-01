/**
 * tool.flaky_tests.update_test backdating a status day, on both
 * transports, as the page's edit form does: quarantinedAt only for a
 * quarantined test and fixedAt only for a fixed one ('wrong_status'
 * otherwise), never after the latest day the path takes, never before the
 * first-seen day (also when both are patched together).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { FLAKY_BOARD_ID, FLAKY_BOARD_KIND } from "@/lib/quality/flaky";

import "@/lib/actions/tools/flaky-tests";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
type Path = "handler" | "mcpHandler";
const PATHS: Path[] = ["handler", "mcpHandler"];
const update = (path: Path, params: Record<string, unknown>) => {
  const action = registry.get("tool.flaky_tests.update_test")!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<{
    updated: boolean;
    reason?: string;
    message?: string;
  }>;
};

/** The first day each path refuses: the server also takes the day after its own. */
const tooLate = (path: Path) => (path === "handler" ? "2026-10-28" : "2026-10-29");

const QUARANTINED: FlakyTest = {
  id: "q",
  name: "checkout › VAT",
  failureRate: 0.15,
  failures: 30,
  runs: 200,
  status: "quarantined",
  firstSeenAt: "2026-09-14",
  quarantinedAt: "2026-10-27",
};
const FIXED: FlakyTest = {
  id: "f",
  name: "search › debounce",
  failureRate: 0.05,
  status: "fixed",
  firstSeenAt: "2026-08-01",
  fixedAt: "2026-10-27",
};
const ACTIVE: FlakyTest = {
  id: "a",
  name: "login",
  failureRate: 0.1,
  status: "active",
  firstSeenAt: "2026-10-01",
};

function seed(path: Path) {
  const doc: FlakyTestBoard = { id: FLAKY_BOARD_ID, tests: [QUARANTINED, FIXED, ACTIVE] };
  if (path === "handler") useWorkspaceStore.setState({ flakyTestBoards: [doc] });
  else rows.set(`${FLAKY_BOARD_KIND}/${FLAKY_BOARD_ID}`, doc);
}

function byId(path: Path, id: string): FlakyTest | undefined {
  const doc =
    path === "handler"
      ? (useWorkspaceStore.getState().flakyTestBoards ?? []).find((d) => d.id === FLAKY_BOARD_ID)
      : (rows.get(`${FLAKY_BOARD_KIND}/${FLAKY_BOARD_ID}`) as FlakyTestBoard | undefined);
  return doc?.tests.find((t) => t.id === id);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 27, 23, 30));
  rows.clear();
  useWorkspaceStore.setState({ flakyTestBoards: [] });
});
afterEach(() => vi.useRealTimers());

describe.each(PATHS)("tool.flaky_tests.update_test status days (%s)", (path) => {
  it("backdates a quarantine and a fix, the rest of the test kept", async () => {
    seed(path);
    expect(await update(path, { testId: "q", patch: { quarantinedAt: "2026-10-01" } })).toEqual({
      updated: true,
    });
    expect(byId(path, "q")).toEqual({ ...QUARANTINED, quarantinedAt: "2026-10-01" });
    expect(await update(path, { testId: "f", patch: { fixedAt: "2026-09-30" } })).toEqual({
      updated: true,
    });
    expect(byId(path, "f")).toEqual({ ...FIXED, fixedAt: "2026-09-30" });
  });

  it("refuses the day of a status the test isn't in", async () => {
    seed(path);
    for (const [testId, patch] of [
      ["a", { quarantinedAt: "2026-10-20" }],
      ["q", { fixedAt: "2026-10-20" }],
      ["f", { quarantinedAt: "2026-10-20" }],
    ] as const) {
      expect(await update(path, { testId, patch })).toMatchObject({
        updated: false,
        reason: "wrong_status",
      });
    }
    expect(byId(path, "a")).toEqual(ACTIVE);
  });

  it("refuses a day after the latest it takes, a blank, and one before first seen", async () => {
    seed(path);
    expect(await update(path, { testId: "q", patch: { quarantinedAt: tooLate(path) } })).toEqual({
      updated: false,
      reason: "invalid_date",
      message: "quarantinedAt: The day can't be after today.",
    });
    expect(await update(path, { testId: "q", patch: { quarantinedAt: " " } })).toMatchObject({
      updated: false,
      reason: "invalid_date",
    });
    expect(await update(path, { testId: "f", patch: { fixedAt: "2026-07-31" } })).toEqual({
      updated: false,
      reason: "invalid_date",
      message: "fixedAt: It can't come before the day it was first seen (2026-08-01).",
    });
    expect(byId(path, "q")).toEqual(QUARANTINED);
    expect(byId(path, "f")).toEqual(FIXED);
  });

  it("checks the first-seen day against the status day patched with it", async () => {
    seed(path);
    expect(await update(path, { testId: "q", patch: { quarantinedAt: "2026-09-20" } })).toEqual({
      updated: true,
    });
    // Both moved, in order: fine, though the new first-seen day is after
    // the quarantine day stored before this patch.
    expect(
      await update(path, {
        testId: "q",
        patch: { firstSeenAt: "2026-09-25", quarantinedAt: "2026-10-01" },
      })
    ).toEqual({ updated: true });
    expect(byId(path, "q")).toMatchObject({
      firstSeenAt: "2026-09-25",
      quarantinedAt: "2026-10-01",
    });
    // The first-seen day after the quarantine patched beside it is refused.
    expect(
      await update(path, {
        testId: "q",
        patch: { firstSeenAt: "2026-10-10", quarantinedAt: "2026-10-08" },
      })
    ).toMatchObject({ updated: false, reason: "invalid_date" });
    expect(byId(path, "q")).toMatchObject({ quarantinedAt: "2026-10-01" });
  });
});
