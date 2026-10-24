import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { SELECTED_SPRINT_KEY, resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { SPRINT_METRICS_ACTIONS } from "@/lib/history/event-actions";
import { CEREMONY_CADENCE_ID } from "@/lib/stores/workspace-types";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";

/**
 * Sprint Metrics around the trend: the current sprint is left to the
 * cockpit (a card links there), the sprint tools and the board-level tools
 * are plain links, the data checks stay (points added with Undo, dates and
 * details fixed in the cockpit, migrated sprints checked once), new sprints
 * take the cadence's length, and the example is never saved. The trend
 * itself is covered by sprint-metrics-upgrade.test.tsx; the current
 * sprint's tiles, close and details by the cockpit's tests.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
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
vi.mock("@/app/(tools)/sprint-metrics/charts", () => ({
  SayDoChart: () => null,
  ChurnChart: () => null,
}));

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
const SERIES2: SprintSeries = { id: "s2", days: [{ day: 0, remaining: 30 }] };

const state = () => useWorkspaceStore.getState();
const stored = (id: string) => state().sprints.find((s) => s.id === id);

function seed(sprints: Sprint[], series: SprintSeries[] = []) {
  useWorkspaceStore.setState({ sprints, sprintSeries: series, stories: [] });
}

/** Click Undo on the newest toast. */
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 19, 12, 0, 0)); // 19 Oct 2026: day 4 of Sprint 2
  logs.length = 0;
  toastSpy.mockReset();
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/sprint-metrics");
  useSprintMigrationStore.setState({ status: "idle" });
  seed([S1, S2, S3], [SERIES2]);
});

afterEach(() => {
  vi.useRealTimers();
  seed([], []);
  useWorkspaceStore.setState({ ceremonyCadences: [] });
});

describe("the current sprint", () => {
  it("is left to the cockpit, with a card that links there", () => {
    render(<SprintMetricsClient />);
    expect(screen.getByText(/is running · Day 4 of 10/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the cockpit/ })).toHaveAttribute(
      "href",
      "/sprint?sprint=s2"
    );
    // No tiles, close or details here any more.
    expect(document.querySelector("[data-tile]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close sprint" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
  });
});

describe("tool links", () => {
  it("open each sprint tool on the current sprint", () => {
    render(<SprintMetricsClient />);
    const tools = screen.getByRole("region", { name: "Sprint tools" });
    const link = (name: RegExp) => within(tools).getByRole("link", { name });
    expect(link(/^Burndown/)).toHaveAttribute("href", "/burndown?sprint=s2");
    expect(link(/^Burnup/)).toHaveAttribute("href", "/burnup?sprint=s2");
    expect(link(/^Velocity/)).toHaveAttribute("href", "/velocity?sprint=s2");
    expect(link(/^Sprint Comparison/)).toHaveAttribute("href", "/sprint-compare?sprint=s2");
    expect(link(/^Release Planner/)).toHaveAttribute("href", "/release-planner?sprint=s2");
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
  });
});

describe("data-quality nudges", () => {
  it("asks for completed points on a finished sprint without them, with Undo", () => {
    seed([{ ...S1, pointsCompleted: undefined }, S2, S3], [SERIES2]);
    render(<SprintMetricsClient />);
    expect(screen.getByText(/Sprint 1 is done but has no completed points/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add completed points to Sprint 1" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Completed points/), {
      target: { value: "24" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save points" }));

    expect(stored("s1")).toMatchObject({ status: "completed", pointsCompleted: 24 });
    expect(screen.queryByText(/is done but has no completed points/)).toBeNull();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Added 24 points to Sprint 1");
    expect(logs.map((l) => l.action)).not.toContain(SPRINT_METRICS_ACTIONS.SPRINT_CLOSED);

    undoLast();
    expect(stored("s1")?.pointsCompleted).toBeUndefined();
    expect(screen.getByText(/Sprint 1 is done but has no completed points/)).toBeInTheDocument();
  });

  it("sends a sprint with placeholder dates to the cockpit to set them", () => {
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
    render(<SprintMetricsClient />);
    expect(screen.getByText(/Old sprint has no real dates/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set real dates for Old sprint" })).toHaveAttribute(
      "href",
      "/sprint?sprint=v1"
    );
  });

  it("flags a sprint made by the migration until it's checked", () => {
    seed([S1, S2, S3], [{ ...SERIES2, migratedFrom: ["burndown", "velocity"] }]);
    render(<SprintMetricsClient />);
    expect(
      screen.getByText(/made from your earlier Burndown and Velocity data/)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check the details of Sprint 2" })).toHaveAttribute(
      "href",
      "/sprint?sprint=s2"
    );

    fireEvent.click(screen.getByRole("button", { name: "Sprint 2 looks right" }));
    expect(screen.queryByText(/made from your earlier/)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(CHECKED_SPRINTS_KEY) ?? "[]")).toEqual(["s2"]);
  });

  it("remembers the checked sprints from before (the same key)", () => {
    window.localStorage.setItem(CHECKED_SPRINTS_KEY, JSON.stringify(["s2"]));
    seed([S1, S2, S3], [{ ...SERIES2, migratedFrom: ["burndown"] }]);
    render(<SprintMetricsClient />);
    expect(screen.queryByText(/made from your earlier/)).toBeNull();
  });
});

describe("no sprints yet", () => {
  beforeEach(() => seed([], []));

  it("offers to create the first sprint at the cadence's length, and logs it", () => {
    useWorkspaceStore.setState({
      ceremonyCadences: [{ ...DEFAULT_CADENCE, id: CEREMONY_CADENCE_ID, sprintLengthDays: 7 }],
    });
    render(<SprintMetricsClient />);
    expect(screen.queryByText("Loading sprints…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create your first sprint" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Sprint 1");
    expect(within(dialog).getByLabelText(/First day/)).toHaveValue("2026-10-19");
    expect(within(dialog).getByLabelText(/Last day/)).toHaveValue("2026-10-26");
    fireEvent.change(within(dialog).getByLabelText(/Planned points/), {
      target: { value: "20" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sprint" }));

    expect(state().sprints).toHaveLength(1);
    expect(state().sprints[0]).toMatchObject({ name: "Sprint 1", pointsPlanned: 20 });
    expect(logs).toContainEqual({
      action: SPRINT_METRICS_ACTIONS.SPRINT_CREATED,
      payload: expect.objectContaining({ sprintId: state().sprints[0].id, name: "Sprint 1" }),
    });
    expect(window.localStorage.getItem(SELECTED_SPRINT_KEY)).toBe(state().sprints[0].id);
  });

  it("still links the board-level tools", () => {
    render(<SprintMetricsClient />);
    const board = screen.getByRole("region", { name: "Flow, board-level" });
    expect(within(board).getAllByRole("link")).toHaveLength(2);
  });

  it("shows an example that writes nothing", () => {
    render(<SprintMetricsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByText("Example data.")).toBeInTheDocument();
    // The verdict, on the page and in the export.
    expect(screen.getAllByText(/^Over the last 6 sprints/).length).toBeGreaterThan(0);
    // Tools open on the user's own sprints, not an example id.
    const tools = screen.getByRole("region", { name: "Sprint tools" });
    expect(within(tools).getByRole("link", { name: /^Burndown/ })).toHaveAttribute(
      "href",
      "/burndown"
    );

    expect(state().sprints).toEqual([]);
    expect(state().stories).toEqual([]);
    expect(window.localStorage.getItem(SELECTED_SPRINT_KEY)).toBeNull();
    expect(logs).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Start your own" }));
    expect(within(screen.getByRole("dialog")).getByText("New sprint")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
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
