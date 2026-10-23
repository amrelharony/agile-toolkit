import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityPlan, Sprint, Story } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";

/**
 * Sprint Planning's upgrade to the tool UX contract: stories a closed
 * sprint left over are carried over (or sent back) with Undo, the capacity
 * plan turns into a points forecast, status changes are stamped, done work
 * stays done, "Fill to capacity" names what it skipped, readiness shows on
 * each story, the add form validates, titles edit in place, and the
 * example plan lives in memory only.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    dismiss: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test" }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
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
import {
  EMPTY_STORY_DRAFT,
  carryOverLabel,
  checkStoryPoints,
  forecastText,
  targetError,
  leftoverGroups,
  planFill,
  planWarnings,
  readCapacity,
  skippedText,
  suggestedPoints,
  validateStory,
} from "@/app/(tools)/sprint-planning/view";
import { planToMarkdown } from "@/app/(tools)/sprint-planning/markdown";
import { buildExample } from "@/app/(tools)/sprint-planning/example";
import {
  createExampleStore,
  exampleWriter,
  placeStory,
} from "@/app/(tools)/sprint-planning/writer";

const sprint = (id: string, patch: Partial<Sprint> = {}): Sprint => ({
  id,
  name: `Sprint ${id.slice(1)}`,
  startDate: "2026-10-05",
  endDate: "2026-10-19",
  pointsPlanned: 0,
  status: "planned",
  ...patch,
});

const plan = (
  id: string,
  members: { availability: number; daysOff: number }[],
  sprintId?: string
): CapacityPlan => ({
  id,
  ...(sprintId ? { sprintId } : {}),
  members: members.map((m, i) => ({ id: `m${i}`, name: `P${i}`, role: "Dev", ...m })),
  config: {
    sprintDays: 10,
    ceremonyOverhead: 10,
    focusFactor: 0.8,
    hoursPerDay: 8,
    pointsCommitted: "",
  },
});

const S1 = sprint("s1", {
  startDate: "2026-09-21",
  endDate: "2026-10-05",
  pointsPlanned: 30,
  pointsCompleted: 30,
  status: "completed",
});
const S2 = sprint("s2");

const STORIES: Story[] = [
  {
    id: "left-1",
    title: "Refund flow",
    status: "in_progress",
    sprintId: "s1",
    points: 5,
    startedAt: "2026-10-01T09:00:00.000Z",
  },
  { id: "left-2", title: "Card expiry reminders", status: "todo", sprintId: "s1", points: 3 },
  { id: "done-1", title: "Save a card", status: "done", sprintId: "s1", points: 8 },
  {
    id: "in-1",
    title: "Pay with a saved card",
    status: "todo",
    sprintId: "s2",
    points: 8,
    readiness: { checked: ["a"], ready: true, updatedAt: "2026-10-01T00:00:00.000Z" },
  },
  { id: "in-done", title: "Receipts", status: "done", sprintId: "s2", points: 2 },
  { id: "in-wip", title: "Card nicknames", status: "in_progress", sprintId: "s2", points: 1 },
  {
    id: "b1",
    title: "Remove a saved card",
    status: "backlog",
    points: 5,
    priorityScore: 9,
    owner: "Ann",
  },
  { id: "b2", title: "Apple Pay", status: "backlog", points: 13, priorityScore: 8 },
  { id: "b3", title: "Fraud checks", status: "backlog", priorityScore: 7 },
];

const state = () => useWorkspaceStore.getState();
const story = (id: string) => state().stories.find((s) => s.id === id);
const renderPlanning = () =>
  render(
    <TooltipProvider>
      <SprintPlanning />
    </TooltipProvider>
  );
/** The Undo of the last undoable toast. */
const lastUndo = () => {
  const call = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  return () => act(() => call[1].action.onClick());
};

beforeEach(() => {
  toastSpy.mockClear();
  toastSpy.info.mockClear();
  router.push.mockClear();
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({
    sprints: [S1, S2],
    sprintSeries: [],
    stories: STORIES.map((s) => ({ ...s })),
    backlogItems: [],
    // A general plan and Sprint 2's own: the sprint's own wins.
    capacityPlans: [
      plan("capacity-planner:current", [{ availability: 100, daysOff: 0 }]),
      plan(
        "capacity-planner:sprint:s2",
        [
          { availability: 100, daysOff: 2 },
          { availability: 100, daysOff: 0 },
        ],
        "s2"
      ),
    ],
    pokerEstimationLogs: [],
  });
});

afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], stories: [], backlogItems: [], capacityPlans: [] });
});

/* ── Pure logic ──────────────────────────────────────────────────────── */

describe("left over from a closed sprint", () => {
  it("groups the open stories of closed sprints, newest first, never the sprint being planned", () => {
    const old = sprint("s0", { startDate: "2026-09-07", status: "cancelled" });
    const active = sprint("s3", { startDate: "2026-10-19", status: "active" });
    const stories: Story[] = [
      ...STORIES,
      { id: "old-1", title: "Old", status: "review", sprintId: "s0", points: 2.5 },
      { id: "act-1", title: "Active work", status: "todo", sprintId: "s3" },
    ];
    const groups = leftoverGroups([old, S1, S2, active], stories, "s2");
    expect(groups.map((g) => [g.sprint.id, g.stories.map((s) => s.id), g.points])).toEqual([
      ["s1", ["left-1", "left-2"], 8],
      ["s0", ["old-1"], 2.5],
    ]);
    expect(leftoverGroups([S1], stories, "s1")).toEqual([]);
    expect(leftoverGroups([], stories)).toEqual([]);
    expect(carryOverLabel(groups[0])).toBe("Carry over 2 stories (8 points)");
    expect(carryOverLabel({ stories: [STORIES[0]], points: 1 })).toBe(
      "Carry over 1 story (1 point)"
    );
  });
});

describe("fill to capacity", () => {
  const backlog = STORIES.filter((s) => s.status === "backlog");

  it("names what it skipped and why", () => {
    const fill = planFill(backlog, 10);
    expect(fill.selected.map((s) => s.id)).toEqual(["b1"]);
    expect(fill.totalPoints).toBe(5);
    expect(fill.tooBig.map((s) => s.id)).toEqual(["b2"]);
    expect(fill.unestimated.map((s) => s.id)).toEqual(["b3"]);
    expect(skippedText(fill)).toBe(
      "Too big for the points left: “Apple Pay” (13). Not estimated: “Fraud checks”."
    );
  });

  it("says nothing when nothing was skipped, and shortens long lists", () => {
    expect(skippedText(planFill([backlog[0]], 100))).toBeUndefined();
    const many: Story[] = Array.from({ length: 6 }, (_, i) => ({
      id: `u${i}`,
      title: `Unsized ${i}`,
      status: "backlog",
    }));
    expect(skippedText(planFill(many, 1e9))).toBe(
      "Not estimated: “Unsized 0”, “Unsized 1”, “Unsized 2” and 3 more."
    );
    // No room at all: everything sized is too big.
    expect(planFill(backlog, 0).tooBig.map((s) => s.id)).toEqual(["b1", "b2"]);
  });
});

describe("capacity forecast", () => {
  const plans = [
    plan("capacity-planner:current", [{ availability: 100, daysOff: 0 }]),
    plan(
      "capacity-planner:sprint:s2",
      [
        { availability: 100, daysOff: 2 },
        { availability: 100, daysOff: 0 },
      ],
      "s2"
    ),
  ];

  it("reads the sprint's own plan first and scales velocity by it", () => {
    const read = readCapacity(plans, "s2", 30);
    expect(read).toMatchObject({ perSprint: true, people: 2, ratio: 0.9, points: 27 });
    expect(forecastText(read, 30)).toBe(
      "Capacity is 90% of a normal sprint, so plan about 27 points (velocity 30 × 90%)."
    );
    expect(suggestedPoints(read, 30)).toBe(27);
  });

  it("falls back to the general plan, then says plainly what is missing", () => {
    expect(readCapacity(plans, "s9", 30)).toMatchObject({ perSprint: false, ratio: 1, points: 30 });

    const none = readCapacity([], "s2", 26);
    expect(none).toMatchObject({ plan: undefined, hours: null, ratio: null, points: null });
    expect(forecastText(none, 26)).toBe(
      "There's no capacity plan for this sprint, so the suggestion is plain velocity: about 26 points."
    );
    expect(suggestedPoints(none, 26)).toBe(26);
    expect(forecastText(none, null)).toBe(
      "There's no capacity plan for this sprint, and no finished sprint has points yet. Type the points to commit to."
    );
    expect(suggestedPoints(none, null)).toBeNull();

    const empty = readCapacity([plan("capacity-planner:current", [])], "s2", 26);
    expect(forecastText(empty, 26)).toMatch(/^The capacity plan has nobody in it yet, so/);

    const withPlan = readCapacity(plans, "s2", null);
    expect(forecastText(withPlan, null)).toMatch(/90% of a normal sprint, but no finished sprint/);

    const allOff = readCapacity(
      [plan("capacity-planner:current", [{ availability: 0, daysOff: 0 }])],
      "s2",
      30
    );
    expect(allOff.points).toBe(0);
    expect(forecastText(allOff, 30)).toMatch(/^Nobody is available this sprint/);

    // People, but settings that leave no hours (a focus factor of 0).
    const unfocused = plan("capacity-planner:current", [{ availability: 100, daysOff: 0 }]);
    unfocused.config.focusFactor = 0;
    expect(forecastText(readCapacity([unfocused], "s2", 30), 30)).toBe(
      "The capacity plan's settings leave no working hours, so the suggestion is plain velocity: about 30 points."
    );
  });

  it("flags a plan that still holds example members", () => {
    const ex = plan("capacity-planner:current", [
      { availability: 100, daysOff: 0 },
      { availability: 100, daysOff: 0 },
    ]);
    ex.members[0].id = "example-member-1";
    expect(readCapacity([ex], "s2", 10).example).toBe(true);
    expect(readCapacity(plans, "s2", 10).example).toBe(false);
  });

  it("passes over a plan of example members for a real sprint", () => {
    const exampleOnly = plan(
      "capacity-planner:sprint:s2",
      [
        { availability: 100, daysOff: 5 },
        { availability: 100, daysOff: 5 },
      ],
      "s2"
    );
    exampleOnly.members.forEach((m, i) => (m.id = `example-member-${i}`));
    // Sprint 2's own plan is only the example: the general plan is used.
    expect(readCapacity([plans[0], exampleOnly], "s2", 30)).toMatchObject({
      perSprint: false,
      people: 1,
      ratio: 1,
      points: 30,
      example: false,
    });
    expect(readCapacity([exampleOnly], "s2", 30)).toMatchObject({ plan: undefined, points: null });
    // The example plan's own sprint still uses it.
    const exSprintPlan = { ...exampleOnly, id: "capacity-planner:sprint:example-s5" };
    expect(readCapacity([exSprintPlan], "example-s5", 30)).toMatchObject({
      perSprint: true,
      people: 2,
      example: true,
    });
  });

  it("measures a normal sprint by the team's usual length, so a holiday lowers the points", () => {
    // Sprint 2's plan with a holiday taken off: 9 working days, everyone in.
    const holiday = plan(
      "capacity-planner:sprint:s2",
      [
        { availability: 100, daysOff: 0 },
        { availability: 100, daysOff: 0 },
      ],
      "s2"
    );
    holiday.config.sprintDays = 9;
    expect(readCapacity([holiday], "s2", 30, 10)).toMatchObject({ ratio: 0.9, points: 27 });
    // Measured with its own 9 days, the holiday dropped out.
    expect(readCapacity([holiday], "s2", 30)).toMatchObject({ ratio: 1, points: 30 });
  });

  it("counts a blank row as nobody", () => {
    const legacy = plan("capacity-planner:current", [{ availability: 100, daysOff: 0 }]);
    legacy.members[0] = {
      id: "default:member-1",
      name: "",
      role: "",
      availability: 100,
      daysOff: 0,
    };
    const read = readCapacity([legacy], "s2", 30, 10);
    expect(read).toMatchObject({ people: 0, hours: null, ratio: null, points: null });
    expect(forecastText(read, 30)).toMatch(/^The capacity plan has nobody in it yet/);
    legacy.members.push({ id: "m1", name: "Ann", role: "Dev", availability: 100, daysOff: 0 });
    expect(readCapacity([legacy], "s2", 30, 10)).toMatchObject({ people: 1, hours: 57.6 });
  });
});

describe("typed points", () => {
  it("explains a Commit to value it can't use", () => {
    expect(targetError("")).toBeUndefined();
    expect(targetError("0")).toBeUndefined();
    expect(targetError("27.5")).toBeUndefined();
    expect(targetError("-5")).toBe("Points are 0 or more. Leave it blank to use the suggestion.");
    expect(targetError("", true)).toBe(
      "Points are a number. Leave it blank to use the suggestion."
    );
  });

  it("keeps a story's points on a bad entry and names what still counts", () => {
    expect(checkStoryPoints("", 5)).toEqual({ ok: true, points: undefined });
    expect(checkStoryPoints(" 8 ", 5)).toEqual({ ok: true, points: 8 });
    expect(checkStoryPoints("0", 5)).toEqual({ ok: true, points: 0 });
    expect(checkStoryPoints("-3", 5)).toEqual({
      ok: false,
      error: "Points are 0 or more. Still counting 5 points.",
    });
    expect(checkStoryPoints("", 5, true)).toEqual({
      ok: false,
      error: "Points are a number. Still counting 5 points.",
    });
    expect(checkStoryPoints("-1", 0)).toEqual({
      ok: false,
      error: "Points are 0 or more. Still not sized.",
    });
  });
});

describe("the add-story form", () => {
  it("needs a title and takes blank, zero or positive points", () => {
    expect(validateStory(EMPTY_STORY_DRAFT)).toEqual({
      ok: false,
      errors: { title: "Enter the story's title." },
    });
    expect(validateStory({ title: "  Pay   later ", points: "" })).toEqual({
      ok: true,
      values: { title: "Pay later" },
    });
    expect(validateStory({ title: "x", points: "0" })).toEqual({
      ok: true,
      values: { title: "x", points: 0 },
    });
    expect(validateStory({ title: "x", points: "-3" })).toMatchObject({
      ok: false,
      errors: { points: expect.stringContaining("0 or more") },
    });
    expect(validateStory({ title: "x", points: "abc" })).toMatchObject({ ok: false });
    const long = validateStory({ title: "y".repeat(500), points: "1e6" });
    expect(long).toMatchObject({ ok: true, values: { points: 1e6 } });
    expect(long.ok && long.values.title).toHaveLength(200);
  });
});

describe("readiness warning", () => {
  it("only nags teams that check readiness, and ignores done stories", () => {
    const stories: Story[] = [
      { id: "a", title: "A", status: "todo", sprintId: "s2", points: 1 },
      { id: "b", title: "B", status: "done", sprintId: "s2", points: 1 },
    ];
    const base = { sprint: { ...S2, goal: "G" }, stories, targetPoints: 10, otherActive: [] };
    expect(planWarnings(base)).toEqual([]);
    expect(planWarnings({ ...base, checkReadiness: true })).toEqual([
      {
        id: "not-ready",
        text: "1 story isn't refined yet: check it against the Definition of Ready before committing.",
      },
    ]);
  });
});

describe("writers", () => {
  it("stamps status changes in memory just as the live writer does", () => {
    const store = createExampleStore({ sprints: [S2], stories: [{ ...STORIES[6] }] });
    const writer = exampleWriter(store);
    placeStory(writer, "b1", "s2", "in_progress");
    const moved = store.getState().stories[0];
    expect(moved).toMatchObject({ sprintId: "s2", status: "in_progress" });
    expect(moved.startedAt).toBeTruthy();
    expect(moved.statusHistory?.[0]).toMatchObject({ from: "backlog", status: "in_progress" });
    placeStory(writer, "b1", undefined, "backlog");
    expect(store.getState().stories[0].sprintId).toBeUndefined();
    expect(store.getState().stories[0].startedAt).toBeUndefined();
    // Unknown ids are ignored.
    placeStory(writer, "nope", "s2", "todo");
    expect(store.getState().stories).toHaveLength(1);
  });
});

describe("Markdown", () => {
  it("adds the forecast, readiness and anything left over", () => {
    const md = planToMarkdown({
      sprint: { ...S2, goal: "Pay | fast" },
      stories: STORIES.filter((s) => s.sprintId === "s2"),
      capacityHours: 103.7,
      targetPoints: 27,
      averageVelocity: 30,
      capacityRatio: 0.9,
      suggestedPoints: 27,
      leftovers: leftoverGroups([S1, S2], STORIES, "s2"),
    });
    expect(md).toContain("**Goal:** Pay \\| fast");
    expect(md).toContain("**Team capacity:** 103.7 hours (90% of a normal sprint)");
    expect(md).toContain("**Suggested commitment:** about 27 points");
    expect(md).toContain("| Story | Points | Status | Owner | Ready |");
    expect(md).toContain("| Pay with a saved card | 8 | todo |  | Ready |");
    expect(md).toContain("| Receipts | 2 | done |  |  |");
    expect(md).toContain("| Card nicknames | 1 | in progress |  | Not refined |");
    expect(md).toContain("## Left over from Sprint 1");
    expect(md).toContain("- Refund flow (5 points, in progress)");
  });

  it("still exports a plan without the new fields", () => {
    const md = planToMarkdown({
      sprint: S2,
      stories: [],
      capacityHours: null,
      targetPoints: null,
      averageVelocity: null,
    });
    expect(md).toContain("None yet.");
    expect(md).not.toContain("Suggested");
    expect(md).not.toContain("Left over");
  });
});

/* ── The page ────────────────────────────────────────────────────────── */

describe("Sprint Planning page", () => {
  it("shows the sprint's own capacity plan as a points forecast", () => {
    const { container } = renderPlanning();
    // Velocity 30, Sprint 2's plan at 90% of normal.
    expect(container.querySelector('[data-field="forecast"]')?.textContent).toBe(
      "Capacity is 90% of a normal sprint, so plan about 27 points (velocity 30 × 90%)."
    );
    expect(container.querySelector('[data-field="capacity-hours"]')?.textContent).toBe("103.7 h");
    expect(screen.getByText(/2 people, from Sprint 2's plan/)).toBeInTheDocument();
    expect(screen.getByLabelText("Commit to")).toHaveAttribute("placeholder", "27");
  });

  it("carries the left-over stories over with their status, and Undo sends them back", () => {
    renderPlanning();
    const left = screen.getByRole("region", { name: "Left over from Sprint 1" });
    expect(within(left).getByText(/2 stories, 8 points/)).toBeInTheDocument();
    // Done work isn't left over.
    expect(within(left).queryByText("Save a card")).toBeNull();

    fireEvent.click(within(left).getByRole("button", { name: "Carry over 2 stories (8 points)" }));
    expect(story("left-1")).toMatchObject({ sprintId: "s2", status: "in_progress" });
    expect(story("left-1")?.startedAt).toBe("2026-10-01T09:00:00.000Z");
    expect(story("left-2")).toMatchObject({ sprintId: "s2", status: "todo" });
    expect(screen.queryByRole("region", { name: "Left over from Sprint 1" })).toBeNull();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Carried 2 stories over to Sprint 2");

    lastUndo()();
    expect(story("left-1")).toMatchObject({ sprintId: "s1", status: "in_progress" });
    expect(story("left-2")).toMatchObject({ sprintId: "s1" });
  });

  it("sends left-over stories back to the backlog, stamped, with Undo", () => {
    renderPlanning();
    const left = screen.getByRole("region", { name: "Left over from Sprint 1" });
    fireEvent.click(within(left).getByRole("button", { name: "Back to the backlog" }));
    expect(story("left-1")?.sprintId).toBeUndefined();
    expect(story("left-1")).toMatchObject({ status: "backlog" });
    expect(story("left-1")?.startedAt).toBeUndefined();
    expect(story("left-1")?.statusHistory?.at(-1)).toMatchObject({
      from: "in_progress",
      status: "backlog",
    });
    // They now show in the backlog.
    expect(
      within(screen.getByRole("list", { name: "Backlog" })).getByText("Refund flow")
    ).toBeInTheDocument();

    lastUndo()();
    expect(story("left-1")).toEqual(STORIES[0]);
  });

  it("ticks one left-over story into the sprint on its own", () => {
    renderPlanning();
    fireEvent.click(screen.getByLabelText("Add to sprint: Card expiry reminders"));
    expect(story("left-2")).toMatchObject({ sprintId: "s2", status: "todo" });
    expect(story("left-1")?.sprintId).toBe("s1");
  });

  it("doesn't offer to carry into a closed sprint, only back to the backlog", () => {
    const closed = { ...S2, status: "completed" as const, pointsCompleted: 0 };
    useWorkspaceStore.setState({ sprints: [S1, closed] });
    const { container } = renderPlanning();
    const left = screen.getByRole("region", { name: "Left over from Sprint 1" });
    expect(within(left).queryByRole("button", { name: /Carry over/ })).toBeNull();
    expect(within(left).getByRole("button", { name: "Back to the backlog" })).toBeInTheDocument();

    // Not one story at a time either, from the left-overs or the backlog.
    const leftBox = screen.getByLabelText("Add to sprint: Card expiry reminders");
    const backlogBox = screen.getByLabelText("Add to sprint: Remove a saved card");
    expect(leftBox).toBeDisabled();
    expect(leftBox).toHaveAttribute("title", "Sprint 2 is closed");
    expect(backlogBox).toBeDisabled();
    fireEvent.click(leftBox);
    fireEvent.click(backlogBox);
    expect(story("left-2")?.sprintId).toBe("s1");
    expect(story("b1")?.sprintId).toBeUndefined();
    expect(screen.getByRole("button", { name: "Fill to capacity" })).toBeDisabled();
    expect(screen.queryByLabelText("New story")).toBeNull();
    expect(container.querySelector('[data-field="closed"]')?.textContent).toBe(
      "Sprint 2 is completed, so nothing more can be planned into it. Pick a sprint that is still open, or start a new one."
    );

    // A closed sprint isn't started again: that would drop it from velocity.
    expect(screen.queryByRole("button", { name: "Start the sprint" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update the commitment" })).toBeNull();
    expect(container.querySelector('[data-field="closed-commit"]')?.textContent).toBe(
      "Sprint 2 is closed, so it can't be started again: its commitment stays at 0 points."
    );
    expect(state().sprints.find((s) => s.id === "s2")?.status).toBe("completed");

    // Its own unfinished work can still go back to the backlog.
    fireEvent.click(screen.getByLabelText("Remove from sprint: Pay with a saved card"));
    expect(story("in-1")?.sprintId).toBeUndefined();
  });

  it("puts focus on the next story after a tick, and says where the story went", () => {
    renderPlanning();
    const status = () => screen.getByText(/^(Added|Moved) /, { selector: "[role=status]" });
    fireEvent.click(screen.getByLabelText("Add to sprint: Remove a saved card"));
    // "Apple Pay" moved up into its place in the backlog.
    expect(screen.getByLabelText("Add to sprint: Apple Pay")).toHaveFocus();
    expect(status()).toHaveTextContent("Added “Remove a saved card” to Sprint 2.");

    // The last one in a list: focus goes to the one before it.
    fireEvent.click(screen.getByLabelText("Add to sprint: Fraud checks"));
    expect(screen.getByLabelText("Add to sprint: Apple Pay")).toHaveFocus();

    fireEvent.click(screen.getByLabelText("Remove from sprint: Pay with a saved card"));
    expect(status()).toHaveTextContent("Moved “Pay with a saved card” back to the backlog.");
    expect(document.activeElement).toHaveAttribute("type", "checkbox");
    expect(document.activeElement?.closest("[data-story-list]")).toHaveAttribute(
      "data-story-list",
      "sprint"
    );
  });

  it("moves focus to the sprint's heading when a list empties or a group is carried over", () => {
    renderPlanning();
    fireEvent.click(screen.getByLabelText("Add to sprint: Card expiry reminders"));
    // One left over still: it takes focus.
    expect(screen.getByLabelText("Add to sprint: Refund flow")).toHaveFocus();
    fireEvent.click(screen.getByLabelText("Add to sprint: Refund flow"));
    // The section is gone; focus lands where the stories went.
    expect(screen.queryByRole("region", { name: "Left over from Sprint 1" })).toBeNull();
    expect(screen.getByRole("heading", { name: /^In Sprint 2/ })).toHaveFocus();

    const reset = () =>
      act(() => useWorkspaceStore.setState({ stories: STORIES.map((s) => ({ ...s })) }));
    reset();
    fireEvent.click(screen.getByRole("button", { name: "Carry over 2 stories (8 points)" }));
    expect(screen.getByRole("heading", { name: /^In Sprint 2/ })).toHaveFocus();

    reset();
    fireEvent.click(screen.getByRole("button", { name: "Back to the backlog" }));
    expect(screen.getByRole("heading", { name: /^Backlog/ })).toHaveFocus();
  });

  it("says why a Commit to value isn't used", () => {
    const { container } = renderPlanning();
    const field = screen.getByLabelText("Commit to");
    fireEvent.change(field, { target: { value: "-5" } });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Points are 0 or more. Leave it blank to use the suggestion.")
    ).toBeInTheDocument();
    expect(container.querySelector('[data-field="commitment"]')?.textContent).not.toContain(
      "against"
    );
    // A malformed entry the field reports as blank isn't taken for "use the suggestion".
    Object.defineProperty(field, "validity", { value: { badInput: true }, configurable: true });
    fireEvent.change(field, { target: { value: "" } });
    expect(
      screen.getByText("Points are a number. Leave it blank to use the suggestion.")
    ).toBeInTheDocument();
    Object.defineProperty(field, "validity", { value: { badInput: false }, configurable: true });
    fireEvent.change(field, { target: { value: "20" } });
    expect(screen.queryByText(/Leave it blank to use the suggestion\./)).toBeNull();
    expect(container.querySelector('[data-field="commitment"]')?.textContent).toContain(
      "against 20 points of capacity"
    );
  });

  it("keeps a story's points on a bad entry and says why", () => {
    renderPlanning();
    const input = screen.getByLabelText("Points for Remove a saved card");
    fireEvent.change(input, { target: { value: "-3" } });
    fireEvent.blur(input);
    expect(story("b1")?.points).toBe(5);
    expect(input).toHaveValue(-3);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Points are 0 or more. Still counting 5 points."
    );

    // "3e" reads as blank in a number field: it must not clear the points.
    Object.defineProperty(input, "validity", { value: { badInput: true }, configurable: true });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(story("b1")?.points).toBe(5);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Points are a number. Still counting 5 points."
    );

    Object.defineProperty(input, "validity", { value: { badInput: false }, configurable: true });
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(story("b1")?.points).toBe(8);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("doesn't count a blank row of an older general plan as a person", () => {
    useWorkspaceStore.setState({
      capacityPlans: [
        {
          ...plan("capacity-planner:current", []),
          members: [{ id: "default:member-1", name: "", role: "", availability: 100, daysOff: 0 }],
        },
      ],
    });
    const { container } = renderPlanning();
    expect(container.querySelector('[data-field="capacity-hours"]')?.textContent).toBe("—");
    expect(screen.getByText(/Nobody in the capacity plan yet/)).toBeInTheDocument();
  });

  it("lowers the suggestion for a sprint whose plan has a holiday taken off", () => {
    const own = plan(
      "capacity-planner:sprint:s2",
      [
        { availability: 100, daysOff: 0 },
        { availability: 100, daysOff: 0 },
      ],
      "s2"
    );
    own.config.sprintDays = 9;
    useWorkspaceStore.setState({ capacityPlans: [own] });
    const { container } = renderPlanning();
    // The cadence's usual sprint is 10 working days.
    expect(container.querySelector('[data-field="forecast"]')?.textContent).toBe(
      "Capacity is 90% of a normal sprint, so plan about 27 points (velocity 30 × 90%)."
    );
  });

  it("stamps a story ticked in from the backlog", () => {
    renderPlanning();
    fireEvent.click(screen.getByLabelText("Add to sprint: Remove a saved card"));
    expect(story("b1")).toMatchObject({ sprintId: "s2", status: "todo" });
    expect(story("b1")?.statusHistory).toEqual([
      { status: "todo", from: "backlog", at: expect.any(String) },
    ]);
  });

  it("keeps a done story done and in the sprint", () => {
    renderPlanning();
    const box = screen.getByLabelText("Done, stays in the sprint: Receipts");
    expect(box).toBeDisabled();
    fireEvent.click(box);
    expect(story("in-done")).toMatchObject({ sprintId: "s2", status: "done" });
  });

  it("offers Undo when a started story goes back to the backlog", () => {
    renderPlanning();
    fireEvent.click(screen.getByLabelText("Remove from sprint: Card nicknames"));
    expect(story("in-wip")).toMatchObject({ status: "backlog" });
    expect(story("in-wip")?.sprintId).toBeUndefined();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Moved “Card nicknames” back to the backlog");
    lastUndo()();
    expect(story("in-wip")).toEqual(STORIES[5]);

    // A story not started yet moves without a toast.
    toastSpy.mockClear();
    fireEvent.click(screen.getByLabelText("Remove from sprint: Pay with a saved card"));
    expect(story("in-1")?.status).toBe("backlog");
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("names the stories Fill to capacity skipped", () => {
    renderPlanning();
    // 27 suggested − 11 planned = 16 points: b1 (5) fits, b2 (13) is too big after it, b3 unsized.
    fireEvent.click(screen.getByRole("button", { name: "Fill to capacity" }));
    expect(story("b1")?.sprintId).toBe("s2");
    expect(story("b2")?.sprintId).toBeUndefined();
    const [label, opts] = toastSpy.mock.calls.at(-1)!;
    expect(label).toBe("1 story added to Sprint 2");
    expect(opts.description).toBe(
      "5 points, highest priority first. Too big for the points left: “Apple Pay” (13). Not estimated: “Fraud checks”."
    );
  });

  it("explains an empty fill with the skipped stories", () => {
    renderPlanning();
    fireEvent.change(screen.getByLabelText("Commit to"), { target: { value: "13" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill to capacity" }));
    expect(toastSpy.info).toHaveBeenCalledWith("No sized backlog story fits in the points left.", {
      description:
        "Too big for the points left: “Remove a saved card” (5) and “Apple Pay” (13). Not estimated: “Fraud checks”.",
    });
  });

  it("separates owner and priority, and shows readiness with a way to Refinement", () => {
    renderPlanning();
    const backlog = screen.getByRole("list", { name: "Backlog" });
    const row = within(backlog).getByText("Remove a saved card").closest("li")!;
    expect(within(row).getByText("Ann")).toBeInTheDocument();
    expect(within(row).getByText("Priority 9")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /Not refined/ })).toHaveAttribute(
      "href",
      "/refinement"
    );
    const inSprint = screen.getByRole("list", { name: "Stories in Sprint 2" });
    const ready = within(inSprint).getByText("Pay with a saved card").closest("li")!;
    expect(within(ready).getByText("Ready")).toBeInTheDocument();
    // Done stories carry no readiness badge.
    const done = within(inSprint).getByText("Receipts").closest("li")!;
    expect(within(done).queryByText(/Ready|Not refined/)).toBeNull();
  });

  it("validates the new story inline and saves nothing until it is valid", () => {
    renderPlanning();
    const before = state().stories.length;
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Enter the story's title.")).toBeInTheDocument();
    expect(screen.getByLabelText("New story")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("New story"), { target: { value: "Gift cards" } });
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(state().stories).toHaveLength(before);
    expect(screen.getByText(/Points are a number, 0 or more/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const added = state().stories.find((s) => s.title === "Gift cards");
    expect(added).toMatchObject({ sprintId: "s2", status: "todo" });
    expect(added && "points" in added).toBe(false);
  });

  it("renames a story in place", () => {
    renderPlanning();
    fireEvent.click(screen.getByRole("button", { name: "Edit Apple Pay" }));
    const field = screen.getByLabelText("Story title");
    fireEvent.change(field, { target: { value: "Apple Pay and Google Pay" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(story("b2")?.title).toBe("Apple Pay and Google Pay");
  });

  it("clears a story's points without leaving a stray key", () => {
    renderPlanning();
    const input = screen.getByLabelText("Points for Remove a saved card");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(story("b1") && "points" in story("b1")!).toBe(false);
  });

  it("loads legacy data: no plans, no readiness, odd statuses", () => {
    useWorkspaceStore.setState({
      capacityPlans: [],
      stories: [
        { id: "x", title: "Legacy", status: "todo", sprintId: "s2" },
        { id: "y", title: "Odd", status: "blocked" as Story["status"], sprintId: "s2", points: 3 },
      ],
    });
    const { container } = renderPlanning();
    expect(container.querySelector('[data-field="capacity-hours"]')?.textContent).toBe("—");
    expect(container.querySelector('[data-field="forecast"]')?.textContent).toMatch(
      /no capacity plan for this sprint, so the suggestion is plain velocity: about 30 points/
    );
    expect(screen.getByText("Odd")).toBeInTheDocument();
  });
});

describe("the example plan", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sprints: [], stories: [], capacityPlans: [] });
  });

  it("opens from the empty state, works in memory and writes nothing", () => {
    const { container } = renderPlanning();
    expect(screen.getByRole("heading", { name: "No sprint to plan yet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See an example plan" }));

    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(container.querySelector('[data-field="forecast"]')?.textContent).toBe(
      "Capacity is 90% of a normal sprint, so plan about 28 points (velocity 31.3 × 90%)."
    );
    const left = screen.getByRole("region", { name: "Left over from Sprint 4" });
    fireEvent.click(within(left).getByRole("button", { name: "Carry over 2 stories (8 points)" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill to capacity" }));
    expect(
      within(screen.getByRole("list", { name: "Stories in Sprint 5" })).getByText(
        "Remove a saved card"
      )
    ).toBeInTheDocument();
    // Nothing reached the workspace, and the example can't start a sprint.
    expect(state().sprints).toEqual([]);
    expect(state().stories).toEqual([]);
    expect(screen.queryByRole("button", { name: "Start the sprint" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("heading", { name: "No sprint to plan yet" })).toBeInTheDocument();
  });

  it("is built from example ids and dated from today", () => {
    const ex = buildExample("2026-10-23");
    expect(ex.planning).toMatchObject({
      name: "Sprint 5",
      status: "planned",
      startDate: "2026-10-23",
    });
    expect(
      [...ex.sprints, ...ex.stories, ...ex.capacityPlans[0].members].every((x) =>
        x.id.startsWith("example-")
      )
    ).toBe(true);
    expect(ex.capacityPlans[0]).toMatchObject({
      id: `capacity-planner:sprint:${ex.planning.id}`,
      sprintId: ex.planning.id,
    });
  });
});
