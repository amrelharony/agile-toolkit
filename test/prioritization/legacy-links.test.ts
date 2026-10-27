import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * Links made before Phase 7. Back then a link wrote the row's inputs to
 * the backlog item once, and later edits in a tool changed only the row.
 * An item the new code never saved that still holds a method's old
 * defaults (read as Not scored) leaves the row's own value as the only
 * real one: every view with the rows reads it, and the item's first save
 * through the new code writes it to the item, which owns it from then on.
 * Where a legacy row and its item both hold real values that differ, the
 * item's counts and the tool asks once (legacyDifferences).
 */

const undo = vi.hoisted(() => ({
  calls: [] as { label: string; apply: () => void; revert: () => void }[],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.calls.push(a);
    a.apply();
  },
}));

import {
  removeBacklogItemWithUndo,
  renameEverywhere,
  saveBacklogItem,
  saveMethodRow,
} from "@/lib/prioritization/backlog-links";
import { OLD_BACKLOG_DEFAULTS } from "@/lib/prioritization/defaults";
import {
  evaluateItemIn,
  evaluateRow,
  legacyDifferences,
  withLegacyLinks,
} from "@/lib/prioritization/methods";
import { rankMethodRows } from "@/lib/prioritization/rank";
import { frameworkScores } from "@/lib/prioritization/scores";
import { heldScores } from "@/app/(tools)/prioritizer/hub-form";

const STAMP = "2026-10-20T09:00:00.000Z";

/** A pre-Phase 7 item: every field at its old default, never saved by the new code. */
const legacy = (id: string, patch: Partial<BacklogItem> = {}): BacklogItem =>
  ({ ...OLD_BACKLOG_DEFAULTS, id, name: `Item ${id}`, ...patch }) as BacklogItem;

const row = (
  id: string,
  framework: PrioritizationItem["framework"],
  fields: PrioritizationItem["fields"],
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework,
  title: "Checkout",
  fields,
  status: "scored",
  updatedAt: STAMP,
  backlogItemId: "b1",
  ...extra,
});

const moscow = row("m1", "moscow", { bucket: "must" });
const wsjf = row("w1", "wsjf", { businessValue: 8, timeCriticality: 3, rrOe: 2, jobSize: 1 });
const rice = row("r1", "rice", { reach: 500, impact: 2, confidence: 50, effort: 2 });

const state = () => useWorkspaceStore.getState();
const storedRow = (id: string) => (state().prioritizations ?? []).find((p) => p.id === id);
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);
const lastUndo = () => undo.calls[undo.calls.length - 1];

beforeEach(() => {
  undo.calls = [];
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("a link made before Phase 7: read", () => {
  it("shows what the row was given in its tool while its item holds the old defaults", () => {
    const item = legacy("b1");
    const rows = [moscow, wsjf, rice];
    // The method tools and their agent list_* verbs (read through).
    expect(evaluateRow(moscow, item).bucket).toBe("must");
    expect(evaluateRow(wsjf, item).score).toBe(13);
    expect(rankMethodRows("rice", rows, [item])[0]).toMatchObject({
      values: { reach: 500, impact: 2, confidence: 50, effort: 2 },
      result: { score: 250 },
    });
    // The hub's All methods, Decide order and list_state (read with the rows).
    expect(frameworkScores(item, rows)).toMatchObject({ moscow: "must", wsjf: 13, rice: 250 });
    expect(heldScores("moscow", item, rows)).toEqual({ bucket: "must" });
    // The item alone still reads Not scored, as the old defaults say.
    expect(evaluateItemIn(item, [], "moscow").bucket).toBeNull();
    expect(evaluateItemIn(item, [], "wsjf").score).toBeNull();
  });

  it("adds nothing for a row that holds the old defaults too, or once the item was saved", () => {
    const item = legacy("b1");
    expect(evaluateRow(row("m2", "moscow", { bucket: "should" }), item).bucket).toBeNull();
    const fives = { businessValue: 5, timeCriticality: 5, rrOe: 5, jobSize: 5 };
    expect(evaluateRow(row("w2", "wsjf", fives), item).score).toBeNull();
    expect(withLegacyLinks(item, [row("m2", "moscow", { bucket: "should" })])).toBe(item);
    // Saved by the new code: what the item holds is chosen, unset included.
    const saved: BacklogItem = { id: "b1", name: "Item b1", updatedAt: STAMP };
    expect(evaluateRow(moscow, saved).bucket).toBeNull();
    expect(frameworkScores(saved, [moscow]).moscow).toBeUndefined();
  });

  it("keeps a value the item already holds: WSJF's business value is Value/Effort's too", () => {
    const item = legacy("b1", {
      businessValue: 13,
      timeCriticality: 8,
      riskReduction: 3,
      jobSize: 5,
    });
    const ve = row("v1", "value-effort", { value: 8, effort: 2 });
    expect(evaluateRow(ve, item)).toMatchObject({
      bucket: "quick_wins",
      extra: { value: 13, effort: 2 },
    });
    expect(frameworkScores(item, [ve]).valueEffort).toEqual({
      value: 13,
      effort: 2,
      quadrant: "quick_wins",
    });
  });
});

describe("a link made before Phase 7: the item's first save keeps it", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ backlogItems: [legacy("b1")], prioritizations: [moscow, wsjf] });
  });

  it("a hub rename writes the rows' values to the item, stamped, its old defaults unset", () => {
    renameEverywhere("b1", "Checkout v2");
    const saved = storedItem("b1")!;
    expect(saved).toMatchObject({
      name: "Checkout v2",
      moscow: "must",
      businessValue: 8,
      timeCriticality: 3,
      riskReduction: 2,
      jobSize: 1,
    });
    expect(saved.updatedAt).toBeTruthy();
    for (const key of ["reach", "impact", "confidence", "effort", "value", "matrixEffort"]) {
      expect(saved).not.toHaveProperty(key);
    }
    // The item owns them now: everything reads the same, the item alone too.
    expect(evaluateItemIn(saved, [], "moscow").bucket).toBe("must");
    expect(evaluateRow(storedRow("m1")!, saved).bucket).toBe("must");
    expect(evaluateItemIn(saved, [], "rice").score).toBeNull();
  });

  it("Decide order's rank save keeps them too", () => {
    saveBacklogItem("b1", { rank: 1 });
    expect(storedItem("b1")).toMatchObject({ rank: 1, moscow: "must", businessValue: 8 });
  });

  it("a save in another method keeps them, and its Undo puts the legacy item back", () => {
    useWorkspaceStore.setState({ prioritizations: [moscow, rice] });
    saveMethodRow("r1", { effort: 3 });
    expect(storedItem("b1")).toMatchObject({ moscow: "must", reach: 500, effort: 3 });
    lastUndo().revert();
    expect(storedItem("b1")).toEqual(legacy("b1"));
    expect(evaluateRow(storedRow("m1")!, storedItem("b1")).bucket).toBe("must");
  });

  it("a save that changes nothing the item reads writes nothing", () => {
    saveMethodRow("m1", {});
    expect(storedItem("b1")).toEqual(legacy("b1"));
    expect(undo.calls).toEqual([]);
  });

  it("a move in the tool writes through; a hub clear clears", () => {
    saveMethodRow("m1", { bucket: "could" });
    expect(storedItem("b1")?.moscow).toBe("could");
    useWorkspaceStore.setState({ backlogItems: [legacy("b1")], prioritizations: [moscow] });
    saveBacklogItem("b1", { moscow: undefined });
    const cleared = storedItem("b1")!;
    expect(cleared).not.toHaveProperty("moscow");
    expect(evaluateRow(storedRow("m1")!, cleared).bucket).toBeNull();
  });

  it("deleting the item freezes the row's own value", () => {
    removeBacklogItemWithUndo("b1");
    expect(storedRow("m1")?.fields).toEqual({ bucket: "must" });
    expect(storedRow("m1")).not.toHaveProperty("backlogItemId");
    expect(storedRow("w1")?.score).toBe(13);
  });
});

describe("a legacy row that disagrees with its item", () => {
  it("names each input both hold differently until the item is saved; the item's counts", () => {
    const item = legacy("b1", { moscow: "must", businessValue: 13 });
    const could = row("m2", "moscow", { bucket: "could" });
    expect(legacyDifferences(could, item)).toEqual([{ key: "bucket", row: "could", item: "must" }]);
    expect(evaluateRow(could, item).bucket).toBe("must");
    const rescored = row("w2", "wsjf", {
      businessValue: 8,
      timeCriticality: 3,
      rrOe: 2,
      jobSize: 1,
    });
    // One changed value keeps every WSJF value of the item (13/5/5/5).
    expect(legacyDifferences(rescored, item)).toEqual([
      { key: "businessValue", row: 8, item: 13 },
      { key: "timeCriticality", row: 3, item: 5 },
      { key: "rrOe", row: 2, item: 5 },
      { key: "jobSize", row: 1, item: 5 },
    ]);
    // Saved by the new code, or a row of old defaults: nothing to ask.
    expect(legacyDifferences(could, { ...item, updatedAt: STAMP })).toEqual([]);
    expect(legacyDifferences(row("m3", "moscow", { bucket: "should" }), item)).toEqual([]);
    expect(legacyDifferences(could, undefined)).toEqual([]);
  });
});
