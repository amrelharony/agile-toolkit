import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  impedimentMigrationSummary,
  planImpedimentMove,
  runLegacyImpedimentMigration,
} from "@/lib/impediments/migrate-legacy";
import { hasLegacyImpediments, LEGACY_IMPEDIMENTS_KEY } from "@/lib/impediments/legacy-key";

/**
 * The Impediments tool's local store moves into workspace.impediments once:
 * crash-safe, gap-filling, and a no-op the second time.
 */

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Impediment ${id}`,
  description: `About ${id}`,
  category: "Process",
  severity: "Low",
  raisedBy: "Alice",
  assignedTo: "",
  status: "Open",
  raisedDate: "2026-10-01",
  ...over,
});

const blob = (rows: unknown[]) => JSON.stringify({ state: { impediments: rows }, version: 0 });

describe("planImpedimentMove", () => {
  it("adds rows the workspace lacks, fills the ones it has, skips unreadable ones", () => {
    const current = [
      { id: "a", title: "Shared A", severity: "low" as const, raisedAt: "2026-10-01" },
    ];
    const { next, report } = planImpedimentMove(
      blob([row("a"), row("b", { status: "Escalated" }), { id: "" }]),
      current
    );
    expect(report).toEqual({ added: 1, filled: 1, skipped: 1 });
    expect(next.map((i) => i.id)).toEqual(["a", "b"]);
    expect(next[0]).toMatchObject({
      title: "Shared A",
      description: "About a",
      category: "process",
    });
    expect(next[1]).toMatchObject({ escalatedAt: "2026-10-01", raisedBy: "Alice" });
    // Twice: nothing left to do.
    expect(planImpedimentMove(blob([row("a"), row("b")]), next).report).toEqual({
      added: 0,
      filled: 0,
      skipped: 0,
    });
  });

  it("reads a bare array and survives junk", () => {
    expect(planImpedimentMove(JSON.stringify([row("x")]), []).report.added).toBe(1);
    expect(planImpedimentMove("{not json", []).report).toEqual({ added: 0, filled: 0, skipped: 0 });
  });
});

describe("runLegacyImpedimentMigration", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState({ impediments: [] });
  });

  it("moves the rows, backs the key up and removes it", async () => {
    localStorage.setItem(LEGACY_IMPEDIMENTS_KEY, blob([row("a"), row("b")]));
    expect(hasLegacyImpediments()).toBe(true);

    const result = await runLegacyImpedimentMigration(localStorage);
    expect(result.report).toEqual({ added: 2, filled: 0, skipped: 0 });
    expect(result.removed).toEqual([LEGACY_IMPEDIMENTS_KEY]);
    expect(useWorkspaceStore.getState().impediments.map((i) => i.id)).toEqual(["a", "b"]);
    expect(localStorage.getItem(`${LEGACY_IMPEDIMENTS_KEY}:migrated`)).not.toBeNull();
    expect(hasLegacyImpediments()).toBe(false);
    expect(impedimentMigrationSummary(result.report)).toBe(
      "Moved 2 impediments saved in this browser into your workspace."
    );

    // Nothing left: a second run does nothing.
    expect((await runLegacyImpedimentMigration(localStorage)).report).toBeNull();
  });

  it("says nothing when every row was already in the workspace", () => {
    expect(impedimentMigrationSummary({ added: 0, filled: 3, skipped: 0 })).toBeNull();
    expect(impedimentMigrationSummary(null)).toBeNull();
  });
});
