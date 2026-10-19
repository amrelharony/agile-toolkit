import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { SELECTED_SPRINT_KEY, resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";

/**
 * Burnup on a shared sprint: it shows Burndown's readings as worked-out
 * points done (dimmed, labelled, never saved as if typed), saves a scope edit
 * to the shared log, opens on the sprint a `?sprint=` link names, and its
 * length and planned points edit the shared Sprint every tool sees.
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

import { BurnupClient } from "@/app/(tools)/burnup/burnup-client";

const ACTIVE: Sprint = {
  id: "s-active",
  name: "Sprint 8",
  startDate: "2026-10-12",
  endDate: "2026-10-22",
  pointsPlanned: 30,
  status: "active",
};
const DONE: Sprint = {
  id: "s-done",
  name: "Sprint 7",
  startDate: "2026-09-28",
  endDate: "2026-10-10",
  pointsPlanned: 24,
  status: "completed",
};
const ACTIVE_LOG: SprintSeries = {
  id: "s-active",
  days: [
    { day: 1, completed: 4 },
    { day: 2, remaining: 22 }, // logged in Burndown
  ],
};
const DONE_LOG: SprintSeries = { id: "s-done", days: [{ day: 1, completed: 9 }] };

beforeEach(() => {
  spy.logs = [];
  spy.sounds = [];
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burnup");
  useSprintMigrationStore.setState({ status: "idle" });
  useWorkspaceStore.setState({ sprints: [DONE, ACTIVE], sprintSeries: [ACTIVE_LOG, DONE_LOG] });
});

const renderBurnup = () =>
  render(
    <TooltipProvider>
      <BurnupClient />
    </TooltipProvider>
  );
const completed = (day: number) =>
  screen.getByRole("spinbutton", { name: `Completed points on day ${day}` });
const scope = (day: number) =>
  screen.getByRole("spinbutton", { name: `Scope points on day ${day}` });
const commit = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
const sprint = (id: string) => useWorkspaceStore.getState().sprints.find((s) => s.id === id);
const logOf = (id: string) => useWorkspaceStore.getState().sprintSeries?.find((s) => s.id === id);

describe("Burnup on a shared sprint", () => {
  it("shows Burndown's remaining as points done, dimmed and labelled, without saving it", () => {
    renderBurnup();
    // Opens on the active sprint.
    expect(completed(1)).toHaveValue(4);

    const day2 = completed(2);
    expect(day2).toHaveValue(null);
    expect(day2).toHaveAttribute("placeholder", "8");
    expect(day2).toHaveAccessibleDescription("8 from Burndown");
    const caption = document.getElementById(day2.getAttribute("aria-describedby")!);
    expect(caption).toHaveAttribute("data-derived");
    expect(caption).toHaveClass("italic", "text-sub");

    // Focusing and leaving the field doesn't save the worked-out number.
    fireEvent.focus(day2);
    fireEvent.blur(day2);
    expect(logOf("s-active")?.days).toEqual(ACTIVE_LOG.days);

    // Typing over it saves Burnup's own number next to Burndown's.
    commit(day2, "9");
    expect(logOf("s-active")?.days?.find((d) => d.day === 2)).toEqual({
      day: 2,
      remaining: 22,
      completed: 9,
    });
    expect(spy.logs).toContainEqual(["day_logged", { sprintId: "s-active", day: 2, completed: 9 }]);
    expect(spy.sounds).toContain("day-logged");
  });

  it("saves a scope edit to the shared log", () => {
    renderBurnup();
    // A blank day shows the scope in force, carried from the plan.
    expect(scope(3)).toHaveAttribute("placeholder", "30");
    commit(scope(3), "36");
    expect(logOf("s-active")?.days?.find((d) => d.day === 3)).toEqual({ day: 3, scope: 36 });
    expect(scope(5)).toHaveAttribute("placeholder", "36");
    expect(spy.logs).toContainEqual(["scope_changed", { sprintId: "s-active", day: 3, scope: 36 }]);
    expect(spy.sounds).toContain("scope-increase");

    // Clearing it removes the scope again.
    commit(scope(3), "");
    expect(logOf("s-active")?.days?.find((d) => d.day === 3)).toBeUndefined();
  });

  it("opens on the sprint a ?sprint= link names", () => {
    window.history.replaceState(null, "", "/burnup?sprint=s-done");
    renderBurnup();
    expect(completed(1)).toHaveValue(9);
    expect(screen.getByLabelText("First day")).toHaveValue("2026-09-28");
    expect(screen.getByRole("combobox", { name: "Sprint" })).toHaveTextContent("Sprint 7");
    // The choice is shared with the other sprint tools.
    expect(window.localStorage.getItem(SELECTED_SPRINT_KEY)).toBe("s-done");
  });

  it("edits the shared Sprint's length and planned points", () => {
    renderBurnup();
    expect(
      screen.getByText("Shared with Burndown, Velocity and Sprint Metrics.", { exact: false })
    ).toBeInTheDocument();

    const length = screen.getByLabelText("Length (days)");
    expect(length).toHaveValue(10);
    commit(length, "14");
    expect(sprint("s-active")).toMatchObject({ startDate: "2026-10-12", endDate: "2026-10-26" });
    expect(
      screen.getByRole("spinbutton", { name: "Completed points on day 14" })
    ).toBeInTheDocument();

    const points = screen.getByLabelText("Planned points");
    commit(points, "34");
    expect(sprint("s-active")?.pointsPlanned).toBe(34);
    // The plan is day 0's scope.
    expect(scope(0)).toHaveAccessibleDescription("34 from the plan");

    // Moving the start keeps the length.
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-10-13" } });
    expect(sprint("s-active")).toMatchObject({ startDate: "2026-10-13", endDate: "2026-10-27" });

    expect(spy.logs).toEqual([
      ["config_updated", { sprintId: "s-active", sprintDays: 14 }],
      ["config_updated", { sprintId: "s-active", totalPoints: 34 }],
      ["config_updated", { sprintId: "s-active", sprintStartDate: "2026-10-13" }],
    ]);
  });
});
