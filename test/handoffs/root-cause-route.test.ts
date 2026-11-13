import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffSource } from "@/lib/handoffs/types";

/**
 * The root-cause hand-off route (lib/handoffs/targets/root-cause): a send
 * opens an analysis with the item as its problem and keeps where it came
 * from, a post-mortem's factor and a retro card link back to their
 * document, the analysis is done once it has a root cause and a
 * countermeasure, and `openRootCause` reuses the analysis already made
 * from the same item, its Undo removing a new one.
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
  analysisFrom,
  buildRootCauseAnalysis,
  openRootCause,
  rootCauseHref,
  rootCauseRoute,
  sameRef,
} from "@/lib/handoffs/targets/root-cause";

const ws = () => useWorkspaceStore.getState();
const analyses = () => ws().rootCauseAnalyses ?? [];

const src = (over: Partial<HandoffSource> = {}): HandoffSource => ({
  title: "No alert on checkout errors",
  description: "Customers saw errors for two hours.",
  sourceRef: { tool: "post-mortem", id: "factor:abc", doc: "pm1" },
  ...over,
});

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({ rootCauseAnalyses: [] });
});

describe("the root-cause route", () => {
  it("opens an analysis with the item as its problem, linked to its post-mortem", () => {
    const id = rootCauseRoute.send(src());
    const a = analyses().find((x) => x.id === id)!;
    expect(id).toMatch(/^rca_/);
    expect(a).toMatchObject({
      title: "No alert on checkout errors",
      problem: "Customers saw errors for two hours.",
      method: "five-whys",
      whys: [],
      causes: [],
      postMortemId: "pm1",
      sourceRef: { tool: "post-mortem", id: "factor:abc", doc: "pm1" },
    });
    expect(a.createdAt).toBe(a.updatedAt);
    expect(rootCauseRoute.targetHref(id)).toBe(`/root-cause?analysis=${id}`);
    expect(rootCauseHref("a b")).toBe("/root-cause?analysis=a%20b");
  });

  it("states the problem from the title when there's no description, and links a retro card's board", () => {
    const a = buildRootCauseAnalysis(
      src({
        description: undefined,
        sourceRef: { tool: "retro", id: "card-1", doc: "retro:current" },
      }),
      "rca_x",
      "2026-11-12T10:00:00.000Z"
    );
    expect(a.problem).toBe("No alert on checkout errors");
    expect(a.retroBoardId).toBe("retro:current");
    expect(a.postMortemId).toBeUndefined();
  });

  it("knows whether its analysis exists and is done, and removes it", () => {
    const id = rootCauseRoute.send(src());
    expect(rootCauseRoute.exists(id)).toBe(true);
    expect(rootCauseRoute.isDone?.(id)).toBe(false);
    useWorkspaceStore.setState({
      rootCauseAnalyses: analyses().map((a) => ({
        ...a,
        rootCause: "No alert",
        countermeasure: "Add one",
      })),
    });
    expect(rootCauseRoute.isDone?.(id)).toBe(true);
    rootCauseRoute.remove(id);
    expect(rootCauseRoute.exists(id)).toBe(false);
    expect(() => rootCauseRoute.remove("nope")).not.toThrow();
  });

  it("matches refs on tool, item and document", () => {
    expect(sameRef({ tool: "a", id: "1", doc: "d" }, { tool: "a", id: "1", doc: "d" })).toBe(true);
    expect(sameRef({ tool: "a", id: "1" }, { tool: "a", id: "1", doc: "" })).toBe(true);
    expect(sameRef({ tool: "a", id: "1", doc: "d" }, { tool: "a", id: "1", doc: "e" })).toBe(false);
    expect(sameRef(undefined, { tool: "a", id: "1" })).toBe(false);
  });
});

describe("openRootCause", () => {
  it("opens one analysis per item, with Undo, and finds it again after", () => {
    const first = openRootCause(src())!;
    expect(first.created).toBe(true);
    expect(undo.last?.label).toBe("Added to Root Cause");
    const again = openRootCause(src())!;
    expect(again).toEqual({ id: first.id, created: false });
    expect(analyses()).toHaveLength(1);
    expect(analysisFrom(src().sourceRef)?.id).toBe(first.id);
    // Another factor of the same post-mortem gets its own.
    const other = openRootCause(
      src({ sourceRef: { tool: "post-mortem", id: "factor:zzz", doc: "pm1" } })
    )!;
    expect(other.created).toBe(true);
    expect(analyses()).toHaveLength(2);
  });

  it("takes a new analysis away on Undo, and opens nothing for a blank title", () => {
    openRootCause(src());
    undo.last!.revert();
    expect(analyses()).toEqual([]);
    expect(openRootCause(src({ title: "  " }))).toBeNull();
  });
});
