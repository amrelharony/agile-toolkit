import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TechDebtItem } from "@/lib/stores/workspace-types";

/**
 * Tech debt:
 * - Nothing set `resolvedAt`, so "Open" counted every item and the
 *   resolution survival curve never had data. "Mark resolved" (with Undo)
 *   sets it, and Open counts only unresolved items.
 * - The score in each row had no label.
 * The items live in workspace.techDebt since Phase 8.
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
vi.mock("@/app/(tools)/tech-debt/charts", () => ({ ResolutionSurvivalChart: () => null }));

import { TechDebtClient } from "@/app/(tools)/tech-debt/tech-debt-client";

const item = (id: string, title: string, impact: TechDebtItem["impact"]): TechDebtItem => ({
  id,
  title,
  impact,
  effort: 2,
  interestRate: 0,
  raisedAt: "2026-09-01",
});
const stored = () => useWorkspaceStore.getState().techDebt;
const openCount = () => screen.getByText("Open").parentElement!.nextElementSibling!;
const renderPage = () =>
  render(
    <TooltipProvider>
      <TechDebtClient />
    </TooltipProvider>
  );

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  useWorkspaceStore.setState({
    techDebt: [item("d1", "Flaky deploy script", 5), item("d2", "Old ORM", 2)],
    stories: [],
    whiteboardObjects: [],
    ceremonyCadences: [],
  });
});

describe("Tech debt resolve", () => {
  it("marks an item resolved, drops it from Open, and can be undone", () => {
    renderPage();
    expect(openCount()).toHaveTextContent(/^2$/);

    fireEvent.click(screen.getByRole("button", { name: "Mark resolved: Flaky deploy script" }));
    expect(undo.last?.label).toBe("Resolved “Flaky deploy script”");
    expect(stored().find((i) => i.id === "d1")?.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(openCount()).toHaveTextContent(/^1$/);
    expect(screen.getByText(/^Paid down \d{4}-\d{2}-\d{2}$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen: Flaky deploy script" })).toBeInTheDocument();
    // Resolved items sink below open ones once the list is re-sorted.
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    const deletes = screen.getAllByRole("button", { name: /^Delete / });
    expect(deletes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Delete Old ORM",
      "Delete Flaky deploy script",
    ]);

    act(() => undo.last!.revert());
    expect(stored().find((i) => i.id === "d1")?.resolvedAt).toBeUndefined();
    expect(openCount()).toHaveTextContent(/^2$/);
    expect(
      screen.getByRole("button", { name: "Mark resolved: Flaky deploy script" })
    ).toBeInTheDocument();
  });

  it("labels the score in every row", () => {
    renderPage();
    expect(screen.getAllByText("Score", { selector: "span" })).toHaveLength(2);
  });
});
