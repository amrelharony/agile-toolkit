import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { A11yIssue } from "@/lib/stores/workspace-types";
import { A11Y_ACTIONS } from "@/lib/history/event-actions";

/**
 * Accessibility Audit Tracker: KPIs (open, critical/serious, avg age,
 * components), the per-component rollup, the add form (disabled until both
 * required fields are filled), open-first row order, status changes that
 * preserve resolvedAt, remove, the chart series + weekly analytics, the
 * chart component itself, and the CSV export. "Today" is 18 Oct 2026.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
interface ChartRow {
  date: string;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  total: number;
}
interface ChartProps {
  data: ChartRow[];
  control: { centerLine: number; ucl: number; lcl: number } | null;
  changepoints: { x: string }[];
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const recharts = vi.hoisted(() => ({
  lines: [] as { dataKey: string; stroke: string; name: string }[],
  refs: [] as { y: number; label: { value: string } }[],
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: CsvData }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
// Every next/dynamic component (the chart and ChartCard's ResponsiveContainer)
// becomes a placeholder that exposes its props, so chart data can be read.
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
// The chart module is rendered directly in its own test below; record what
// it hands to recharts instead of drawing SVG.
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    LineChart: Box,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    Line: (p: { dataKey: string; stroke: string; name: string }) => {
      recharts.lines.push({ dataKey: p.dataKey, stroke: p.stroke, name: p.name });
      return null;
    },
    ReferenceLine: (p: { y: number; label: { value: string } }) => {
      recharts.refs.push({ y: p.y, label: p.label });
      return null;
    },
  };
});
vi.mock("@/components/charts/causal-annotation", () => ({
  CausalLine: ({ annotation }: { annotation: { x: string } }) => (
    <span data-testid="causal">{annotation.x}</span>
  ),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { A11yTrackerClient } from "@/app/(tools)/a11y-tracker/a11y-tracker-client";
import { A11yOpenIssuesChart } from "@/app/(tools)/a11y-tracker/charts";

const AT_ID = "a11yTracker:current";
const TODAY = "2026-10-18";

const issue = (id: string, over: Partial<A11yIssue> = {}): A11yIssue => ({
  id,
  component: `Comp-${id}`,
  wcagCriterion: "1.4.3",
  severity: "serious",
  status: "open",
  openedAt: TODAY,
  ...over,
});

const seed = (issues: A11yIssue[]) =>
  useWorkspaceStore.setState({ a11yTrackers: [{ id: AT_ID, issues }] });

const issues = () =>
  (useWorkspaceStore.getState().a11yTrackers ?? []).find((d) => d.id === AT_ID)?.issues ?? [];

function kpi(label: string): string | null | undefined {
  const el = screen
    .queryAllByText(label)
    .find((e) => e.parentElement?.className.includes("uppercase"));
  return el?.parentElement?.nextElementSibling?.textContent;
}

function chartProps(): ChartProps | undefined {
  const el = screen
    .queryAllByTestId("dynamic")
    .find((e) => "data" in JSON.parse(e.getAttribute("data-props") ?? "{}"));
  return el ? JSON.parse(el.getAttribute("data-props")!) : undefined;
}

function chooseOption(combobox: HTMLElement, option: string) {
  fireEvent.pointerDown(combobox, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

const addButton = () => screen.getByRole("button", { name: /Add issue/ });
const rowCriteria = () =>
  screen.getAllByText(/^WCAG \d/).map((e) => e.textContent!.replace("WCAG ", ""));
const rollup = () => {
  const card = screen.getByText("Per-component coverage").closest(".rounded-xl")!;
  return within(card as HTMLElement)
    .getAllByRole("listitem")
    .map((li) => li.textContent);
};

const mixed = () => [
  issue("1", {
    component: "Header",
    wcagCriterion: "1.4.3",
    severity: "critical",
    openedAt: "2026-10-08",
  }),
  issue("2", {
    component: "Header",
    wcagCriterion: "2.1.1",
    severity: "minor",
    status: "in_progress",
    openedAt: "2026-10-16",
  }),
  issue("3", {
    component: "Modal",
    wcagCriterion: "2.4.3",
    severity: "serious",
    openedAt: "2026-10-12",
  }),
  issue("4", {
    component: "Footer",
    wcagCriterion: "1.1.1",
    severity: "moderate",
    status: "resolved",
    openedAt: "2026-09-01",
    resolvedAt: "2026-09-10",
  }),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0));
  exported.csv = undefined;
  history.log.mockClear();
  recharts.lines = [];
  recharts.refs = [];
  useWorkspaceStore.setState({ a11yTrackers: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("A11y tracker: empty state", () => {
  it("shows zeroed KPIs, no chart or rollup, and a disabled Add", () => {
    render(<A11yTrackerClient />);
    expect(kpi("Open issues")).toBe("0");
    expect(kpi("Critical / Serious")).toBe("0");
    expect(kpi("Avg age")).toBe("0.0d");
    expect(kpi("Components affected")).toBe("0");
    expect(chartProps()).toBeUndefined();
    expect(screen.queryByText("Per-component coverage")).not.toBeInTheDocument();
    expect(screen.getByText(/No accessibility issues logged/)).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });
});

describe("A11y tracker: KPIs, rollup and rows", () => {
  it("derives the KPIs from unresolved issues only", () => {
    seed(mixed());
    render(<A11yTrackerClient />);
    expect(kpi("Open issues")).toBe("3");
    expect(kpi("Critical / Serious")).toBe("2");
    expect(kpi("Avg age")).toBe("6.0d"); // (10 + 2 + 6) / 3
    expect(kpi("Components affected")).toBe("2"); // Footer is resolved
  });

  it("rolls up open issues per component, worst severity first, then by count", () => {
    seed([
      issue("a", { component: "Card", severity: "minor" }),
      issue("b", { component: "Nav", severity: "serious" }),
      issue("c", { component: "Card", severity: "minor" }),
      issue("d", { component: "Form", severity: "serious" }),
      issue("e", { component: "Form", severity: "moderate" }),
      issue("f", { component: "Card", severity: "minor" }),
      issue("g", { component: "Old", severity: "critical", status: "resolved", resolvedAt: TODAY }),
    ]);
    render(<A11yTrackerClient />);
    expect(rollup()).toEqual([
      "Form2 openworst: serious",
      "Nav1 openworst: serious",
      "Card3 openworst: minor",
    ]);
  });

  it("lists open issues first, most severe first, resolved last", () => {
    seed(mixed());
    render(<A11yTrackerClient />);
    expect(rowCriteria()).toEqual(["1.4.3", "2.4.3", "2.1.1", "1.1.1"]);
    expect(issues().map((i) => i.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("shows each issue's age, frozen at the resolution date once resolved", () => {
    seed(mixed());
    render(<A11yTrackerClient />);
    const ageOf = (wcag: string) =>
      within(screen.getByText(`WCAG ${wcag}`).parentElement!).getByText(/^\d+d$/).textContent;
    expect(ageOf("1.4.3")).toBe("10d");
    expect(ageOf("1.1.1")).toBe("9d");
  });

  it("ages a non-ISO or unparseable openedAt without NaN", () => {
    seed([
      issue("a", { wcagCriterion: "1.1.1", openedAt: "October 8, 2026" }),
      issue("b", { wcagCriterion: "2.2.2", openedAt: "garbage" }),
    ]);
    render(<A11yTrackerClient />);
    const ageOf = (wcag: string) =>
      within(screen.getByText(`WCAG ${wcag}`).parentElement!).getByText(/^\d+d$/).textContent;
    expect(ageOf("1.1.1")).toBe("10d");
    expect(ageOf("2.2.2")).toBe("0d");
    expect(kpi("Avg age")).toBe("5.0d");
  });
});

describe("A11y tracker: adding", () => {
  it("keeps Add disabled until component and criterion are both non-blank", () => {
    render(<A11yTrackerClient />);
    fireEvent.change(screen.getByLabelText("Component"), { target: { value: "Header" } });
    expect(addButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("WCAG criterion"), { target: { value: "   " } });
    expect(addButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("WCAG criterion"), { target: { value: "1.4.3" } });
    expect(addButton()).toBeEnabled();
  });

  it("adds a trimmed open issue at the top and resets the form", () => {
    seed([issue("old")]);
    render(<A11yTrackerClient />);
    fireEvent.change(screen.getByLabelText("Component"), { target: { value: "  Modal " } });
    fireEvent.change(screen.getByLabelText("WCAG criterion"), { target: { value: " 2.4.3 " } });
    chooseOption(screen.getByRole("combobox", { name: "Severity" }), "Critical");
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: " Focus escapes the dialog " },
    });
    fireEvent.click(addButton());

    const [added, old] = issues();
    expect(old.id).toBe("old");
    expect(added).toMatchObject({
      component: "Modal",
      wcagCriterion: "2.4.3",
      severity: "critical",
      status: "open",
      openedAt: TODAY,
      description: "Focus escapes the dialog",
    });
    expect(history.log).toHaveBeenCalledWith(A11Y_ACTIONS.ISSUE_ADDED, {
      issueId: added.id,
      component: "Modal",
      wcagCriterion: "2.4.3",
      severity: "critical",
      description: "Focus escapes the dialog",
    });
    expect(screen.getByLabelText("Component")).toHaveValue("");
    expect(screen.getByLabelText("WCAG criterion")).toHaveValue("");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Severity" })).toHaveTextContent("Serious");
    expect(addButton()).toBeDisabled();
  });

  it("leaves a blank description unset", () => {
    render(<A11yTrackerClient />);
    fireEvent.change(screen.getByLabelText("Component"), { target: { value: "Nav" } });
    fireEvent.change(screen.getByLabelText("WCAG criterion"), { target: { value: "2.1.1" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "   " },
    });
    fireEvent.click(addButton());
    expect(issues()[0].description).toBeUndefined();
    expect(issues()[0].severity).toBe("serious");
  });
});

describe("A11y tracker: status changes and removal", () => {
  it("keeps the first resolution date across a re-open and logs ages against it", () => {
    seed([issue("a", { component: "Header", wcagCriterion: "1.4.3", openedAt: "2026-10-01" })]);
    render(<A11yTrackerClient />);
    const status = () => screen.getByRole("combobox", { name: "Status for Header" });

    chooseOption(status(), "Resolved");
    expect(issues()[0]).toMatchObject({ status: "resolved", resolvedAt: TODAY });
    expect(history.log).toHaveBeenLastCalledWith(A11Y_ACTIONS.ISSUE_RESOLVED, {
      issueId: "a",
      component: "Header",
      wcagCriterion: "1.4.3",
      ageDays: 17,
    });
    expect(kpi("Open issues")).toBe("0");

    vi.setSystemTime(new Date(2026, 9, 20, 12, 0));
    chooseOption(status(), "Open");
    expect(issues()[0]).toMatchObject({ status: "open", resolvedAt: TODAY });
    expect(history.log).toHaveBeenLastCalledWith(A11Y_ACTIONS.ISSUE_UPDATED, {
      issueId: "a",
      fields: ["status"],
    });
    expect(screen.getByText("19d")).toBeInTheDocument();
    expect(kpi("Open issues")).toBe("1");
    const data = chartProps()!.data;
    expect(data[data.length - 1]).toMatchObject({ date: "2026-10-20", total: 1 });

    chooseOption(status(), "Resolved");
    expect(issues()[0].resolvedAt).toBe(TODAY);
    expect(screen.getByText("17d")).toBeInTheDocument();
    // Bug: the log measured age to today (19) while the stored resolvedAt kept 18 Oct (17).
    expect(history.log).toHaveBeenLastCalledWith(A11Y_ACTIONS.ISSUE_RESOLVED, {
      issueId: "a",
      component: "Header",
      wcagCriterion: "1.4.3",
      ageDays: 17,
    });
  });

  it("gives every remove button a distinct name and removes only that issue", () => {
    seed(mixed());
    render(<A11yTrackerClient />);
    // Bug: every row's button was just "Remove issue", so a screen reader could not tell them apart.
    const names = screen
      .getAllByRole("button", { name: /^Remove / })
      .map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Remove Header issue (WCAG 2.1.1)" }));
    expect(issues().map((i) => i.id)).toEqual(["1", "3", "4"]);
    expect(history.log).toHaveBeenCalledWith(A11Y_ACTIONS.ISSUE_REMOVED, {
      issueId: "2",
      component: "Header",
      wcagCriterion: "2.1.1",
    });
    expect(kpi("Open issues")).toBe("2");
  });
});

describe("A11y tracker: chart series", () => {
  it("counts open issues per severity on each event date", () => {
    seed(mixed());
    render(<A11yTrackerClient />);
    const data = chartProps()!.data;
    expect(data.map((d) => d.date)).toEqual([
      "2026-09-01",
      "2026-09-10",
      "2026-10-08",
      "2026-10-12",
      "2026-10-16",
      TODAY,
    ]);
    expect(data.map((d) => d.total)).toEqual([1, 0, 1, 2, 3, 3]);
    expect(data[5]).toMatchObject({ critical: 1, serious: 1, moderate: 0, minor: 1 });
  });

  it("pads a single-day series with a point a week earlier", () => {
    seed([issue("a")]);
    render(<A11yTrackerClient />);
    expect(chartProps()!.data).toEqual([
      { date: "2026-10-11", critical: 0, serious: 0, moderate: 0, minor: 0, total: 0 },
      { date: TODAY, critical: 0, serious: 1, moderate: 0, minor: 0, total: 1 },
    ]);
    expect(chartProps()!.control).toBeNull();
  });

  it("adds XmR limits, regime markers and a trend chip over ten climbing weeks", () => {
    const mondays = [
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
    ];
    seed(mondays.map((d, i) => issue(String(i), { openedAt: d })));
    render(<A11yTrackerClient />);
    const props = chartProps()!;
    expect(props.data.map((d) => d.total)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
    expect(props.control).not.toBeNull();
    expect(props.control!.lcl).toBeGreaterThanOrEqual(0);
    expect(props.control!.ucl).toBeGreaterThan(props.control!.centerLine);
    const dates = new Set(props.data.map((d) => d.date));
    for (const cp of props.changepoints) expect(dates.has(cp.x)).toBe(true);
    expect(screen.getByText("↗ trend")).toBeInTheDocument();
    expect(
      screen.getByText(/^Weekly open-issue trend up \(Mann-Kendall p=0\.\d{3}\)$/)
    ).toBeInTheDocument();
  });
});

describe("A11y tracker: chart component", () => {
  const colors = { critical: "#c", serious: "#s", moderate: "#m", minor: "#n" };

  it("draws one line per severity in its colour plus the total", () => {
    render(
      <A11yOpenIssuesChart data={[]} severityColor={colors} control={null} changepoints={[]} />
    );
    expect(recharts.lines.map((l) => [l.dataKey, l.stroke, l.name])).toEqual([
      ["critical", "#c", "Critical"],
      ["serious", "#s", "Serious"],
      ["moderate", "#m", "Moderate"],
      ["minor", "#n", "Minor"],
      ["total", expect.any(String), "Total open"],
    ]);
    expect(recharts.refs).toEqual([]);
    expect(screen.queryByTestId("causal")).not.toBeInTheDocument();
  });

  it("draws the XmR limits and one marker per changepoint", () => {
    render(
      <A11yOpenIssuesChart
        data={[]}
        severityColor={colors}
        control={{ centerLine: 4, ucl: 9, lcl: 0, type: "xmr" }}
        changepoints={[
          { x: "2026-09-07", label: "up", detail: "d", confidence: "strong" },
          { x: "2026-10-05", label: "down", detail: "d", confidence: "moderate" },
        ]}
      />
    );
    expect(recharts.refs.map((r) => [r.y, r.label.value])).toEqual([
      [4, "X̄"],
      [9, "UCL"],
      [0, "LCL"],
    ]);
    expect(screen.getAllByTestId("causal").map((e) => e.textContent)).toEqual([
      "2026-09-07",
      "2026-10-05",
    ]);
  });
});

describe("A11y tracker: export", () => {
  it("exports one row per issue with its age", () => {
    seed(mixed());
    render(<A11yTrackerClient />);
    expect(exported.csv?.headers).toEqual([
      "Component",
      "WCAG Criterion",
      "Severity",
      "Status",
      "Opened",
      "Resolved",
      "Age (d)",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["Header", "1.4.3", "critical", "open", "2026-10-08", "", 10, ""],
      ["Header", "2.1.1", "minor", "in_progress", "2026-10-16", "", 2, ""],
      ["Modal", "2.4.3", "serious", "open", "2026-10-12", "", 6, ""],
      ["Footer", "1.1.1", "moderate", "resolved", "2026-09-01", "2026-09-10", 9, ""],
    ]);
  });
});
