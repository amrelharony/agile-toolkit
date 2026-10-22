import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SpaceScore } from "@/lib/stores/workspace-types";

/**
 * SPACE Pulse: logging a quarterly pulse (sliders, quarter canonicalisation,
 * same-quarter replacement, format warning), the latest-vs-prior KPI trend,
 * the radar data, the pulses table, removal and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const toasts = vi.hoisted(() => ({ warning: [] as string[] }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(() => "t", {
    success: () => "t",
    error: () => "t",
    info: () => "t",
    warning: (m: string) => {
      toasts.warning.push(m);
      return "t";
    },
  }),
}));
// Every next/dynamic component (the radar and ChartCard's ResponsiveContainer)
// becomes a placeholder that exposes its props, so the chart data can be read.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dynamic({ children, ...props }: { children?: ReactNode }) {
      return (
        <div data-testid="dynamic" data-props={JSON.stringify(props)}>
          {children}
        </div>
      );
    },
}));
// Radix Slider measures its thumb with a ResizeObserver; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { SpacePulseClient } from "@/app/(tools)/space-pulse/space-pulse-client";

const SP_ID = "spacePulse:current";
const DIMS = ["Satisfaction", "Performance", "Activity", "Communication", "Efficiency"];

const score = (id: string, quarter: string, v: number[], description?: string): SpaceScore => ({
  id,
  quarter,
  satisfaction: v[0],
  performance: v[1],
  activity: v[2],
  communication: v[3],
  efficiency: v[4],
  description,
});

const seed = (scores: SpaceScore[]) =>
  useWorkspaceStore.setState({ spacePulses: [{ id: SP_ID, scores }] });

const stored = () =>
  (useWorkspaceStore.getState().spacePulses ?? []).find((d) => d.id === SP_ID)?.scores ?? [];

/** The KPI card (outer Card element) for a dimension. */
const kpiCard = (label: string) =>
  screen.getAllByText(label).find((e) => e.classList.contains("truncate"))!.parentElement!
    .parentElement!.parentElement!;
const kpi = (label: string) => kpiCard(label).textContent;

const radarData = () =>
  screen
    .getAllByTestId("dynamic")
    .map((e) => JSON.parse(e.dataset.props!) as { data?: { subject: string; value: number }[] })
    .find((p) => p.data)!.data!;

const setQuarter = (v: string) =>
  fireEvent.change(screen.getByLabelText("Quarter"), { target: { value: v } });
const addPulse = () => fireEvent.click(screen.getByRole("button", { name: "Add pulse" }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0));
  exported.csv = undefined;
  toasts.warning = [];
  useWorkspaceStore.setState({ spacePulses: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SPACE Pulse: empty state", () => {
  it("shows placeholder KPIs, a zeroed radar and no pulses table", () => {
    render(<SpacePulseClient />);
    for (const d of DIMS) expect(kpi(d)).toBe(`${d}—No data`);
    expect(screen.getByText("Radar")).toBeInTheDocument();
    expect(radarData()).toEqual(DIMS.map((subject) => ({ subject, value: 0, fullMark: 5 })));
    expect(screen.queryByText("Pulses")).toBeNull();
    expect(exported.csv?.rows).toEqual([]);
  });

  it("defaults the quarter to the current one and every slider to 3", () => {
    render(<SpacePulseClient />);
    expect(screen.getByLabelText("Quarter")).toHaveValue("2026-Q4");
    for (const d of DIMS) {
      const thumb = screen.getByRole("slider", { name: d });
      expect(thumb).toHaveAttribute("aria-valuenow", "3");
      expect(thumb).toHaveAttribute("aria-valuetext", "3 of 5");
    }
  });
});

describe("SPACE Pulse: logging a pulse", () => {
  it("adds the default pulse for the current quarter", () => {
    render(<SpacePulseClient />);
    addPulse();
    expect(stored()).toEqual([
      {
        id: expect.any(String),
        quarter: "2026-Q4",
        satisfaction: 3,
        performance: 3,
        activity: 3,
        communication: 3,
        efficiency: 3,
        description: undefined,
      },
    ]);
    expect(kpi("Satisfaction")).toBe("Satisfaction3First pulse");
    expect(screen.getByText("Radar — 2026-Q4")).toBeInTheDocument();
    expect(screen.getByText("Pulses")).toBeInTheDocument();
    expect(toasts.warning).toEqual([]);
  });

  it("records slider values and a trimmed description, then resets the draft", () => {
    render(<SpacePulseClient />);
    setQuarter("2026-Q1");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Satisfaction" }), { key: "End" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Activity" }), { key: "Home" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Efficiency" }), { key: "ArrowRight" });
    expect(screen.getByRole("slider", { name: "Satisfaction" })).toHaveAttribute(
      "aria-valuetext",
      "5 of 5"
    );
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "  After the re-org  " },
    });
    addPulse();

    expect(stored()[0]).toMatchObject({
      quarter: "2026-Q1",
      satisfaction: 5,
      performance: 3,
      activity: 1,
      communication: 3,
      efficiency: 4,
      description: "After the re-org",
    });
    expect(screen.getByLabelText("Quarter")).toHaveValue("2026-Q4");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
    expect(screen.getByRole("slider", { name: "Satisfaction" })).toHaveAttribute(
      "aria-valuenow",
      "3"
    );
  });

  it("stores a whitespace-only description as undefined", () => {
    render(<SpacePulseClient />);
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "  \n " },
    });
    addPulse();
    expect(stored()[0].description).toBeUndefined();
  });

  it("canonicalises a lower-case quarter without warning", () => {
    render(<SpacePulseClient />);
    setQuarter(" 2026-q1 ");
    addPulse();
    expect(stored()[0].quarter).toBe("2026-Q1");
    expect(toasts.warning).toEqual([]);
  });

  it("replaces the entry for a quarter that already has one", () => {
    seed([score("old", "2026-Q1", [1, 1, 1, 1, 1]), score("keep", "2026-Q2", [2, 2, 2, 2, 2])]);
    render(<SpacePulseClient />);
    setQuarter("2026-q1");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Satisfaction" }), { key: "End" });
    addPulse();

    expect(stored()).toHaveLength(2);
    expect(stored().map((s) => s.quarter)).toEqual(["2026-Q1", "2026-Q2"]);
    expect(stored()[0].id).not.toBe("old");
    expect(stored()[0].satisfaction).toBe(5);
    expect(stored()[1].id).toBe("keep");
    expect(toasts.warning).toEqual(["Replaced existing entry for 2026-Q1"]);
  });

  it("warns about a malformed quarter but still records it", () => {
    render(<SpacePulseClient />);
    setQuarter("Q1 2026");
    addPulse();
    expect(stored().map((s) => s.quarter)).toEqual(["Q1 2026"]);
    expect(toasts.warning).toHaveLength(1);
    expect(toasts.warning[0]).toMatch(/YYYY-Q1\.\.Q4/);
  });

  it("ignores a blank quarter", () => {
    render(<SpacePulseClient />);
    setQuarter("   ");
    addPulse();
    expect(stored()).toEqual([]);
    expect(toasts.warning).toEqual([]);
  });
});

describe("SPACE Pulse: latest vs prior", () => {
  // Inserted newest-first: the trend must follow quarters, not insertion order.
  const seedTwo = () =>
    seed([
      score("q2", "2026-Q2", [4, 3, 2, 5, 3], "Second"),
      score("q1", "2025-Q4", [3, 3, 4, 5, 1], "First"),
    ]);

  it("compares the chronologically latest pulse with the one before it", () => {
    seedTwo();
    render(<SpacePulseClient />);
    expect(kpi("Satisfaction")).toBe("Satisfaction4+1 vs prior");
    expect(kpi("Performance")).toBe("Performance3No change");
    expect(kpi("Activity")).toBe("Activity2-2 vs prior");
    expect(kpi("Communication")).toBe("Communication5No change");
    expect(kpi("Efficiency")).toBe("Efficiency3+2 vs prior");
    expect(screen.getByText("Radar — 2026-Q2")).toBeInTheDocument();
    expect(radarData().map((d) => d.value)).toEqual([4, 3, 2, 5, 3]);
  });

  it("tones a KPI by its absolute value", () => {
    seedTwo();
    render(<SpacePulseClient />);
    expect(kpiCard("Satisfaction").className).toContain("border-success/40"); // 4
    expect(kpiCard("Activity").className).toContain("border-destructive/40"); // 2
    expect(kpiCard("Performance").className).toContain("border-border"); // 3
  });

  it("lists pulses newest first and exports them oldest first", () => {
    seedTwo();
    render(<SpacePulseClient />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector("td")!.textContent)).toEqual(["2026-Q2", "2025-Q4"]);
    expect(rows[0]).toHaveTextContent("Second");
    expect(exported.csv?.headers).toEqual([
      "Quarter",
      "Satisfaction",
      "Performance",
      "Activity",
      "Communication",
      "Efficiency",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["2025-Q4", 3, 3, 4, 5, 1, "First"],
      ["2026-Q2", 4, 3, 2, 5, 3, "Second"],
    ]);
  });

  it("removes exactly the clicked pulse", () => {
    seedTwo();
    render(<SpacePulseClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove pulse for 2026-Q2" }));
    expect(stored().map((s) => s.id)).toEqual(["q1"]);
    expect(kpi("Satisfaction")).toBe("Satisfaction3First pulse");
    expect(screen.getByText("Radar — 2025-Q4")).toBeInTheDocument();
  });

  it("shows a dash for a pulse without a description", () => {
    seed([score("q1", "2026-Q1", [3, 3, 3, 3, 3])]);
    render(<SpacePulseClient />);
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("—");
    expect(exported.csv?.rows).toEqual([["2026-Q1", 3, 3, 3, 3, 3, ""]]);
  });
});
