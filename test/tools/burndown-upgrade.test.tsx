import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import "@/lib/actions/tools/burndown";

/**
 * Burndown's Phase 5 upgrade: the points left come from the sprint board's
 * stories (the typed log is the labelled fallback, switchable when both hold
 * something), the ideal line counts the team's working days, the gap, the %
 * done and the projected finish are the shared ones, Holt and CUSUM sit in
 * a closed Advanced section behind a minimum sample, input that can't be
 * saved says why, and the page and tool.burndown.status quote one number.
 */

const spy = vi.hoisted(() => ({
  logs: [] as Array<[string, Record<string, unknown> | undefined]>,
  exported: { markdown: "", csv: null as null | { headers: string[]; rows: unknown[][] } },
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    markdown,
    csvData,
  }: {
    markdown?: string;
    csvData?: { headers: string[]; rows: unknown[][] };
  }) => {
    spy.exported.markdown = markdown ?? "";
    spy.exported.csv = csvData ?? null;
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

import { BurndownClient } from "@/app/(tools)/burndown/burndown-client";

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

/** 38 planned; +7 on day 3, −5 on day 4; 8 done on day 2, 5 on day 4. */
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
    points: 10,
    status: "in_progress",
    sprintId: "s1",
    sprintHistory: [joined("2026-10-05", 10)],
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
  {
    id: "f",
    title: "Legacy",
    points: 10,
    status: "todo",
    sprintId: "s1",
    sprintHistory: [joined("2026-10-05", 10)],
  },
];

const setToday = (y: number, m: number, d: number) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(y, m - 1, d, 9, 0, 0));
};

beforeEach(() => {
  spy.logs = [];
  spy.exported = { markdown: "", csv: null };
  setToday(2026, 10, 12);
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burndown");
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

const renderBurndown = () =>
  render(
    <TooltipProvider>
      <BurndownClient />
    </TooltipProvider>
  );
const tile = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-tile="${id}"]`) as HTMLElement;
const verdict = (container: HTMLElement) =>
  container.querySelector("[data-burn-verdict]")?.textContent ?? "";
const remaining = (day: number) =>
  screen.getByRole("spinbutton", { name: `Remaining points on day ${day}` });
const commit = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
const seriesDays = () =>
  useWorkspaceStore.getState().sprintSeries?.find((s) => s.id === "s1")?.days;

describe("the board as the source", () => {
  it("says where the sprint stands, from the board, on working days", () => {
    const { container } = renderBurndown();
    // Ideal on day 7: 38 × (1 − 5/10) = 19 (the weekend didn't burn); 27 left.
    expect(verdict(container)).toMatch(
      /^Day 7 of 14: 13 of 40 points done, behind by 8 points; at this pace it finishes on day \d+, \d+ days late\.$/
    );
    expect(tile(container, "remaining")).toHaveTextContent("27");
    expect(tile(container, "remaining")).toHaveTextContent("On day 7 · from the board");
    expect(tile(container, "gap")).toHaveTextContent("Behind by 8 points");
    expect(tile(container, "gap")).toHaveTextContent("Ideal: 19 left on day 7");
    // Done is of the current scope (40), not the plan (38).
    expect(tile(container, "done")).toHaveTextContent("13");
    expect(tile(container, "done")).toHaveTextContent("of 40 points");
    expect(tile(container, "done")).toHaveTextContent("33% of the current scope");
    expect(tile(container, "finish")).toHaveTextContent(/Day \d+/);
    expect(tile(container, "finish")).toHaveTextContent(/after the last day \(day 14\)/);

    // One source: a label, not a switch, and a way to the board.
    expect(screen.queryByRole("button", { name: "From the typed log" })).toBeNull();
    expect(screen.getAllByText("From the sprint board").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Move stories on the sprint board/ })).toHaveAttribute(
      "href",
      "/kanban?sprint=s1"
    );

    // The days, read-only, with what joined and left.
    const days = screen.getByRole("list", { name: "Points left by day, from the board" });
    const items = within(days).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    expect(items[3]).toHaveTextContent("37 left");
    expect(items[3]).toHaveTextContent("+7 added");
    expect(items[4]).toHaveTextContent("27 left · 5 done that day · −5 removed");
    expect(items[5]).toHaveTextContent("Sat");
    // The typed log is still there, as the fallback.
    expect(screen.getByText("Daily log (fallback)")).toBeInTheDocument();

    const figure = screen.getByRole("figure", { name: "Burndown chart" });
    expect(figure).toHaveAccessibleDescription(
      "Remaining points fell from 38 to 27 over 7 days; 8 points behind the ideal line. Days off are shaded: the ideal line stays flat across them."
    );
  });

  it("exports the burn as Markdown and CSV, with the source and the scope moves", () => {
    renderBurndown();
    const md = spy.exported.markdown;
    expect(md).toContain("**Source:** From the sprint board");
    expect(md).toContain(
      "**Day 7:** 27 points left, ideal 19: behind by 8 points (33% of the scope done)"
    );
    expect(md).toContain("**Scope:** The scope grew by 7 and lost 5 points since day 0 (38 → 40)");
    expect(md).toContain("- Day 3: +7 points");
    expect(md).toContain("- Day 4: −5 points");
    expect(md).toContain("| 5 | 10 Oct 2026 | Weekend | 19 | 27 |  |  |  |");
    expect(spy.exported.csv?.headers).toEqual([
      "Day",
      "Date",
      "Day off",
      "Source",
      "Ideal (pts)",
      "Remaining (pts)",
      "Done (pts)",
      "Scope (pts)",
      "Added",
      "Removed",
      "Note",
    ]);
    expect(spy.exported.csv?.rows[3]).toEqual([
      3,
      "2026-10-08",
      "",
      "stories",
      26.6,
      37,
      8,
      45,
      7,
      "",
      "",
    ]);
  });

  it("quotes the same numbers as tool.burndown.status", async () => {
    const { container } = renderBurndown();
    const action = registry.get("tool.burndown.status")!;
    const r = (await action.handler(action.paramsSchema.parse({}), {
      userId: "u",
      source: "agent",
      squadProfileIds: [],
    })) as Record<string, unknown>;
    expect(r).toMatchObject({
      found: true,
      source: "stories",
      remaining: 27,
      gapLabel: "Behind by 8 points",
      completionPct: 33,
      scopeAdded: 7,
      scopeRemoved: 5,
    });
    expect(verdict(container)).toBe(r.verdict);
    expect(tile(container, "finish")).toHaveTextContent(
      `Day ${Math.ceil(r.projectedFinishDay as number)}`
    );
  });
});

describe("the typed log, the labelled fallback", () => {
  const LOG: SprintSeries = {
    id: "s1",
    days: [
      { day: 0, remaining: 38 },
      { day: 2, remaining: 20 },
    ],
  };

  it("ignores typed numbers while the board has points, and switches on request", () => {
    useWorkspaceStore.setState({ sprintSeries: [LOG] });
    const { container } = renderBurndown();
    expect(screen.getByRole("button", { name: "From the board" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(remaining(2)).toHaveValue(20);
    expect(remaining(2)).toHaveAccessibleDescription(
      "Not used while the board has pointed stories"
    );
    expect(tile(container, "remaining")).toHaveTextContent("27");

    fireEvent.click(screen.getByRole("button", { name: "From the typed log" }));
    expect(screen.getByRole("button", { name: "From the typed log" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(tile(container, "remaining")).toHaveTextContent("20");
    expect(tile(container, "remaining")).toHaveTextContent("On day 2 · from the typed log");
    expect(verdict(container)).toMatch(/^Day 7 of 14: 18 of 38 points done, ahead by 10\.4 points/);
    expect(spy.logs).toContainEqual(["source_switched", { sprintId: "s1", source: "log" }]);
    // In the log view the log is the section, not a disclosure.
    expect(screen.queryByText("Daily log (fallback)")).toBeNull();
    expect(remaining(2)).not.toHaveAccessibleDescription();
  });

  it("is the source without pointed stories, and says nothing is recorded before a reading", () => {
    useWorkspaceStore.setState({ stories: [] });
    const { container } = renderBurndown();
    expect(verdict(container)).toBe(
      "Day 7 of 14: nothing recorded yet. Point the sprint's stories and move them on the board, or log the points left each day."
    );
    expect(tile(container, "remaining")).toHaveTextContent("Not logged yet");
    expect(tile(container, "gap")).toHaveTextContent("—");
    expect(tile(container, "done")).toHaveTextContent("—");
    expect(tile(container, "finish")).toHaveTextContent("No trend yet");
    expect(screen.getAllByText("Nothing recorded yet").length).toBeGreaterThan(0);

    commit(remaining(7), "30");
    expect(seriesDays()).toEqual([{ day: 7, remaining: 30 }]);
    expect(tile(container, "remaining")).toHaveTextContent("30");
    expect(tile(container, "remaining")).toHaveTextContent("from the typed log");
    expect(screen.getAllByText("Typed in the daily log").length).toBeGreaterThan(0);
  });

  it("refuses what it can't save, keeps the text and says why", () => {
    useWorkspaceStore.setState({ stories: [] });
    renderBurndown();
    commit(remaining(1), "-3");
    expect(remaining(1)).toHaveValue(-3);
    expect(remaining(1)).toHaveAttribute("aria-invalid", "true");
    expect(remaining(1)).toHaveAccessibleDescription("Enter 0 or more points left.");
    expect(seriesDays()).toBeUndefined();

    commit(remaining(1), "250000");
    expect(remaining(1)).toHaveAccessibleDescription("Enter at most 100000 points left.");
    expect(seriesDays()).toBeUndefined();

    // Escape drops the draft and its message.
    fireEvent.change(remaining(1), { target: { value: "-1" } });
    fireEvent.keyDown(remaining(1), { key: "Escape" });
    expect(remaining(1)).toHaveValue(null);
    expect(remaining(1)).not.toHaveAttribute("aria-invalid");

    commit(remaining(1), "33");
    expect(seriesDays()).toEqual([{ day: 1, remaining: 33 }]);
    expect(remaining(1)).not.toHaveAttribute("aria-invalid");
  });
});

describe("the sprint settings", () => {
  const sprint = () => useWorkspaceStore.getState().sprints.find((s) => s.id === "s1");

  it("validates the length and the planned points, and saves the first day on blur", () => {
    renderBurndown();
    const length = screen.getByLabelText("Length (days)");
    expect(length).toHaveAccessibleDescription(/10 working days/);
    commit(length, "0");
    expect(length).toHaveAccessibleDescription(/A sprint lasts 1 to 60 days\./);
    commit(length, "61");
    expect(sprint()?.endDate).toBe("2026-10-19");
    commit(length, "7.5");
    expect(length).toHaveAccessibleDescription(/Enter a whole number of days\./);
    commit(length, "21");
    expect(sprint()?.endDate).toBe("2026-10-26");

    const points = screen.getByLabelText("Planned points");
    commit(points, "");
    expect(points).toHaveAccessibleDescription(/Enter the points the team committed to\./);
    expect(sprint()?.pointsPlanned).toBe(38);
    commit(points, "42");
    expect(sprint()?.pointsPlanned).toBe(42);

    const first = screen.getByLabelText("First day");
    fireEvent.change(first, { target: { value: "0002-10-06" } });
    fireEvent.blur(first);
    expect(sprint()?.startDate).toBe("2026-10-05");
    expect(first).toHaveAttribute("aria-invalid", "true");
    commit(first, "2026-10-06");
    expect(sprint()).toMatchObject({ startDate: "2026-10-06", endDate: "2026-10-27" });
    expect(spy.logs.filter(([a]) => a === "config_updated").map(([, p]) => p)).toEqual([
      { sprintId: "s1", sprintDays: 21 },
      { sprintId: "s1", totalPoints: 42 },
      { sprintId: "s1", sprintStartDate: "2026-10-06" },
    ]);
  });
});

describe("Advanced analysis", () => {
  it("is closed, and Holt and CUSUM wait for their minimum sample", () => {
    setToday(2026, 10, 7); // day 2: three working days sampled
    renderBurndown();
    const summary = screen.getByText("Advanced analysis: forecast and pace shifts");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(
      within(details).getByText("Log 1 more working day to see a forecast.")
    ).toBeInTheDocument();
    expect(
      within(details).getByText("Log 5 more working days to see pace shifts.")
    ).toBeInTheDocument();
    // Nothing statistical on the main chart's text.
    const figure = screen.getByRole("figure", { name: "Burndown chart" });
    expect(figure.textContent).not.toMatch(/Forecast|CUSUM/);
  });

  it("forecasts once there are enough working days", () => {
    renderBurndown(); // day 7: days 0–4 and 7 are working days, six samples
    const details = screen
      .getByText("Advanced analysis: forecast and pace shifts")
      .closest("details") as HTMLDetailsElement;
    act(() => {
      details.open = true;
    });
    expect(
      within(details).getByRole("figure", { name: "Forecast of the points left" })
    ).toHaveAccessibleDescription(
      /^Holt's forecast from 6 working days: about [\d.]+ points left on day 14/
    );
    expect(
      within(details).getByText("Log 2 more working days to see pace shifts.")
    ).toBeInTheDocument();
  });
});

describe("edges", () => {
  it("can't tell the pace while open stories have no points and the rest are done", () => {
    useWorkspaceStore.setState({
      stories: [BOARD[0], { id: "u", title: "Unsized", status: "todo", sprintId: "s1" }],
    });
    const { container } = renderBurndown();
    expect(tile(container, "gap")).toHaveTextContent("Can't tell yet");
    expect(tile(container, "finish")).toHaveTextContent("Can't tell yet");
    expect(verdict(container)).toMatch(/1 open story has no points yet/);
  });

  it("asks for dates on a sprint without them, sized by the cadence", () => {
    useWorkspaceStore.setState({
      sprints: [{ ...SPRINT, startDate: "2020-01-03", endDate: "" }],
      stories: [],
    });
    renderBurndown();
    expect(screen.getByText("Set this sprint's dates to chart it")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Last day/)).toHaveValue("2026-10-26");
  });
});
