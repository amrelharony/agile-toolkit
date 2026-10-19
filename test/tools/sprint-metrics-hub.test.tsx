import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { SELECTED_SPRINT_KEY, resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { sprintStatus } from "@/lib/sprints/metrics";
import { SPRINT_METRICS_ACTIONS } from "@/lib/history/event-actions";

/**
 * The Sprint Metrics hub: one place for the shared sprints. It opens on the
 * same sprint as every sprint tool, shows the series' numbers, deep-links
 * the tools with ?sprint=, closes and reopens sprints, flags data problems,
 * and offers an example that is never saved.
 */

const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown> = {}) => logs.push({ action, payload }),
    toolRunId: "test",
  }),
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
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import {
  SprintMetricsClient,
  CHECKED_SPRINTS_KEY,
} from "@/app/(tools)/sprint-metrics/sprint-metrics-client";

const S1: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-09-21",
  endDate: "2026-10-01",
  pointsPlanned: 30,
  pointsCompleted: 26,
  status: "completed",
};
const S2: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-15",
  endDate: "2026-10-25",
  goal: "Checkout works end to end",
  pointsPlanned: 30,
  status: "active",
};
const S3: Sprint = {
  id: "s3",
  name: "Sprint 3",
  startDate: "2026-10-26",
  endDate: "2026-11-05",
  pointsPlanned: 0,
  status: "planned",
};
/** Day 0: 30 left; day 2: 27 left (ideal is 24): 3 points behind. Rated 7.5. */
const SERIES2: SprintSeries = {
  id: "s2",
  days: [
    { day: 0, remaining: 30 },
    { day: 2, remaining: 27 },
  ],
  ratings: { Velocity: 7, Quality: 8 },
};

const state = () => useWorkspaceStore.getState();
const stored = (id: string) => state().sprints.find((s) => s.id === id);
const heading = (name: string) => screen.getByRole("heading", { level: 2, name });
const tile = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-tile="${id}"]`)?.textContent ?? "";

function seed(sprints: Sprint[], series: SprintSeries[] = []) {
  useWorkspaceStore.setState({ sprints, sprintSeries: series });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 19, 12, 0, 0)); // 19 Oct 2026: day 4 of Sprint 2
  logs.length = 0;
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/sprint-metrics");
  useSprintMigrationStore.setState({ status: "idle" });
  seed([S1, S2, S3], [SERIES2]);
});

afterEach(() => {
  vi.useRealTimers();
  seed([], []);
});

describe("choosing the sprint", () => {
  it("opens on the active sprint", () => {
    render(<SprintMetricsClient />);
    expect(heading("Sprint 2")).toBeInTheDocument();
    expect(screen.getByText("Day 4 of 10")).toBeInTheDocument();
    expect(screen.getByText("Checkout works end to end")).toBeInTheDocument();
  });

  it("lets a ?sprint= link win over the active sprint", () => {
    window.history.replaceState(null, "", "/sprint-metrics?sprint=s1");
    render(<SprintMetricsClient />);
    expect(heading("Sprint 1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Sprint 2" })).toBeNull();
  });
});

describe("tiles", () => {
  it("come from the sprint's series", () => {
    const { container } = render(<SprintMetricsClient />);
    const status = sprintStatus(S2, SERIES2);
    expect(status).toMatchObject({ remaining: 27, done: 3, gap: 3, scopeNow: 30 });

    expect(tile(container, "committed")).toContain("30");
    expect(tile(container, "scope")).toContain("No change since the plan");
    expect(tile(container, "done")).toContain("3");
    expect(tile(container, "done")).toContain("10% of the scope");
    expect(tile(container, "remaining")).toContain("27");
    expect(tile(container, "remaining")).toContain("On day 2");
    expect(tile(container, "gap")).toContain("3 points behind");
    expect(tile(container, "gap")).toContain("Ideal: 24 left on day 2");
    expect(tile(container, "finish")).toContain(
      `Day ${Math.ceil(status.projectedFinishDay as number)}`
    );
    // Committed against the other finished sprints' average (Sprint 1: 26).
    expect(tile(container, "average")).toContain("30 vs 26");
    expect(tile(container, "average")).toContain("4 over the last sprint");
    expect(tile(container, "rating")).toContain("7.5");
  });

  it("say honestly when nothing is logged", () => {
    window.history.replaceState(null, "", "/sprint-metrics?sprint=s3");
    const { container } = render(<SprintMetricsClient />);
    expect(tile(container, "done")).toContain("Not logged yet");
    expect(tile(container, "remaining")).toContain("Not logged yet");
    expect(tile(container, "gap")).toContain("Not logged yet");
    expect(tile(container, "finish")).toContain("Not logged yet");
    expect(container.querySelector('[data-tile="rating"]')).toBeNull();
    expect(screen.getByText("Starts in 7 days")).toBeInTheDocument();
  });

  it("exports the selected sprint as Markdown", () => {
    render(<SprintMetricsClient />);
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Sprint 2");
    expect(md).toContain("**Goal:** Checkout works end to end");
    expect(md).toContain("| Pace vs ideal | 3 points behind |");
    expect(md).toContain("## Daily log");
    expect(md).toMatch(/\| 2 \| 17 Oct \| 27 \| 3 \| 30 \|/);
  });
});

describe("tool cards", () => {
  it("open each sprint tool on this sprint, with a status line", () => {
    render(<SprintMetricsClient />);
    const tools = screen.getByRole("region", { name: "Sprint tools" });
    const link = (name: RegExp) => within(tools).getByRole("link", { name });

    expect(link(/^Burndown/)).toHaveAttribute("href", "/burndown?sprint=s2");
    expect(link(/^Burndown/)).toHaveTextContent("2 of 11 days logged");
    expect(link(/^Burnup/)).toHaveAttribute("href", "/burnup?sprint=s2");
    expect(link(/^Burnup/)).toHaveTextContent("3 of 30 points done");
    expect(link(/^Velocity/)).toHaveAttribute("href", "/velocity?sprint=s2");
    expect(link(/^Velocity/)).toHaveTextContent("Average 26 points over 1 sprint");
    expect(link(/^Sprint Comparison/)).toHaveAttribute("href", "/sprint-compare?sprint=s2");
    expect(link(/^Sprint Comparison/)).toHaveTextContent("Rated 7.5");
    expect(link(/^Release Planner/)).toHaveAttribute("href", "/release-planner?sprint=s2");
  });

  it("show Sprint Comparison as not rated yet", () => {
    seed([S1, S2, S3], [{ ...SERIES2, ratings: {} }]);
    render(<SprintMetricsClient />);
    const tools = screen.getByRole("region", { name: "Sprint tools" });
    expect(within(tools).getByRole("link", { name: /^Sprint Comparison/ })).toHaveTextContent(
      "Not rated yet"
    );
  });

  it("list Cumulative Flow and Cycle Time as board-level links", () => {
    render(<SprintMetricsClient />);
    const board = screen.getByRole("region", { name: "Flow, board-level" });
    expect(within(board).getByText("Tracks your board, not a sprint.")).toBeInTheDocument();
    expect(within(board).getByRole("link", { name: /^Cumulative Flow/ })).toHaveAttribute(
      "href",
      "/cumulative-flow"
    );
    expect(within(board).getByRole("link", { name: /^Cycle Time/ })).toHaveAttribute(
      "href",
      "/cycle-time"
    );
    const tools = screen.getByRole("region", { name: "Sprint tools" });
    expect(within(tools).queryByRole("link", { name: /Cumulative Flow|Cycle Time/ })).toBeNull();
  });
});

describe("closing a sprint", () => {
  it("sets its status and completed points, suggested from the log", () => {
    render(<SprintMetricsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Close sprint" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText(/Completed points/);
    expect(input).toHaveValue(3); // done by day 2
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close sprint" }));

    expect(stored("s2")).toMatchObject({ status: "completed", pointsCompleted: 5 });
    expect(logs).toContainEqual({
      action: SPRINT_METRICS_ACTIONS.SPRINT_CLOSED,
      payload: expect.objectContaining({ sprintId: "s2", pointsCompleted: 5 }),
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    // Still on the sprint just closed, though it's no longer the active one.
    expect(heading("Sprint 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(stored("s2")?.status).toBe("active");
    expect(logs.map((l) => l.action)).toContain(SPRINT_METRICS_ACTIONS.SPRINT_REOPENED);
    expect(screen.getByRole("button", { name: "Close sprint" })).toBeInTheDocument();
  });

  it("won't close without a number", () => {
    window.history.replaceState(null, "", "/sprint-metrics?sprint=s3");
    render(<SprintMetricsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Close sprint" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/Completed points/)).toHaveValue(null);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close sprint" }));
    expect(within(dialog).getByText("Enter 0 or more points.")).toBeInTheDocument();
    expect(stored("s3")?.status).toBe("planned");
  });
});

describe("editing details", () => {
  it("saves the name, goal and committed points on blur", () => {
    render(<SprintMetricsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));

    const name = screen.getByLabelText(/^Name/);
    fireEvent.change(name, { target: { value: "Sprint 2: checkout" } });
    fireEvent.blur(name);
    expect(stored("s2")?.name).toBe("Sprint 2: checkout");

    const goal = screen.getByLabelText("Sprint goal");
    fireEvent.change(goal, { target: { value: "" } });
    fireEvent.blur(goal);
    expect(stored("s2")?.goal).toBeUndefined();

    const committed = screen.getByLabelText("Committed points");
    fireEvent.change(committed, { target: { value: "34" } });
    fireEvent.blur(committed);
    expect(stored("s2")?.pointsPlanned).toBe(34);
  });
});

describe("data-quality nudges", () => {
  it("asks for completed points on a finished sprint without them", () => {
    seed([{ ...S1, pointsCompleted: undefined }, S2, S3], [SERIES2]);
    window.history.replaceState(null, "", "/sprint-metrics?sprint=s1");
    render(<SprintMetricsClient />);
    expect(screen.getByText(/is done but has no completed points/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add completed points" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Completed points/), {
      target: { value: "24" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save points" }));

    expect(stored("s1")).toMatchObject({ status: "completed", pointsCompleted: 24 });
    expect(screen.queryByText(/is done but has no completed points/)).toBeNull();
    expect(logs.map((l) => l.action)).not.toContain(SPRINT_METRICS_ACTIONS.SPRINT_CLOSED);
  });

  it("offers to set real dates on a sprint with placeholder dates", () => {
    const old: Sprint = {
      id: "v1",
      name: "Old sprint",
      startDate: "2020-01-03",
      endDate: "",
      pointsPlanned: 20,
      pointsCompleted: 18,
      status: "completed",
    };
    seed([old, S2], [SERIES2]);
    window.history.replaceState(null, "", "/sprint-metrics?sprint=v1");
    render(<SprintMetricsClient />);
    expect(screen.getByText(/has no real dates/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set real dates" }));
    const first = screen.getByLabelText("First day");
    expect(first).toHaveFocus();
    fireEvent.change(first, { target: { value: "2026-08-03" } });
    const last = screen.getByLabelText("Last day");
    fireEvent.change(last, { target: { value: "2026-08-14" } });
    fireEvent.blur(last);

    expect(stored("v1")).toMatchObject({ startDate: "2026-08-03", endDate: "2026-08-14" });
    expect(screen.queryByText(/has no real dates/)).toBeNull();
  });

  it("flags a sprint made by the migration until it's checked", () => {
    seed([S1, S2, S3], [{ ...SERIES2, migratedFrom: ["burndown", "velocity"] }]);
    render(<SprintMetricsClient />);
    expect(
      screen.getByText(/made from your earlier Burndown and Velocity data/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check this sprint's details" }));
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    expect(screen.queryByText(/made from your earlier/)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(CHECKED_SPRINTS_KEY) ?? "[]")).toEqual(["s2"]);
  });

  it("points to other sprints that need a look", () => {
    seed([{ ...S1, pointsCompleted: undefined }, S2, S3], [SERIES2]);
    render(<SprintMetricsClient />);
    expect(heading("Sprint 2")).toBeInTheDocument();
    expect(screen.getByText("Sprints to check:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sprint 1" }));
    expect(heading("Sprint 1")).toBeInTheDocument();
    expect(window.localStorage.getItem(SELECTED_SPRINT_KEY)).toBe("s1");
  });
});

describe("no sprints yet", () => {
  beforeEach(() => seed([], []));

  it("offers to create the first sprint, and logs it", () => {
    render(<SprintMetricsClient />);
    expect(screen.queryByText("Loading sprints…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create your first sprint" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Sprint 1");
    fireEvent.change(within(dialog).getByLabelText(/Planned points/), {
      target: { value: "20" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sprint" }));

    expect(state().sprints).toHaveLength(1);
    expect(state().sprints[0]).toMatchObject({ name: "Sprint 1", pointsPlanned: 20 });
    expect(heading("Sprint 1")).toBeInTheDocument();
    expect(logs).toContainEqual({
      action: SPRINT_METRICS_ACTIONS.SPRINT_CREATED,
      payload: expect.objectContaining({ sprintId: state().sprints[0].id, name: "Sprint 1" }),
    });
  });

  it("still links the board-level tools", () => {
    render(<SprintMetricsClient />);
    const board = screen.getByRole("region", { name: "Flow, board-level" });
    expect(within(board).getAllByRole("link")).toHaveLength(2);
  });

  it("shows an example that writes nothing", () => {
    render(<SprintMetricsClient />);
    fireEvent.click(screen.getByRole("button", { name: "See an example" }));

    expect(screen.getByText("Example sprints.")).toBeInTheDocument();
    expect(heading("Sprint 5")).toBeInTheDocument();
    expect(screen.getByText("Day 5 of 14")).toBeInTheDocument();
    // Read-only: no editing, closing or data checks.
    expect(screen.queryByRole("button", { name: "Close sprint" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
    // Tools open on the user's own sprints, not an example id.
    const tools = screen.getByRole("region", { name: "Sprint tools" });
    expect(within(tools).getByRole("link", { name: /^Burndown/ })).toHaveAttribute(
      "href",
      "/burndown"
    );

    expect(state().sprints).toEqual([]);
    expect(state().sprintSeries).toEqual([]);
    expect(window.localStorage.getItem(SELECTED_SPRINT_KEY)).toBeNull();
    expect(logs).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Start your own" }));
    expect(within(screen.getByRole("dialog")).getByText("New sprint")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Close example" }));
    expect(screen.getByRole("button", { name: "Create your first sprint" })).toBeInTheDocument();
    expect(state().sprints).toEqual([]);
  });

  it("shows Loading sprints… instead while old data is being moved in", () => {
    useSprintMigrationStore.setState({ status: "pending" });
    render(<SprintMetricsClient />);
    expect(screen.getByText("Loading sprints…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create your first sprint" })).toBeNull();
  });
});
