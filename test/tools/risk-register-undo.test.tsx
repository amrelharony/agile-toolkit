import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";

/**
 * Risk Register: deleting a risk offers Undo that puts it back, once. The
 * register lives in workspace.risks since Phase 8.
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
vi.mock("@/app/(tools)/risk-register/charts", () => ({ OpenRisksChart: () => null }));

import { RiskRegisterClient } from "@/app/(tools)/risk-register/risk-register-client";

const risk = (id: string, title: string, probability: Risk["probability"]): Risk => ({
  id,
  title,
  probability,
  impact: 3,
  status: "open",
  raisedAt: "2026-10-01",
  mitigation: `Plan for ${title}`,
});

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  useWorkspaceStore.setState({
    risks: [risk("r1", "Vendor lock-in", 4), risk("r2", "Key person leaves", 2)],
    whiteboardObjects: [],
    impediments: [],
  });
});

const stored = () => useWorkspaceStore.getState().risks.map((r) => r.id);
const renderPage = () =>
  render(
    <TooltipProvider>
      <RiskRegisterClient />
    </TooltipProvider>
  );

describe("Risk Register undo", () => {
  it("puts a deleted risk back", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Vendor lock-in" }));

    expect(screen.queryByRole("button", { name: "Delete Vendor lock-in" })).toBeNull();
    expect(undo.last?.label).toBe("Deleted “Vendor lock-in”");
    expect(stored()).toEqual(["r2"]);

    act(() => undo.last!.revert());
    expect(screen.getByRole("button", { name: "Delete Vendor lock-in" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Mitigation plan for Vendor lock-in" })).toHaveValue(
      "Plan for Vendor lock-in"
    );
    expect(stored().sort()).toEqual(["r1", "r2"]);

    // A second revert can't duplicate it.
    act(() => undo.last!.revert());
    expect(screen.getAllByRole("button", { name: "Delete Vendor lock-in" })).toHaveLength(1);
    expect(stored()).toHaveLength(2);
  });
});
