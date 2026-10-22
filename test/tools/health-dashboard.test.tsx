import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  HealthCheck,
  HealthDimensionScore,
  Impediment,
  Sprint,
  StandupEntry,
} from "@/lib/stores/workspace-types";

/**
 * Health dashboard: the traffic-light thresholds, the cycle-time
 * localStorage extractor, edge cases of the synced KPI functions, the KPI
 * card and its indicators, and the client (empty and seeded workspace,
 * overall score, data sources, executive summary, copy and refresh).
 */

const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/insights-engine", () => ({
  InsightsEngine: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

import { HealthDashboardClient } from "@/app/(tools)/health-dashboard/health-dashboard-client";
import { extractCycleTimeKPIs } from "@/app/(tools)/health-dashboard/extractors";
import {
  healthCheckKPIs,
  impedimentKPIs,
  standupKPIs,
  velocityKPIs,
} from "@/app/(tools)/health-dashboard/synced-kpis";
import {
  criticalImpedimentsStatus,
  cycleTimeP85Status,
  healthPctStatus,
  openBlockersStatus,
  openImpedimentsStatus,
  predictabilityStatus,
} from "@/app/(tools)/health-dashboard/status-config";
import { KpiCard } from "@/app/(tools)/health-dashboard/components/kpi-card";
import {
  MannKendallChip,
  TrafficCircle,
  TrendIcon,
} from "@/app/(tools)/health-dashboard/components/kpi-indicators";
import type { KPI } from "@/app/(tools)/health-dashboard/types";

const CT_KEY = "agile-toolkit:cycle-time";

const sprint = (id: string, planned: number, completed?: number, status = "completed") =>
  ({ id, status, pointsPlanned: planned, pointsCompleted: completed }) as Sprint;
const imp = (id: string, over: Partial<Impediment> = {}): Impediment =>
  ({ id, title: id, severity: "low", raisedAt: "2026-10-01", ...over }) as Impediment;
const entry = (id: string, over: Partial<StandupEntry> = {}): StandupEntry =>
  ({ id, member: id, date: "2026-10-23", blockers: "", ...over }) as StandupEntry;
const light = (l: HealthDimensionScore["light"]): HealthDimensionScore => ({
  light: l,
  trend: "same",
});
const scores = (...lights: HealthDimensionScore["light"][]) =>
  Object.fromEntries(lights.map((l, i) => [`d${i}`, light(l)])) as never;
const check = (history: HealthDimensionScore["light"][][], id = "healthCheck:current") =>
  ({
    id,
    current: { sprintName: "draft", scores: scores("green") },
    history: history.map((l, i) => ({
      id: `h${i}`,
      sprintName: `S${i}`,
      date: "2026-10-01",
      scores: scores(...l),
    })),
  }) as HealthCheck;

const cycleItems = (pairs: [string, string][]) =>
  localStorage.setItem(
    CT_KEY,
    JSON.stringify({
      state: {
        items: pairs.map(([startDate, endDate], i) => ({ id: `w${i}`, startDate, endDate })),
      },
      version: 0,
    })
  );

const emptyWorkspace = () =>
  useWorkspaceStore.setState({
    sprints: [],
    healthChecks: [],
    impediments: [],
    standupEntries: [],
    teamMembers: [],
  });

beforeEach(() => {
  localStorage.clear();
  history.log.mockClear();
  emptyWorkspace();
});

describe("health-dashboard status thresholds", () => {
  it("treats a missing value as red everywhere", () => {
    for (const f of [
      predictabilityStatus,
      healthPctStatus,
      openImpedimentsStatus,
      criticalImpedimentsStatus,
      openBlockersStatus,
      cycleTimeP85Status,
    ]) {
      expect(f(null)).toBe("red");
    }
  });

  it("bands each KPI at its boundaries", () => {
    expect([80, 79, 60, 59].map(predictabilityStatus)).toEqual(["green", "amber", "amber", "red"]);
    expect([75, 74, 50, 49].map(healthPctStatus)).toEqual(["green", "amber", "amber", "red"]);
    expect([0, 1, 3, 4].map(openImpedimentsStatus)).toEqual(["green", "amber", "amber", "red"]);
    expect([0, 1].map(criticalImpedimentsStatus)).toEqual(["green", "red"]);
    expect([0, 1, 2, 3].map(openBlockersStatus)).toEqual(["green", "amber", "amber", "red"]);
    expect([7, 8, 14, 15].map(cycleTimeP85Status)).toEqual(["green", "amber", "amber", "red"]);
  });
});

describe("extractCycleTimeKPIs", () => {
  it("is null with no blob, a null state, bad JSON or no finished items", () => {
    expect(extractCycleTimeKPIs()).toEqual({ p85: null });
    localStorage.setItem(CT_KEY, JSON.stringify({ state: null, version: 0 }));
    expect(extractCycleTimeKPIs()).toEqual({ p85: null });
    localStorage.setItem(CT_KEY, "{not json");
    expect(extractCycleTimeKPIs()).toEqual({ p85: null });
    cycleItems([
      ["2026-10-01", ""],
      ["2026-10-05", "2026-10-01"],
      ["garbage", "2026-10-01"],
    ]);
    expect(extractCycleTimeKPIs()).toEqual({ p85: null });
  });

  it("takes the nearest-rank 85th percentile of whole-day cycle times", () => {
    cycleItems([
      ["2026-10-01", "2026-10-03"], // 2
      ["2026-10-01", "2026-10-04"], // 3
      ["2026-10-01", "2026-10-06"], // 5
      ["2026-10-01", "2026-10-11"], // 10
      ["2026-10-01", ""], // unfinished
    ]);
    expect(extractCycleTimeKPIs()).toEqual({ p85: 10 });
    cycleItems([["2026-10-01", "2026-10-01"]]);
    expect(extractCycleTimeKPIs()).toEqual({ p85: 0 });
  });

  it("also reads an unwrapped { items } blob", () => {
    localStorage.setItem(
      CT_KEY,
      JSON.stringify({ items: [{ id: "a", startDate: "2026-10-01", endDate: "2026-10-08" }] })
    );
    expect(extractCycleTimeKPIs()).toEqual({ p85: 7 });
  });
});

describe("synced KPI edge cases", () => {
  it("needs a velocity change above 1 point (and 4 sprints) for a trend", () => {
    expect(
      velocityKPIs([sprint("1", 5, 10), sprint("2", 5, 10), sprint("3", 5, 11), sprint("4", 5, 11)])
        .trend
    ).toBe("same");
    expect(velocityKPIs([sprint("1", 5, 12), sprint("2", 5, 12), sprint("3", 5, 10)]).trend).toBe(
      "same"
    );
    expect(
      velocityKPIs([sprint("1", 5, 12), sprint("2", 5, 12), sprint("3", 5, 10), sprint("4", 5, 10)])
        .trend
    ).toBe("down");
  });

  it("counts a completed sprint with no completed points as 0 and unpredictable", () => {
    const r = velocityKPIs([sprint("1", 10, undefined), sprint("2", 10, 10)]);
    expect(r.series).toEqual([0, 10]);
    expect(r.avgVelocity).toBe(5);
    expect(r.predictability).toBe(50);
  });

  it("prefers the healthCheck:current document and needs more than 5 points for a trend", () => {
    const other = check([["red"]], "healthCheck:other");
    const main = check([
      ["green", "red"],
      ["green", "red"],
    ]);
    expect(healthCheckKPIs([other, main])).toEqual({
      healthPct: 50,
      trend: "same",
      series: [50, 50],
    });
    // 3 dimensions: 50 → 33 is a 17-point drop.
    expect(
      healthCheckKPIs([
        check([
          ["green", "red"],
          ["green", "red", "red"],
        ]),
      ]).trend
    ).toBe("down");
  });

  it("skips unparseable dates and clamps a resolve-before-raise to 0 days", () => {
    expect(
      impedimentKPIs([imp("a", { raisedAt: "garbage", resolvedAt: "2026-10-02" })])
        .avgResolutionDays
    ).toBeNull();
    expect(
      impedimentKPIs([
        imp("a", { raisedAt: "2026-10-05", resolvedAt: "2026-10-01" }),
        imp("b", { raisedAt: "2026-10-01", resolvedAt: "2026-10-04" }),
      ])
    ).toEqual({ openCount: 0, criticalCount: 0, avgResolutionDays: 1.5 });
  });

  it("ignores whitespace-only blockers and has no participation without a team", () => {
    const r = standupKPIs([entry("ana", { blockers: "   " }), entry("ben", { blockers: "CI" })], 0);
    expect(r).toEqual({ openBlockers: 1, participationRate: null });
  });
});

describe("KPI card and indicators", () => {
  const kpi = (over: Partial<KPI> = {}): KPI => ({
    id: "k",
    name: "Velocity Predictability",
    value: 85,
    unit: "%",
    status: "green",
    trend: "up",
    sourcePath: "/velocity",
    sourceName: "Velocity Tracker",
    icon: Activity,
    iconColor: "#00f0ff",
    description: "% of sprints where completed ≥ committed",
    ...over,
  });

  it("shows the value, unit, status, trend and source link", () => {
    render(<KpiCard kpi={kpi()} />);
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
    expect(screen.getByText("On Track")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Trending up" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Velocity Tracker" })).toHaveAttribute(
      "href",
      "/velocity"
    );
  });

  it("shows a muted no-data state with a link to open the source", () => {
    render(<KpiCard kpi={kpi({ value: null, status: "red" })} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(screen.queryByText("At Risk")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Velocity Tracker" })).toBeInTheDocument();
  });

  it("names every trend direction", () => {
    const { rerender } = render(<TrendIcon trend="down" />);
    expect(screen.getByRole("img", { name: "Trending down" })).toBeInTheDocument();
    rerender(<TrendIcon trend="same" />);
    expect(screen.getByRole("img", { name: "No change" })).toBeInTheDocument();
  });

  it("labels the traffic circle only when asked", () => {
    const { container, rerender } = render(<TrafficCircle status="amber" labelled />);
    expect(screen.getByRole("img", { name: "Needs Attention" })).toBeInTheDocument();
    rerender(<TrafficCircle status="amber" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  const rising = Array.from({ length: 10 }, (_, i) => i + 1);
  const falling = [...rising].reverse();
  const GREEN = "rgb(34, 197, 94)";
  const RED = "rgb(239, 68, 68)";

  it("shows no Mann-Kendall chip for short or trendless series", () => {
    const { container, rerender } = render(
      <MannKendallChip series={[1, 2, 3, 4]} positiveIsGood />
    );
    expect(container).toBeEmptyDOMElement();
    // Fewer than 10 points is never significant.
    rerender(<MannKendallChip series={[1, 2, 3, 4, 5]} positiveIsGood />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MannKendallChip series={[3, 3, 3, 3, 3, 3, 3, 3, 3, 3]} positiveIsGood />);
    expect(container).toBeEmptyDOMElement();
  });

  it("colours a rise green when up is good and red when it is bad", () => {
    const { rerender } = render(<MannKendallChip series={rising} positiveIsGood />);
    expect(screen.getByText("↑ trending up")).toHaveStyle({ color: GREEN });
    rerender(<MannKendallChip series={falling} positiveIsGood />);
    expect(screen.getByText("↓ trending down")).toHaveStyle({ color: RED });
  });

  // Bug: the chip's words followed good/bad instead of the direction, so a
  // rising bad metric read "↑ trending down" and a falling one "↓ trending up".
  it("names the direction for a metric where up is bad", () => {
    const { rerender } = render(<MannKendallChip series={rising} positiveIsGood={false} />);
    expect(screen.getByText("↑ trending up")).toHaveStyle({ color: RED });
    rerender(<MannKendallChip series={falling} positiveIsGood={false} />);
    expect(screen.getByText("↓ trending down")).toHaveStyle({ color: GREEN });
  });
});

/** The KPI card holding the title `name`. */
const card = (name: string) => screen.getAllByText(name)[0].closest(".rounded-xl") as HTMLElement;

/** A connected workspace: every KPI has data. */
const seedAll = () => {
  useWorkspaceStore.setState({
    sprints: [sprint("1", 10, 10), sprint("2", 10, 12), sprint("3", 10, 0, "active")],
    healthChecks: [check([["green", "green"]])],
    impediments: [
      imp("a", { severity: "critical" }),
      imp("b"),
      imp("c", { resolvedAt: "2026-10-03" }),
    ],
    standupEntries: [entry("ana", { blockers: "Waiting on API keys" }), entry("ben")],
    teamMembers: [],
  });
  cycleItems([
    ["2026-10-01", "2026-10-04"],
    ["2026-10-01", "2026-10-06"],
  ]);
};

describe("Health dashboard: empty workspace", () => {
  it("shows every KPI awaiting data and no overall score", () => {
    render(<HealthDashboardClient />);
    expect(screen.getByText(/0 of 5 data sources/)).toBeInTheDocument();
    expect(screen.getAllByText("No data yet")).toHaveLength(6);
    expect(screen.getAllByRole("img", { name: "No data" })).toHaveLength(6);
    expect(screen.getByText("No data connected yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Weighted average of 0 connected KPIs \(6 awaiting data\)/)
    ).toBeInTheDocument();
    expect(screen.getAllByText("No data", { selector: "span" })).toHaveLength(5);
  });

  it("writes a not-yet-available summary rated AT RISK", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 23, 12));
    try {
      render(<HealthDashboardClient />);
      fireEvent.click(screen.getByRole("button", { name: "Generate Summary" }));
      expect(screen.getByText(/Sprint Health Report/).textContent).toBe(
        [
          "Sprint Health Report — 23 Oct 2026",
          "Overall team health is AT RISK.",
          "",
          "Velocity data is not yet available.",
          "Squad health check data is not yet available.",
          "Impediment data is not yet available.",
          "Standup data is not yet available.",
          "Cycle time data is not yet available.",
        ].join("\n")
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Health dashboard: connected workspace", () => {
  beforeEach(seedAll);

  it("shows each KPI's value and status", () => {
    render(<HealthDashboardClient />);
    expect(screen.getByText(/5 of 5 data sources/)).toBeInTheDocument();
    expect(card("Velocity Predictability")).toHaveTextContent("100%");
    expect(card("Velocity Predictability")).toHaveTextContent("On Track");
    expect(card("Team Health Score")).toHaveTextContent("100%");
    expect(card("Open Impediments")).toHaveTextContent("Needs Attention");
    expect(within(card("Open Impediments")).getByText("2")).toBeInTheDocument();
    expect(within(card("Critical Impediments")).getByText("1")).toBeInTheDocument();
    expect(card("Critical Impediments")).toHaveTextContent("At Risk");
    expect(within(card("Open Standup Blockers")).getByText("1")).toBeInTheDocument();
    expect(card("Cycle Time P85")).toHaveTextContent("5 days");
    expect(screen.getAllByText("Connected")).toHaveLength(5);
  });

  it("averages the traffic lights into the overall score", () => {
    render(<HealthDashboardClient />);
    // green 2 + green 2 + amber 1 + red 0 + amber 1 + green 2 = 8 of 12 → 67 %.
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("MODERATE")).toBeInTheDocument();
    expect(screen.getByText(/Weighted average of 6 connected KPIs$/)).toBeInTheDocument();
  });

  it("writes the executive summary from the connected KPIs", () => {
    render(<HealthDashboardClient />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Summary" }));
    const lines = screen.getByText(/Sprint Health Report/).textContent!.split("\n");
    expect(lines.slice(1)).toEqual([
      "Overall team health is MODERATE.",
      "",
      "Velocity predictability is 100% (target: 80%).",
      "Team health score is 100% based on the latest squad check.",
      "2 impediments are open, 1 is critical.",
      "1 blocker is unresolved from standup.",
      "Cycle time P85 is 5 days.",
    ]);
    expect(history.log).toHaveBeenCalledWith(
      "summary_generated",
      expect.objectContaining({ overallStatus: "amber", openImpediments: 2 })
    );
  });

  it("copies the summary to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<HealthDashboardClient />);
    expect(screen.queryByRole("button", { name: /Copy/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate Summary" }));
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith(screen.getByText(/Sprint Health Report/).textContent);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("re-reads the cycle-time blob and clears the summary on Refresh", () => {
    render(<HealthDashboardClient />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Summary" }));
    cycleItems([["2026-10-01", "2026-10-21"]]);
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(card("Cycle Time P85")).toHaveTextContent("20 days");
    expect(card("Cycle Time P85")).toHaveTextContent("At Risk");
    expect(screen.queryByText(/Sprint Health Report/)).not.toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith("dashboard_refreshed", {});
  });

  it("follows synced workspace writes without a refresh", () => {
    render(<HealthDashboardClient />);
    act(() => {
      useWorkspaceStore.setState({ impediments: [imp("a", { resolvedAt: "2026-10-02" })] });
    });
    expect(within(card("Open Impediments")).getByText("0")).toBeInTheDocument();
    expect(card("Open Impediments")).toHaveTextContent("On Track");
  });
});

describe("Health dashboard: summary wording", () => {
  // Bug: one open impediment read "1 impediment are open, 1 are critical."
  it("agrees verb and noun for a single impediment", () => {
    useWorkspaceStore.setState({ impediments: [imp("a", { severity: "critical" })] });
    render(<HealthDashboardClient />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Summary" }));
    expect(screen.getByText(/Sprint Health Report/)).toHaveTextContent(
      "1 impediment is open, 1 is critical."
    );
  });

  it("uses plurals for zero", () => {
    useWorkspaceStore.setState({
      impediments: [imp("a", { resolvedAt: "2026-10-02" })],
      standupEntries: [entry("ana")],
    });
    cycleItems([["2026-10-01", "2026-10-02"]]);
    render(<HealthDashboardClient />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Summary" }));
    const text = screen.getByText(/Sprint Health Report/).textContent;
    expect(text).toContain("0 impediments are open, 0 are critical.");
    expect(text).toContain("0 blockers are unresolved from standup.");
    expect(text).toContain("Cycle time P85 is 1 day.");
    expect(text).toContain("Overall team health is GOOD.");
  });
});
