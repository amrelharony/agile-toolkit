/**
 * lib/tech-debt/store: the browser writes to the debt items, the Risk
 * Register store's shape. Saves stamp updatedAt and put new rows first; the
 * list folds in the old blob's pending rows; a patch edits a pending row as
 * merged; a delete marks a pending row moved and unpins the canvas cards,
 * and Undo puts back exactly that; the blob is never written.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TechDebtItem, WhiteboardObject } from "@/lib/stores/workspace-types";
import { TECH_DEBT_KEY, TECH_DEBT_MOVED_KEY } from "@/lib/tech-debt/legacy";
import {
  currentTechDebt,
  patchDebt,
  removeTechDebtRecord,
  restoreTechDebtRecord,
  saveDebt,
  saveTechDebt,
} from "@/lib/tech-debt/store";

const ws = () => useWorkspaceStore.getState();
const objects = () => ws().whiteboardObjects ?? [];

const rec = (over: Partial<TechDebtItem> = {}): TechDebtItem => ({
  id: "d1",
  title: "Flaky deploy script",
  impact: 3,
  effort: 3,
  raisedAt: "2026-10-01",
  ...over,
});

const card = (id: string, sourceRef?: { tool: string; entityId: string }): WhiteboardObject =>
  ({
    id,
    boardId: "b",
    type: "card",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 0,
    version: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    title: "Card",
    ...(sourceRef ? { sourceRef } : {}),
  }) as unknown as WhiteboardObject;

const blob = (rows: unknown[]) => localStorage.setItem(TECH_DEBT_KEY, JSON.stringify(rows));
const moved = (): unknown => JSON.parse(localStorage.getItem(TECH_DEBT_MOVED_KEY) ?? "null");

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ techDebt: [], whiteboardObjects: [] });
});

describe("currentTechDebt and saves", () => {
  it("lists the workspace's items and the blob's pending rows", () => {
    useWorkspaceStore.setState({ techDebt: [rec({ id: "a" })] });
    blob([rec({ id: "old" }), rec({ id: "gone" })]);
    localStorage.setItem(TECH_DEBT_MOVED_KEY, JSON.stringify(["gone"]));
    expect(currentTechDebt().map((t) => t.id)).toEqual(["a", "old"]);
  });

  it("stamps updatedAt, replaces by id, puts new rows first, and never writes the blob", () => {
    blob([rec({ id: "old" })]);
    useWorkspaceStore.setState({ techDebt: [rec({ id: "a" })] });
    const [edited] = saveTechDebt([rec({ id: "a", area: "ci" }), rec({ id: "new" })]);
    expect(edited.updatedAt).toEqual(expect.any(String));
    expect(ws().techDebt.map((t) => [t.id, t.area ?? null])).toEqual([
      ["new", null],
      ["a", "ci"],
    ]);
    expect(saveDebt(rec({ id: "x" })).updatedAt).toEqual(expect.any(String));
    expect(JSON.parse(localStorage.getItem(TECH_DEBT_KEY)!)).toEqual([rec({ id: "old" })]);
  });

  it("patchDebt edits a pending row as merged; an unknown id writes nothing", () => {
    blob([rec({ id: "old", description: "From the old page" })]);
    expect(patchDebt("old", (t) => ({ ...t, area: "api" }))).toMatchObject({
      id: "old",
      description: "From the old page",
      area: "api",
    });
    expect(ws().techDebt.map((t) => t.id)).toEqual(["old"]);
    expect(patchDebt("nope", (t) => t)).toBeNull();
  });
});

describe("removeTechDebtRecord / restoreTechDebtRecord", () => {
  it("removes an item and unpins its cards; Undo puts both back", () => {
    useWorkspaceStore.setState({
      techDebt: [rec({ id: "a" })],
      whiteboardObjects: [card("c1", { tool: "techDebt", entityId: "a" })],
    });
    const snap = removeTechDebtRecord("a");
    expect(snap).toEqual({
      id: "a",
      item: rec({ id: "a" }),
      cards: [{ id: "c1", sourceRef: { tool: "techDebt", entityId: "a" } }],
    });
    expect(ws().techDebt).toEqual([]);
    expect(objects()[0].sourceRef).toBeUndefined();
    restoreTechDebtRecord(snap);
    expect(ws().techDebt).toEqual([rec({ id: "a" })]);
    expect(objects()[0].sourceRef).toEqual({ tool: "techDebt", entityId: "a" });
  });

  it("a pending blob row is marked moved, and Undo unmarks it", () => {
    blob([rec({ id: "old" })]);
    const snap = removeTechDebtRecord("old");
    expect(snap).toEqual({ id: "old", pendingBlobRow: true, cards: [] });
    expect(moved()).toEqual(["old"]);
    expect(currentTechDebt()).toEqual([]);
    restoreTechDebtRecord(snap);
    expect(moved()).toEqual([]);
    expect(currentTechDebt().map((t) => t.id)).toEqual(["old"]);
  });
});
