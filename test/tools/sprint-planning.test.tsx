import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, CapacityPlan, Sprint, Story } from "@/lib/stores/workspace-types";
import { BACKLOG_DEFAULTS } from "@/lib/prioritization/frameworks";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";

/**
 * Sprint Planning: capacity and velocity, the goal, stories in and out of
 * the sprint (ticked, filled to capacity, imported from the shared backlog,
 * typed), the unsized ones queued for Poker, and the commitment that starts
 * the sprint — all on the shared sprint and stories.
 */

const logs = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: (action: string) => logs.push(action), toolRunId: "test" }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
const undo = vi.hoisted(() => ({ last: null as null | { revert: () => void } }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/sprint-planning",
}));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [DEFAULT_CADENCE, () => {}] };
});

import { SprintPlanning } from "@/app/(tools)/sprint-planning/planning";

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
  pointsPlanned: 0,
  status: "planned",
};
const STORIES: Story[] = [
  { id: "i1", title: "Pay with a saved card", status: "todo", sprintId: "s2", points: 8 },
  { id: "b1", title: "Remove a saved card", status: "backlog", points: 5, priorityScore: 9 },
  { id: "b2", title: "Card expiry reminders", status: "backlog", points: 3, priorityScore: 8 },
  { id: "b3", title: "Fraud checks", status: "backlog", priorityScore: 7 },
];
const ITEMS: BacklogItem[] = [
  {
    ...BACKLOG_DEFAULTS,
    id: "bi1",
    name: "Refund flow",
    businessValue: 9,
    timeCriticality: 6,
    riskReduction: 3,
    jobSize: 3,
  },
  { ...BACKLOG_DEFAULTS, id: "bi2", name: "remove a saved card" }, // already a story
];
const PLAN: CapacityPlan = {
  id: "capacity-planner:current",
  members: [
    { id: "m1", name: "Ann", role: "Dev", availability: 80, daysOff: 1 },
    { id: "m2", name: "Bob", role: "QA", availability: 100, daysOff: 0 },
  ],
  config: {
    sprintDays: 10,
    hoursPerDay: 8,
    focusFactor: 0.8,
    ceremonyOverhead: 15,
    pointsCommitted: "",
  },
};

const state = () => useWorkspaceStore.getState();
const story = (id: string) => state().stories.find((s) => s.id === id);

beforeEach(() => {
  logs.length = 0;
  undo.last = null;
  router.push.mockClear();
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({
    sprints: [S1, S2],
    sprintSeries: [],
    stories: STORIES.map((s) => ({ ...s })),
    backlogItems: ITEMS,
    capacityPlans: [PLAN],
    pokerEstimationLogs: [],
  });
});

afterEach(() => {
  useWorkspaceStore.setState({
    sprints: [],
    stories: [],
    backlogItems: [],
    capacityPlans: [],
    pokerEstimationLogs: [],
  });
});

describe("Sprint Planning", () => {
  it("opens on the newest sprint with capacity, velocity and the current plan", () => {
    const { container } = render(<SprintPlanning />);
    expect(container.querySelector('[data-field="capacity-hours"]')?.textContent).toBe("93.6 h");
    expect(container.querySelector('[data-field="velocity"]')?.textContent).toBe("26 pts");
    expect(container.querySelector('[data-field="commitment"]')?.textContent).toContain(
      "1 story · 8 points against 26 points of capacity (31%)"
    );
    expect(screen.getByRole("list", { name: "Things to check" })).toHaveTextContent("no goal yet");
    expect(screen.getByRole("button", { name: "Start the sprint" })).toBeInTheDocument();
  });

  it("saves the goal on blur", () => {
    render(<SprintPlanning />);
    const goal = screen.getByLabelText("Sprint goal");
    fireEvent.change(goal, { target: { value: "Customers can pay with a saved card" } });
    fireEvent.blur(goal);
    expect(state().sprints.find((s) => s.id === "s2")?.goal).toBe(
      "Customers can pay with a saved card"
    );
  });

  it("moves stories in and out of the sprint", () => {
    render(<SprintPlanning />);
    fireEvent.click(screen.getByLabelText("Add to sprint: Remove a saved card"));
    expect(story("b1")).toMatchObject({ sprintId: "s2", status: "todo" });
    fireEvent.click(screen.getByLabelText("Remove from sprint: Pay with a saved card"));
    expect(story("i1")).toMatchObject({ status: "backlog" });
    expect(story("i1")?.sprintId).toBeUndefined();
  });

  it("adds a typed story to the sprint", () => {
    render(<SprintPlanning />);
    fireEvent.change(screen.getByLabelText("New story"), {
      target: { value: "Receipts by email" },
    });
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const added = state().stories.find((s) => s.title === "Receipts by email");
    expect(added).toMatchObject({ sprintId: "s2", status: "todo", points: 2 });
    expect(logs).toContain("story_added");
  });

  it("fills to capacity from the backlog by priority, with Undo", () => {
    render(<SprintPlanning />);
    // 26 (velocity) − 8 planned = 18 points of room: b1 (5) and b2 (3) fit; b3 has no points.
    fireEvent.click(screen.getByRole("button", { name: "Fill to capacity" }));
    expect(story("b1")?.sprintId).toBe("s2");
    expect(story("b2")?.sprintId).toBe("s2");
    expect(story("b3")?.sprintId).toBeUndefined();
    expect(logs).toContain("filled_to_capacity");
    undo.last?.revert();
    expect(story("b1")).toMatchObject({ status: "backlog" });
    expect(story("b1")?.sprintId).toBeUndefined();
  });

  it("imports only the backlog items that aren't stories yet", () => {
    render(<SprintPlanning />);
    fireEvent.click(screen.getByRole("button", { name: "Import from the backlog (1)" }));
    const imported = state().stories.filter((s) => s.title === "Refund flow");
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ status: "backlog", priorityScore: 6 });
    expect(screen.getByRole("button", { name: "Import from the backlog" })).toBeDisabled();
  });

  it("queues the unsized sprint stories for Planning Poker", () => {
    fireEvent.click(render(<SprintPlanning />).getByLabelText("Add to sprint: Fraud checks"));
    fireEvent.click(screen.getByRole("button", { name: "Estimate 1 in Planning Poker" }));
    const queue = state().pokerEstimationLogs?.find((l) => l.id === POKER_LOG_ID)?.queue ?? [];
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      title: "Fraud checks",
      sourceRef: { tool: "story", id: "b3" },
    });
    // A second click doesn't queue it twice.
    fireEvent.click(screen.getByRole("button", { name: "Estimate 1 in Planning Poker" }));
    expect(state().pokerEstimationLogs?.find((l) => l.id === POKER_LOG_ID)?.queue).toHaveLength(1);
  });

  it("starts the sprint with the planned points and opens the cockpit", () => {
    render(<SprintPlanning />);
    fireEvent.click(screen.getByLabelText("Add to sprint: Remove a saved card"));
    fireEvent.click(screen.getByRole("button", { name: "Start the sprint" }));
    expect(state().sprints.find((s) => s.id === "s2")).toMatchObject({
      status: "active",
      pointsPlanned: 13,
    });
    expect(logs).toContain("sprint_committed");
    expect(router.push).toHaveBeenCalledWith("/sprint");
    undo.last?.revert();
    expect(state().sprints.find((s) => s.id === "s2")).toMatchObject({
      status: "planned",
      pointsPlanned: 0,
    });
  });

  it("exports the plan as Markdown", () => {
    render(<SprintPlanning />);
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Sprint 2 — plan");
    expect(md).toContain("**Commitment:** 8 points in 1 story (target 26)");
    expect(md).toContain("| Pay with a saved card | 8 | todo |  |");
  });

  it("asks for a sprint first when there is none", () => {
    useWorkspaceStore.setState({ sprints: [] });
    render(<SprintPlanning />);
    expect(screen.getByRole("heading", { name: "No sprint to plan yet" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: "Create the sprint" })).getByText(
        "Create the sprint"
      )
    ).toBeInTheDocument();
  });
});
