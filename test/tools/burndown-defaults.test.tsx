import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import { endDateFor, todayIso } from "@/lib/sprints/series";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";

/**
 * Burndown on a shared sprint: with no sprints it offers to create one (or
 * show an example); a new sprint starts today, the KPIs say there's no data
 * until a second day has a number, and logging a day writes the shared log,
 * the history event and the gamification trigger. It waits while old data
 * moves in, and asks for real dates on a sprint that has none.
 */

const spy = vi.hoisted(() => ({
  logs: [] as Array<[string, Record<string, unknown> | undefined]>,
  sounds: [] as string[],
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => spy.logs.push([action, payload]),
  }),
}));
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => (event: string) => spy.sounds.push(event),
}));

beforeAll(() => {
  // Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { BurndownClient } from "@/app/(tools)/burndown/burndown-client";

beforeEach(() => {
  spy.logs = [];
  spy.sounds = [];
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burndown");
  useSprintMigrationStore.setState({ status: "idle" });
  useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
});

const renderBurndown = () =>
  render(
    <TooltipProvider>
      <BurndownClient />
    </TooltipProvider>
  );
const remaining = (day: number) =>
  screen.getByRole("spinbutton", { name: `Remaining points on day ${day}` });
const commit = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("Burndown first run", () => {
  it("creates the first sprint, starting today, and shows no pace until a day has a number", () => {
    renderBurndown();
    expect(screen.getByRole("heading", { name: "No sprints yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create your first sprint" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Planned points/), {
      target: { value: "40" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sprint" }));

    // A shared sprint, in the workspace, starting today and as long as the
    // team's cadence says (two weeks while it isn't set).
    const sprints = useWorkspaceStore.getState().sprints;
    expect(sprints).toHaveLength(1);
    const sprint = sprints[0];
    expect(sprint).toMatchObject({
      name: "Sprint 1",
      startDate: todayIso(),
      endDate: endDateFor(todayIso(), 14),
      pointsPlanned: 40,
    });
    expect(screen.getByLabelText("First day")).toHaveValue(todayIso());
    expect(
      screen.getByText("Shared with Burnup, Velocity, Sprint Metrics and the Sprint cockpit.", {
        exact: false,
      })
    ).toBeInTheDocument();

    // Nothing recorded: no pace, no 0s.
    expect(screen.getByText("Not logged yet")).toBeInTheDocument();
    expect(screen.queryByText(/Ahead by|Behind by|On the ideal line/)).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // Day 0 holds the plan, dimmed, not as if typed.
    expect(remaining(0)).toHaveValue(null);
    expect(remaining(0)).toHaveAccessibleDescription("40 from the plan");

    // Logging today (day 0) gives a reading and a pace against the ideal line.
    commit(remaining(0), "38");
    expect(screen.queryByText("Not logged yet")).toBeNull();
    expect(screen.getByText("Ahead by 2 points")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().sprintSeries).toEqual([
      expect.objectContaining({ id: sprint.id, days: [{ day: 0, remaining: 38 }] }),
    ]);
    expect(spy.logs).toContainEqual(["day_logged", { sprintId: sprint.id, day: 0, remaining: 38 }]);
    expect(spy.sounds).toEqual(["day-logged"]);

    // A new number on the same day isn't another logged day.
    commit(remaining(0), "37");
    expect(spy.sounds).toEqual(["day-logged"]);
  });

  it("shows Loading sprints… while old data moves in, never the empty state", () => {
    useSprintMigrationStore.setState({ status: "pending" });
    renderBurndown();
    expect(screen.getByRole("status")).toHaveTextContent("Loading sprints…");
    expect(screen.queryByText("No sprints yet")).toBeNull();

    act(() => useSprintMigrationStore.setState({ status: "done" }));
    expect(screen.getByRole("heading", { name: "No sprints yet" })).toBeInTheDocument();
  });

  it("asks for real dates on a sprint the old Velocity tool added", () => {
    const fromVelocity: Sprint = {
      id: "v1",
      name: "Sprint 3",
      startDate: "2020-01-03",
      endDate: "",
      pointsPlanned: 30,
      status: "planned",
    };
    useWorkspaceStore.setState({ sprints: [fromVelocity] });
    renderBurndown();

    expect(screen.getByText("Set this sprint's dates to chart it")).toBeInTheDocument();
    expect(screen.queryByText("Burndown chart")).toBeNull();

    fireEvent.change(screen.getByLabelText(/^First day/), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText(/^Last day/), { target: { value: "2026-10-19" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));

    expect(useWorkspaceStore.getState().sprints[0]).toMatchObject({
      startDate: "2026-10-05",
      endDate: "2026-10-19",
    });
    expect(screen.queryByText("Set this sprint's dates to chart it")).toBeNull();
    expect(screen.getByText("Burndown chart")).toBeInTheDocument();
    expect(remaining(14)).toBeInTheDocument();
    expect(spy.logs).toContainEqual([
      "config_updated",
      { sprintId: "v1", sprintStartDate: "2026-10-05", sprintDays: 14 },
    ]);
  });
});
