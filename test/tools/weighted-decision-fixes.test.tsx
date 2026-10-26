import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WeightedCriterion, WeightedOption } from "@/lib/stores/workspace-types";

/**
 * Weighted decision matrix:
 *  - two criteria at the same weight don't trip a "weights should sum to 1
 *    or 100" warning; weights are relative, with each criterion's share
 *    shown;
 *  - score cells run 1–10, and an out-of-range score isn't saved;
 *  - clearing a cell means "not scored", not a saved 0.
 * Cells save when they are left (not per keystroke), since Phase 7.
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
vi.mock("@/app/(tools)/weighted-decision/charts", () => ({ WeightedScoreChart: () => null }));

import { WeightedDecisionClient } from "@/app/(tools)/weighted-decision/weighted-decision-client";

const cost: WeightedCriterion = { id: "c-cost", name: "Cost", weight: 1 };
const speed: WeightedCriterion = { id: "c-speed", name: "Speed", weight: 1 };
const vendorA: WeightedOption = { id: "o-a", name: "Vendor A", scores: { "c-cost": 6 } };

const option = (id: string) =>
  (useWorkspaceStore.getState().weightedOptions ?? []).find((o) => o.id === id)!;
const cell = (criterion: string, opt: string) =>
  screen.getByLabelText(`${criterion} score for ${opt}`);
/** Type into a cell and leave it, which is when it saves. */
const score = (criterion: string, opt: string, value: string) => {
  fireEvent.change(cell(criterion, opt), { target: { value } });
  fireEvent.blur(cell(criterion, opt));
};
const renderPage = () =>
  render(
    <TooltipProvider>
      <WeightedDecisionClient />
    </TooltipProvider>
  );

beforeEach(() => {
  useWorkspaceStore.setState({
    weightedMatrices: [],
    weightedCriteria: [],
    weightedOptions: [],
  });
});

describe("Weighted decision: weights", () => {
  it("doesn't warn about two criteria at the same weight, and shows each share", () => {
    // A legacy option puts the (unnamed) default matrix on screen.
    useWorkspaceStore.setState({ weightedOptions: [vendorA] });
    renderPage();
    for (const name of ["Cost", "Speed"]) {
      fireEvent.change(screen.getByLabelText(/^Criterion name/), { target: { value: name } });
      fireEvent.change(screen.getByLabelText(/^Criterion weight/), { target: { value: "1" } });
      fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    }

    expect(useWorkspaceStore.getState().weightedCriteria).toHaveLength(2);
    expect(screen.queryByText(/Weights sum to/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Every weight is 0/)).not.toBeInTheDocument();
    expect(screen.getAllByText("50%")).toHaveLength(2);
  });

  it("warns when every weight is 0, because no option can have a total", () => {
    useWorkspaceStore.setState({
      weightedCriteria: [
        { ...cost, weight: 0 },
        { ...speed, weight: 0 },
      ],
    });
    renderPage();
    expect(screen.getByText(/Every weight is 0/)).toHaveAttribute("role", "alert");
  });
});

describe("Weighted decision: score cells", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ weightedCriteria: [cost, speed], weightedOptions: [vendorA] });
  });

  it("saves a score from 1 to 10 when the cell is left", () => {
    renderPage();
    fireEvent.change(cell("Speed", "Vendor A"), { target: { value: "7" } });
    // Not yet: typing "10" must not save a 1 first.
    expect(option("o-a").scores).toEqual({ "c-cost": 6 });
    fireEvent.blur(cell("Speed", "Vendor A"));
    expect(option("o-a").scores).toEqual({ "c-cost": 6, "c-speed": 7 });
  });

  it("refuses a score outside 1–10 and says why", () => {
    renderPage();
    score("Speed", "Vendor A", "15");

    expect(option("o-a").scores).toEqual({ "c-cost": 6 });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Scores run from 1 to 10. 15 for Speed on Vendor A wasn't saved."
    );

    score("Speed", "Vendor A", "0");
    expect(option("o-a").scores).toEqual({ "c-cost": 6 });

    score("Speed", "Vendor A", "9");
    expect(option("o-a").scores).toEqual({ "c-cost": 6, "c-speed": 9 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a cleared cell as not scored rather than saving 0", () => {
    renderPage();
    expect(screen.getByText("1 not scored")).toBeInTheDocument();

    score("Cost", "Vendor A", "");

    expect(option("o-a").scores).toEqual({});
    expect("c-cost" in option("o-a").scores).toBe(false);
    expect(cell("Cost", "Vendor A")).toHaveValue("");
    expect(screen.getByText("2 not scored")).toBeInTheDocument();
  });
});
