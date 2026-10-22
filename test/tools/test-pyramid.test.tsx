import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TestPyramid } from "@/lib/stores/workspace-types";
import { TEST_PYRAMID_ACTIONS } from "@/lib/history/event-actions";

/**
 * Test Pyramid Analyzer: count inputs (string draft, commit on blur/Enter),
 * percentages, inverted-pyramid alert, cost-of-quality, bar widths/colours,
 * the description draft and the CSV export.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({
  csv: undefined as CsvData | undefined,
  json: undefined as unknown,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData, jsonData }: { csvData?: CsvData; jsonData?: unknown }) => {
    exported.csv = csvData;
    exported.json = jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

import { TestPyramidClient } from "@/app/(tools)/test-pyramid/test-pyramid-client";

const TP_ID = "testPyramid:current";

function seed(p: Partial<Omit<TestPyramid, "id">>) {
  useWorkspaceStore.setState({
    testPyramids: [{ id: TP_ID, unit: 0, integration: 0, e2e: 0, ...p }],
  });
}

function doc(): TestPyramid | undefined {
  return (useWorkspaceStore.getState().testPyramids ?? []).find((d) => d.id === TP_ID);
}

function kpi(label: string): string {
  const el = screen.getByText(label, { selector: "span" });
  return el.parentElement!.nextElementSibling!.textContent ?? "";
}

function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

/** The bar fill element for a layer (it carries the aria-label). */
function bar(prefix: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${prefix}: `));
}

beforeEach(() => {
  useWorkspaceStore.setState({ testPyramids: [] });
  exported.csv = undefined;
  exported.json = undefined;
  history.log.mockClear();
});

describe("Test Pyramid — empty state", () => {
  it("renders zeros, no alert and a prompt to enter counts", () => {
    render(<TestPyramidClient />);
    expect(kpi("Total tests")).toBe("0");
    expect(kpi("% unit")).toBe("0%");
    expect(kpi("% e2e")).toBe("0%");
    expect(kpi("Cost-of-quality")).toBe("0");
    expect(screen.getByText("Enter counts above to render the pyramid.")).toBeInTheDocument();
    expect(screen.queryByText(/Inverted pyramid detected/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Unit tests")).toHaveValue("0");
  });

  it("exports a 0.0% total row (no NaN) when empty", () => {
    render(<TestPyramidClient />);
    expect(exported.csv?.rows).toEqual([
      ["Unit", 0, "0.0", 0],
      ["Integration", 0, "0.0", 0],
      ["E2E", 0, "0.0", 0],
      ["Total", 0, "0.0", 0],
    ]);
  });
});

describe("Test Pyramid — derived values", () => {
  it("computes total, percentages and the 1/5/25 cost of quality", () => {
    seed({ unit: 70, integration: 20, e2e: 10 });
    render(<TestPyramidClient />);
    expect(kpi("Total tests")).toBe("100");
    expect(kpi("% unit")).toBe("70%");
    expect(kpi("% e2e")).toBe("10%");
    // 70×1 + 20×5 + 10×25
    expect(kpi("Cost-of-quality")).toBe("420");
    expect(exported.csv?.rows).toEqual([
      ["Unit", 70, "70.0", 70],
      ["Integration", 20, "20.0", 100],
      ["E2E", 10, "10.0", 250],
      ["Total", 100, "100.0", 420],
    ]);
  });

  it("flags an inverted pyramid only when e2e strictly exceeds unit", () => {
    seed({ unit: 5, integration: 1, e2e: 5 });
    const { unmount } = render(<TestPyramidClient />);
    expect(screen.queryByText(/Inverted pyramid detected/)).not.toBeInTheDocument();
    unmount();
    seed({ unit: 5, integration: 1, e2e: 6 });
    render(<TestPyramidClient />);
    const alert = screen.getByText(/Inverted pyramid detected/).parentElement!;
    expect(alert).toHaveTextContent("e2e count (6) exceeds unit count (5)");
  });

  it("sizes bars relative to the largest layer and labels them", () => {
    seed({ unit: 40, integration: 20, e2e: 10 });
    render(<TestPyramidClient />);
    expect(bar("Unit")).toHaveStyle({ width: "100%" });
    expect(bar("Integration")).toHaveStyle({ width: "50%" });
    expect(bar("E2E")).toHaveStyle({ width: "25%" });
    expect(bar("E2E")).toHaveAttribute("aria-label", "E2E: 10 (14%)");
    expect(bar("Unit")).toHaveAttribute("aria-label", "Unit: 40 (57%)");
  });

  it("renders an empty layer at 0% width", () => {
    seed({ unit: 3, integration: 0, e2e: 0 });
    render(<TestPyramidClient />);
    expect(bar("Integration")).toHaveStyle({ width: "0%" });
    expect(bar("E2E")).toHaveAttribute("aria-label", "E2E: 0 (0%)");
  });

  it("colours a healthy pyramid green and an inverted e2e layer red", () => {
    const GREEN = /#34d399|rgb\(52, 211, 153\)/i;
    const AMBER = /#facc15|rgb\(250, 204, 21\)/i;
    const RED = /#ef4444|rgb\(239, 68, 68\)/i;
    const border = (layer: string) => bar(layer).style.borderRight;
    seed({ unit: 10, integration: 5, e2e: 1 });
    const { unmount } = render(<TestPyramidClient />);
    for (const layer of ["Unit", "Integration", "E2E"]) expect(border(layer)).toMatch(GREEN);
    unmount();
    // Integration above unit (a "diamond") is amber, inverted e2e is red.
    seed({ unit: 2, integration: 9, e2e: 4 });
    render(<TestPyramidClient />);
    expect(border("E2E")).toMatch(RED);
    expect(border("Integration")).toMatch(AMBER);
    expect(border("Unit")).toMatch(AMBER);
  });
});

describe("Test Pyramid — count inputs", () => {
  it("creates the doc on first commit and logs the changed field", () => {
    render(<TestPyramidClient />);
    commit(screen.getByLabelText("Unit tests"), "120");
    expect(doc()).toMatchObject({ unit: 120, integration: 0, e2e: 0 });
    expect(history.log).toHaveBeenCalledWith(TEST_PYRAMID_ACTIONS.COUNT_UPDATED, {
      fields: ["unit"],
    });
    expect(kpi("Total tests")).toBe("120");
  });

  it("rounds decimals and keeps the other layers", () => {
    seed({ unit: 10, integration: 4, e2e: 2 });
    render(<TestPyramidClient />);
    const field = screen.getByLabelText("Integration tests");
    commit(field, "2.6");
    expect(doc()).toMatchObject({ unit: 10, integration: 3, e2e: 2 });
    expect(field).toHaveValue("3");
  });

  it("reverts negative and non-numeric input without touching the store", () => {
    seed({ unit: 10, integration: 4, e2e: 2 });
    render(<TestPyramidClient />);
    const field = screen.getByLabelText("E2E tests");
    commit(field, "-3");
    expect(field).toHaveValue("2");
    commit(field, "abc");
    expect(field).toHaveValue("2");
    expect(doc()?.e2e).toBe(2);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("commits on Enter", () => {
    render(<TestPyramidClient />);
    const field = screen.getByLabelText("E2E tests");
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "7" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(doc()?.e2e).toBe(7);
  });

  it("re-syncs a field when the count changes upstream (e.g. an agent write)", () => {
    seed({ unit: 1 });
    render(<TestPyramidClient />);
    act(() => {
      useWorkspaceStore.getState().upsertTestPyramid({
        id: TP_ID,
        unit: 99,
        integration: 0,
        e2e: 0,
      });
    });
    expect(screen.getByLabelText("Unit tests")).toHaveValue("99");
    expect(kpi("Total tests")).toBe("99");
  });
});

describe("Test Pyramid — description", () => {
  it("keeps typed spaces and commits on blur; a blank description is stored as undefined", () => {
    seed({ unit: 1 });
    render(<TestPyramidClient />);
    const desc = screen.getByLabelText("Description (optional)");
    fireEvent.change(desc, { target: { value: "repo a b " } });
    expect(desc).toHaveValue("repo a b ");
    fireEvent.blur(desc);
    expect(doc()?.description).toBe("repo a b ");
    expect(doc()?.unit).toBe(1);
    commit(desc, "   ");
    expect(doc()?.description).toBeUndefined();
  });

  it("shows a description written elsewhere when the field is not focused", () => {
    seed({ unit: 1, description: "old" });
    render(<TestPyramidClient />);
    const desc = screen.getByLabelText("Description (optional)");
    expect(desc).toHaveValue("old");
    act(() => {
      useWorkspaceStore.getState().upsertTestPyramid({
        id: TP_ID,
        unit: 1,
        integration: 0,
        e2e: 0,
        description: "from agent",
      });
    });
    expect(desc).toHaveValue("from agent");
  });

  it("exports the counts and description as JSON", () => {
    seed({ unit: 3, integration: 2, e2e: 1, description: "snap" });
    render(<TestPyramidClient />);
    expect(exported.json).toEqual({ unit: 3, integration: 2, e2e: 1, description: "snap" });
  });
});
