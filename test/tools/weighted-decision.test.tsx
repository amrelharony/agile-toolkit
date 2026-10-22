import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WeightedCriterion, WeightedOption } from "@/lib/stores/workspace-types";

/**
 * Weighted Decision Matrix: adding criteria (with weights) and options, the
 * weighted totals and ranking, removing criteria (cascading their scores) and
 * options, and the CSV export. Score-cell validation lives in
 * weighted-decision-fixes.test.tsx.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = p.csvData;
    return null;
  },
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

import { WeightedDecisionClient } from "@/app/(tools)/weighted-decision/weighted-decision-client";
import { generateWeightedPrompts } from "@/lib/ai-prompts/weighted-decision";

const criteria = () => useWorkspaceStore.getState().weightedCriteria ?? [];
const options = () => useWorkspaceStore.getState().weightedOptions ?? [];
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const addCriterion = (name: string, weight?: string) => {
  type("Criterion name", name);
  if (weight !== undefined) type("Criterion weight", weight);
  fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
};
const addOption = (name: string) => {
  type("Option name", name);
  fireEvent.click(screen.getByRole("button", { name: "Add option" }));
};
/** Matrix rows in display order: [option name, total]. */
const ranking = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((tr) => {
      const cells = within(tr).getAllByRole("cell");
      return [
        cells[0].textContent,
        cells[cells.length - 2].firstChild?.textContent ?? cells[cells.length - 2].textContent,
      ];
    });

const cost: WeightedCriterion = { id: "c-cost", name: "Cost", weight: 2 };
const speed: WeightedCriterion = { id: "c-speed", name: "Speed", weight: 1 };
const vendorA: WeightedOption = {
  id: "o-a",
  name: "Vendor A",
  scores: { "c-cost": 6, "c-speed": 9 },
};
const vendorB: WeightedOption = {
  id: "o-b",
  name: "Vendor B",
  scores: { "c-cost": 9, "c-speed": 2 },
};

beforeEach(() => {
  exported.csv = undefined;
  useWorkspaceStore.setState({ weightedCriteria: [], weightedOptions: [] });
});

describe("Weighted decision: empty state", () => {
  it("shows no matrix or chart until there are criteria and options", () => {
    render(<WeightedDecisionClient />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Total score")).toBeNull();
    expect(screen.queryByText(/Weights are relative/)).toBeNull();
  });

  it("an option without criteria shows the chart but no matrix", () => {
    useWorkspaceStore.setState({ weightedOptions: [vendorA] });
    render(<WeightedDecisionClient />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Total score")).toBeInTheDocument();
  });
});

describe("Weighted decision: criteria", () => {
  it("adds a trimmed criterion with its weight and resets the weight to 1", () => {
    render(<WeightedDecisionClient />);
    addCriterion("  Cost  ", "2.5");
    expect(criteria()).toEqual([expect.objectContaining({ name: "Cost", weight: 2.5 })]);
    expect(screen.getByLabelText("Criterion name")).toHaveValue("");
    expect(screen.getByLabelText("Criterion weight")).toHaveValue(1);
    expect(screen.getByText(/Weights are relative/)).toBeInTheDocument();
  });

  it("keeps an explicit weight of 0, floors negatives at 0 and defaults a blank weight to 1", () => {
    render(<WeightedDecisionClient />);
    addCriterion("Zero", "0");
    addCriterion("Negative", "-3");
    addCriterion("Blank", "");
    expect(criteria().map((c) => [c.name, c.weight])).toEqual([
      ["Zero", 0],
      ["Negative", 0],
      ["Blank", 1],
    ]);
  });

  it("does nothing without a name", () => {
    render(<WeightedDecisionClient />);
    addCriterion("   ", "3");
    expect(criteria()).toEqual([]);
    expect(screen.getByLabelText("Criterion weight")).toHaveValue(3);
  });

  it("shows each criterion's share of the total weight", () => {
    useWorkspaceStore.setState({ weightedCriteria: [cost, speed] });
    render(<WeightedDecisionClient />);
    expect(screen.getByText("w2 · 67%")).toBeInTheDocument();
    expect(screen.getByText("w1 · 33%")).toBeInTheDocument();
  });

  it("removing a criterion drops its scores from every option", () => {
    useWorkspaceStore.setState({
      weightedCriteria: [cost, speed],
      weightedOptions: [vendorA, vendorB],
    });
    render(<WeightedDecisionClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove criterion Cost" }));
    expect(criteria().map((c) => c.id)).toEqual(["c-speed"]);
    expect(options().map((o) => o.scores)).toEqual([{ "c-speed": 9 }, { "c-speed": 2 }]);
    expect(screen.getByText("w1 · 100%")).toBeInTheDocument();
    expect(ranking()).toEqual([
      ["Vendor A★(top option)", "9.00"],
      ["Vendor B", "2.00"],
    ]);
  });
});

describe("Weighted decision: options and totals", () => {
  it("adds a trimmed option with no scores", () => {
    render(<WeightedDecisionClient />);
    addOption("  Vendor C  ");
    expect(options()).toEqual([expect.objectContaining({ name: "Vendor C", scores: {} })]);
    expect(screen.getByLabelText("Option name")).toHaveValue("");
    addOption("   ");
    expect(options()).toHaveLength(1);
  });

  it("totals score × weight and ranks the best option first", () => {
    useWorkspaceStore.setState({
      weightedCriteria: [cost, speed],
      weightedOptions: [vendorB, vendorA],
    });
    render(<WeightedDecisionClient />);
    // A: 6×2 + 9×1 = 21; B: 9×2 + 2×1 = 20.
    expect(ranking()).toEqual([
      ["Vendor A★(top option)", "21.00"],
      ["Vendor B", "20.00"],
    ]);
    // The header shows each weight.
    const headers = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers.slice(0, 4)).toEqual(["Option", "Cost ×2", "Speed ×1", "Total"]);
    // Sorting for display leaves the stored order alone.
    expect(options().map((o) => o.id)).toEqual(["o-b", "o-a"]);
  });

  it("re-ranks as scores change, and counts unscored cells", () => {
    useWorkspaceStore.setState({
      weightedCriteria: [cost, speed],
      weightedOptions: [vendorA, { id: "o-c", name: "Vendor C", scores: {} }],
    });
    render(<WeightedDecisionClient />);
    expect(screen.getByText("2 not scored")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cost score for Vendor C"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Speed score for Vendor C"), {
      target: { value: "7.5" },
    });
    expect(options().find((o) => o.id === "o-c")?.scores).toEqual({ "c-cost": 10, "c-speed": 7.5 });
    expect(ranking()).toEqual([
      ["Vendor C★(top option)", "27.50"],
      ["Vendor A", "21.00"],
    ]);
    expect(screen.queryByText(/not scored/)).toBeNull();
  });

  it("weights of 0 zero every total and warn", () => {
    useWorkspaceStore.setState({
      weightedCriteria: [{ ...cost, weight: 0 }],
      weightedOptions: [vendorA],
    });
    render(<WeightedDecisionClient />);
    expect(ranking()[0][1]).toBe("0.00");
    expect(screen.getByText("w0 · 0%")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Every weight is 0");
  });

  it("removes exactly the clicked option", () => {
    useWorkspaceStore.setState({
      weightedCriteria: [cost, speed],
      weightedOptions: [vendorA, vendorB],
    });
    render(<WeightedDecisionClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove option Vendor A" }));
    expect(options().map((o) => o.id)).toEqual(["o-b"]);
    expect(ranking()).toEqual([["Vendor B★(top option)", "20.00"]]);
  });

  it("exports the ranked matrix with weights in the headers and blanks for unscored cells", () => {
    useWorkspaceStore.setState({
      weightedCriteria: [cost, speed],
      weightedOptions: [{ ...vendorB, scores: { "c-cost": 9 } }, vendorA],
    });
    render(<WeightedDecisionClient />);
    expect(exported.csv?.headers).toEqual(["Option", "Cost (w2)", "Speed (w1)", "Total"]);
    expect(exported.csv?.rows).toEqual([
      ["Vendor A", 6, 9, "21.00"],
      ["Vendor B", 9, "", "18.00"],
    ]);
  });
});

describe("Weighted decision: AI prompt", () => {
  it("has no prompt without both criteria and options", () => {
    expect(generateWeightedPrompts({ criteria: [cost], ranked: [] })).toEqual([]);
    expect(generateWeightedPrompts({ criteria: [], ranked: [{ ...vendorA, score: 0 }] })).toEqual(
      []
    );
  });

  it("puts the weighted matrix in the prompt", () => {
    const [prompt] = generateWeightedPrompts({
      criteria: [cost, speed],
      ranked: [{ ...vendorA, score: 21 }],
    });
    expect(prompt.prompt).toContain("| Option | Cost (w2) | Speed (w1) | Total |");
    expect(prompt.prompt).toContain("| Vendor A | 6 | 9 | 21.00 |");
  });

  // Bug: an unscored cell went to the AI as a 0 score (outside the 1–10
  // scale), while the page and the CSV both treat it as "not scored".
  it("marks an unscored cell as not scored instead of 0", () => {
    const [prompt] = generateWeightedPrompts({
      criteria: [cost, speed],
      ranked: [{ ...vendorB, scores: { "c-cost": 9 }, score: 18 }],
    });
    const line = prompt.prompt.split("\n").find((l) => l.startsWith("| Vendor B"));
    expect(line).toBe("| Vendor B | 9 | not scored | 18.00 |");
  });
});
