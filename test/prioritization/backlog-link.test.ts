import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { tools } from "@/lib/constants/tools";

/**
 * The shared backlog: the framework registry's mappers (both ways), RICE
 * impact snapping, the per-item scores the hub and MCP read, and the
 * store writes that link method rows to backlog items.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));

import {
  BACKLOG_DEFAULTS,
  FRAMEWORKS,
  changedFields,
  createBacklogItem,
  frameworkFor,
  readBacklogItemParam,
  scoreWithHref,
  snapImpact,
} from "@/lib/prioritization/frameworks";
import { frameworkScores, latestLinkedRow, matrixQuadrant } from "@/lib/prioritization/scores";
import {
  addRowToBacklog,
  linkNewRow,
  removeBacklogItemWithUndo,
  renameLinkedRows,
} from "@/lib/prioritization/backlog-links";

const backlogItem = (id: string, partial: Partial<BacklogItem> = {}): BacklogItem => ({
  ...BACKLOG_DEFAULTS,
  id,
  name: `Item ${id}`,
  ...partial,
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
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...extra,
});

const f = (key: PrioritizationItem["framework"]) => frameworkFor(key)!;
const state = () => useWorkspaceStore.getState();
const storedRow = (id: string) => (state().prioritizations ?? []).find((p) => p.id === id);
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("framework registry", () => {
  it("lists the seven hub methods, each at its tool's real path", () => {
    expect(FRAMEWORKS.map((x) => x.framework)).toEqual([
      "moscow",
      "wsjf",
      "rice",
      "value-effort",
      "ice",
      "kano",
      "cost-of-delay",
    ]);
    for (const fw of FRAMEWORKS) {
      const tool = tools.find((t) => t.id === fw.id);
      expect(tool?.path, fw.id).toBe(fw.path);
      expect(fw.pickWhen.length).toBeGreaterThan(10);
    }
    // Personal and group-game methods stay out of the hub.
    for (const left of ["eisenhower", "buy-feature", "hundred-dollar"]) {
      expect(frameworkFor(left)).toBeUndefined();
    }
  });

  it("marks the methods the backlog holds inputs for as embedded", () => {
    expect(FRAMEWORKS.filter((x) => x.embedded).map((x) => x.framework)).toEqual([
      "moscow",
      "wsjf",
      "rice",
      "value-effort",
    ]);
    for (const fw of FRAMEWORKS.filter((x) => !x.embedded)) {
      expect(fw.fromBacklog).toBeUndefined();
      expect(fw.toBacklog).toBeUndefined();
    }
  });

  it("builds Score-with links and reads them back", () => {
    const href = scoreWithHref(f("ice"), "item 1/2");
    expect(href).toBe("/ice-score?backlogItem=item%201%2F2");
    expect(readBacklogItemParam(href.slice(href.indexOf("?")))).toBe("item 1/2");
    expect(readBacklogItemParam("")).toBeNull();
    expect(readBacklogItemParam("?backlogItem=")).toBeNull();
  });
});

describe("snapImpact", () => {
  it("keeps the allowed steps", () => {
    for (const v of [0.25, 0.5, 1, 2, 3]) expect(snapImpact(v)).toBe(v);
  });

  it("snaps to the nearest step, the lower one on a tie", () => {
    expect(snapImpact(0.3)).toBe(0.25);
    expect(snapImpact(0.8)).toBe(1);
    expect(snapImpact(1.5)).toBe(1);
    expect(snapImpact(1.6)).toBe(2);
    expect(snapImpact(2.5)).toBe(2);
    expect(snapImpact(2.6)).toBe(3);
    expect(snapImpact("2.9")).toBe(3);
  });

  it("clamps out-of-range values and falls back to 1", () => {
    expect(snapImpact(0)).toBe(0.25);
    expect(snapImpact(-4)).toBe(0.25);
    expect(snapImpact(10)).toBe(3);
    expect(snapImpact(NaN)).toBe(1);
    expect(snapImpact("abc")).toBe(1);
    expect(snapImpact(undefined)).toBe(1);
  });
});

describe("mappers", () => {
  const item = backlogItem("b1", {
    moscow: "must",
    businessValue: 8,
    timeCriticality: 6,
    riskReduction: 4,
    jobSize: 3,
    reach: 500,
    impact: 2,
    confidence: 90,
    effort: 1.5,
    value: 7,
    matrixEffort: 2,
  });

  it("RICE: same names both ways, impact snapped into the backlog", () => {
    expect(f("rice").fromBacklog!(item)).toEqual({
      reach: 500,
      impact: 2,
      confidence: 90,
      effort: 1.5,
    });
    expect(f("rice").toBacklog!({ reach: 800, impact: 1.4, confidence: 60, effort: 2 })).toEqual({
      reach: 800,
      impact: 1,
      confidence: 60,
      effort: 2,
    });
  });

  it("WSJF: rrOe maps to riskReduction", () => {
    expect(f("wsjf").fromBacklog!(item)).toEqual({
      businessValue: 8,
      timeCriticality: 6,
      rrOe: 4,
      jobSize: 3,
    });
    expect(
      f("wsjf").toBacklog!({ businessValue: 13, timeCriticality: 8, rrOe: 5, jobSize: 2 })
    ).toEqual({ businessValue: 13, timeCriticality: 8, riskReduction: 5, jobSize: 2 });
  });

  it("MoSCoW: bucket maps to moscow, unknown buckets are ignored", () => {
    expect(f("moscow").fromBacklog!(item)).toEqual({ bucket: "must" });
    expect(f("moscow").toBacklog!({ bucket: "could" })).toEqual({ moscow: "could" });
    expect(f("moscow").toBacklog!({ bucket: "maybe" })).toEqual({});
  });

  it("Value/Effort: effort maps to matrixEffort", () => {
    expect(f("value-effort").fromBacklog!(item)).toEqual({ value: 7, effort: 2 });
    expect(f("value-effort").toBacklog!({ value: 9, effort: 4, quadrant: "Quick Wins" })).toEqual({
      value: 9,
      matrixEffort: 4,
    });
  });

  it("skips fields that are missing or unreadable", () => {
    expect(f("rice").toBacklog!({ reach: "lots", effort: 3 })).toEqual({ effort: 3 });
    expect(f("wsjf").toBacklog!(undefined)).toEqual({});
    expect(f("rice").toBacklog!({ reach: "1200" })).toEqual({ reach: 1200 });
  });

  it("round-trips the backlog's own inputs", () => {
    for (const fw of FRAMEWORKS.filter((x) => x.embedded)) {
      const back = fw.toBacklog!(fw.fromBacklog!(item));
      expect(changedFields(item, back), fw.id).toEqual({});
    }
  });
});

describe("createBacklogItem", () => {
  it("fills the defaults and keeps business value and matrix value together", () => {
    const fromWsjf = createBacklogItem("  Search  ", { businessValue: 13, riskReduction: 2 }, "x");
    expect(fromWsjf).toMatchObject({
      id: "x",
      name: "Search",
      businessValue: 13,
      value: 10,
      riskReduction: 2,
      moscow: "should",
      reach: 100,
    });
    const fromMatrix = createBacklogItem("Search", { value: 7, matrixEffort: 3 }, "y");
    expect(fromMatrix).toMatchObject({ value: 7, businessValue: 7, matrixEffort: 3 });
  });
});

describe("scores", () => {
  it("reads the embedded methods from the item and the rest from the latest linked row", () => {
    const item = backlogItem("b1", {
      moscow: "must",
      businessValue: 9,
      timeCriticality: 8,
      riskReduction: 7,
      jobSize: 3,
      reach: 500,
      impact: 2,
      confidence: 90,
      effort: 2,
      value: 9,
      matrixEffort: 3,
    });
    const rows = [
      row("i-old", "ice", { impact: 5 }, { backlogItemId: "b1", score: 100 }),
      row(
        "i-new",
        "ice",
        { impact: 8 },
        { backlogItemId: "b1", score: 320, updatedAt: "2026-10-05T09:00:00.000Z" }
      ),
      row("i-other", "ice", {}, { backlogItemId: "b2", score: 999 }),
      row("k", "kano", { category: "attractive" }, { backlogItemId: "b1", score: 4 }),
    ];
    expect(latestLinkedRow(rows, "b1", "ice")?.id).toBe("i-new");
    expect(frameworkScores(item, rows)).toEqual({
      moscow: "must",
      wsjf: 8,
      rice: 450,
      valueEffort: { value: 9, effort: 3, quadrant: "Quick Wins" },
      ice: 320,
      kano: "attractive",
      costOfDelay: null,
    });
  });

  it("uses the Prioritizer matrix's quadrants", () => {
    expect(matrixQuadrant(6, 5)).toBe("Quick Wins");
    expect(matrixQuadrant(6, 6)).toBe("Major Projects");
    expect(matrixQuadrant(5, 5)).toBe("Fill-ins");
    expect(matrixQuadrant(5, 6)).toBe("Time Sinks");
  });
});

describe("linkNewRow", () => {
  it("links the row and writes its differing inputs to the backlog item, with Undo", () => {
    useWorkspaceStore.setState({ backlogItems: [backlogItem("b1", { reach: 500, impact: 2 })] });
    const linked = linkNewRow(
      row("r1", "rice", { reach: 700, impact: 2, confidence: 80, effort: 1 }),
      "b1"
    );
    expect(linked.backlogItemId).toBe("b1");
    expect(storedItem("b1")).toMatchObject({ reach: 700, impact: 2, confidence: 80 });
    expect(undo.last?.label).toBe("Updated “Item b1” in the backlog");

    undo.last!.revert();
    expect(storedItem("b1")).toMatchObject({ reach: 500, impact: 2 });
  });

  it("writes nothing when the inputs already match, or for methods the backlog doesn't hold", () => {
    const item = backlogItem("b1");
    useWorkspaceStore.setState({ backlogItems: [item] });
    linkNewRow(row("m", "moscow", { bucket: item.moscow }), "b1");
    linkNewRow(row("i", "ice", { impact: 3, confidence: 3, ease: 3 }), "b1");
    expect(undo.last).toBeNull();
    expect(storedItem("b1")).toEqual(item);
  });

  it("leaves the row unlinked when there is no pending item or it was deleted", () => {
    const r = row("r1", "rice", { reach: 1 });
    expect(linkNewRow(r, null)).toBe(r);
    expect(linkNewRow(r, "gone").backlogItemId).toBeUndefined();
  });
});

describe("addRowToBacklog", () => {
  it("creates a backlog item from the row's inputs and links the row; Undo removes both", () => {
    const r = row("w1", "wsjf", { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 2 });
    r.title = "Single sign-on";
    useWorkspaceStore.setState({ prioritizations: [r] });

    const id = addRowToBacklog(r);
    expect(storedItem(id)).toMatchObject({
      name: "Single sign-on",
      businessValue: 8,
      timeCriticality: 5,
      riskReduction: 3,
      jobSize: 2,
    });
    expect(storedRow("w1")?.backlogItemId).toBe(id);
    expect(undo.last?.label).toBe("Added “Single sign-on” to the backlog");

    undo.last!.revert();
    expect(state().backlogItems).toEqual([]);
    expect(storedRow("w1")?.backlogItemId).toBeUndefined();
  });

  it("links to an existing item with the same name instead of making a duplicate", () => {
    const existing = backlogItem("b1", { name: "Dark mode", moscow: "should" });
    const r = row("m1", "moscow", { bucket: "must" }, { title: "  dark MODE " });
    useWorkspaceStore.setState({ backlogItems: [existing], prioritizations: [r] });

    expect(addRowToBacklog(r)).toBe("b1");
    expect(state().backlogItems).toHaveLength(1);
    expect(storedItem("b1")?.moscow).toBe("must");
    expect(storedRow("m1")?.backlogItemId).toBe("b1");

    undo.last!.revert();
    expect(storedItem("b1")).toEqual(existing);
    expect(storedRow("m1")?.backlogItemId).toBeUndefined();
  });
});

describe("renameLinkedRows and removeBacklogItemWithUndo", () => {
  it("renames only the rows linked to the item", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("a", "ice", {}, { backlogItemId: "b1" }),
        row("b", "kano", {}, { backlogItemId: "b2" }),
        row("c", "rice", {}),
      ],
    });
    renameLinkedRows("b1", "  Passkeys ");
    expect(storedRow("a")?.title).toBe("Passkeys");
    expect(storedRow("b")?.title).toBe("Row b");
    expect(storedRow("c")?.title).toBe("Row c");
    renameLinkedRows("b1", "   ");
    expect(storedRow("a")?.title).toBe("Passkeys");
  });

  it("deletes an item, unlinking its rows, and Undo restores the item and the links", () => {
    const item = backlogItem("b1");
    useWorkspaceStore.setState({
      backlogItems: [item],
      prioritizations: [row("a", "ice", {}, { backlogItemId: "b1" })],
    });
    removeBacklogItemWithUndo("b1");
    expect(state().backlogItems).toEqual([]);
    expect(storedRow("a")?.backlogItemId).toBeUndefined();
    expect(undo.last?.label).toBe("Deleted “Item b1”");

    undo.last!.revert();
    expect(storedItem("b1")).toEqual(item);
    expect(storedRow("a")?.backlogItemId).toBe("b1");
  });
});
