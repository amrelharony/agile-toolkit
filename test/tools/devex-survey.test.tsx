import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DevexResponse } from "@/lib/stores/workspace-types";

/**
 * DevEx Survey: logging a response (sliders, respondent / comment trimming,
 * date fallback), the per-metric averages and their tones, the score
 * distribution, the responses table, removal and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));

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
// Every next/dynamic component (the chart and ChartCard's ResponsiveContainer)
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

import { DevexSurveyClient } from "@/app/(tools)/devex-survey/devex-survey-client";

const DX_ID = "devexSurvey:current";
const TODAY = "2026-10-18";

type Row = { score: string; flow: number; feedback: number; cognitive: number };

const r = (
  id: string,
  date: string,
  [flowState, feedbackLoops, cognitiveLoad]: number[],
  extra: Partial<DevexResponse> = {}
): DevexResponse => ({
  id,
  respondent: "",
  date,
  flowState,
  feedbackLoops,
  cognitiveLoad,
  ...extra,
});

const seed = (responses: DevexResponse[]) =>
  useWorkspaceStore.setState({ devexSurveys: [{ id: DX_ID, responses }] });

const stored = () =>
  (useWorkspaceStore.getState().devexSurveys ?? []).find((d) => d.id === DX_ID)?.responses ?? [];

/** The KPI card (outer Card element) with this label. */
const kpiCard = (label: string) =>
  screen.getByText(label).parentElement!.parentElement!.parentElement!;
const kpi = (label: string) => kpiCard(label).textContent;

const distribution = () =>
  screen
    .getAllByTestId("dynamic")
    .map((e) => JSON.parse(e.dataset.props!) as { data?: Row[] })
    .find((p) => p.data)!.data!;

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Submit response" }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Just after local midnight: a UTC-derived "today" would be a day off east of UTC.
  vi.setSystemTime(new Date(2026, 9, 18, 0, 30));
  exported.csv = undefined;
  useWorkspaceStore.setState({ devexSurveys: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DevEx survey: empty state", () => {
  it("shows dashes, an all-zero distribution and no table", () => {
    render(<DevexSurveyClient />);
    expect(kpi("Flow state (avg)")).toBe("Flow state (avg)—0 response(s) — higher is better");
    expect(kpi("Feedback loops (avg)")).toBe("Feedback loops (avg)—Higher is better");
    expect(kpi("Cognitive load (avg)")).toBe("Cognitive load (avg)—Lower is better");
    expect(distribution()).toEqual(
      ["1", "2", "3", "4", "5"].map((score) => ({ score, flow: 0, feedback: 0, cognitive: 0 }))
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(exported.csv?.rows).toEqual([]);
  });

  it("defaults the date to the local today and the sliders to 3", () => {
    render(<DevexSurveyClient />);
    expect(screen.getByLabelText("Date")).toHaveValue(TODAY);
    for (const name of ["Flow state", "Feedback loops", "Cognitive load"]) {
      expect(screen.getByRole("slider", { name })).toHaveAttribute("aria-valuenow", "3");
    }
    expect(screen.getByRole("slider", { name: "Cognitive load" })).toHaveAccessibleDescription(
      "1 = low (good), 5 = overwhelming (bad)"
    );
  });
});

describe("DevEx survey: logging a response", () => {
  it("submits the default anonymous response for today", () => {
    render(<DevexSurveyClient />);
    submit();
    expect(stored()).toEqual([
      {
        id: expect.any(String),
        respondent: "",
        date: TODAY,
        flowState: 3,
        feedbackLoops: 3,
        cognitiveLoad: 3,
        comments: undefined,
      },
    ]);
    expect(kpi("Flow state (avg)")).toBe("Flow state (avg)3.001 response(s) — higher is better");
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("anon");
  });

  it("records slider values, trims the text fields and resets the form", () => {
    render(<DevexSurveyClient />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Flow state" }), { key: "End" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Feedback loops" }), { key: "Home" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Cognitive load" }), {
      key: "ArrowLeft",
    });
    fireEvent.change(screen.getByLabelText("Respondent (optional)"), {
      target: { value: "  Dev A  " },
    });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Comments (optional)"), {
      target: { value: "  CI is slow  " },
    });
    submit();

    expect(stored()[0]).toMatchObject({
      respondent: "Dev A",
      date: "2026-09-01",
      flowState: 5,
      feedbackLoops: 1,
      cognitiveLoad: 2,
      comments: "CI is slow",
    });
    expect(screen.getByLabelText("Respondent (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Date")).toHaveValue(TODAY);
    expect(screen.getByLabelText("Comments (optional)")).toHaveValue("");
    expect(screen.getByRole("slider", { name: "Flow state" })).toHaveAttribute(
      "aria-valuenow",
      "3"
    );
  });

  it("falls back to today when the date field was cleared", () => {
    render(<DevexSurveyClient />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    submit();
    expect(stored()[0].date).toBe(TODAY);
  });

  it("stores whitespace-only comments as undefined and caps long text", () => {
    render(<DevexSurveyClient />);
    fireEvent.change(screen.getByLabelText("Comments (optional)"), {
      target: { value: "   " },
    });
    submit();
    expect(stored()[0].comments).toBeUndefined();

    fireEvent.change(screen.getByLabelText("Respondent (optional)"), {
      target: { value: "x".repeat(200) },
    });
    fireEvent.change(screen.getByLabelText("Comments (optional)"), {
      target: { value: "y".repeat(5000) },
    });
    submit();
    expect(stored()[1].respondent).toHaveLength(120);
    expect(stored()[1].comments).toHaveLength(4000);
  });
});

describe("DevEx survey: seeded responses", () => {
  const seedThree = () =>
    seed([
      r("r1", "2026-10-02", [5, 4, 5], { comments: "Too many meetings" }),
      r("r2", "2026-09-15", [4, 5, 4], { respondent: "Ana" }),
      r("r3", "2026-10-10", [3, 3, 3], { respondent: "Ben" }),
    ]);

  it("averages each metric", () => {
    seedThree();
    render(<DevexSurveyClient />);
    expect(kpi("Flow state (avg)")).toBe("Flow state (avg)4.003 response(s) — higher is better");
    expect(kpi("Feedback loops (avg)")).toBe("Feedback loops (avg)4.00Higher is better");
    expect(kpi("Cognitive load (avg)")).toBe("Cognitive load (avg)4.00Lower is better");
  });

  it("tones flow / feedback high-is-good and cognitive load high-is-bad", () => {
    seedThree();
    const { unmount } = render(<DevexSurveyClient />);
    expect(kpiCard("Flow state (avg)").className).toContain("border-success/40");
    expect(kpiCard("Feedback loops (avg)").className).toContain("border-success/40");
    expect(kpiCard("Cognitive load (avg)").className).toContain("border-destructive/40");
    unmount();

    seed([r("r1", "2026-10-02", [1, 2, 1])]);
    render(<DevexSurveyClient />);
    expect(kpiCard("Flow state (avg)").className).toContain("border-destructive/40");
    expect(kpiCard("Feedback loops (avg)").className).toContain("border-destructive/40");
    expect(kpiCard("Cognitive load (avg)").className).toContain("border-success/40");
  });

  it("counts each score per metric in the distribution", () => {
    seedThree();
    render(<DevexSurveyClient />);
    expect(distribution()).toEqual([
      { score: "1", flow: 0, feedback: 0, cognitive: 0 },
      { score: "2", flow: 0, feedback: 0, cognitive: 0 },
      { score: "3", flow: 1, feedback: 1, cognitive: 1 },
      { score: "4", flow: 1, feedback: 1, cognitive: 1 },
      { score: "5", flow: 1, feedback: 1, cognitive: 1 },
    ]);
  });

  it("drops out-of-range scores from the distribution instead of clamping them", () => {
    seed([r("r1", "2026-10-02", [7, 0, 2.5]), r("r2", "2026-10-03", [5, 1, 2])]);
    render(<DevexSurveyClient />);
    const rows = distribution();
    expect(rows.find((x) => x.score === "5")!.flow).toBe(1);
    expect(rows.find((x) => x.score === "1")!.feedback).toBe(1);
    expect(rows.find((x) => x.score === "2")!.cognitive).toBe(1);
    expect(rows.reduce((a, x) => a + x.flow + x.feedback + x.cognitive, 0)).toBe(3);
  });

  it("lists responses newest first and exports them oldest first", () => {
    seedThree();
    render(<DevexSurveyClient />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => row.querySelector("td")!.textContent)).toEqual([
      "2026-10-10",
      "2026-10-02",
      "2026-09-15",
    ]);
    expect(rows[1]).toHaveTextContent("anon");
    expect(rows[1]).toHaveTextContent("Too many meetings");
    expect(rows[0]).toHaveTextContent("—");

    expect(exported.csv?.headers).toEqual([
      "Date",
      "Respondent",
      "Flow",
      "Feedback Loops",
      "Cognitive Load",
      "Comments",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["2026-09-15", "Ana", 4, 5, 4, ""],
      ["2026-10-02", "anonymous", 5, 4, 5, "Too many meetings"],
      ["2026-10-10", "Ben", 3, 3, 3, ""],
    ]);
  });

  it("removes exactly the clicked response", () => {
    seedThree();
    render(<DevexSurveyClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove response from 2026-10-02" }));
    expect(stored().map((x) => x.id)).toEqual(["r2", "r3"]);
    expect(kpi("Flow state (avg)")).toBe("Flow state (avg)3.502 response(s) — higher is better");
  });
});
