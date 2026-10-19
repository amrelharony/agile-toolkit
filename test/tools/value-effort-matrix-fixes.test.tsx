import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Value vs Effort: an empty Value or Effort used to become 5 without a
 * word, which is the quadrant boundary. Both are now required.
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
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { ValueEffortMatrixClient } from "@/app/(tools)/value-effort-matrix/value-effort-matrix-client";

const rows = () =>
  (useWorkspaceStore.getState().prioritizations ?? []).filter(
    (r) => r.framework === "value-effort"
  );
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const plot = () => fireEvent.click(screen.getByRole("button", { name: "Plot" }));

beforeEach(() => {
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("Value vs Effort: both scores are required", () => {
  it("doesn't plot an item with an empty Effort, and says so", () => {
    render(<ValueEffortMatrixClient />);
    type("Item title", "Dark mode");
    type("Value (1-10)", "7");
    plot();

    expect(rows()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter Effort to plot this item. Value and Effort each run from 1 to 10."
    );
    expect(screen.getByLabelText("Effort (1-10)")).toHaveAttribute("aria-invalid", "true");
  });

  it("plots the item in the right quadrant once both are filled", () => {
    render(<ValueEffortMatrixClient />);
    type("Item title", "Dark mode");
    type("Value (1-10)", "7");
    plot();
    type("Effort (1-10)", "2");
    plot();

    expect(rows()).toHaveLength(1);
    expect(rows()[0].fields).toEqual({ value: 7, effort: 2, quadrant: "Quick Wins" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
