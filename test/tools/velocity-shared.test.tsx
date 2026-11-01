import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Velocity's rows are the shared workspace sprints: an edit writes the
 * Sprint at once, a new sprint is planned with no completed points, removing
 * one offers Undo that brings back the sprint and its daily log, and the
 * example is a preview that writes nothing. The old local store
 * (`agile-toolkit:velocity`) is never read or written.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
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
  useHistoryLogger: () => ({ log: history.log }),
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

import { VelocityClient } from "@/app/(tools)/velocity/velocity-client";

const LEGACY_KEY = "agile-toolkit:velocity";
const LEGACY_VALUE = JSON.stringify({
  state: { sprints: [{ id: "old", name: "Old", committed: 30, completed: 28 }] },
  version: 0,
});

const S1: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2025-01-06",
  endDate: "2025-01-20",
  goal: "Checkout v1",
  pointsPlanned: 30,
  pointsCompleted: 28,
  status: "completed",
};
const S2: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2025-01-20",
  endDate: "2025-02-03",
  pointsPlanned: 32,
  pointsCompleted: 33,
  status: "completed",
};
// Ended long ago but never closed.
const S3: Sprint = {
  id: "s3",
  name: "Sprint 3",
  startDate: "2025-02-03",
  endDate: "2025-02-17",
  pointsPlanned: 34,
  status: "planned",
};
// Still running (its end date is far ahead).
const S4: Sprint = {
  id: "s4",
  name: "Sprint 4",
  startDate: "2099-01-05",
  endDate: "2099-01-19",
  pointsPlanned: 35,
  status: "active",
};
const S2_SERIES: SprintSeries = {
  id: "s2",
  days: [
    { day: 0, remaining: 32 },
    { day: 3, remaining: 20, note: "Payments merged" },
  ],
  ratings: { Quality: 7 },
};

const ws = () => useWorkspaceStore.getState();
const sprint = (id: string) => ws().sprints.find((s) => s.id === id);

const renderVelocity = () =>
  render(
    <TooltipProvider>
      <VelocityClient />
    </TooltipProvider>
  );

const names = () =>
  screen
    .queryAllByRole("textbox", { name: "Sprint name" })
    .map((i) => (i as HTMLInputElement).value);
const committed = () =>
  screen
    .queryAllByRole("spinbutton", { name: /^Committed points for/ })
    .map((i) => (i as HTMLInputElement).value);
const completed = () =>
  screen
    .queryAllByRole("spinbutton", { name: /^Completed points for/ })
    .map((i) => (i as HTMLInputElement).value);

function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

beforeEach(() => {
  undo.last = null;
  history.log.mockClear();
  resetSelectedSprint();
  window.localStorage.clear();
  window.localStorage.setItem(LEGACY_KEY, LEGACY_VALUE);
  useSprintMigrationStore.setState({ status: "idle" });
  // Stored out of order: the tool sorts oldest first.
  useWorkspaceStore.setState({ sprints: [S3, S1, S4, S2], sprintSeries: [S2_SERIES] });
});
afterEach(() => {
  // The legacy key is package M's: Velocity never touches it.
  expect(window.localStorage.getItem(LEGACY_KEY)).toBe(LEGACY_VALUE);
  useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
});

describe("Velocity rows are the shared sprints", () => {
  it("lists the workspace sprints oldest first, with their points", () => {
    renderVelocity();
    expect(names()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4"]);
    expect(committed()).toEqual(["30", "32", "34", "35"]);
    expect(completed()).toEqual(["28", "33", "", ""]);
    expect(screen.getByRole("textbox", { name: "Goal for Sprint 1" })).toHaveValue("Checkout v1");

    // Only finished sprints count, graded: 28 of 30 and 33 of 32 both met
    // it (90–110%).
    expect(screen.getByText("2 of 2")).toBeInTheDocument();

    // A sprint saved elsewhere (another tool, an agent) shows up at once.
    act(() =>
      ws().upsertSprint({
        ...S4,
        id: "s5",
        name: "Sprint 5",
        startDate: "2099-01-19",
        endDate: "2099-02-02",
        status: "planned",
      })
    );
    expect(names()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4", "Sprint 5"]);
  });

  it("writes each edit to the sprint straight away", () => {
    renderVelocity();

    commit(screen.getByRole("spinbutton", { name: "Committed points for Sprint 1" }), "31");
    expect(sprint("s1")?.pointsPlanned).toBe(31);
    expect(history.log).toHaveBeenLastCalledWith("sprint_updated", {
      sprintId: "s1",
      field: "committed",
      value: 31,
    });

    commit(screen.getByRole("textbox", { name: "Goal for Sprint 1" }), "Checkout v2");
    expect(sprint("s1")?.goal).toBe("Checkout v2");

    commit(screen.getAllByRole("textbox", { name: "Sprint name" })[1], "Sprint Two");
    expect(sprint("s2")?.name).toBe("Sprint Two");

    // A blank name isn't saved; the field goes back to the stored one.
    const first = screen.getAllByRole("textbox", { name: "Sprint name" })[0];
    commit(first, "  ");
    expect(sprint("s1")?.name).toBe("Sprint 1");
    expect(first).toHaveValue("Sprint 1");

    // Completed points on a sprint whose end date has passed are saved, and
    // closing it is asked, never done as a side effect of typing.
    commit(screen.getByRole("spinbutton", { name: "Completed points for Sprint 3" }), "29");
    expect(sprint("s3")).toMatchObject({ pointsCompleted: 29, status: "planned" });
    expect(history.log).toHaveBeenLastCalledWith("sprint_updated", {
      sprintId: "s3",
      field: "completed",
      value: 29,
    });
    expect(screen.getByText("Sprint 3 has ended. Close it?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Sprint 3" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("spinbutton", { name: /Completed points/ })).toHaveValue(29);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close sprint" }));
    expect(sprint("s3")).toMatchObject({ pointsCompleted: 29, status: "completed" });
    expect(undo.last?.label).toBe("Closed Sprint 3 with 29 points done");

    // A sprint still running keeps its status until the user closes it.
    commit(screen.getByRole("spinbutton", { name: "Completed points for Sprint 4" }), "12");
    expect(sprint("s4")).toMatchObject({ pointsCompleted: 12, status: "active" });
    expect(screen.getByText("Counts once the sprint is done.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark done for Sprint 4" }));
    // Mark done asks first, through the same dialog.
    expect(sprint("s4")?.status).toBe("active");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close sprint" })
    );
    expect(sprint("s4")?.status).toBe("completed");

    // Clearing completed points keeps the status and asks nothing.
    commit(screen.getByRole("spinbutton", { name: "Completed points for Sprint 1" }), "");
    expect(sprint("s1")?.pointsCompleted).toBeUndefined();
    expect(sprint("s1")?.status).toBe("completed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Adding a sprint", () => {
  it("plans the next sprint with its commitment and no completed points", () => {
    renderVelocity();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Points to commit/ }), {
      target: { value: "36" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    // Commit opens the New sprint dialog, prefilled, so nothing is saved unseen.
    expect(ws().sprints.find((s) => s.name === "Sprint 5")).toBeUndefined();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("spinbutton", { name: /points/i })).toHaveValue(36);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sprint" }));

    const created = ws().sprints.find((s) => s.name === "Sprint 5");
    expect(created).toMatchObject({
      status: "planned",
      pointsPlanned: 36,
      // Starts the day after the latest sprint ends, as long as it ran.
      startDate: "2099-01-20",
      endDate: "2099-02-03",
    });
    expect(created?.pointsCompleted).toBeUndefined();
    expect(names()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4", "Sprint 5"]);
    expect(history.log).toHaveBeenLastCalledWith(
      "next_sprint_planned",
      expect.objectContaining({ sprintId: created?.id, committed: 36 })
    );
  });

  it("creates a sprint from the dialog without inventing points", () => {
    renderVelocity();
    fireEvent.click(screen.getByRole("button", { name: "Add sprint" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: /Name/ })).toHaveValue("Sprint 5");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sprint" }));

    const created = ws().sprints.find((s) => s.name === "Sprint 5");
    expect(created).toMatchObject({ status: "planned", pointsPlanned: 0 });
    expect(created?.pointsCompleted).toBeUndefined();
    expect(completed()).toEqual(["28", "33", "", "", ""]);

    // The new sprint is the one every sprint tool now shows.
    const rows = document.querySelectorAll('[aria-current="true"]');
    expect(rows).toHaveLength(1);
    expect(
      within(rows[0] as HTMLElement).getByRole("textbox", { name: "Sprint name" })
    ).toHaveValue("Sprint 5");
  });
});

describe("Removing a sprint", () => {
  it("removes it everywhere and Undo brings back the sprint and its log", () => {
    renderVelocity();
    fireEvent.click(screen.getByRole("button", { name: "Remove Sprint 2" }));
    expect(undo.last?.label).toBe("Removed “Sprint 2” from every sprint tool");
    expect(sprint("s2")).toBeUndefined();
    expect(ws().sprintSeries?.find((s) => s.id === "s2")).toBeUndefined();
    expect(names()).toEqual(["Sprint 1", "Sprint 3", "Sprint 4"]);
    expect(history.log).toHaveBeenLastCalledWith("sprint_removed", {
      sprintId: "s2",
      name: "Sprint 2",
    });

    act(() => undo.last!.revert());
    expect(sprint("s2")).toEqual(S2);
    expect(ws().sprintSeries?.find((s) => s.id === "s2")).toEqual(S2_SERIES);
    expect(names()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4"]);
  });
});

describe("Velocity with no sprints", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
  });

  it("previews the example without writing it", () => {
    renderVelocity();
    expect(screen.getByText(/No sprints yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getByText("Sprint 5")).toBeInTheDocument();
    // Read-only: nothing to type into, nothing to remove.
    expect(names()).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(ws().sprints).toEqual([]);
    expect(ws().sprintSeries).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No sprints yet/)).toBeInTheDocument();
    expect(ws().sprints).toEqual([]);
  });

  it("says it is loading while old sprint data is being moved", () => {
    useSprintMigrationStore.setState({ status: "pending" });
    renderVelocity();
    expect(screen.getByText("Loading sprints…")).toBeInTheDocument();
    expect(screen.queryByText(/No sprints yet/)).toBeNull();
    act(() => useSprintMigrationStore.setState({ status: "done" }));
    expect(screen.getByText(/No sprints yet/)).toBeInTheDocument();
  });
});

describe("Sprints without real dates", () => {
  it("links to the cockpit to set them, and asks before closing", () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "legacy-1",
          name: "Sprint 1",
          startDate: "2020-01-01",
          endDate: "",
          pointsPlanned: 30,
          status: "planned",
        },
      ],
      sprintSeries: [],
    });
    renderVelocity();
    // The cockpit's header edits a sprint's details now.
    expect(screen.getByRole("link", { name: "Set dates" })).toHaveAttribute(
      "href",
      "/sprint?sprint=legacy-1"
    );
    commit(screen.getByRole("spinbutton", { name: "Completed points for Sprint 1" }), "27");
    expect(sprint("legacy-1")).toMatchObject({ pointsCompleted: 27, status: "planned" });
    expect(screen.getByText("Sprint 1 has ended. Close it?")).toBeInTheDocument();
  });
});
