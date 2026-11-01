/**
 * lib/risks/store: the browser writes to the risks. Every save stamps
 * updatedAt; the list folds in the old blob's pending rows; a patch edits a
 * pending row as merged; a delete marks a pending row moved and unpins the
 * canvas cards, and Undo puts back exactly that; the move saves in one
 * store write with new rows first; the blob is never written.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk, WhiteboardObject } from "@/lib/stores/workspace-types";
import {
  RISK_REGISTER_KEY,
  RISK_REGISTER_MOVED_KEY,
  planRiskRegisterMove,
} from "@/lib/risks/legacy-register";
import {
  currentRisks,
  patchRisk,
  removeRiskRecord,
  restoreRiskRecord,
  saveRisk,
  saveRisks,
} from "@/lib/risks/store";

const ws = () => useWorkspaceStore.getState();
const objects = () => ws().whiteboardObjects ?? [];

const rec = (over: Partial<Risk> = {}): Risk => ({
  id: "r1",
  title: "Vendor API rate limits",
  probability: 3,
  impact: 3,
  status: "open",
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

const blob = (rows: unknown[]) => localStorage.setItem(RISK_REGISTER_KEY, JSON.stringify(rows));
const moved = (): unknown => JSON.parse(localStorage.getItem(RISK_REGISTER_MOVED_KEY) ?? "null");

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ risks: [], whiteboardObjects: [] });
});

describe("currentRisks", () => {
  it("lists the workspace's risks and the blob's pending rows, not moved ones", () => {
    useWorkspaceStore.setState({ risks: [rec({ id: "a" })] });
    blob([rec({ id: "old", title: "Old page" }), rec({ id: "gone" })]);
    localStorage.setItem(RISK_REGISTER_MOVED_KEY, JSON.stringify(["gone"]));
    expect(currentRisks().map((r) => r.id)).toEqual(["a", "old"]);
  });
});

describe("saveRisk / saveRisks", () => {
  it("stamps updatedAt, replaces by id and puts new rows first", () => {
    useWorkspaceStore.setState({ risks: [rec({ id: "a" }), rec({ id: "b" })] });
    const saved = saveRisks([rec({ id: "b", title: "B edited" }), rec({ id: "new" })]);
    expect(saved.every((r) => typeof r.updatedAt === "string")).toBe(true);
    expect(ws().risks.map((r) => [r.id, r.title])).toEqual([
      ["new", "Vendor API rate limits"],
      ["a", "Vendor API rate limits"],
      ["b", "B edited"],
    ]);
    expect(ws().risks.find((r) => r.id === "a")?.updatedAt).toBeUndefined();
    expect(saveRisks([])).toEqual([]);
  });

  it("saveRisk returns the row as saved; the blob is never written", () => {
    blob([rec({ id: "old" })]);
    const r = saveRisk(rec({ id: "x" }));
    expect(r.updatedAt).toEqual(expect.any(String));
    expect(ws().risks).toEqual([r]);
    expect(JSON.parse(localStorage.getItem(RISK_REGISTER_KEY)!)).toEqual([rec({ id: "old" })]);
  });
});

describe("patchRisk", () => {
  it("edits a pending blob row as merged, saving it into the workspace", () => {
    blob([rec({ id: "old", mitigation: "From the old page" })]);
    const saved = patchRisk("old", (r) => ({ ...r, owner: "Ana" }));
    expect(saved).toMatchObject({ id: "old", mitigation: "From the old page", owner: "Ana" });
    expect(ws().risks).toEqual([saved]);
    expect(patchRisk("nope", (r) => r)).toBeNull();
  });
});

describe("removeRiskRecord / restoreRiskRecord", () => {
  it("removes a workspace risk, unpins its cards, and Undo puts both back", () => {
    useWorkspaceStore.setState({
      risks: [rec({ id: "a" }), rec({ id: "b" })],
      whiteboardObjects: [
        card("c1", { tool: "risk", entityId: "a" }),
        card("c2", { tool: "risk", entityId: "b" }),
        card("c3", { tool: "decision", entityId: "a" }),
      ],
    });
    const snap = removeRiskRecord("a");
    expect(snap).toEqual({
      id: "a",
      risk: rec({ id: "a" }),
      cards: [{ id: "c1", sourceRef: { tool: "risk", entityId: "a" } }],
    });
    expect(ws().risks.map((r) => r.id)).toEqual(["b"]);
    expect(objects().find((o) => o.id === "c1")?.sourceRef).toBeUndefined();
    expect(moved()).toBeNull();

    restoreRiskRecord(snap);
    expect(ws().risks.find((r) => r.id === "a")).toEqual(rec({ id: "a" }));
    expect(objects().find((o) => o.id === "c1")?.sourceRef).toEqual({
      tool: "risk",
      entityId: "a",
    });
  });

  it("a pending blob row is marked moved, so the move doesn't bring it back; Undo unmarks it", () => {
    blob([rec({ id: "old", title: "Old page" }), rec({ id: "other" })]);
    const snap = removeRiskRecord("old");
    expect(snap).toEqual({ id: "old", pendingBlobRow: true, cards: [] });
    expect(moved()).toEqual(["old"]);
    expect(currentRisks().map((r) => r.id)).toEqual(["other"]);
    expect(
      planRiskRegisterMove(
        JSON.parse(localStorage.getItem(RISK_REGISTER_KEY)!),
        [],
        ["old"]
      ).toAdd.map((r) => r.id)
    ).toEqual(["other"]);

    restoreRiskRecord(snap);
    expect(moved()).toEqual([]);
    expect(currentRisks().map((r) => r.id)).toEqual(["old", "other"]);
    // The backup is untouched throughout.
    expect(JSON.parse(localStorage.getItem(RISK_REGISTER_KEY)!)).toHaveLength(2);
  });

  it("a pushed row in both stores: the delete marks it moved and removes the workspace copy", () => {
    useWorkspaceStore.setState({ risks: [rec({ id: "both" })] });
    blob([rec({ id: "both", mitigation: "From the old page" })]);
    const snap = removeRiskRecord("both");
    expect(snap).toMatchObject({ id: "both", risk: rec({ id: "both" }), pendingBlobRow: true });
    expect(currentRisks()).toEqual([]);
    restoreRiskRecord(snap);
    expect(currentRisks()).toEqual([rec({ id: "both", mitigation: "From the old page" })]);
  });

  it("Undo leaves a row that came back under the id since, and a card pinned again since", () => {
    useWorkspaceStore.setState({
      risks: [rec({ id: "a" })],
      whiteboardObjects: [card("c1", { tool: "risk", entityId: "a" })],
    });
    const snap = removeRiskRecord("a");
    ws().upsertRisk(rec({ id: "a", title: "Another device's copy" }));
    useWorkspaceStore.setState({
      whiteboardObjects: [card("c1", { tool: "risk", entityId: "elsewhere" })],
    });
    restoreRiskRecord(snap);
    expect(ws().risks.map((r) => r.title)).toEqual(["Another device's copy"]);
    expect(objects()[0].sourceRef).toEqual({ tool: "risk", entityId: "elsewhere" });
  });
});
