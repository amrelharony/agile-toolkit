import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * WSJF and RICE: removing a scored item offers Undo, and Undo brings it
 * back with its scores.
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
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { WsjfClient } from "@/app/(tools)/wsjf/wsjf-client";
import { RiceScoringClient } from "@/app/(tools)/rice-scoring/rice-scoring-client";

const item = (
  id: string,
  framework: "wsjf" | "rice",
  title: string,
  score: number,
  fields: Record<string, number>
): PrioritizationItem => ({
  id,
  framework,
  title,
  score,
  fields,
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const stored = (id: string) =>
  (useWorkspaceStore.getState().prioritizations ?? []).find((x) => x.id === id);

beforeEach(() => {
  undo.last = null;
});

describe("WSJF item delete", () => {
  it("removes the item and Undo brings it back with its scores", () => {
    const wsjfFields = { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 2 };
    const w1 = item("w1", "wsjf", "Single sign-on", 8, wsjfFields);
    useWorkspaceStore.setState({
      prioritizations: [w1, item("w2", "wsjf", "Dark mode", 2, wsjfFields)],
    });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Single sign-on" }));

    expect(stored("w1")).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Remove Single sign-on" })).toBeNull();
    expect(undo.last!.label).toBe("Deleted “Single sign-on”");

    act(() => undo.last!.revert());
    expect(stored("w1")).toEqual(w1);
    expect(screen.getByRole("button", { name: "Remove Single sign-on" })).toBeInTheDocument();
  });
});

describe("RICE item delete", () => {
  it("removes the item and Undo brings it back with its scores", () => {
    const riceFields = { reach: 500, impact: 2, confidence: 80, effort: 3 };
    const r1 = item("r1", "rice", "Saved searches", 266.67, riceFields);
    useWorkspaceStore.setState({
      prioritizations: [r1, item("r2", "rice", "CSV import", 40, riceFields)],
    });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Saved searches" }));

    expect(stored("r1")).toBeUndefined();
    expect(undo.last!.label).toBe("Deleted “Saved searches”");

    act(() => undo.last!.revert());
    expect(stored("r1")).toEqual(r1);
    expect(screen.getByRole("button", { name: "Remove Saved searches" })).toBeInTheDocument();
  });
});
