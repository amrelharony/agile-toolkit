import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { EXAMPLE_SPRINT_PREFIX } from "@/lib/sprints/example";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import "@/lib/actions/tools/burnup";

/**
 * Burnup's Phase 5 upgrade: the scope and done lines come from the sprint
 * board's stories (the typed log is the labelled fallback), scope removed is
 * counted next to scope added, done is a share of the current scope
 * (clamped), the meet day is the shared least-squares projection on working
 * days, nothing reads 0 before there is data, the statistics wait for their
 * minimum sample in a closed Advanced section, odd typed numbers get a note
 * and bad ones a refusal, there is a Markdown export, and the page and
 * tool.burnup.status agree.
 */

const spy = vi.hoisted(() => ({
  logs: [] as Array<[string, Record<string, unknown> | undefined]>,
  markdown: "",
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    spy.markdown = markdown ?? "";
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => spy.logs.push([action, payload]),
  }),
}));
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => () => {},
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
});

import { BurnupClient } from "@/app/(tools)/burnup/burnup-client";
import { completedWarning } from "@/app/(tools)/burnup/validate";
import { burnupView } from "@/app/(tools)/burnup/view";

const at = (day: string) => `${day}T12:00:00.000Z`;

/** Mon 5 Oct → Mon 19 Oct 2026; today is Monday 12 Oct, day 7. */
const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 7",
  startDate: "2026-10-05",
  endDate: "2026-10-19",
  pointsPlanned: 38,
  status: "active",
};
const joined = (day: string, points: number) => ({ sprintId: "s1", at: at(day), points });
const BOARD: Story[] = [
  {
    id: "a",
    title: "Save",
    points: 8,
    status: "done",
    sprintId: "s1",
    doneAt: at("2026-10-07"),
    sprintHistory: [joined("2026-10-05", 8)],
  },
  {
    id: "b",
    title: "Pay",
    points: 5,
    status: "done",
    sprintId: "s1",
    doneAt: at("2026-10-09"),
    sprintHistory: [joined("2026-10-05", 5)],
  },
  {
    id: "c",
    title: "Refund flow",
    points: 20,
    status: "in_progress",
    sprintId: "s1",
    sprintHistory: [joined("2026-10-05", 20)],
  },
  {
    id: "d",
    title: "Refund",
    points: 7,
    status: "todo",
    sprintId: "s1",
    sprintHistory: [joined("2026-10-08", 7)],
  },
  {
    id: "e",
    title: "Analytics",
    points: 5,
    status: "backlog",
    sprintHistory: [joined("2026-10-05", 5), { from: "s1", at: at("2026-10-09"), points: 5 }],
  },
];

beforeEach(() => {
  spy.logs = [];
  spy.markdown = "";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 9, 0, 0));
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burnup");
  useSprintMigrationStore.setState({ status: "idle" });
  useWorkspaceStore.setState({
    sprints: [SPRINT],
    sprintSeries: [],
    stories: BOARD,
    ceremonyCadences: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const renderBurnup = () =>
  render(
    <TooltipProvider>
      <BurnupClient />
    </TooltipProvider>
  );
const tile = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-tile="${id}"]`) as HTMLElement;
const verdict = (container: HTMLElement) =>
  container.querySelector("[data-burn-verdict]")?.textContent ?? "";
const completed = (day: number) =>
  screen.getByRole("spinbutton", { name: `Completed points on day ${day}` });
const scope = (day: number) =>
  screen.getByRole("spinbutton", { name: `Scope points on day ${day}` });
const commit = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
const seriesDays = () =>
  useWorkspaceStore.getState().sprintSeries?.find((s) => s.id === "s1")?.days;

describe("the board as the source", () => {
  it("counts scope added and removed and done of the current scope", () => {
    const { container } = renderBurnup();
    // 38 planned, +7 on day 3, −5 on day 4: 40 now, 13 done.
    expect(verdict(container)).toMatch(
      /^Day 7 of 14: 13 of 40 points done \(33%\); the scope grew by 7 and lost 5 points since day 0; at this pace the work meets the scope on day \d+, \d+ days late\.$/
    );
    expect(tile(container, "done")).toHaveTextContent("13");
    expect(tile(container, "done")).toHaveTextContent("of 40 points");
    expect(tile(container, "done")).toHaveTextContent("33% of the current scope · from the board");
    expect(tile(container, "added")).toHaveTextContent("+7");
    expect(tile(container, "added")).toHaveTextContent("On day 3");
    expect(tile(container, "removed")).toHaveTextContent("−5");
    expect(tile(container, "removed")).toHaveTextContent("On day 4");
    expect(tile(container, "meet")).toHaveTextContent(/Day \d+/);

    const figure = screen.getByRole("figure", { name: "Burnup chart" });
    expect(figure).toHaveAccessibleDescription(
      "13 of 40 points done by day 7 (33%); scope rose from 38 to 40 points. Days off are shaded."
    );
    expect(figure).toHaveTextContent(
      "The scope grew by 7 and lost 5 points since day 0 (38 → 40)."
    );
    const days = screen.getByRole("list", { name: "Scope and points done by day, from the board" });
    const items = within(days).getAllByRole("listitem");
    expect(items[3]).toHaveTextContent("8 of 45 done · +7 added");
    expect(items[4]).toHaveTextContent("13 of 40 done · −5 removed");
  });

  it("exports Markdown with the scope moves and the projected done day", () => {
    renderBurnup();
    expect(spy.markdown).toMatch(/^# Burnup — 12 Oct 2026\n/);
    expect(spy.markdown).toContain("**Source:** From the sprint board");
    expect(spy.markdown).toContain("**Done:** 13 of 40 points (33%)");
    expect(spy.markdown).toContain(
      "**Scope:** The scope grew by 7 and lost 5 points since day 0 (38 → 40)"
    );
    expect(spy.markdown).toMatch(
      /\*\*Projected done:\*\* Day \d+ \(\d+ \w+ 2026\), after the last day/
    );
    expect(spy.markdown).toContain("- Day 3: +7 added");
    expect(spy.markdown).toContain("- Day 4: −5 removed");
    expect(spy.markdown).toContain("| 4 | 9 Oct 2026 |  | 40 | 13 |  | 5 |  |");
  });

  it("quotes the same numbers as tool.burnup.status", async () => {
    const { container } = renderBurnup();
    const action = registry.get("tool.burnup.status")!;
    const r = (await action.handler(action.paramsSchema.parse({}), {
      userId: "u",
      source: "agent",
      squadProfileIds: [],
    })) as Record<string, unknown>;
    expect(r).toMatchObject({
      source: "stories",
      done: 13,
      scopeNow: 40,
      completionPct: 33,
      scopeAdded: 7,
      scopeRemoved: 5,
    });
    expect(verdict(container)).toBe(r.scopeVerdict);
    expect(tile(container, "meet")).toHaveTextContent(
      `Day ${Math.ceil(r.projectedMeetDay as number)}`
    );
  });
});

describe("the typed log", () => {
  it("counts scope removed from the typed scope, and clamps done to the scope", () => {
    const LOG: SprintSeries = {
      id: "s1",
      days: [
        { day: 1, completed: 5 },
        { day: 2, scope: 45, completed: 12 },
        { day: 4, scope: 37, completed: 50 },
      ],
    };
    useWorkspaceStore.setState({ stories: [], sprintSeries: [LOG] });
    const { container } = renderBurnup();
    expect(tile(container, "added")).toHaveTextContent("+7");
    expect(tile(container, "added")).toHaveTextContent("On day 2");
    expect(tile(container, "removed")).toHaveTextContent("−8");
    expect(tile(container, "removed")).toHaveTextContent("On day 4");
    expect(tile(container, "done")).toHaveTextContent("50");
    expect(tile(container, "done")).toHaveTextContent(
      "100% of the current scope · from the typed log"
    );
    expect(tile(container, "meet")).toHaveTextContent("Day 4");
    // 50 done of 37 in scope reads oddly: it is saved, with a note.
    expect(completed(4)).toHaveAccessibleDescription("More than the 37 points in scope that day.");
  });

  it("reads nothing as nothing: no 0%, no green 0 creep", () => {
    useWorkspaceStore.setState({ stories: [] });
    const { container } = renderBurnup();
    expect(tile(container, "done")).toHaveTextContent("Not logged yet");
    expect(tile(container, "added")).toHaveTextContent("—");
    expect(tile(container, "removed")).toHaveTextContent("—");
    expect(tile(container, "meet")).toHaveTextContent("No trend yet");
    expect(container.textContent).not.toMatch(/0 ?%/);
  });

  it("gives the projected tile a neutral tone and a reason when there is no trend", () => {
    useWorkspaceStore.setState({
      stories: [],
      sprintSeries: [
        {
          id: "s1",
          days: [
            { day: 0, completed: 5 },
            { day: 1, completed: 5 },
            { day: 2, completed: 5 },
          ],
        },
      ],
    });
    const { container } = renderBurnup();
    const meet = tile(container, "meet");
    expect(meet).toHaveTextContent("No trend yet");
    expect(meet).toHaveTextContent("The points done aren't climbing");
    expect(meet.innerHTML).not.toMatch(/destructive|danger|warning/);
  });

  it("refuses a bad number and notes a falling running total", () => {
    useWorkspaceStore.setState({
      stories: [],
      sprintSeries: [{ id: "s1", days: [{ day: 2, completed: 10 }] }],
    });
    renderBurnup();
    commit(scope(3), "-1");
    expect(scope(3)).toHaveAttribute("aria-invalid", "true");
    expect(scope(3)).toHaveAccessibleDescription("Enter 0 or more scope points.");
    expect(seriesDays()).toEqual([{ day: 2, completed: 10 }]);

    commit(completed(3), "4");
    expect(seriesDays()).toEqual([
      { day: 2, completed: 10 },
      { day: 3, completed: 4 },
    ]);
    expect(completed(3)).toHaveAccessibleDescription(
      "Lower than day 2's 10: points done is a running total."
    );
    expect(spy.logs).toContainEqual(["day_logged", { sprintId: "s1", day: 3, completed: 4 }]);
  });

  it("words the running-total note from the log view", () => {
    const view = burnupView(SPRINT, {
      id: "s1",
      days: [
        { day: 1, completed: 6 },
        { day: 2, completed: 6 },
        { day: 3, completed: 2 },
      ],
    });
    expect(completedWarning(view.entries, 2)).toBeNull();
    expect(completedWarning(view.entries, 3)).toBe(
      "Lower than day 1's 6: points done is a running total."
    );
    expect(completedWarning(view.entries, 9)).toBeNull();
  });
});

describe("Advanced analysis", () => {
  it("holds the trend test until there are enough working days", () => {
    renderBurnup();
    const details = screen
      .getByText("Advanced analysis: forecast and pace shifts")
      .closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    // Six working days sampled (0–4 and 7): a forecast, not yet a trend test or shifts.
    expect(
      within(details).getByRole("figure", { name: "Forecast of the points done" })
    ).toBeInTheDocument();
    expect(
      within(details).getByText("Log 2 more working days to see pace shifts.")
    ).toBeInTheDocument();
    expect(within(details).queryByText(/to see a trend test/)).toBeNull();
    expect(within(details).getByText(/^Mann-Kendall:/)).toBeInTheDocument();
  });
});

describe("the example", () => {
  it("previews the same example sprint as Burndown and writes nothing", () => {
    useWorkspaceStore.setState({ sprints: [], stories: [] });
    const { container } = renderBurnup();
    expect(screen.getByRole("heading", { name: "No sprints yet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(verdict(container)).toMatch(
      /^Day 5 of 14: 13 of 38 points done \(34%\); the scope grew by 8 and lost 5 points since day 0/
    );
    commit(completed(5), "30");
    const ws = useWorkspaceStore.getState();
    expect(ws.sprints).toEqual([]);
    expect(ws.sprintSeries).toEqual([]);
    expect(spy.logs).toEqual([]);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(EXAMPLE_SPRINT_PREFIX);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("heading", { name: "No sprints yet" })).toBeInTheDocument();
  });
});
