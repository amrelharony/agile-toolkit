import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StaceyItem } from "@/lib/stores/workspace-types";

/**
 * Stacey Matrix: plotting an item (0–1 parsing + clamping), the region
 * classification, the scatter data handed to the chart, the region lists,
 * removal, the emitted signal and the CSV export.
 */

type Csv = { headers: string[]; rows: unknown[][] };
type Point = { title: string; x: number; y: number; region?: string };
const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const chart = vi.hoisted(() => ({ data: undefined as Point[] | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/signals/signal-bus", () => ({ emitSignal: signals.emit }));
// The scatter chart is loaded through next/dynamic; capture the points it gets.
vi.mock("next/dynamic", () => ({
  default: () =>
    function StaceyScatterChart({ data }: { data: Point[] }) {
      chart.data = data;
      return <div data-testid="stacey-chart" />;
    },
}));

import { StaceyMatrixClient } from "@/app/(tools)/stacey-matrix/stacey-matrix-client";
import { STACEY_ACTIONS } from "@/lib/history/event-actions";

const REGIONS = ["simple", "complicated", "complex", "chaotic"] as const;

const staceyItem = (
  id: string,
  title: string,
  agreement: number,
  certainty: number,
  region: StaceyItem["region"]
): StaceyItem => ({
  id,
  title,
  agreement,
  certainty,
  region,
  loggedAt: "2026-10-01T09:00:00.000Z",
});

const stored = () => useWorkspaceStore.getState().staceyItems ?? [];

const AGREEMENT = "Agreement (0–1)";
const CERTAINTY = "Certainty (0–1)";

function plot(title: string, agreement?: string, certainty?: string) {
  fireEvent.change(screen.getByLabelText("Item or problem"), { target: { value: title } });
  if (agreement !== undefined)
    fireEvent.change(screen.getByLabelText(AGREEMENT), { target: { value: agreement } });
  if (certainty !== undefined)
    fireEvent.change(screen.getByLabelText(CERTAINTY), { target: { value: certainty } });
  fireEvent.click(screen.getByRole("button", { name: "Plot" }));
}

/** The region panel ("simple", "complex", …) below the chart. */
function panel(region: string): HTMLElement {
  const heading = screen.getAllByText(region).find((e) => e.className.includes("uppercase"));
  if (!heading) throw new Error(`no panel for ${region}`);
  return heading.parentElement!.parentElement!;
}
const panelCount = (region: string) =>
  within(panel(region)).getByText(/^\d+$/, { selector: "span.text-xs" }).textContent;

beforeEach(() => {
  exported.csv = undefined;
  chart.data = undefined;
  history.log.mockClear();
  signals.emit.mockClear();
  useWorkspaceStore.setState({ staceyItems: [], whiteboardObjects: [] });
});

describe("Stacey — empty state and validation", () => {
  it("shows the form with 0.5 defaults and no chart or region panels", () => {
    render(<StaceyMatrixClient />);
    expect(screen.getByLabelText(AGREEMENT)).toHaveValue(0.5);
    expect(screen.getByLabelText(CERTAINTY)).toHaveValue(0.5);
    expect(screen.queryByTestId("stacey-chart")).not.toBeInTheDocument();
    expect(screen.queryByText("simple")).not.toBeInTheDocument();
  });

  it("ignores Plot with a blank or whitespace-only title", () => {
    render(<StaceyMatrixClient />);
    plot("");
    plot("   ", "0.9", "0.9");
    expect(stored()).toEqual([]);
    expect(signals.emit).not.toHaveBeenCalled();
  });
});

describe("Stacey — plotting and region classification", () => {
  it("plots a trimmed item at the defaults as complex and resets the form", () => {
    render(<StaceyMatrixClient />);
    plot("  New billing system  ", "0.8", "0.9");
    plot("Default point");

    expect(stored()).toHaveLength(2);
    expect(stored()[0]).toMatchObject({
      title: "New billing system",
      agreement: 0.8,
      certainty: 0.9,
      region: "simple",
    });
    expect(stored()[1]).toMatchObject({ agreement: 0.5, certainty: 0.5, region: "complex" });
    expect(screen.getByLabelText("Item or problem")).toHaveValue("");
    expect(screen.getByLabelText(AGREEMENT)).toHaveValue(0.5);
    expect(screen.getByLabelText(CERTAINTY)).toHaveValue(0.5);
    expect(history.log).toHaveBeenCalledWith(STACEY_ACTIONS.ITEM_ADDED, {
      title: "New billing system",
      region: "simple",
    });
  });

  it.each([
    // [agreement, certainty, region]
    ["0.9", "0.9", "simple"],
    ["0.66", "0.66", "simple"],
    ["1", "1", "simple"],
    // 0 is a valid end of the scale, not a reason to fall back to 0.5.
    ["0", "0", "chaotic"],
    ["0.33", "0.33", "chaotic"],
    ["0.1", "0.3", "chaotic"],
    ["0.8", "0.1", "complicated"],
    ["0.1", "0.8", "complicated"],
    ["1", "0", "complicated"],
    // Mid + high is complex, not complicated (BUG-T8-stacey-matrix-1).
    ["0.5", "0.7", "complex"],
    ["0.7", "0.5", "complex"],
    ["0.2", "0.5", "complex"],
    ["0.5", "0.5", "complex"],
  ])("agreement %s, certainty %s is %s", (a, c, region) => {
    render(<StaceyMatrixClient />);
    plot("Item", a, c);
    expect(stored()[0]).toMatchObject({ agreement: Number(a), certainty: Number(c), region });
  });

  it("clamps out-of-range values into 0–1", () => {
    render(<StaceyMatrixClient />);
    plot("Out of range", "1.5", "-0.2");
    expect(stored()[0]).toMatchObject({ agreement: 1, certainty: 0, region: "complicated" });
  });

  it("falls back to 0.5 for a blank field", () => {
    render(<StaceyMatrixClient />);
    plot("Blank axes", "", "");
    expect(stored()[0]).toMatchObject({ agreement: 0.5, certainty: 0.5, region: "complex" });
  });

  it("emits a classification signal with the plotted item", () => {
    render(<StaceyMatrixClient />);
    plot("Incident", "0", "0.1");
    const it0 = stored()[0];
    expect(signals.emit).toHaveBeenCalledWith({
      kind: "decision.staceyClassified",
      at: it0.loggedAt,
      toolId: "stacey-matrix",
      payload: it0,
    });
  });
});

describe("Stacey — chart and region panels", () => {
  const seed = () =>
    useWorkspaceStore.setState({
      staceyItems: [
        staceyItem("s1", "Payroll run", 0.9, 0.95, "simple"),
        staceyItem("s2", "Data migration", 0.8, 0.1, "complicated"),
        staceyItem("s3", "New market", 0.5, 0.5, "complex"),
        staceyItem("s4", "Outage", 0.05, 0.1, "chaotic"),
      ],
    });

  it("hands the chart certainty on x and agreement on y", () => {
    seed();
    render(<StaceyMatrixClient />);
    expect(screen.getByTestId("stacey-chart")).toBeInTheDocument();
    expect(chart.data).toEqual([
      { title: "Payroll run", x: 0.95, y: 0.9, region: "simple" },
      { title: "Data migration", x: 0.1, y: 0.8, region: "complicated" },
      { title: "New market", x: 0.5, y: 0.5, region: "complex" },
      { title: "Outage", x: 0.1, y: 0.05, region: "chaotic" },
    ]);
  });

  it("lists each item under its region with its coordinates", () => {
    seed();
    render(<StaceyMatrixClient />);
    for (const r of REGIONS) expect(panelCount(r)).toBe("1");
    const complicated = panel("complicated");
    expect(within(complicated).getByText("Data migration")).toBeInTheDocument();
    expect(within(complicated).getByText("a0.80 c0.10")).toBeInTheDocument();
    expect(within(panel("chaotic")).getByText("a0.05 c0.10")).toBeInTheDocument();
  });

  it("files an item with a missing or out-of-schema region under complex", () => {
    useWorkspaceStore.setState({
      staceyItems: [
        staceyItem("s1", "No region", 0.5, 0.5, undefined),
        staceyItem("s2", "Legacy region", 0.5, 0.5, "unknown" as StaceyItem["region"]),
      ],
    });
    render(<StaceyMatrixClient />);
    expect(panelCount("complex")).toBe("2");
    expect(within(panel("complex")).getByText("No region")).toBeInTheDocument();
    expect(within(panel("complex")).getByText("Legacy region")).toBeInTheDocument();
  });

  it("removes only the clicked item", () => {
    seed();
    render(<StaceyMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Data migration" }));
    expect(stored().map((x) => x.id)).toEqual(["s1", "s3", "s4"]);
    expect(panelCount("complicated")).toBe("0");
    expect(chart.data).toHaveLength(3);
    expect(history.log).toHaveBeenCalledWith(STACEY_ACTIONS.ITEM_REMOVED, { id: "s2" });
  });

  it("hides the chart and panels once the last item is removed", () => {
    useWorkspaceStore.setState({ staceyItems: [staceyItem("s1", "Only", 0.5, 0.5, "complex")] });
    render(<StaceyMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Only" }));
    expect(screen.queryByTestId("stacey-chart")).not.toBeInTheDocument();
    expect(screen.queryByText("complex")).not.toBeInTheDocument();
  });

  it("exports title, axes and region to CSV", () => {
    seed();
    useWorkspaceStore.setState({
      staceyItems: [...stored(), staceyItem("s5", "No region", 0.4, 0.4, undefined)],
    });
    render(<StaceyMatrixClient />);
    expect(exported.csv?.headers).toEqual(["Title", "Agreement", "Certainty", "Region"]);
    expect(exported.csv?.rows).toEqual([
      ["Payroll run", 0.9, 0.95, "simple"],
      ["Data migration", 0.8, 0.1, "complicated"],
      ["New market", 0.5, 0.5, "complex"],
      ["Outage", 0.05, 0.1, "chaotic"],
      ["No region", 0.4, 0.4, ""],
    ]);
  });
});
