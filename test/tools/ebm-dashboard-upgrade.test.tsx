/**
 * The EBM Dashboard against the tool UX contract: an empty state with an
 * example (cleared without touching Product Metrics' example rows, and its
 * goal only while it is still the example's text); the credit line; the
 * goal ladder; measures added through the form or an idea, each with Undo;
 * the toolkit's reading written only on "Add this reading"; a measure in
 * another view keeps its row when removed from EBM; Suggest a focus and a
 * recorded review; Ask Amr's answer without AI; the export; and history.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  EBM_BOARD_ID,
  type EbmBoard,
  type ProductMetric,
  type Sprint,
  type TechDebtItem,
} from "@/lib/stores/workspace-types";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const cheers = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/ebm-dashboard",
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "t",
  }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (toolId: string, reason: string) => cheers.push(`${toolId}:${reason}`),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/components/presentation/wall-view", () => ({
  WallViewButton: ({ title }: { title: string }) => (
    <button type="button">Wall mode: {title}</button>
  ),
}));

import { EbmDashboardClient } from "@/app/(tools)/ebm-dashboard/ebm-dashboard-client";
import { EXAMPLE_STRATEGIC_GOAL } from "@/app/(tools)/ebm-dashboard/example";
import { EBM_DASHBOARD_ACTIONS } from "@/lib/history/event-actions";
import { todayIso } from "@/lib/sprints/series";

const NOW = "2026-11-01T00:00:00.000Z";
const metric = (over: Partial<ProductMetric> = {}): ProductMetric => ({
  id: "metric_a",
  name: "Weekly teams",
  direction: "increase",
  readings: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const metrics = () => useWorkspaceStore.getState().productMetrics ?? [];
const board = () => (useWorkspaceStore.getState().ebmBoards ?? [])[0] as EbmBoard | undefined;

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <EbmDashboardClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const area = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  localStorage.clear();
  useWorkspaceStore.setState({
    productMetrics: [],
    ebmBoards: [],
    productGoals: [],
    sprints: [],
    hypothesisTrackers: [],
    stories: [],
    kanbanBoards: [],
    doraScorecards: [],
    npsResponses: [],
    techDebt: [],
  });
});

describe("empty state, example and credit", () => {
  it("offers an example, and credits Scrum.org without claiming its endorsement", async () => {
    renderPage();
    expect((await screen.findAllByText(/No evidence yet/)).length).toBeGreaterThan(0);
    const credit = screen
      .getAllByText(
        /Evidence-Based Management is Scrum\.org's\. This page is independent and not endorsed by Scrum\.org\./
      )
      .filter((el) => el.tagName !== "PRE");
    expect(credit).toHaveLength(1);
    expect(screen.getByRole("link", { name: "About Evidence-Based Management" })).toHaveAttribute(
      "href",
      "https://www.scrum.org/resources/evidence-based-management"
    );
    for (const name of [
      "Current Value",
      "Unrealized Value",
      "Time to Market",
      "Ability to Innovate",
    ]) {
      expect(area(name)).toBeInTheDocument();
    }
  });

  it("loads two measures per area, a goal and two reviews, and logs nothing", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(metrics()).toHaveLength(8);
    expect(board()?.strategicGoal).toBe(EXAMPLE_STRATEGIC_GOAL);
    expect(board()?.reviews).toHaveLength(2);
    expect(within(area("Time to Market")).getByText("Median cycle time")).toBeInTheDocument();
    expect(screen.getByText(/4 of 4 areas measured/)).toBeInTheDocument();
    expect(logs).toEqual([]);
  });

  it("clears only its own rows, and the goal only while it is the example's", async () => {
    useWorkspaceStore.setState({
      productMetrics: [
        metric({ id: "example-pm-ns", name: "PM example", kva: "current-value" }),
        metric({ id: "example-ebm-x", name: "EBM example", kva: "time-to-market" }),
      ],
      ebmBoards: [
        {
          id: EBM_BOARD_ID,
          strategicGoal: EXAMPLE_STRATEGIC_GOAL,
          reviews: [
            { id: "example-ebm-review-1", date: "2026-10-01", focus: "current-value", areas: {} },
            { id: "review_own", date: "2026-10-15", focus: "time-to-market", areas: {} },
          ],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    renderPage();
    expect(await screen.findByText(/\(from the Product Metrics example\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(metrics().map((m) => m.id)).toEqual(["example-pm-ns"]);
    expect(board()?.reviews.map((r) => r.id)).toEqual(["review_own"]);
    expect(board()?.strategicGoal).toBeUndefined();
  });

  it("keeps a goal the team wrote over the example's", async () => {
    useWorkspaceStore.setState({
      ebmBoards: [
        {
          id: EBM_BOARD_ID,
          strategicGoal: "Our own goal",
          reviews: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    expect(board()?.strategicGoal).toBe("Our own goal");
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(board()?.strategicGoal).toBe("Our own goal");
    expect(metrics()).toEqual([]);
  });
});

describe("the goal ladder", () => {
  it("writes the strategic goal and reads the Product Goal and the sprint's goal", async () => {
    useWorkspaceStore.setState({
      productGoals: [
        {
          id: "goal_a",
          statement: "Teams improve every sprint",
          measures: [],
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      sprints: [
        {
          id: "sprint_1",
          name: "Sprint 9",
          startDate: "2026-11-16",
          endDate: "2026-11-29",
          status: "active",
          goal: "Ship reminders",
        } as Sprint,
      ],
    });
    renderPage();
    expect(await screen.findByText("Teams improve every sprint")).toBeInTheDocument();
    expect(screen.getByText("Ship reminders (Sprint 9)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Write it/ }));
    fireEvent.change(screen.getByLabelText("Strategic goal"), {
      target: { value: "Every team improves" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the goal" }));
    expect(board()?.strategicGoal).toBe("Every team improves");
    expect(logs.at(-1)).toMatchObject({
      action: EBM_DASHBOARD_ACTIONS.STRATEGIC_GOAL_SET,
      payload: { goal: true, why: false },
    });
  });
});

describe("measures", () => {
  it("adds a measure through the form, read from the toolkit, and opens its readings", async () => {
    renderPage();
    const ttm = await screen.findByRole("region", { name: "Time to Market" });
    fireEvent.click(within(ttm).getByRole("button", { name: "Add a measure" }));
    fireEvent.click(within(ttm).getByRole("button", { name: "Add to Time to Market" }));
    expect(await within(ttm).findByText("Name the metric.")).toBeInTheDocument();
    fireEvent.change(within(ttm).getByLabelText(/^Name/), { target: { value: "Cycle time" } });
    fireEvent.change(within(ttm).getByLabelText("Read it from the toolkit"), {
      target: { value: "cycle-time-median" },
    });
    fireEvent.click(within(ttm).getByRole("button", { name: "Add to Time to Market" }));
    expect(metrics()[0]).toMatchObject({
      name: "Cycle time",
      kva: "time-to-market",
      source: "cycle-time-median",
    });
    expect(logs.at(-1)).toMatchObject({
      action: EBM_DASHBOARD_ACTIONS.MEASURE_ADDED,
      payload: { area: "time-to-market", source: "cycle-time-median" },
    });
    expect(screen.getByRole("region", { name: "Readings for Cycle time" })).toBeInTheDocument();
  });

  it("takes a source's direction and unit, and offers only the area's own sources", async () => {
    renderPage();
    const ttm = await screen.findByRole("region", { name: "Time to Market" });
    fireEvent.click(within(ttm).getByRole("button", { name: "Add a measure" }));
    const direction = within(ttm).getByLabelText(/^Which way is better/) as HTMLSelectElement;
    expect(direction.value).toBe("increase");
    const pick = within(ttm).getByLabelText(/^Read it from the toolkit/) as HTMLSelectElement;
    expect(Array.from(pick.options).map((o) => o.value)).toEqual([
      "",
      "cycle-time-median",
      "dora-lead-time",
      "dora-deploys",
    ]);
    fireEvent.change(within(ttm).getByLabelText(/^Name/), { target: { value: "Cycle time" } });
    fireEvent.change(within(ttm).getByLabelText(/^Target/), { target: { value: "3" } });
    fireEvent.change(pick, { target: { value: "cycle-time-median" } });
    expect(direction.value).toBe("decrease");
    expect(direction).toBeDisabled();
    expect((within(ttm).getByLabelText(/^Unit/) as HTMLInputElement).value).toBe("days");
    fireEvent.click(within(ttm).getByRole("button", { name: "Add to Time to Market" }));
    expect(metrics()[0]).toMatchObject({
      direction: "decrease",
      unit: "days",
      target: 3,
      source: "cycle-time-median",
    });

    const uv = screen.getByRole("region", { name: "Unrealized Value" });
    fireEvent.click(within(uv).getByRole("button", { name: "Add a measure" }));
    expect(within(uv).queryByLabelText(/^Read it from the toolkit/)).toBeNull();
  });

  it("adds an idea with Undo", async () => {
    renderPage();
    const ai = await screen.findByRole("region", { name: "Ability to Innovate" });
    fireEvent.click(within(ai).getByRole("button", { name: "Open tech debt" }));
    expect(metrics()[0]).toMatchObject({
      name: "Open tech debt",
      source: "open-tech-debt",
      kva: "ability-to-innovate",
    });
    undoLast();
    expect(metrics()).toEqual([]);
  });

  it("writes the toolkit's reading only on Add this reading", async () => {
    useWorkspaceStore.setState({
      techDebt: [{ id: "d1", title: "Old API", impact: 3 } as TechDebtItem],
      productMetrics: [
        metric({
          id: "metric_debt",
          name: "Open debt",
          direction: "decrease",
          kva: "ability-to-innovate",
          source: "open-tech-debt",
        }),
      ],
    });
    renderPage();
    const ai = await screen.findByRole("region", { name: "Ability to Innovate" });
    expect(within(ai).getByText(/From Tech Debt: 1 on/)).toBeInTheDocument();
    expect(metrics()[0].readings).toEqual([]);
    fireEvent.click(within(ai).getByRole("button", { name: "Add this reading" }));
    expect(metrics()[0].readings.map((r) => [r.date, r.value])).toEqual([[todayIso(), 1]]);
    expect(logs.at(-1)).toMatchObject({
      action: EBM_DASHBOARD_ACTIONS.READING_ADDED,
      payload: { metricId: "metric_debt", source: "open-tech-debt" },
    });
    expect(within(ai).queryByRole("button", { name: "Add this reading" })).toBeNull();
  });

  it("removes a measure that sits in another view from EBM only, and deletes one that doesn't, with Undo", async () => {
    useWorkspaceStore.setState({
      productMetrics: [
        metric({ id: "metric_ns", name: "Our star", role: "north-star", kva: "current-value" }),
        metric({ id: "metric_gap", name: "Gap", kva: "unrealized-value" }),
      ],
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove “Our star” from Current Value" })
    );
    expect(metrics().find((m) => m.id === "metric_ns")).toMatchObject({ role: "north-star" });
    expect(metrics().find((m) => m.id === "metric_ns")?.kva).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Remove “Gap” from Unrealized Value" }));
    expect(metrics().map((m) => m.id)).toEqual(["metric_ns"]);
    expect(logs.at(-1)?.action).toBe(EBM_DASHBOARD_ACTIONS.MEASURE_REMOVED);
    undoLast();
    expect(
      metrics()
        .map((m) => m.id)
        .sort()
    ).toEqual(["metric_gap", "metric_ns"]);
  });

  it("lists the experiments measured by an area, with a Run an experiment link", async () => {
    useWorkspaceStore.setState({
      productMetrics: [metric({ id: "metric_cv", name: "Renewals", kva: "current-value" })],
      hypothesisTrackers: [
        {
          id: "hypothesisTracker:current",
          hypotheses: [
            {
              id: "h1",
              believe: "Reminders keep teams",
              willDo: "w",
              toLearn: "t",
              successMetric: "s",
              status: "running",
              raisedAt: "2026-10-01",
              measuredBy: { kind: "metric", metricId: "metric_cv" },
            },
          ],
        },
      ],
    });
    renderPage();
    const cv = await screen.findByRole("region", { name: "Current Value" });
    expect(within(cv).getByText("Reminders keep teams")).toBeInTheDocument();
    expect(within(cv).getByRole("link", { name: /Run an experiment/ })).toHaveAttribute(
      "href",
      "/hypothesis-tracker?metric=metric_cv"
    );
  });
});

describe("reviews", () => {
  it("says what is missing, fills the form from Suggest a focus, and records a review", async () => {
    useWorkspaceStore.setState({
      productMetrics: [
        metric({
          id: "metric_cv",
          name: "Renewals",
          kva: "current-value",
          baseline: 0,
          target: 10,
          readings: [{ id: "r", date: "2026-10-01", value: 5 }],
        }),
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Record the review" }));
    expect(await screen.findByText("Pick the area to focus on next.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Suggest a focus" }));
    expect((screen.getByLabelText(/^Area to focus on next/) as HTMLSelectElement).value).toBe(
      "unrealized-value"
    );
    expect((screen.getByLabelText(/^Note/) as HTMLTextAreaElement).value).toMatch(
      /Current Value 50%/
    );
    fireEvent.click(screen.getByRole("button", { name: "Record the review" }));
    expect(board()?.reviews).toHaveLength(1);
    expect(board()?.reviews[0]).toMatchObject({
      focus: "unrealized-value",
      areas: { "current-value": 0.5 },
    });
    expect(logs.at(-1)).toMatchObject({
      action: EBM_DASHBOARD_ACTIONS.REVIEW_RECORDED,
      payload: { focus: "unrealized-value", measured: 1 },
    });
    expect(cheers).toEqual(["ebm-dashboard:milestone"]);
    expect(
      within(screen.getByRole("list", { name: "Past reviews" })).getByText(
        /focus on Unrealized Value/
      )
    ).toBeInTheDocument();
  });
});

describe("Ask Amr, without AI", () => {
  it("suggests measures for an area to add, leaving out names it has", async () => {
    useWorkspaceStore.setState({
      productMetrics: [
        metric({ id: "metric_c", name: "Median cycle time", kva: "time-to-market" }),
      ],
    });
    renderPage();
    const ttm = await screen.findByRole("region", { name: "Time to Market" });
    fireEvent.click(within(ttm).getByRole("button", { name: "Suggest measures" }));
    const list = await within(ttm).findByRole("region", { name: "Measures for Time to Market" });
    expect(within(list).getByText(/Suggested without AI/)).toBeInTheDocument();
    expect(within(list).queryByText("Median cycle time")).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: "Add: Deploys a week" }));
    expect(metrics().map((m) => m.name)).toEqual(["Median cycle time", "Deploys a week"]);
  });

  it("keeps an idea's toolkit source when its suggestion is added", async () => {
    renderPage();
    const ttm = await screen.findByRole("region", { name: "Time to Market" });
    fireEvent.click(within(ttm).getByRole("button", { name: "Suggest measures" }));
    const list = await within(ttm).findByRole("region", { name: "Measures for Time to Market" });
    fireEvent.click(within(list).getByRole("button", { name: "Add: Median cycle time" }));
    expect(metrics()[0]).toMatchObject({
      name: "Median cycle time",
      source: "cycle-time-median",
      direction: "decrease",
      unit: "days",
    });
    expect(within(ttm).getByText(/From Cycle Time:/)).toBeInTheDocument();
  });
});

describe("more of the contract", () => {
  const measured = () =>
    metric({
      id: "metric_cv",
      name: "Renewals",
      role: "north-star",
      kva: "current-value",
      baseline: 0,
      target: 10,
      readings: [{ id: "r", date: "2026-10-01", value: 5 }],
    });

  it("adds a reading to a measure and logs it", async () => {
    useWorkspaceStore.setState({ productMetrics: [measured()] });
    renderPage();
    const cv = await screen.findByRole("region", { name: "Current Value" });
    fireEvent.click(within(cv).getByRole("button", { name: "Reading" }));
    const panel = screen.getByRole("region", { name: "Readings for Renewals" });
    fireEvent.change(within(panel).getByLabelText(/^Value/), { target: { value: "7" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add the reading" }));
    expect(metrics()[0].readings.map((r) => r.value)).toEqual([5, 7]);
    expect(logs.at(-1)).toMatchObject({ action: EBM_DASHBOARD_ACTIONS.READING_ADDED });
  });

  it("edits a measure and keeps the views it sits in", async () => {
    useWorkspaceStore.setState({ productMetrics: [measured()] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit “Renewals”" }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Teams that renew" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the measure" }));
    expect(metrics()[0]).toMatchObject({
      name: "Teams that renew",
      role: "north-star",
      kva: "current-value",
    });
    expect(logs.at(-1)?.action).toBe(EBM_DASHBOARD_ACTIONS.MEASURE_UPDATED);
  });

  it("sums up the radar with the unmeasured areas named, and offers Wall mode", async () => {
    useWorkspaceStore.setState({ productMetrics: [measured()] });
    renderPage();
    expect(
      await screen.findByText(
        /Current Value 50%, Unrealized Value not measured, Time to Market not measured/
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Area progress is a guide, not a grade/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wall mode: EBM Dashboard" })).toBeInTheDocument();
  });

  it("needs a goal for its why", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Write it/ }));
    fireEvent.change(screen.getByLabelText("Why it matters"), { target: { value: "Because" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the goal" }));
    expect(await screen.findByText("Write the goal this why is for.")).toBeInTheDocument();
    expect(board()).toBeUndefined();
  });

  it("records a review of the example as the example's own, logging nothing", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    fireEvent.change(screen.getByLabelText(/^Area to focus on next/), {
      target: { value: "current-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record the review" }));
    const added = board()?.reviews.find((r) => !r.id.startsWith("example-ebm-review-"));
    expect(added?.id).toMatch(/^example-ebm-review_/);
    expect(Object.keys(added?.areas ?? {})).toHaveLength(4);
    expect(logs).toEqual([]);
    expect(cheers).toEqual([]);
  });

  it("adds every suggestion at once with one Undo", async () => {
    renderPage();
    const uv = await screen.findByRole("region", { name: "Unrealized Value" });
    fireEvent.click(within(uv).getByRole("button", { name: "Suggest measures" }));
    const list = await within(uv).findByRole("region", { name: "Measures for Unrealized Value" });
    fireEvent.click(within(list).getByRole("button", { name: /^Add all/ }));
    expect(metrics()).toHaveLength(4);
    expect(metrics().every((m) => m.kva === "unrealized-value")).toBe(true);
    undoLast();
    expect(metrics()).toEqual([]);
  });
});

describe("the export", () => {
  it("writes the ladder, the areas, the experiments and the reviews", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# EBM Dashboard");
    expect(md).toContain(`- Strategic goal: ${EXAMPLE_STRATEGIC_GOAL}`);
    expect(md).toContain("## Time to Market");
    expect(md).toContain("| Measure | Latest | Target | Progress | Trend | Source |");
    expect(md).toContain("| Cycle Time |");
    expect(md).toContain("## Reviews");
    expect(md).toContain("not endorsed by Scrum.org");
  });

  it("declares a next step", async () => {
    const { toolsWithNextSteps } = await import("@/lib/tools/next-steps");
    expect(toolsWithNextSteps()).toContain("ebm-dashboard");
  });
});
