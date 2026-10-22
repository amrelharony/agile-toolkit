import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, Sprint, Story } from "@/lib/stores/workspace-types";
import { BACKLOG_DEFAULTS } from "@/lib/prioritization/frameworks";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";

/**
 * Sprint Planning gap-filling: the Markdown plan, the warning thresholds and
 * the view helpers' edges, then the story table's points cells, the
 * fill-to-capacity refusals, a typed commitment, updating an active sprint
 * and the add-story validation. The main flow is in sprint-planning.test.
 */

const toasts = vi.hoisted(() => ({ calls: [] as { kind: string; message: unknown }[] }));
vi.mock("@/lib/utils/toast", () => {
  const push = (kind: string) => (message: unknown) => {
    toasts.calls.push({ kind, message });
    return 1;
  };
  return {
    toast: Object.assign(push("default"), {
      success: push("success"),
      error: push("error"),
      info: push("info"),
      warning: push("warning"),
    }),
  };
});
const logs = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: (action: string) => logs.push(action), toolRunId: "test" }),
}));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown ?? "";
    return null;
  },
}));
const undo = vi.hoisted(() => ({ last: null as null | { revert: () => void } }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/sprint-planning",
}));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [DEFAULT_CADENCE, () => {}] };
});

import { SprintPlanning } from "@/app/(tools)/sprint-planning/planning";
import { planToMarkdown } from "@/app/(tools)/sprint-planning/markdown";
import {
  backlogStories,
  nameKey,
  planWarnings,
  priorityScore,
  sprintStories,
  storyFromBacklogItem,
} from "@/app/(tools)/sprint-planning/view";

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

const item = (name: string, patch: Partial<BacklogItem> = {}): BacklogItem => ({
  ...BACKLOG_DEFAULTS,
  id: name,
  name,
  ...patch,
});

/* ── Markdown ──────────────────────────────────────────────────────────── */

describe("planToMarkdown", () => {
  const base = {
    sprint: { ...S2, goal: "Pay | fast\nand safely" },
    capacityHours: null,
    targetPoints: null,
    averageVelocity: null,
  };

  it("escapes pipes and newlines in the name, goal and every cell", () => {
    const md = planToMarkdown({
      ...base,
      sprint: { ...base.sprint, name: "Sprint | 2" },
      stories: [
        {
          id: "a",
          title: "Refunds | partial\nand full",
          status: "in_progress",
          points: 5,
          owner: "Ann | Bo",
        },
        { id: "b", title: "Receipts", status: "todo" },
      ],
    });
    expect(md.startsWith("# Sprint \\| 2 — plan\n")).toBe(true);
    expect(md).toContain("**Goal:** Pay \\| fast and safely  ");
    expect(md).toContain("| Refunds \\| partial and full | 5 | in progress | Ann \\| Bo |");
    expect(md).toContain("| Receipts | — | todo |  |");
    expect(md).toContain("**Commitment:** 5 points in 2 stories  ");
    expect(md).not.toContain("**Team capacity:**");
    expect(md).not.toContain("**Recent velocity:**");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("says when nothing is planned, and adds capacity, velocity and the target", () => {
    const md = planToMarkdown({
      sprint: { ...S2, name: "   ", goal: "  " },
      stories: [],
      capacityHours: 93.6,
      targetPoints: 26,
      averageVelocity: 24.5,
    });
    expect(md).toContain("# Sprint — plan");
    expect(md).toContain("**Goal:** not set yet");
    expect(md).toContain("**Dates:** 2026-10-15 → 2026-10-25");
    expect(md).toContain("**Commitment:** 0 points in 0 stories (target 26)");
    expect(md).toContain("**Team capacity:** 93.6 hours");
    expect(md).toContain("**Recent velocity:** 24.5 points");
    expect(md).toContain("## Stories\n\nNone yet.\n");
  });

  it("uses the singular for one story and keeps a target of 0", () => {
    const md = planToMarkdown({
      ...base,
      stories: [{ id: "a", title: "A", status: "done", points: 2 }],
      targetPoints: 0,
    });
    expect(md).toContain("**Commitment:** 2 points in 1 story (target 0)");
  });
});

/* ── View helpers ──────────────────────────────────────────────────────── */

describe("planWarnings thresholds", () => {
  const sized = (points: number): Story => ({
    id: `p${points}`,
    title: `P${points}`,
    status: "todo",
    sprintId: "s2",
    points,
  });
  const sprint = { ...S2, goal: "Ship it" };

  it("allows up to 10% over the target, and flags beyond it", () => {
    const at = planWarnings({ sprint, stories: [sized(22)], targetPoints: 20, otherActive: [] });
    expect(at).toEqual([]);
    const over = planWarnings({ sprint, stories: [sized(23)], targetPoints: 20, otherActive: [] });
    expect(over.map((w) => w.id)).toEqual(["over-capacity"]);
  });

  it("has nothing to compare against with a 0 target", () => {
    expect(
      planWarnings({ sprint, stories: [sized(40)], targetPoints: 0, otherActive: [] })
    ).toEqual([]);
  });

  it("uses plural wording for several unsized stories and several active sprints", () => {
    const w = planWarnings({
      sprint,
      stories: [
        { id: "a", title: "A", status: "todo" },
        { id: "b", title: "B", status: "todo", points: 0 },
      ],
      targetPoints: null,
      otherActive: [
        { ...S1, status: "active" },
        { ...S2, id: "s3", name: "Sprint 3", status: "active" },
      ],
    });
    expect(w.map((x) => x.text)).toEqual([
      "2 stories have no points, so the commitment can't be weighed.",
      "Sprint 1, Sprint 3 are still active; starting this one leaves them open.",
    ]);
  });
});

describe("view helpers", () => {
  it("nameKey trims, folds case and single-spaces", () => {
    expect(nameKey("  Pay   with\ta CARD ")).toBe("pay with a card");
    expect(nameKey("")).toBe("");
  });

  it("priorityScore treats a negative job size as 1 and rounds to two decimals", () => {
    expect(
      priorityScore(
        item("a", { businessValue: 10, timeCriticality: 0, riskReduction: 0, jobSize: -4 })
      )
    ).toBe(10);
    expect(
      priorityScore(
        item("b", { businessValue: 5, timeCriticality: 3, riskReduction: 2, jobSize: 3 })
      )
    ).toBe(3.33);
  });

  it("keeps the backlog to unplanned backlog stories, without touching the input", () => {
    const stories: Story[] = [
      { id: "lo", title: "Lo", status: "backlog", priorityScore: 1 },
      { id: "todo-no-sprint", title: "Loose", status: "todo" },
      { id: "hi", title: "Hi", status: "backlog", priorityScore: 5 },
    ];
    const before = stories.map((s) => s.id);
    expect(backlogStories(stories).map((s) => s.id)).toEqual(["hi", "lo"]);
    expect(stories.map((s) => s.id)).toEqual(before);
  });

  it("keeps the open stories in their order ahead of the done ones", () => {
    const stories: Story[] = [
      { id: "d1", title: "D1", status: "done", sprintId: "s" },
      { id: "o1", title: "O1", status: "review", sprintId: "s" },
      { id: "o2", title: "O2", status: "todo", sprintId: "s" },
    ];
    expect(sprintStories(stories, "s").map((s) => s.id)).toEqual(["o1", "o2", "d1"]);
    expect(sprintStories(stories, "none")).toEqual([]);
  });

  it("caps an imported story's title at 200 characters", () => {
    const s = storyFromBacklogItem(item(`  ${"x".repeat(250)}  `), "id1");
    expect(s.title).toHaveLength(200);
  });
});

/* ── The page ──────────────────────────────────────────────────────────── */

const state = () => useWorkspaceStore.getState();
const story = (id: string) => state().stories.find((s) => s.id === id);
const sprint = (id: string) => state().sprints.find((s) => s.id === id);

function seed(sprints: Sprint[] = [S1, S2], stories: Story[] = STORIES) {
  useWorkspaceStore.setState({
    sprints,
    sprintSeries: [],
    stories: stories.map((s) => ({ ...s })),
    backlogItems: [],
    capacityPlans: [],
    pokerEstimationLogs: [],
  });
}

beforeEach(() => {
  toasts.calls.length = 0;
  logs.length = 0;
  undo.last = null;
  exported.markdown = "";
  resetSelectedSprint();
  window.localStorage.clear();
  seed();
});
afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], stories: [], backlogItems: [], capacityPlans: [] });
});

describe("points cells", () => {
  it("save on blur or Enter, and a blank clears the points", () => {
    render(<SprintPlanning />);
    const inSprint = screen.getByLabelText("Points for Pay with a saved card");
    expect(inSprint).toHaveValue(8);
    fireEvent.change(inSprint, { target: { value: "13" } });
    fireEvent.blur(inSprint);
    expect(story("i1")?.points).toBe(13);

    fireEvent.change(inSprint, { target: { value: "" } });
    fireEvent.blur(inSprint);
    expect(story("i1")?.points).toBeUndefined();
    expect(inSprint).toHaveValue(null);

    const backlog = screen.getByLabelText("Points for Fraud checks");
    fireEvent.change(backlog, { target: { value: "2.5" } });
    fireEvent.keyDown(backlog, { key: "Enter" });
    expect(story("b3")?.points).toBe(2.5);
  });

  it("put a negative number back to the stored points", () => {
    render(<SprintPlanning />);
    const cell = screen.getByLabelText("Points for Remove a saved card");
    fireEvent.change(cell, { target: { value: "-2" } });
    fireEvent.blur(cell);
    expect(story("b1")?.points).toBe(5);
    expect(cell).toHaveValue(5);
  });
});

describe("the backlog table", () => {
  it("separates a story's owner from its priority", () => {
    // Bug: the owner and "Priority N" ran together ("AnnPriority 9") in the backlog list.
    seed([S1, S2], [...STORIES.slice(0, 1), { ...STORIES[1], owner: "Ann" }, ...STORIES.slice(2)]);
    render(<SprintPlanning />);
    const row = screen.getByLabelText("Add to sprint: Remove a saved card").closest("li")!;
    expect(row).toHaveTextContent("Ann · Priority 9");
    const ownerless = screen.getByLabelText("Add to sprint: Fraud checks").closest("li")!;
    expect(within(ownerless).getByText("Priority 7")).toBeInTheDocument();
  });

  it("says a backlog story without a score isn't scored", () => {
    seed([S1, S2], [...STORIES, { id: "b4", title: "Gift cards", status: "backlog" }]);
    render(<SprintPlanning />);
    const row = screen.getByLabelText("Add to sprint: Gift cards").closest("li")!;
    expect(within(row).getByText("Not scored")).toBeInTheDocument();
  });

  it("shows the status and owner of a planned story", () => {
    seed([S1, S2], [{ ...STORIES[0], owner: "Bo" }, ...STORIES.slice(1)]);
    render(<SprintPlanning />);
    const row = screen.getByLabelText("Remove from sprint: Pay with a saved card").closest("li")!;
    expect(row).toHaveTextContent("To do · Bo");
  });
});

describe("fill to capacity", () => {
  it("asks for a commitment when there is no velocity and none is typed", () => {
    seed([S2]);
    render(<SprintPlanning />);
    fireEvent.click(screen.getByRole("button", { name: "Fill to capacity" }));
    expect(toasts.calls).toEqual([
      { kind: "error", message: "Set the points to commit to first." },
    ]);
    expect(story("b1")?.sprintId).toBeUndefined();
  });

  it("says so when the sprint is already full, or nothing sized fits", () => {
    render(<SprintPlanning />);
    const target = screen.getByLabelText("Commit to");
    fireEvent.change(target, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill to capacity" }));
    expect(toasts.calls.at(-1)).toEqual({
      kind: "info",
      message: "The sprint is already at capacity.",
    });

    fireEvent.change(target, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill to capacity" }));
    expect(toasts.calls.at(-1)).toEqual({
      kind: "info",
      message: "No sized backlog story fits in the points left.",
    });
    expect(story("b1")?.sprintId).toBeUndefined();
    expect(story("b2")?.sprintId).toBeUndefined();
    expect(logs).not.toContain("filled_to_capacity");
  });

  it("fills only to a typed commitment, not the velocity", () => {
    render(<SprintPlanning />);
    fireEvent.change(screen.getByLabelText("Commit to"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill to capacity" }));
    // 11 − 8 = 3 points of room: only b2 (3) fits.
    expect(story("b1")?.sprintId).toBeUndefined();
    expect(story("b2")).toMatchObject({ sprintId: "s2", status: "todo" });
  });
});

describe("commitment", () => {
  it("measures the plan against a typed number instead of the velocity", () => {
    const { container } = render(<SprintPlanning />);
    fireEvent.change(screen.getByLabelText("Commit to"), { target: { value: "40" } });
    expect(container.querySelector('[data-field="commitment"]')?.textContent).toBe(
      "1 story · 8 points against 40 points of capacity (20%)"
    );
    expect(exported.markdown).toContain("(target 40)");
  });

  it("shows no capacity or velocity when neither exists", () => {
    seed([S2]);
    const { container } = render(<SprintPlanning />);
    expect(container.querySelector('[data-field="capacity-hours"]')?.textContent).toBe("—");
    expect(container.querySelector('[data-field="velocity"]')?.textContent).toBe("—");
    expect(screen.getByText(/No capacity plan yet/)).toBeInTheDocument();
    expect(screen.getByText(/No finished sprint yet/)).toBeInTheDocument();
    expect(container.querySelector('[data-field="commitment"]')?.textContent).toBe(
      "1 story · 8 points"
    );
  });

  it("updates an active sprint's commitment without restarting it, with Undo", () => {
    seed([S1, { ...S2, status: "active", pointsPlanned: 5 }]);
    render(<SprintPlanning />);
    fireEvent.click(screen.getByRole("button", { name: "Update the commitment" }));
    expect(sprint("s2")).toMatchObject({ status: "active", pointsPlanned: 8 });
    undo.last?.revert();
    expect(sprint("s2")).toMatchObject({ status: "active", pointsPlanned: 5 });
  });

  it("can't start a sprint with no stories", () => {
    seed([S1, S2], STORIES.slice(1));
    render(<SprintPlanning />);
    expect(screen.getByRole("button", { name: "Start the sprint" })).toBeDisabled();
    expect(screen.getByText(/Nothing yet\. Tick backlog stories below/)).toBeInTheDocument();
  });
});

describe("goal and new stories", () => {
  it("clears the goal when the field is emptied", () => {
    seed([S1, { ...S2, goal: "Old goal" }]);
    render(<SprintPlanning />);
    const goal = screen.getByLabelText("Sprint goal");
    expect(goal).toHaveValue("Old goal");
    fireEvent.change(goal, { target: { value: "   " } });
    fireEvent.blur(goal);
    expect(sprint("s2")?.goal).toBeUndefined();
  });

  it("won't add a blank story and drops points of 0 or less", () => {
    render(<SprintPlanning />);
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText("New story"), { target: { value: "  Receipts  " } });
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "0" } });
    fireEvent.click(add);
    const added = state().stories.find((s) => s.title === "Receipts");
    expect(added).toMatchObject({ status: "todo", sprintId: "s2" });
    expect(added?.points).toBeUndefined();
    expect(screen.getByLabelText("New story")).toHaveValue("");
    expect(screen.getByLabelText("Points")).toHaveValue(null);
  });
});
