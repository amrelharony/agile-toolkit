import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WeightedCriterion, WeightedOption } from "@/lib/stores/workspace-types";

/**
 * Weighted decision matrix:
 *  - two criteria at the default weight of 1 no longer trip a "weights
 *    should sum to 1 or 100" warning; weights are relative, with each
 *    criterion's share shown;
 *  - score cells run 1–10, and an out-of-range score isn't saved;
 *  - clearing a cell means "not scored", not a saved 0.
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
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { WeightedDecisionClient } from "@/app/(tools)/weighted-decision/weighted-decision-client";

const cost: WeightedCriterion = { id: "c-cost", name: "Cost", weight: 1 };
const speed: WeightedCriterion = { id: "c-speed", name: "Speed", weight: 1 };
const vendorA: WeightedOption = { id: "o-a", name: "Vendor A", scores: { "c-cost": 6 } };

const option = (id: string) =>
  (useWorkspaceStore.getState().weightedOptions ?? []).find((o) => o.id === id)!;
const cell = (criterion: string, opt: string) =>
  screen.getByLabelText(`${criterion} score for ${opt}`);

beforeEach(() => {
  useWorkspaceStore.setState({ weightedCriteria: [], weightedOptions: [] });
});

describe("Weighted decision: weights", () => {
  it("doesn't warn about two criteria at the default weight, and shows each share", () => {
    render(<WeightedDecisionClient />);
    for (const name of ["Cost", "Speed"]) {
      fireEvent.change(screen.getByLabelText("Criterion name"), { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    }

    expect(useWorkspaceStore.getState().weightedCriteria).toHaveLength(2);
    expect(screen.queryByText(/Weights sum to/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("w1 · 50%")).toHaveLength(2);
  });

  it("warns when every weight is 0, because every total is then 0", () => {
    useWorkspaceStore.setState({
      weightedCriteria: [
        { ...cost, weight: 0 },
        { ...speed, weight: 0 },
      ],
    });
    render(<WeightedDecisionClient />);
    expect(screen.getByRole("alert")).toHaveTextContent("Every weight is 0");
  });
});

describe("Weighted decision: score cells", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ weightedCriteria: [cost, speed], weightedOptions: [vendorA] });
  });

  it("saves a score from 1 to 10", () => {
    render(<WeightedDecisionClient />);
    fireEvent.change(cell("Speed", "Vendor A"), { target: { value: "7" } });
    expect(option("o-a").scores).toEqual({ "c-cost": 6, "c-speed": 7 });
  });

  it("refuses a score outside 1–10 and says why", () => {
    render(<WeightedDecisionClient />);
    fireEvent.change(cell("Speed", "Vendor A"), { target: { value: "15" } });

    expect(option("o-a").scores).toEqual({ "c-cost": 6 });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Scores run from 1 to 10. 15 for Speed on Vendor A wasn't saved."
    );

    fireEvent.change(cell("Speed", "Vendor A"), { target: { value: "0" } });
    expect(option("o-a").scores).toEqual({ "c-cost": 6 });

    fireEvent.change(cell("Speed", "Vendor A"), { target: { value: "9" } });
    expect(option("o-a").scores).toEqual({ "c-cost": 6, "c-speed": 9 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a cleared cell as not scored rather than saving 0", () => {
    render(<WeightedDecisionClient />);
    expect(screen.getByText("1 not scored")).toBeInTheDocument();

    fireEvent.change(cell("Cost", "Vendor A"), { target: { value: "" } });

    expect(option("o-a").scores).toEqual({});
    expect("c-cost" in option("o-a").scores).toBe(false);
    expect(cell("Cost", "Vendor A")).toHaveValue(null);
    expect(screen.getByText("2 not scored")).toBeInTheDocument();
  });
});
