import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Value vs Effort: an empty Value or Effort used to become 5 without a
 * word, which was the quadrant boundary. Now one without the other is
 * refused with a message, and a title alone waits under "Not placed yet"
 * instead of landing in a quadrant.
 */

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

import { ValueEffortMatrixClient } from "@/app/(tools)/value-effort-matrix/value-effort-matrix-client";

const rows = () =>
  (useWorkspaceStore.getState().prioritizations ?? []).filter(
    (r) => r.framework === "value-effort"
  );
const form = () => screen.getByRole("button", { name: "Add" }).closest("form") as HTMLElement;
const pick = (group: string, value: string) =>
  fireEvent.click(
    within(within(form()).getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: value,
    })
  );
const add = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));

beforeEach(() => {
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

const renderPage = () =>
  render(
    <TooltipProvider>
      <ValueEffortMatrixClient />
    </TooltipProvider>
  );

describe("Value vs Effort: both scores or neither", () => {
  it("doesn't place an item with an empty Effort, and says so", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Item title/), { target: { value: "Dark mode" } });
    pick("Value", "8");
    add();

    expect(rows()).toHaveLength(0);
    expect(
      screen.getByText("Pick an effort too, or leave both empty and place it on the matrix later.")
    ).toBeInTheDocument();
  });

  it("places the item in the right quadrant once both are filled, storing no quadrant", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Item title/), { target: { value: "Dark mode" } });
    pick("Value", "8");
    add();
    pick("Effort", "2");
    add();

    expect(rows()).toHaveLength(1);
    expect(rows()[0].fields).toEqual({ businessValue: 8, effort: 2 });
    expect(
      screen.queryByText(
        "Pick an effort too, or leave both empty and place it on the matrix later."
      )
    ).not.toBeInTheDocument();
  });
});
