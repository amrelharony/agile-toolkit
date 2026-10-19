import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KeyResult, Okr } from "@/lib/stores/workspace-types";

/**
 * OKRs: deleting an objective or a key result offers Undo. An objective
 * comes back with its key results; a key result goes back into its
 * objective at its old position.
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

import { OkrsClient } from "@/app/(tools)/okrs/okrs-client";

const kr = (id: string, title: string): KeyResult => ({ id, title, target: 10, current: 5 });
const okr = (id: string, objective: string, keyResults: KeyResult[]): Okr => ({
  id,
  objective,
  keyResults,
  quarter: "Q4 2026",
});

const stored = () => useWorkspaceStore.getState().okrs;

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    okrs: [
      okr("o1", "Delight new users", [
        kr("k1", "Activation to 60%"),
        kr("k2", "Onboarding under 3 min"),
        kr("k3", "NPS above 40"),
      ]),
    ],
  });
});

describe("OKR deletes", () => {
  it("restores a deleted key result at its old position", () => {
    render(<OkrsClient />);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete key result: Onboarding under 3 min" })
    );

    expect(stored()[0].keyResults.map((k) => k.id)).toEqual(["k1", "k3"]);
    expect(undo.last!.label).toBe("Deleted “Onboarding under 3 min”");

    act(() => undo.last!.revert());
    expect(stored()[0].keyResults.map((k) => k.id)).toEqual(["k1", "k2", "k3"]);
    expect(
      screen.getByRole("button", { name: "Delete key result: Onboarding under 3 min" })
    ).toBeInTheDocument();
  });

  it("restores a deleted objective with its key results", () => {
    render(<OkrsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete objective: Delight new users" }));

    expect(stored()).toHaveLength(0);
    expect(undo.last!.label).toBe("Deleted “Delight new users”");

    act(() => undo.last!.revert());
    expect(stored()).toHaveLength(1);
    expect(stored()[0].keyResults).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Delete objective: Delight new users" })
    ).toBeInTheDocument();
  });
});
