/**
 * Flaky-test days a day ahead of the reader's. Over MCP an agent's day is
 * the server's (UTC on a typical deploy), which is already tomorrow for a
 * person west of UTC in their evening: add_test's default first-seen day
 * and set_status's stamp can carry the person's tomorrow. The page reads a
 * quarantine one day ahead as today (never "date unknown"), and a status
 * change, on the page or by an agent in the tab, stamps that day rather
 * than one before the test was first seen. A day further ahead still reads
 * as unknown, and the KPI's count of unknown dates agrees with the cards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => rows.get(`${kind}/${id}`) ?? null
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FlakyTest, FlakyTestBoard } from "@/lib/stores/workspace-types";
import {
  FLAKY_BOARD_ID,
  FLAKY_BOARD_KIND,
  applyFlakyStatus,
  flakyStampDay,
  flakySummary,
  quarantinedDays,
} from "@/lib/quality/flaky";
import { quarantineText } from "@/app/(tools)/flaky-tests/view";

import "@/lib/actions/tools/flaky-tests";

const TODAY = "2026-10-27";
const TOMORROW = "2026-10-28";
const LATER = "2026-10-29";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };

const flaky = (over: Partial<FlakyTest>): FlakyTest => ({
  id: "t",
  name: "checkout › VAT",
  failureRate: 0.1,
  failures: 2,
  runs: 20,
  status: "active",
  firstSeenAt: "2026-10-01",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  // The person's evening: the server's UTC day would already be the 28th.
  vi.setSystemTime(new Date(2026, 9, 27, 20, 0));
  rows.clear();
  useWorkspaceStore.setState({ flakyTestBoards: [] });
});
afterEach(() => vi.useRealTimers());

describe("a quarantine a day ahead", () => {
  it("reads as today on the card, in the summary and the alert, not 'date unknown'", () => {
    const t = flaky({ status: "quarantined", quarantinedAt: TOMORROW });
    expect(quarantinedDays(t, TODAY)).toBe(0);
    expect(quarantineText(t, TODAY)).toBe("Quarantined today");
    const s = flakySummary([t], TODAY);
    expect(s.quarantineDateUnknown).toBe(0);
    expect(s.longQuarantined).toEqual([]);
  });

  it("further ahead it stays unknown, and the KPI counts it as the card says", () => {
    const t = flaky({ status: "quarantined", quarantinedAt: LATER });
    expect(quarantinedDays(t, TODAY)).toBeNull();
    expect(quarantineText(t, TODAY)).toBe("Quarantined (date unknown)");
    expect(flakySummary([t], TODAY).quarantineDateUnknown).toBe(1);
  });
});

describe("a status change on a test an agent dated a day ahead", () => {
  it("stamps the test's own day, never one before it was first seen", () => {
    const t = flaky({ firstSeenAt: TOMORROW });
    expect(flakyStampDay(t, TODAY)).toBe(TOMORROW);
    // The page's status change goes through applyFlakyStatus.
    expect(applyFlakyStatus(t, "quarantined", TODAY).quarantinedAt).toBe(TOMORROW);
    expect(applyFlakyStatus(t, "fixed", TODAY).fixedAt).toBe(TOMORROW);
    // A day further ahead is no one's today: the stamp stays today.
    expect(flakyStampDay(flaky({ firstSeenAt: LATER }), TODAY)).toBe(TODAY);
    // Days in the past change nothing.
    expect(applyFlakyStatus(flaky({}), "quarantined", TODAY).quarantinedAt).toBe(TODAY);
  });

  it("set_status in the tab stamps as the page does", async () => {
    const doc: FlakyTestBoard = { id: FLAKY_BOARD_ID, tests: [flaky({ firstSeenAt: TOMORROW })] };
    useWorkspaceStore.setState({ flakyTestBoards: [doc] });
    const action = registry.get("tool.flaky_tests.set_status")!;
    expect(await action.handler({ testId: "t", status: "quarantined" }, ctx)).toEqual({
      updated: true,
      status: "quarantined",
      fixedAt: null,
      quarantinedAt: TOMORROW,
    });
  });

  it("set_status over MCP keeps stamping the test's later day", async () => {
    rows.set(`${FLAKY_BOARD_KIND}/${FLAKY_BOARD_ID}`, {
      id: FLAKY_BOARD_ID,
      tests: [flaky({ firstSeenAt: TOMORROW })],
    });
    const action = registry.get("tool.flaky_tests.set_status")!;
    expect(await action.mcpHandler!({ testId: "t", status: "fixed" }, ctx)).toMatchObject({
      status: "fixed",
      fixedAt: TOMORROW,
    });
  });
});
