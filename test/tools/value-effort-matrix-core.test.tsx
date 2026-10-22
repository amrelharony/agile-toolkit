import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * Value vs Effort gap-filling: clamping, the quadrant cut at 5, the four
 * quadrant lists and their counts, delete, the form reset, and rows written
 * by the MCP actions (snake_case quadrant keys) or without a quadrant.
 * "Both scores are required" lives in value-effort-matrix-fixes.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: unknown[][] },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: unknown[][] } }) => {
    exported.csv = csvData;
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

import { ValueEffortMatrixClient } from "@/app/(tools)/value-effort-matrix/value-effort-matrix-client";

const QUADRANTS = ["Quick Wins", "Big Bets", "Fill-Ins", "Time Wasters"] as const;

const item = (
  id: string,
  title: string,
  fields: Record<string, number | string>,
  framework: PrioritizationItem["framework"] = "value-effort"
): PrioritizationItem => ({
  id,
  framework,
  title,
  score: 0,
  fields,
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const rows = () =>
  (useWorkspaceStore.getState().prioritizations ?? []).filter(
    (r) => r.framework === "value-effort"
  );
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const plot = () => fireEvent.click(screen.getByRole("button", { name: "Plot" }));
function plotItem(title: string, value: string, effort: string) {
  type("Item title", title);
  type("Value (1-10)", value);
  type("Effort (1-10)", effort);
  plot();
}

/** The quadrant box headed `name`. */
const box = (name: string) =>
  screen.getByText(name, { selector: "span" }).closest<HTMLElement>("div.rounded")!;
const titlesIn = (name: string) =>
  within(box(name))
    .queryAllByRole("listitem")
    .map((li) => li.querySelector("span")!.textContent);
const countIn = (name: string) =>
  box(name).querySelector(".justify-between > span.text-xs")!.textContent;

beforeEach(() => {
  exported.csv = undefined;
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("Value vs Effort: plotting", () => {
  it("clamps into 1-10 and stores value − effort as the score", () => {
    render(<ValueEffortMatrixClient />);
    plotItem("Dark mode", "15", "0");
    expect(rows()[0]).toMatchObject({
      title: "Dark mode",
      score: 9,
      fields: { value: 10, effort: 1, quadrant: "Quick Wins" },
    });
  });

  it("puts an item exactly on 5 on the high side of each axis", () => {
    render(<ValueEffortMatrixClient />);
    plotItem("Both five", "5", "5");
    plotItem("Value five", "5", "4.9");
    plotItem("Effort five", "4.9", "5");
    plotItem("Neither", "4.9", "4.9");
    expect(titlesIn("Big Bets")).toEqual(["Both five"]);
    expect(titlesIn("Quick Wins")).toEqual(["Value five"]);
    expect(titlesIn("Time Wasters")).toEqual(["Effort five"]);
    expect(titlesIn("Fill-Ins")).toEqual(["Neither"]);
    for (const q of QUADRANTS) expect(countIn(q)).toBe("1");
  });

  it("trims the title and empties the form for the next item", () => {
    render(<ValueEffortMatrixClient />);
    plotItem("  Dark mode  ", "7", "2");
    expect(rows()[0].title).toBe("Dark mode");
    for (const label of ["Item title", "Value (1-10)", "Effort (1-10)"]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks only for a title when both scores are filled", () => {
    render(<ValueEffortMatrixClient />);
    plotItem("  ", "7", "2");
    expect(rows()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a title to plot this item.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("each run from 1 to 10");
    expect(screen.getByLabelText("Item title")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Value (1-10)")).not.toHaveAttribute("aria-invalid");
  });

  it("names every missing input when nothing is filled", () => {
    render(<ValueEffortMatrixClient />);
    plot();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a title, Value and Effort to plot this item. Value and Effort each run from 1 to 10."
    );
  });
});

describe("Value vs Effort: quadrant lists", () => {
  it("shows no matrix or lists while empty", () => {
    render(<ValueEffortMatrixClient />);
    expect(screen.queryByText("Quick Wins")).toBeNull();
    expect(screen.queryByText("Matrix")).toBeNull();
  });

  it("removes only the item whose Remove was clicked", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        item("a", "Dark mode", { value: 7, effort: 2, quadrant: "Quick Wins" }),
        item("b", "SSO", { value: 8, effort: 8, quadrant: "Big Bets" }),
        item("w", "WSJF row", { businessValue: 1 }, "wsjf"),
      ],
    });
    render(<ValueEffortMatrixClient />);
    expect(screen.queryByText("WSJF row")).toBeNull();
    expect(within(box("Quick Wins")).getByText("v7 e2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove SSO" }));
    expect(rows().map((r) => r.id)).toEqual(["a"]);
    expect(titlesIn("Big Bets")).toEqual([]);
    expect(countIn("Big Bets")).toBe("0");
    expect(titlesIn("Quick Wins")).toEqual(["Dark mode"]);
  });

  // Bug: rows saved by tool.value_effort_matrix.* carry "quick_wins"-style
  // keys; the lists looked up "Quick Wins" only, so those rows vanished.
  it("lists rows the MCP actions saved under their snake_case quadrant", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        item("m1", "Agent quick win", { value: 9, effort: 2, quadrant: "quick_wins" }),
        item("m2", "Agent big bet", { value: 9, effort: 9, quadrant: "big_bets" }),
        item("m3", "Agent fill-in", { value: 2, effort: 2, quadrant: "fill_ins" }),
        item("m4", "Agent time waster", { value: 2, effort: 9, quadrant: "time_wasters" }),
      ],
    });
    render(<ValueEffortMatrixClient />);
    expect(titlesIn("Quick Wins")).toEqual(["Agent quick win"]);
    expect(titlesIn("Big Bets")).toEqual(["Agent big bet"]);
    expect(titlesIn("Fill-Ins")).toEqual(["Agent fill-in"]);
    expect(titlesIn("Time Wasters")).toEqual(["Agent time waster"]);
    expect(exported.csv?.rows.map((r) => r[3])).toEqual([
      "Quick Wins",
      "Big Bets",
      "Fill-Ins",
      "Time Wasters",
    ]);
  });

  // Bug: a row without a quadrant always landed in Fill-Ins, whatever its inputs.
  it("places a row without a stored quadrant by its value and effort", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        item("x1", "Imported win", { value: 8, effort: 3 }),
        item("x2", "Imported bet", { value: "6", effort: "7" }),
      ],
    });
    render(<ValueEffortMatrixClient />);
    expect(titlesIn("Quick Wins")).toEqual(["Imported win"]);
    expect(titlesIn("Big Bets")).toEqual(["Imported bet"]);
    expect(titlesIn("Fill-Ins")).toEqual([]);
  });
});
