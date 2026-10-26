import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The live two-way binding: a linked row of a method the backlog holds
 * reads through to the item; a save in the tool writes the row and the
 * item in one undoable whose Undo never clobbers a later edit; a hub edit
 * shows in the tool with no write to rows; deleting the item freezes the
 * values into its rows; a rename reaches the item and every linked row.
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
  applyItemPatch,
  effectiveFields,
  frozenRow,
  itemPatchChanges,
  linkedItem,
  methodRow,
  ownedPatch,
  rowsUnlinkedFrom,
} from "@/lib/prioritization/binding";
import {
  linkNewRow,
  removeBacklogItemWithUndo,
  renameEverywhere,
  saveBacklogItem,
  saveMethodRow,
} from "@/lib/prioritization/backlog-links";
import { evaluateRow } from "@/lib/prioritization/methods";
import { OLD_BACKLOG_DEFAULTS } from "@/lib/prioritization/defaults";

const STAMP = "2026-10-20T09:00:00.000Z";
const item = (id: string, patch: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  name: `Item ${id}`,
  updatedAt: STAMP,
  ...patch,
});
const row = (
  id: string,
  framework: PrioritizationItem["framework"],
  fields: PrioritizationItem["fields"],
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework,
  title: `Row ${id}`,
  fields,
  status: "scored",
  updatedAt: STAMP,
  ...extra,
});

const state = () => useWorkspaceStore.getState();
const storedRow = (id: string) => (state().prioritizations ?? []).find((p) => p.id === id);
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);
const lastUndo = () => undo.calls[undo.calls.length - 1];

beforeEach(() => {
  undo.calls = [];
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("read-through (pure)", () => {
  const wsjfItem = item("b1", {
    businessValue: 13,
    timeCriticality: 8,
    riskReduction: 2,
    jobSize: 3,
  });

  it("takes an embedded method's inputs from the linked item, the rest from the row", () => {
    const r = row(
      "w",
      "wsjf",
      { businessValue: 1, timeCriticality: 1, rrOe: 1, jobSize: 1, note: "x" },
      {
        backlogItemId: "b1",
      }
    );
    expect(effectiveFields(r, wsjfItem)).toEqual({
      businessValue: 13,
      timeCriticality: 8,
      rrOe: 2,
      jobSize: 3,
      note: "x",
    });
    expect(evaluateRow(r, wsjfItem).score).toBeCloseTo(23 / 3, 6);
    // Unlinked, or the item gone: the row's own values.
    expect(evaluateRow(r).score).toBe(3);
    expect(effectiveFields({ ...r, backlogItemId: "other" }, wsjfItem)).toBe(r.fields);
  });

  it("shows a value the item doesn't hold as unset, never the row's stale copy", () => {
    const r = row(
      "w",
      "wsjf",
      { businessValue: 5, timeCriticality: 5, rrOe: 5, jobSize: 5 },
      {
        backlogItemId: "b2",
      }
    );
    const cleared = item("b2", { businessValue: 5, timeCriticality: 5, riskReduction: 5 });
    expect(evaluateRow(r, cleared)).toMatchObject({ score: null, missing: ["jobSize"] });
  });

  it("leaves a method the backlog doesn't hold on the row", () => {
    const r = row("i", "ice", { impact: 8, confidence: 5, ease: 2 }, { backlogItemId: "b1" });
    expect(effectiveFields(r, wsjfItem)).toBe(r.fields);
    expect(evaluateRow(r, wsjfItem).score).toBe(80);
  });

  it("finds the linked item only while it exists", () => {
    expect(linkedItem({ backlogItemId: "b1" }, [wsjfItem])).toBe(wsjfItem);
    expect(linkedItem({ backlogItemId: "gone" }, [wsjfItem])).toBeUndefined();
    expect(linkedItem({}, [wsjfItem])).toBeUndefined();
  });

  it("writes only the owned fields a save sets, the exact values", () => {
    expect(
      ownedPatch("rice", {
        reach: 10,
        reachPeriod: "month",
        impact: 1.5,
        confidence: 80,
        effort: 2,
      })
    ).toEqual({
      reach: 10,
      reachPeriod: "month",
      impact: 1.5,
      confidence: 80,
      effort: 2,
    });
    // An unplaced Value/Effort row never wipes WSJF's business value.
    expect(ownedPatch("value-effort", {})).toEqual({});
    expect(ownedPatch("ice", { impact: 3, confidence: 3, ease: 3 })).toEqual({});
  });

  it("counts only real changes against what the item reads as", () => {
    const legacyDefaults = { ...OLD_BACKLOG_DEFAULTS, id: "old", name: "Old" } as BacklogItem;
    expect(itemPatchChanges(legacyDefaults, { moscow: "should" })).toEqual({ moscow: "should" });
    expect(
      itemPatchChanges(item("q", { reach: 10 }), { reach: 10, reachPeriod: "quarter" })
    ).toEqual({});
    expect(itemPatchChanges(item("v", { value: 7 }), { businessValue: 8 })).toEqual({});
  });

  it("saves an item stamped, a clear removing the key", () => {
    const next = applyItemPatch(
      item("c", { reach: 10, effort: 2 }),
      { reach: undefined, effort: 3 },
      "T"
    );
    expect(next).toEqual({ id: "c", name: "Item c", effort: 3, updatedAt: "T" });
  });

  it("freezes the values a row read through into its own fields", () => {
    const r = row("w", "wsjf", {}, { backlogItemId: "b1", score: undefined, status: "open" });
    const frozen = frozenRow(r, wsjfItem, "T");
    expect(frozen.fields).toEqual({ businessValue: 13, timeCriticality: 8, rrOe: 2, jobSize: 3 });
    expect(frozen).toMatchObject({ status: "scored", updatedAt: "T" });
    expect(frozen.score).toBeCloseTo(23 / 3, 6);
    const ice = row("i", "ice", { impact: 1 }, { backlogItemId: "b1" });
    expect(frozenRow(ice, wsjfItem)).toBe(ice);
  });

  it("builds a row with the engine's score, keeping the previous row's other keys and link", () => {
    const prev = row(
      "r",
      "rice",
      { reach: 1, note: "keep" },
      { backlogItemId: "b1", description: "d" }
    );
    const next = methodRow({
      id: "r",
      framework: "rice",
      title: "  New title ",
      values: { reach: 100, reachPeriod: "quarter", impact: 2, confidence: 50, effort: 1 },
      prev,
      now: "T",
    });
    expect(next).toEqual({
      id: "r",
      framework: "rice",
      title: "New title",
      description: "d",
      backlogItemId: "b1",
      fields: {
        reach: 100,
        reachPeriod: "quarter",
        impact: 2,
        confidence: 50,
        effort: 1,
        note: "keep",
      },
      score: 100,
      status: "scored",
      updatedAt: "T",
    });
    const unscored = methodRow({ id: "x", framework: "wsjf", title: "Title only", values: {} });
    expect(unscored).toMatchObject({ status: "open", fields: {} });
    expect("score" in unscored).toBe(false);
  });
});

describe("saveMethodRow (write-through)", () => {
  it("saves the row and the linked item in one undoable", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { reach: 500, impact: 2, confidence: 80, effort: 1 })],
      prioritizations: [
        row(
          "r1",
          "rice",
          { reach: 500, impact: 2, confidence: 80, effort: 1 },
          { backlogItemId: "b1" }
        ),
      ],
    });
    saveMethodRow("r1", { reach: 900, reachPeriod: "month", impact: 1.5 });
    expect(undo.calls).toHaveLength(1);
    expect(lastUndo().label).toBe("Updated “Item b1” in the backlog");
    expect(storedItem("b1")).toMatchObject({ reach: 900, reachPeriod: "month", impact: 1.5 });
    expect(storedRow("r1")).toMatchObject({
      fields: { reach: 900, reachPeriod: "month", impact: 1.5, confidence: 80, effort: 1 },
      score: 900 * 3 * 1.5 * 0.8,
    });

    lastUndo().revert();
    expect(storedItem("b1")).toEqual(
      item("b1", { reach: 500, impact: 2, confidence: 80, effort: 1 })
    );
    expect(storedRow("r1")?.fields).toEqual({ reach: 500, impact: 2, confidence: 80, effort: 1 });
  });

  it("Undo keeps an edit made to the item after the save", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("b1", { businessValue: 3, timeCriticality: 3, riskReduction: 3, jobSize: 3 }),
      ],
      prioritizations: [row("w1", "wsjf", {}, { backlogItemId: "b1" })],
    });
    saveMethodRow("w1", { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 3 });
    // The hub changes the job size inside the Undo window.
    saveBacklogItem("b1", { jobSize: 13 });
    lastUndo().revert();
    expect(storedItem("b1")).toMatchObject({
      businessValue: 3,
      timeCriticality: 3,
      riskReduction: 3,
      jobSize: 13,
    });
  });

  it("is a plain save with no toast for an unlinked row or a method the backlog doesn't hold", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1")],
      prioritizations: [
        row("i1", "ice", { impact: 1, confidence: 1, ease: 1 }, { backlogItemId: "b1" }),
        row("r1", "rice", {}),
      ],
    });
    saveMethodRow("i1", { impact: 9 });
    saveMethodRow("r1", { reach: 5, impact: 1, confidence: 100, effort: 1 });
    expect(undo.calls).toHaveLength(0);
    expect(storedRow("i1")).toMatchObject({
      score: 9,
      fields: { impact: 9, confidence: 1, ease: 1 },
    });
    expect(storedRow("r1")?.score).toBe(5);
    expect(storedItem("b1")).toEqual(item("b1"));
  });

  it("shows a hub edit in the tool with no write to the row", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { moscow: "could" })],
      prioritizations: [row("m1", "moscow", { bucket: "could" }, { backlogItemId: "b1" })],
    });
    const before = storedRow("m1");
    saveBacklogItem("b1", { moscow: "must" });
    expect(storedRow("m1")).toBe(before);
    expect(evaluateRow(storedRow("m1")!, storedItem("b1")).bucket).toBe("must");
  });

  it("renames the row, its item and the item's other rows", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { moscow: "must" })],
      prioritizations: [
        row("m1", "moscow", { bucket: "must" }, { backlogItemId: "b1" }),
        row("i1", "ice", { impact: 2, confidence: 2, ease: 2 }, { backlogItemId: "b1" }),
      ],
    });
    saveMethodRow("m1", { bucket: "must" }, { title: "Passkeys" });
    expect(storedItem("b1")?.name).toBe("Passkeys");
    expect(storedRow("m1")?.title).toBe("Passkeys");
    expect(storedRow("i1")?.title).toBe("Passkeys");
  });

  it("merges a partial save over what the row shows, never its stale copy", () => {
    // The row and the item both started at confidence 80; the hub then set 100.
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { reach: 500, impact: 2, confidence: 100, effort: 1 })],
      prioritizations: [
        row(
          "r1",
          "rice",
          { reach: 500, impact: 2, confidence: 80, effort: 1 },
          { backlogItemId: "b1" }
        ),
      ],
    });
    saveMethodRow("r1", { effort: 3 });
    expect(storedItem("b1")).toMatchObject({ confidence: 100, effort: 3 });
    expect(storedRow("r1")?.fields).toMatchObject({ confidence: 100, effort: 3 });
    expect(storedRow("r1")?.score).toBeCloseTo((500 * 2 * 1) / 3, 6);
  });

  it("a title-only save writes nothing stale to the item", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { businessValue: 13, matrixEffort: 2 })],
      prioritizations: [
        row("v1", "value-effort", { businessValue: 5, effort: 2 }, { backlogItemId: "b1" }),
      ],
    });
    saveMethodRow("v1", {}, { title: "Renamed" });
    expect(storedItem("b1")).toMatchObject({ businessValue: 13, matrixEffort: 2 });
    expect(storedRow("v1")?.fields).toEqual({ businessValue: 13, effort: 2 });
  });

  it("clears an input present as undefined, on the row and on a linked item", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { businessValue: 13, matrixEffort: 2, timeCriticality: 3 })],
      prioritizations: [
        row("m1", "moscow", { bucket: "must", effort: 3 }),
        row("e1", "eisenhower", {
          urgent: "true",
          important: "false",
          dueAt: "2026-11-01",
          delegateTo: "Ana",
        }),
        row("v1", "value-effort", {}, { backlogItemId: "b1" }),
      ],
    });
    // An unlinked row's optional inputs.
    saveMethodRow("m1", { bucket: "must", effort: undefined });
    expect(storedRow("m1")?.fields).toEqual({ bucket: "must" });
    saveMethodRow("e1", { dueAt: undefined, delegateTo: undefined });
    expect(storedRow("e1")?.fields).not.toHaveProperty("dueAt");
    expect(storedRow("e1")?.fields).not.toHaveProperty("delegateTo");

    // Both Value/Effort inputs cleared on a linked row: back to Not placed yet.
    saveMethodRow("v1", { value: undefined, effort: undefined });
    expect(storedItem("b1")).not.toHaveProperty("businessValue");
    expect(storedItem("b1")).not.toHaveProperty("matrixEffort");
    expect(storedItem("b1")?.timeCriticality).toBe(3);
    expect(evaluateRow(storedRow("v1")!, storedItem("b1"))).toMatchObject({ score: null });
    lastUndo().revert();
    expect(storedItem("b1")).toMatchObject({ businessValue: 13, matrixEffort: 2 });
  });

  it("a cleared business value stays cleared, the legacy value with it", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { businessValue: 7, value: 7, matrixEffort: 3 })],
      prioritizations: [row("v1", "value-effort", {}, { backlogItemId: "b1" })],
    });
    saveMethodRow("v1", { value: undefined, effort: undefined });
    const saved = storedItem("b1")!;
    expect(saved).not.toHaveProperty("businessValue");
    expect(saved).not.toHaveProperty("value");
    expect(evaluateRow(storedRow("v1")!, saved).score).toBeNull();
    // The hub's Clear does the same, and a written business value drops the dead one.
    useWorkspaceStore.setState({ backlogItems: [item("b2", { businessValue: 7, value: 7 })] });
    saveBacklogItem("b2", { businessValue: undefined });
    expect(storedItem("b2")).not.toHaveProperty("value");
    expect(applyItemPatch(item("b3", { value: 4 }), { businessValue: 8 }, "T")).toEqual({
      id: "b3",
      name: "Item b3",
      businessValue: 8,
      updatedAt: "T",
    });
  });

  it("links a new row, a value blanked from the import's prefill clearing the item's", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { businessValue: 8, matrixEffort: 4, jobSize: 5 })],
    });
    const values = { value: undefined, effort: undefined };
    const linked = linkNewRow(
      methodRow({ id: "v1", framework: "value-effort", title: "Tray", values }),
      "b1",
      values
    );
    expect(linked.backlogItemId).toBe("b1");
    expect(storedItem("b1")).not.toHaveProperty("businessValue");
    expect(storedItem("b1")?.jobSize).toBe(5);
    // Without `values`, nothing the row lacks is a clear.
    useWorkspaceStore.setState({ backlogItems: [item("b2", { businessValue: 8 })] });
    linkNewRow(methodRow({ id: "v2", framework: "value-effort", title: "T", values: {} }), "b2");
    expect(storedItem("b2")?.businessValue).toBe(8);
  });
});

describe("Undo of a save", () => {
  it("never brings an old default back as a chosen score once the item was saved since", () => {
    const legacy = { ...OLD_BACKLOG_DEFAULTS, id: "b1", name: "Search" } as BacklogItem;
    useWorkspaceStore.setState({
      backlogItems: [legacy],
      prioritizations: [row("m1", "moscow", {}, { backlogItemId: "b1" })],
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-21T10:00:00.000Z"));
      saveMethodRow("m1", { bucket: "must" });
      // A hub rename inside the Undo window stamps the item again.
      vi.setSystemTime(new Date("2026-10-21T10:00:05.000Z"));
      saveBacklogItem("b1", { name: "Site search" });
    } finally {
      vi.useRealTimers();
    }
    lastUndo().revert();
    const after = storedItem("b1")!;
    expect(after.name).toBe("Site search");
    expect(after.updatedAt).toBeTruthy();
    // MoSCoW, WSJF, RICE and Value/Effort all read Not scored, as before the save.
    expect(after.moscow).toBeUndefined();
    expect(after.businessValue).toBeUndefined();
    expect(after.reach).toBeUndefined();
    expect(after.matrixEffort).toBeUndefined();
    expect(evaluateRow(storedRow("m1")!, after).bucket).toBeNull();
  });

  it("puts a legacy item back exactly when nobody saved it since", () => {
    const legacy = { ...OLD_BACKLOG_DEFAULTS, id: "b1", name: "Search" } as BacklogItem;
    useWorkspaceStore.setState({
      backlogItems: [legacy],
      prioritizations: [row("m1", "moscow", {}, { backlogItemId: "b1" })],
    });
    saveMethodRow("m1", { bucket: "must" });
    lastUndo().revert();
    expect(storedItem("b1")).toEqual(legacy);
  });

  it("puts back the names of the item's other rows a rename reached", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { moscow: "could", name: "Passkeys" })],
      prioritizations: [
        row("m1", "moscow", { bucket: "could" }, { backlogItemId: "b1", title: "Passkeys" }),
        row("i1", "ice", { impact: 2, confidence: 2, ease: 2 }, { backlogItemId: "b1" }),
        row("w1", "wsjf", {}, { backlogItemId: "b1", title: "Passkeys" }),
      ],
    });
    const iceBefore = storedRow("i1");
    saveMethodRow("m1", { bucket: "must" }, { title: "Passkey sign-in" });
    expect(storedRow("i1")?.title).toBe("Passkey sign-in");
    expect(storedRow("w1")?.title).toBe("Passkey sign-in");
    lastUndo().revert();
    expect(storedItem("b1")?.name).toBe("Passkeys");
    expect(storedRow("m1")?.title).toBe("Passkeys");
    expect(storedRow("i1")).toEqual(iceBefore);
    expect(storedRow("w1")?.title).toBe("Passkeys");
  });

  it("leaves a renamed row someone saved since", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { moscow: "could" })],
      prioritizations: [
        row("m1", "moscow", { bucket: "could" }, { backlogItemId: "b1" }),
        row("i1", "ice", { impact: 2, confidence: 2, ease: 2 }, { backlogItemId: "b1" }),
      ],
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-21T10:00:00.000Z"));
      saveMethodRow("m1", { bucket: "must" }, { title: "New name" });
      vi.setSystemTime(new Date("2026-10-21T10:00:05.000Z"));
      saveMethodRow("i1", { impact: 9 });
    } finally {
      vi.useRealTimers();
    }
    lastUndo().revert();
    expect(storedRow("i1")).toMatchObject({ title: "New name", score: 36 });
  });
});

describe("hub saves, renames and deletes", () => {
  it("saves an old-default item through the engine: fingerprints unset, stamped", () => {
    useWorkspaceStore.setState({
      backlogItems: [{ ...OLD_BACKLOG_DEFAULTS, id: "b1", name: "Search" } as BacklogItem],
    });
    saveBacklogItem("b1", { reach: 2000 });
    const saved = storedItem("b1")!;
    expect(saved).toMatchObject({ reach: 2000, name: "Search" });
    expect(saved.updatedAt).toBeTruthy();
    expect(saved.moscow).toBeUndefined();
    expect(saved.businessValue).toBeUndefined();
    expect(saved.impact).toBeUndefined();
  });

  it("writes nothing for a patch the item already reads as", () => {
    const stored = item("b1", { reach: 10 });
    useWorkspaceStore.setState({ backlogItems: [stored] });
    expect(saveBacklogItem("b1", { reach: 10 })).toBe(stored);
    expect(storedItem("b1")).toBe(stored);
  });

  it("renames everywhere, ignoring a blank name", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1")],
      prioritizations: [row("a", "ice", {}, { backlogItemId: "b1" }), row("c", "rice", {})],
    });
    renameEverywhere("b1", "  Passkeys ");
    expect(storedItem("b1")?.name).toBe("Passkeys");
    expect(storedRow("a")?.title).toBe("Passkeys");
    expect(storedRow("c")?.title).toBe("Row c");
    renameEverywhere("b1", "   ");
    expect(storedItem("b1")?.name).toBe("Passkeys");
  });

  it("freezes the item's values into its rows before unlinking them; Undo re-links", () => {
    const b1 = item("b1", { businessValue: 13, timeCriticality: 8, riskReduction: 2, jobSize: 3 });
    useWorkspaceStore.setState({
      backlogItems: [b1],
      prioritizations: [
        row(
          "w1",
          "wsjf",
          { businessValue: 1, timeCriticality: 1, rrOe: 1, jobSize: 1 },
          { backlogItemId: "b1" }
        ),
        row("i1", "ice", { impact: 2, confidence: 2, ease: 2 }, { backlogItemId: "b1" }),
      ],
    });
    removeBacklogItemWithUndo("b1");
    expect(state().backlogItems).toEqual([]);
    expect(storedRow("w1")).toMatchObject({
      fields: { businessValue: 13, timeCriticality: 8, rrOe: 2, jobSize: 3 },
    });
    expect(storedRow("w1")?.backlogItemId).toBeUndefined();
    expect(storedRow("w1")?.score).toBeCloseTo(23 / 3, 6);
    expect(storedRow("i1")?.fields).toEqual({ impact: 2, confidence: 2, ease: 2 });

    lastUndo().revert();
    expect(storedItem("b1")).toEqual(b1);
    expect(storedRow("w1")?.backlogItemId).toBe("b1");
    expect(storedRow("i1")?.backlogItemId).toBe("b1");
  });

  it("freezes and unlinks the rows on the store's own delete too (the agent's path)", () => {
    const b1 = item("b1", { moscow: "must", jobSize: 3 });
    useWorkspaceStore.setState({
      backlogItems: [b1],
      prioritizations: [
        row("m1", "moscow", {}, { backlogItemId: "b1" }),
        row("i1", "ice", { impact: 2, confidence: 2, ease: 2 }, { backlogItemId: "b1" }),
        row("other", "moscow", { bucket: "could" }),
      ],
    });
    const other = storedRow("other");
    state().removeBacklogItem("b1");
    expect(storedRow("m1")).toMatchObject({ fields: { bucket: "must" }, score: 4 });
    expect(storedRow("m1")).not.toHaveProperty("backlogItemId");
    expect(storedRow("m1")?.updatedAt).not.toBe(STAMP);
    expect(storedRow("i1")).toMatchObject({ fields: { impact: 2, confidence: 2, ease: 2 } });
    expect(storedRow("i1")).not.toHaveProperty("backlogItemId");
    expect(storedRow("other")).toBe(other);
  });

  it("unlinks rows from an item that is already gone, keeping their own values", () => {
    const rows = [
      row(
        "w1",
        "wsjf",
        { businessValue: 1, timeCriticality: 1, rrOe: 1, jobSize: 1 },
        {
          backlogItemId: "gone",
        }
      ),
      row("w2", "wsjf", {}),
    ];
    const out = rowsUnlinkedFrom(rows, "gone", undefined, "T");
    expect(out).toEqual([
      {
        ...rows[0],
        backlogItemId: undefined,
        updatedAt: "T",
      },
    ]);
    expect(out[0]).not.toHaveProperty("backlogItemId");
  });

  it("links a new row and writes only the inputs that change the item", () => {
    useWorkspaceStore.setState({ backlogItems: [item("b1", { reach: 500, impact: 2 })] });
    const linked = linkNewRow(
      row("r1", "rice", { reach: 500, impact: 2, confidence: 80, effort: 1 }),
      "b1"
    );
    expect(linked.backlogItemId).toBe("b1");
    expect(storedItem("b1")).toMatchObject({ reach: 500, impact: 2, confidence: 80, effort: 1 });
    lastUndo().revert();
    expect(storedItem("b1")).toEqual(item("b1", { reach: 500, impact: 2 }));
  });
});
