/**
 * lib/decisions/store: the browser writes to the decision records. A save
 * shadows an old DACI / RAPID row under its id and leaves it as the backup;
 * a new record takes the next number; a delete removes the id from all
 * three collections and Undo puts back exactly that, canvas pins included;
 * the Decision Log's move saves in one store write.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Decision, WhiteboardObject } from "@/lib/stores/workspace-types";
import { DECISION_LOG_KEY, DECISION_LOG_MOVED_KEY } from "@/lib/decisions/legacy-log";
import { fromDaci } from "@/lib/decisions/model";
import {
  createDecision,
  currentDecisions,
  newDecisionId,
  removeDecisionRecord,
  restoreDecisionRecord,
  saveDecision,
  saveDecisions,
} from "@/lib/decisions/store";

const ws = () => useWorkspaceStore.getState();

const rec = (over: Partial<Decision> = {}): Decision => ({
  id: "d1",
  title: "Use Postgres",
  decision: "",
  status: "proposed",
  date: "2026-10-01",
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

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({
    decisions: [],
    daciDecisions: [],
    rapidDecisions: [],
    whiteboardObjects: [],
  });
});

describe("currentDecisions", () => {
  it("lists the workspace's records, old DACI / RAPID rows and the blob's pending rows", () => {
    useWorkspaceStore.setState({
      decisions: [rec({ id: "a" })],
      daciDecisions: [{ id: "x", title: "Vendor", status: "open", date: "2026-10-02" }],
      rapidDecisions: [{ id: "r", title: "Reorg", status: "decided", date: "2026-10-03" }],
    });
    localStorage.setItem(
      DECISION_LOG_KEY,
      JSON.stringify([{ id: "blob", title: "Old page", date: "2026-09-01" }, { id: "gone" }])
    );
    localStorage.setItem(DECISION_LOG_MOVED_KEY, JSON.stringify(["gone"]));
    expect(currentDecisions().map((d) => d.id)).toEqual(["a", "x", "r", "blob"]);
  });

  it("reads an unreadable blob as none", () => {
    localStorage.setItem(DECISION_LOG_KEY, "{not json");
    useWorkspaceStore.setState({ decisions: [rec()] });
    expect(currentDecisions().map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("saving", () => {
  it("saveDecision writes a record under an old DACI row's id and leaves the row as the backup", () => {
    const old = { id: "x", title: "Vendor", status: "open" as const, date: "2026-10-02" };
    useWorkspaceStore.setState({ daciDecisions: [old] });
    saveDecision({ ...fromDaci(old), title: "Vendor (edited)" });
    expect(ws().decisions.map((d) => [d.id, d.title])).toEqual([["x", "Vendor (edited)"]]);
    expect(ws().daciDecisions).toEqual([old]);
    expect(currentDecisions().map((d) => [d.id, d.title])).toEqual([["x", "Vendor (edited)"]]);
  });

  it("createDecision numbers one past the highest, whatever the template", () => {
    useWorkspaceStore.setState({
      decisions: [rec({ id: "a", number: 2 }), rec({ id: "b", template: "rapid", number: 9 })],
    });
    const saved = createDecision(rec({ id: "c", template: "daci" }));
    expect(saved.number).toBe(10);
    expect(ws().decisions.find((d) => d.id === "c")?.number).toBe(10);
    // Against a list the caller passes, as RFC Tracker's push does.
    expect(createDecision(rec({ id: "e" }), []).number).toBe(1);
  });

  it("saveDecisions replaces by id and appends in one store write", () => {
    useWorkspaceStore.setState({ decisions: [rec({ id: "a" }), rec({ id: "b" })] });
    const listener = vi.fn();
    const unsubscribe = useWorkspaceStore.subscribe(listener);
    saveDecisions([rec({ id: "b", number: 2 }), rec({ id: "c", number: 3 })]);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ws().decisions.map((d) => [d.id, d.number])).toEqual([
      ["a", undefined],
      ["b", 2],
      ["c", 3],
    ]);
    saveDecisions([]);
    expect(ws().decisions).toHaveLength(3);
  });

  it("newDecisionId makes distinct ids", () => {
    expect(newDecisionId()).not.toBe(newDecisionId());
  });
});

describe("delete with Undo", () => {
  it("removes the id from all three collections, so a read-through row can't come back", () => {
    useWorkspaceStore.setState({
      decisions: [rec({ id: "x", template: "daci" }), rec({ id: "other" })],
      daciDecisions: [{ id: "x", title: "Vendor", status: "open", date: "2026-10-02" }],
      rapidDecisions: [{ id: "x", title: "Same id", status: "open", date: "2026-10-02" }],
    });
    const snap = removeDecisionRecord("x");
    expect(ws().decisions.map((d) => d.id)).toEqual(["other"]);
    expect(ws().daciDecisions).toEqual([]);
    expect(ws().rapidDecisions).toEqual([]);
    expect(currentDecisions().map((d) => d.id)).toEqual(["other"]);

    restoreDecisionRecord(snap);
    expect(ws().decisions.map((d) => d.id)).toEqual(["other", "x"]);
    expect(ws().daciDecisions?.map((d) => d.id)).toEqual(["x"]);
    expect(ws().rapidDecisions?.map((d) => d.id)).toEqual(["x"]);
  });

  it("an old row only: removed and restored", () => {
    useWorkspaceStore.setState({
      rapidDecisions: [{ id: "r", title: "Reorg", status: "open", date: "2026-10-02" }],
    });
    const snap = removeDecisionRecord("r");
    expect(snap).toEqual({
      id: "r",
      rapid: { id: "r", title: "Reorg", status: "open", date: "2026-10-02" },
      cards: [],
    });
    expect(currentDecisions()).toEqual([]);
    restoreDecisionRecord(snap);
    expect(currentDecisions().map((d) => d.id)).toEqual(["r"]);
    expect(removeDecisionRecord("missing")).toEqual({ id: "missing", cards: [] });
  });

  it("re-pins the canvas cards the delete unpinned, unless they changed since", () => {
    useWorkspaceStore.setState({
      decisions: [rec({ id: "x" })],
      daciDecisions: [{ id: "x", title: "Vendor", status: "open", date: "2026-10-02" }],
      whiteboardObjects: [
        card("c1", { tool: "decision", entityId: "x" }),
        card("c2", { tool: "daci", entityId: "x" }),
        card("c3", { tool: "decision", entityId: "x" }),
        card("c4", { tool: "decision", entityId: "other" }),
      ],
    });
    const snap = removeDecisionRecord("x");
    const pins = () => (ws().whiteboardObjects ?? []).map((o) => [o.id, o.sourceRef?.tool ?? null]);
    expect(pins()).toEqual([
      ["c1", null],
      ["c2", null],
      ["c3", null],
      ["c4", "decision"],
    ]);
    // c3 was pinned to something else on the canvas in the meantime.
    const c3 = ws().whiteboardObjects!.find((o) => o.id === "c3")!;
    ws().upsertWhiteboardObjects([{ ...c3, sourceRef: { tool: "risk", entityId: "k" } }]);

    restoreDecisionRecord(snap);
    expect(pins()).toEqual([
      ["c1", "decision"],
      ["c2", "daci"],
      ["c3", "risk"],
      ["c4", "decision"],
    ]);
  });

  it("leaves a row that came back under the id since", () => {
    useWorkspaceStore.setState({ decisions: [rec({ id: "x", title: "Before" })] });
    const snap = removeDecisionRecord("x");
    ws().upsertDecision(rec({ id: "x", title: "From another device" }));
    restoreDecisionRecord(snap);
    expect(ws().decisions.map((d) => d.title)).toEqual(["From another device"]);
  });
});
