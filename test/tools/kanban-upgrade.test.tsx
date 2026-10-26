import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DodCriterion, KanbanCard, Sprint, Story } from "@/lib/stores/workspace-types";
import { DOD_DOC_ID } from "@/lib/dod/model";
import { SELECTED_SPRINT_KEY, resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { storyProgress } from "@/lib/sprints/progress";
import { percentile } from "@/lib/sprints/metrics";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { ageingWip, cardItems } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import { exampleId } from "@/components/tool-frame/example-data";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/kanban";
import { isExampleSprintId } from "@/lib/sprints/example";
import {
  STORY_STATUS_HISTORY_CAP,
  withStoryBlocked,
  withStoryStatus,
} from "@/lib/sprints/story-status";

/**
 * Kanban's upgrade to the tool UX contract: a Sprint board over the
 * selected sprint's stories (moves through setStoryStatus, announced, with
 * Undo; owner, blocked flag and age in column on each card; WIP nudges; an
 * example held in memory), the Flow board kept for teams without sprints
 * (validated add form, assignee, blocked flag, age in column, shared P85
 * behind minimum samples), the remembered board choice, both Markdown
 * exports and theme colours only.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(
    vi.fn(() => "t"),
    {
      dismiss: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      message: vi.fn(),
    }
  )
);
const spies = vi.hoisted(() => ({ log: vi.fn(), sonify: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: spies.sonify }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log, toolRunId: "test" }),
}));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { KanbanClient } from "@/app/(tools)/kanban/kanban-client";
import { BOARD_VIEW_KEY, linkedBoard, pickBoardView } from "@/app/(tools)/kanban/board-view";
import {
  cardColumnSince,
  cycleStats,
  cycleTimeDays,
  daysInWork,
  daysSince,
  flowBreaches,
  flowVerdict,
  movedCard,
  throughputChartText,
  throughputLastWeek,
  validateCard,
  weeklyThroughput,
} from "@/app/(tools)/kanban/flow-view";
import {
  closedBoardNote,
  columnEnteredAt,
  daysInColumn,
  doneMissingDod,
  isClosedSprint,
  moveMessage,
  revertMove,
  sprintBoardVerdict,
  sprintBreaches,
  sprintColumnOf,
  storiesByColumn,
  wipNudge,
} from "@/app/(tools)/kanban/sprint-view";
import { sprintBoardMarkdown, toMarkdown } from "@/app/(tools)/kanban/markdown";
import { buildExample, buildSprintExample } from "@/app/(tools)/kanban/example";
import {
  createExampleBoardStore,
  exampleSprintWriter,
  liveSprintWriter,
  withOwner,
} from "@/app/(tools)/kanban/sprint-writer";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-20T12:00:00.000Z");
const ago = (days: number, from: Date = NOW) => new Date(from.getTime() - days * DAY).toISOString();
const LIMITS = { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 };

const sprint = (patch: Partial<Sprint> = {}): Sprint => ({
  id: "s7",
  name: "Sprint 7",
  startDate: "2026-10-12",
  endDate: "2026-10-26",
  pointsPlanned: 10,
  status: "active",
  ...patch,
});

const story = (id: string, title: string, patch: Partial<Story> = {}): Story => ({
  id,
  title,
  status: "todo",
  sprintId: "s7",
  ...patch,
});

const card = (id: string, title: string, patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title,
  column: "backlog",
  class: "standard",
  createdAt: ago(10),
  ...patch,
});

const storyById = (id: string) => useWorkspaceStore.getState().stories.find((s) => s.id === id)!;
const flowBoard = () =>
  (useWorkspaceStore.getState().kanbanBoards ?? []).find((b) => b.id === "kanban:current");
const lastToast = () =>
  toastSpy.mock.calls[toastSpy.mock.calls.length - 1] as unknown as [
    string,
    { action: { onClick: () => void } },
  ];
const undoLast = () => act(() => lastToast()[1].action.onClick());
const openMenu = (name: string) =>
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
const live = () => screen.getByTestId("live-polite");
const exported = () => screen.getByTestId("export-markdown").textContent ?? "";

function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>
    </TooltipProvider>
  );
}
const renderBoard = () => render(<KanbanClient />, { wrapper: Providers });

function seed({
  sprints = [sprint()],
  stories = [] as Story[],
  cards = [] as KanbanCard[],
  wipLimits = LIMITS,
}: {
  sprints?: Sprint[];
  stories?: Story[];
  cards?: KanbanCard[];
  wipLimits?: typeof LIMITS;
} = {}) {
  useWorkspaceStore.setState({
    sprints,
    stories,
    teamMembers: [],
    kanbanBoards: [{ id: "kanban:current", cards, wipLimits }],
  });
}

beforeEach(() => {
  toastSpy.mockClear();
  spies.log.mockClear();
  spies.sonify.mockClear();
  localStorage.clear();
  resetSelectedSprint();
  window.history.replaceState(null, "", "/kanban");
  seed({ sprints: [], cards: [] });
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

/* ── Which board opens ──────────────────────────────────────────────── */

describe("board choice", () => {
  it("reads ?board= and ?sprint= links", () => {
    expect(linkedBoard("?board=flow")).toBe("flow");
    expect(linkedBoard("?board=sprint")).toBe("sprint");
    expect(linkedBoard("?sprint=s7")).toBe("sprint");
    expect(linkedBoard("?board=flow&sprint=s7")).toBe("flow");
    expect(linkedBoard("?board=gantt")).toBeNull();
    expect(linkedBoard("")).toBeNull();
  });

  it("prefers a link, then the viewer's choice, then the Sprint board while a sprint is active", () => {
    expect(pickBoardView("flow", "sprint", true)).toBe("flow");
    expect(pickBoardView(null, "flow", true)).toBe("flow");
    expect(pickBoardView(null, "sprint", false)).toBe("sprint");
    expect(pickBoardView(null, null, true)).toBe("sprint");
    expect(pickBoardView(null, null, false)).toBe("flow");
    // A stored value from elsewhere (or hand-edited) is ignored.
    expect(pickBoardView(null, "banana", false)).toBe("flow");
  });

  it("opens the Sprint board while a sprint is active, and remembers a switch to Flow", () => {
    seed({ stories: [story("a", "Pay by card")] });
    const { unmount } = renderBoard();
    expect(screen.getByRole("radio", { name: "Sprint board" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByText("Pay by card")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Flow board" }));
    expect(screen.getByRole("textbox", { name: "New card title" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(BOARD_VIEW_KEY)!)).toBe("flow");
    unmount();

    renderBoard();
    expect(screen.getByRole("radio", { name: "Flow board" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("keeps the Flow board for a team without an active sprint", () => {
    seed({ sprints: [sprint({ status: "completed" })] });
    renderBoard();
    expect(screen.getByRole("textbox", { name: "New card title" })).toBeInTheDocument();
  });

  it("opens the board a link names, without changing the remembered choice", () => {
    seed({ stories: [story("a", "Pay by card")] });
    window.history.replaceState(null, "", "/kanban?board=flow");
    renderBoard();
    expect(screen.getByRole("textbox", { name: "New card title" })).toBeInTheDocument();
    expect(localStorage.getItem(BOARD_VIEW_KEY)).toBe("null");

    // Switching drops the link's ?board=, so a refresh keeps the new choice.
    fireEvent.click(screen.getByRole("radio", { name: "Sprint board" }));
    expect(screen.getByText("Pay by card")).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(JSON.parse(localStorage.getItem(BOARD_VIEW_KEY)!)).toBe("sprint");
  });

  it("choosing Flow on a ?sprint= link drops the link, so a refresh stays on the Flow board", () => {
    seed({ stories: [story("a", "Pay by card")] });
    window.history.replaceState(null, "", "/kanban?sprint=s7");
    const { unmount } = renderBoard();
    expect(screen.getByText("Pay by card")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Flow board" }));
    expect(window.location.search).toBe("");
    unmount();
    renderBoard();
    expect(screen.getByRole("textbox", { name: "New card title" })).toBeInTheDocument();
    // The sprint the link named stays chosen for the sprint tools.
    expect(localStorage.getItem(SELECTED_SPRINT_KEY)).toBe("s7");
  });

  it("choosing Sprint keeps a ?sprint= link", () => {
    seed({ stories: [story("a", "Pay by card")] });
    window.history.replaceState(null, "", "/kanban?board=flow&sprint=s7");
    renderBoard();
    fireEvent.click(screen.getByRole("radio", { name: "Sprint board" }));
    expect(window.location.search).toBe("?sprint=s7");
  });
});

/* ── Sprint board: pure logic ───────────────────────────────────────── */

describe("sprint board columns and ages", () => {
  it("maps statuses to four columns; a planned-in backlog story or an unknown status waits in To do", () => {
    expect(sprintColumnOf("backlog")).toBe("todo");
    expect(sprintColumnOf("todo")).toBe("todo");
    expect(sprintColumnOf("in_progress")).toBe("in_progress");
    expect(sprintColumnOf("review")).toBe("review");
    expect(sprintColumnOf("done")).toBe("done");
    expect(sprintColumnOf("blocked-ish")).toBe("todo");

    const cols = storiesByColumn(
      [
        story("a", "A", { status: "backlog" }),
        story("b", "B", { status: "review" }),
        story("c", "C", { status: "done", sprintId: "other" }),
        story("d", "D", { status: "todo", sprintId: undefined }),
      ],
      "s7"
    );
    expect(cols.todo.map((s) => s.id)).toEqual(["a"]);
    expect(cols.review.map((s) => s.id)).toEqual(["b"]);
    expect(cols.done).toEqual([]);
  });

  it("dates the column stay from the history's last entry, never from time in the product backlog", () => {
    // Sprint Planning moved it out of the sprint (backlog) 6 days ago and
    // planned it back in (todo) 2 days ago: 2 days in this sprint's To do.
    const replanned = story("a", "A", {
      status: "todo",
      statusHistory: [
        { status: "in_progress", from: "todo", at: ago(9) },
        { status: "backlog", from: "in_progress", at: ago(6) },
        { status: "todo", from: "backlog", at: ago(2) },
      ],
    });
    expect(columnEnteredAt(replanned)).toBe(ago(2));
    expect(daysInColumn(replanned, NOW)).toBe(2);
    // A sprint story still marked backlog waits in To do from its own entry.
    const waiting = story("b", "B", {
      status: "backlog",
      statusHistory: [
        { status: "todo", from: "backlog", at: ago(8) },
        { status: "backlog", from: "todo", at: ago(3) },
      ],
    });
    expect(daysInColumn(waiting, NOW)).toBe(3);
  });

  it("falls back to the start or done time, and says nothing when nothing says", () => {
    expect(columnEnteredAt(story("a", "A", { status: "review", startedAt: ago(3) }))).toBe(ago(3));
    expect(columnEnteredAt(story("a", "A", { status: "done", doneAt: ago(1) }))).toBe(ago(1));
    expect(columnEnteredAt(story("a", "A", { status: "todo" }))).toBeNull();
    // The history's last entry disagrees with the status (a hand edit): don't trust it.
    const edited = story("a", "A", {
      status: "review",
      startedAt: ago(4),
      statusHistory: [{ status: "in_progress", from: "todo", at: ago(8) }],
    });
    expect(columnEnteredAt(edited)).toBe(ago(4));
    // A garbled date is no date.
    expect(
      daysInColumn(
        story("a", "A", {
          status: "in_progress",
          statusHistory: [{ status: "in_progress", at: "yesterday-ish" }],
        }),
        NOW
      )
    ).toBeNull();
    // Moved a moment ago (or a clock ahead): 0 days, never negative.
    expect(daysInColumn(story("a", "A", { status: "in_progress", startedAt: ago(-1) }), NOW)).toBe(
      0
    );
  });

  it("nudges only the work in progress over its limit, never To do (the sprint's queue) or Done", () => {
    const many = (n: number, status: Story["status"]) =>
      Array.from({ length: n }, (_, i) => story(`${status}${i}`, `S${i}`, { status }));
    const cols = storiesByColumn(
      [...many(6, "todo"), ...many(4, "in_progress"), ...many(3, "review"), ...many(9, "done")],
      "s7"
    );
    const breaches = sprintBreaches(cols, LIMITS);
    // To do holds 6 against Ready's default 5: a sprint planned that full
    // on day one is no reason to warn.
    expect(breaches.map((b) => [b.column, b.count, b.limit])).toEqual([
      ["in_progress", 4, 3],
      ["review", 3, 2],
    ]);
    expect(wipNudge(breaches[0])).toBe(
      "In progress has 4 stories, limit 3: finish something before starting more."
    );
    expect(sprintBreaches(cols, { ...LIMITS, ready: 1 })).toHaveLength(2);
    // A limit of 0 means no limit.
    expect(sprintBreaches(cols, { ...LIMITS, in_progress: 0, review: 0 })).toEqual([]);
  });

  it("words a move, with the nudge when it went over the limit", () => {
    expect(moveMessage("Pay by card", "review")).toBe("Moved “Pay by card” to Review.");
    expect(
      moveMessage("Pay by card", "in_progress", {
        column: "in_progress",
        label: "In progress",
        count: 4,
        limit: 3,
      })
    ).toBe(
      "Moved “Pay by card” to In progress. In progress has 4 stories, limit 3: finish something before starting more."
    );
  });
});

describe("sprint board verdict", () => {
  const verdict = (stories: Story[], limits = LIMITS) => {
    const cols = storiesByColumn(stories, "s7");
    return sprintBoardVerdict(sprint(), storyProgress(stories, "s7"), sprintBreaches(cols, limits));
  };

  it("covers an empty sprint and a finished one", () => {
    expect(verdict([])).toBe("No stories are planned into Sprint 7 yet.");
    expect(
      verdict([
        story("a", "A", { status: "done", points: 3 }),
        story("b", "B", { status: "done", points: 5 }),
      ])
    ).toBe("Every story in Sprint 7 is done: 8 points.");
    expect(verdict([story("a", "A", { status: "done" })])).toBe("Every story in Sprint 7 is done.");
  });

  it("leads with points done, then the one thing that needs attention", () => {
    const base = [
      story("a", "A", { status: "done", points: 2 }),
      story("b", "B", { status: "in_progress", points: 5 }),
      story("c", "C", { status: "todo", points: 3 }),
    ];
    expect(verdict(base)).toBe("2 of 10 points done (20%).");
    expect(
      verdict([...base.slice(0, 2), story("c", "C", { status: "todo", blocked: true, points: 3 })])
    ).toBe("2 of 10 points done (20%); 1 story is blocked, so unblock it first.");
    expect(verdict(base, { ...LIMITS, in_progress: 0, review: 0, ready: 0 })).toBe(
      "2 of 10 points done (20%)."
    );
    expect(
      verdict([...base, story("d", "D", { status: "in_progress", points: 1 })], {
        ...LIMITS,
        in_progress: 1,
      })
    ).toBe(
      "2 of 11 points done (18%); In progress is over its WIP limit, so finish something before starting more."
    );
    expect(verdict([...base, story("d", "D", { status: "todo" })])).toBe(
      "2 of 10 points done (20%); 1 story has no estimate yet."
    );
    expect(verdict([story("a", "A", { status: "todo", points: 3 })])).toBe(
      "0 of 3 points done (0%); nothing has been started yet."
    );
    // No points at all: counted in stories.
    expect(
      verdict([story("a", "A", { status: "done" }), story("b", "B", { status: "in_progress" })])
    ).toBe("1 of 2 stories done; 2 stories have no estimate yet.");
  });

  it("handles huge numbers", () => {
    expect(
      verdict([
        story("a", "A", { status: "done", points: 1_000_000 }),
        story("b", "B", { status: "in_progress", points: 3_000_000 }),
      ])
    ).toBe("1000000 of 4000000 points done (25%).");
  });
});

describe("the Definition of Done in the sprint board verdict", () => {
  const DOD: DodCriterion[] = [
    { id: "rev", label: "Code reviewed", category: "code", required: true },
    { id: "ci", label: "Tests pass in CI", category: "testing", required: true },
    { id: "doc", label: "Docs updated", category: "docs", required: false },
  ];
  const ticked = (...checked: string[]): Partial<Story> => ({
    dodChecks: { checked, updatedAt: ago(1) },
  });
  const verdict = (stories: Story[], dod = DOD, limits = LIMITS) => {
    const cols = storiesByColumn(stories, "s7");
    return sprintBoardVerdict(
      sprint(),
      storyProgress(stories, "s7"),
      sprintBreaches(cols, limits),
      doneMissingDod(cols.done, { items: dod }).length
    );
  };
  const base = () => [
    story("a", "A", { status: "done", points: 2 }),
    story("b", "B", { status: "in_progress", points: 5 }),
    story("c", "C", { status: "todo", points: 3 }),
  ];

  afterEach(() => {
    useWorkspaceStore.setState({ definitionsOfDone: [] });
  });

  it("finds the done stories with a required criterion still open", () => {
    const stories = [
      // Optional criteria don't count, and a ticked id no longer in the DoD is ignored.
      story("a", "A", { status: "done", ...ticked("rev", "ci") }),
      story("b", "B", { status: "done", ...ticked("rev") }),
      story("c", "C", { status: "done" }),
      story("d", "D", { status: "review" }),
      story("e", "E", { status: "done", ...ticked("rev", "ci", "gone") }),
    ];
    expect(doneMissingDod(stories, { items: DOD }).map((s) => s.id)).toEqual(["b", "c"]);
    // Nothing required: nothing to miss.
    expect(doneMissingDod(stories, { items: [DOD[2]] })).toEqual([]);
    expect(doneMissingDod(stories, { items: [] })).toEqual([]);
  });

  it("names done stories that miss it, after blocked stories and WIP, before estimates", () => {
    expect(verdict(base())).toBe(
      "2 of 10 points done (20%); 1 done story doesn't meet the DoD yet."
    );
    expect(verdict([...base(), story("d", "D", { status: "done", points: 1 })])).toBe(
      "3 of 11 points done (27%); 2 done stories don't meet the DoD yet."
    );
    // No DoD, or every done story meets it: no caveat.
    expect(verdict(base(), [])).toBe("2 of 10 points done (20%).");
    expect(
      verdict([
        story("a", "A", { status: "done", points: 2, ...ticked("rev", "ci") }),
        ...base().slice(1),
      ])
    ).toBe("2 of 10 points done (20%).");
    // A blocked story or a column over its limit needs the team first.
    expect(
      verdict([
        ...base().slice(0, 2),
        story("c", "C", { status: "todo", blocked: true, points: 3 }),
      ])
    ).toBe("2 of 10 points done (20%); 1 story is blocked, so unblock it first.");
    expect(
      verdict([...base(), story("d", "D", { status: "in_progress", points: 1 })], DOD, {
        ...LIMITS,
        in_progress: 1,
      })
    ).toBe(
      "2 of 11 points done (18%); In progress is over its WIP limit, so finish something before starting more."
    );
    // Before an unestimated story.
    expect(verdict([...base(), story("d", "D", { status: "todo" })])).toBe(
      "2 of 10 points done (20%); 1 done story doesn't meet the DoD yet."
    );
  });

  it("still says so when every story is done", () => {
    expect(
      verdict([
        story("a", "A", { status: "done", points: 3, ...ticked("rev", "ci") }),
        story("b", "B", { status: "done", points: 5 }),
      ])
    ).toBe("Every story in Sprint 7 is done: 8 points, but 1 doesn't meet the DoD yet.");
    expect(
      verdict([story("a", "A", { status: "done" }), story("b", "B", { status: "done" })])
    ).toBe("Every story in Sprint 7 is done, but 2 don't meet the DoD yet.");
    expect(verdict([story("a", "A", { status: "done", points: 3, ...ticked("rev", "ci") })])).toBe(
      "Every story in Sprint 7 is done: 3 points."
    );
  });

  it("reads the same in the board's header and its Markdown export", () => {
    const stories = [
      story("a", "Pay by card", { status: "done", points: 2 }),
      story("b", "Receipts", { status: "todo", points: 3 }),
    ];
    const line = "2 of 5 points done (40%); 1 done story doesn't meet the DoD yet.";
    expect(
      sprintBoardMarkdown({ sprint: sprint(), stories, wipLimits: LIMITS, dod: DOD }, NOW)
    ).toContain(line);
    // Without the DoD passed in, the export has nothing to check against.
    expect(sprintBoardMarkdown({ sprint: sprint(), stories, wipLimits: LIMITS }, NOW)).toContain(
      "2 of 5 points done (40%)."
    );

    seed({ stories });
    useWorkspaceStore.setState({
      definitionsOfDone: [{ id: DOD_DOC_ID, items: DOD, history: [] }],
    });
    renderBoard();
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(exported()).toContain(line);
  });
});

describe("undoing a move", () => {
  const before = story("a", "A", {
    status: "in_progress",
    startedAt: ago(3),
    blocked: true,
    statusHistory: [{ status: "in_progress", from: "todo", at: ago(3) }],
  });

  it("puts the status, stamps, flag and history back and keeps later edits", () => {
    const moved = { ...before, status: "done" as const, doneAt: ago(0), owner: "Ben" };
    delete (moved as Partial<Story>).blocked;
    moved.statusHistory = [
      ...before.statusHistory!,
      { status: "done", from: "in_progress", at: ago(0) },
    ];
    const back = revertMove(moved, before, "done")!;
    expect(back).toEqual({ ...before, owner: "Ben" });
    expect("doneAt" in back).toBe(false);
  });

  it("leaves a story that has moved again since", () => {
    expect(revertMove({ ...before, status: "review" }, before, "done")).toBeNull();
  });

  it("keeps a blocked flag set after the move", () => {
    const todo = story("a", "A", { status: "todo" });
    const moved = withStoryStatus(todo, "in_progress", ago(1));
    const back = revertMove(withStoryBlocked(moved, true), todo, "in_progress")!;
    expect(back).toMatchObject({ status: "todo", blocked: true });
    expect("statusHistory" in back).toBe(false);
    // The move to Done cleared the flag itself: Undo brings it back.
    const done = withStoryStatus(before, "done", ago(0));
    expect(done.blocked).toBeUndefined();
    expect(revertMove(done, before, "done")!.blocked).toBe(true);
  });

  it("leaves a story that moved away and back since, though its status matches again", () => {
    const todo = story("a", "A", { status: "todo" });
    const first = withStoryStatus(todo, "in_progress", ago(3));
    const roundTrip = withStoryStatus(
      withStoryStatus(first, "review", ago(2)),
      "in_progress",
      ago(1)
    );
    expect(revertMove(roundTrip, todo, "in_progress")).toBeNull();
    const backAndForth = withStoryStatus(
      withStoryStatus(first, "todo", ago(2)),
      "in_progress",
      ago(1)
    );
    expect(revertMove(backAndForth, todo, "in_progress")).toBeNull();
    // With a history before the move as well.
    const later = withStoryStatus(withStoryStatus(before, "review", ago(2)), "in_progress", ago(1));
    expect(revertMove(later, before, "review")).toBeNull();
    expect(revertMove(withStoryStatus(before, "review", ago(2)), before, "review")).toMatchObject({
      status: "in_progress",
      statusHistory: before.statusHistory,
    });
  });

  it("still finds its own move once the history is at its cap", () => {
    const full = story("a", "A", {
      status: "todo",
      statusHistory: Array.from({ length: STORY_STATUS_HISTORY_CAP }, (_, i) => ({
        status: i % 2 === 0 ? ("in_progress" as const) : ("todo" as const),
        at: ago(100 - i),
      })),
    });
    const moved = withStoryStatus(full, "in_progress", ago(0));
    expect(moved.statusHistory).toHaveLength(STORY_STATUS_HISTORY_CAP);
    expect(revertMove(moved, full, "in_progress")).toMatchObject({
      status: "todo",
      statusHistory: full.statusHistory,
    });
  });
});

/* ── Sprint board: writers ──────────────────────────────────────────── */

describe("sprint board writers", () => {
  it("sets and clears an owner, trimmed, and leaves an unchanged story alone", () => {
    const s = story("a", "A", { owner: "Amira" });
    expect(withOwner(s, "Amira")).toBe(s);
    expect(withOwner(s, "  Ben ")).toMatchObject({ owner: "Ben" });
    expect("owner" in withOwner(s, "  ")).toBe(false);
  });

  it("the live writer stamps a move through setStoryStatus and writes owners", () => {
    seed({ stories: [story("a", "Pay by card")] });
    liveSprintWriter.setStatus("a", "in_progress");
    expect(storyById("a")).toMatchObject({ status: "in_progress" });
    expect(storyById("a").startedAt).toBeDefined();
    expect(storyById("a").statusHistory).toMatchObject([{ status: "in_progress", from: "todo" }]);
    liveSprintWriter.setOwner("a", "Chloé");
    liveSprintWriter.setBlocked("a", true);
    expect(storyById("a")).toMatchObject({ owner: "Chloé", blocked: true });
    liveSprintWriter.setOwner("missing", "Nobody");
  });

  it("the example writer stamps the same way and never touches the workspace", () => {
    seed({ stories: [] });
    const example = buildSprintExample("2026-10-20", NOW);
    const store = createExampleBoardStore(example);
    const writer = exampleSprintWriter(store);
    const id = example.stories[0].id;
    writer.setStatus(id, "done");
    writer.setOwner(id, "Dev");
    expect(writer.story(id)).toMatchObject({ status: "done", owner: "Dev" });
    expect(writer.story(id)!.statusHistory!.at(-1)).toMatchObject({ status: "done" });
    expect(useWorkspaceStore.getState().stories).toEqual([]);
  });
});

/* ── Sprint board: on screen ────────────────────────────────────────── */

describe("sprint board", () => {
  const stories = () => [
    story("a", "Pay by card", {
      status: "in_progress",
      points: 5,
      startedAt: ago(2, new Date()),
      statusHistory: [{ status: "in_progress", from: "todo", at: ago(2, new Date()) }],
    }),
    story("b", "Refund flow", { status: "backlog", points: 3 }),
    story("c", "Receipts by email", { status: "done", points: 2, sourceRef: undefined }),
    story("x", "Another sprint's story", { sprintId: "s6", status: "in_progress" }),
  ];

  it("shows the sprint's stories by status with points, owner, age and a verdict", () => {
    seed({ stories: stories() });
    renderBoard();
    expect(screen.getByText("2 of 10 points done (20%).")).toBeInTheDocument();
    const inProgress = within(screen.getByRole("region", { name: "In progress" }));
    expect(inProgress.getByText("Pay by card")).toBeInTheDocument();
    expect(inProgress.getByText("5 pts")).toBeInTheDocument();
    expect(inProgress.getByText("2 days in In progress")).toBeInTheDocument();
    // A planned-in story still marked "backlog" waits in To do, with no age to show.
    const todo = within(screen.getByRole("region", { name: "To do" }));
    expect(todo.getByText("Refund flow")).toBeInTheDocument();
    expect(todo.getByText("Time in To do unknown")).toBeInTheDocument();
    expect(screen.queryByText("Another sprint's story")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Owner of Pay by card: no owner" })
    ).toBeInTheDocument();
  });

  it("moves a story from the Move to… menu through setStoryStatus, says so, and Undo puts it back", async () => {
    seed({ stories: stories() });
    renderBoard();
    openMenu("Move to…: Pay by card");
    expect(screen.getByRole("menuitem", { name: "In progress (here now)" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Review" }));

    expect(storyById("a").status).toBe("review");
    expect(storyById("a").statusHistory!.at(-1)).toMatchObject({
      status: "review",
      from: "in_progress",
    });
    expect(within(screen.getByRole("region", { name: "Review" })).getByText("Pay by card"));
    await waitFor(() => expect(live()).toHaveTextContent("Moved “Pay by card” to Review."));
    expect(lastToast()[0]).toBe("Moved “Pay by card” to Review");
    expect(spies.log).toHaveBeenCalledWith(
      "card_moved",
      expect.objectContaining({ storyId: "a", from: "in_progress", to: "review" })
    );
    // Focus follows the card to its new column.
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(screen.getByRole("button", { name: "Move to…: Pay by card" })).toHaveFocus();

    undoLast();
    expect(storyById("a").status).toBe("in_progress");
    expect(storyById("a").statusHistory).toHaveLength(1);
    await waitFor(() =>
      expect(live()).toHaveTextContent("Moved “Pay by card” back to In progress.")
    );
  });

  it("moving to To do writes todo, and To do isn't offered to a story already there", () => {
    seed({ stories: stories() });
    renderBoard();
    openMenu("Move to…: Refund flow");
    expect(screen.getByRole("menuitem", { name: "To do (here now)" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "In progress" }));
    expect(storyById("b").status).toBe("in_progress");

    openMenu("Move to…: Receipts by email");
    fireEvent.click(screen.getByRole("menuitem", { name: "To do" }));
    expect(storyById("c")).toMatchObject({ status: "todo" });
    expect("doneAt" in storyById("c")).toBe(false);
  });

  it("nudges, never blocks, when a move takes a column over its limit", async () => {
    seed({ stories: stories(), wipLimits: { ...LIMITS, in_progress: 1 } });
    renderBoard();
    openMenu("Move to…: Refund flow");
    fireEvent.click(screen.getByRole("menuitem", { name: "In progress" }));
    expect(storyById("b").status).toBe("in_progress");
    expect(
      screen.getByText("In progress has 2 stories, limit 1: finish something before starting more.")
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(live()).toHaveTextContent(
        "Moved “Refund flow” to In progress. In progress has 2 stories, limit 1"
      )
    );
  });

  it("flags a story as blocked in words and colour, and clears it", () => {
    seed({ stories: stories() });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Flag blocked: Pay by card" }));
    expect(storyById("a").blocked).toBe(true);
    const card = within(screen.getByRole("region", { name: "In progress" }));
    expect(card.getByText("Blocked")).toHaveClass("text-danger");
    expect(
      screen.getByText(/1 story is blocked, so unblock it first/, { selector: "p" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unblock: Pay by card" }));
    expect("blocked" in storyById("a")).toBe(false);
    // Done stories can't be blocked: no toggle.
    expect(screen.queryByRole("button", { name: "Flag blocked: Receipts by email" })).toBeNull();
  });

  it("sets the owner in place with the person picker; Escape changes nothing", () => {
    seed({ stories: stories() });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Owner of Pay by card: no owner" }));
    const input = screen.getByRole("combobox", { name: "Owner of Pay by card" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "  Ben " } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(storyById("a").owner).toBeUndefined();
    expect(screen.getByRole("button", { name: "Owner of Pay by card: no owner" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Owner of Pay by card: no owner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Owner of Pay by card" }), {
      target: { value: "  Ben " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(storyById("a").owner).toBe("Ben");
    expect(screen.getByRole("button", { name: "Owner of Pay by card: Ben" })).toHaveFocus();
  });

  it("edits the shared WIP limits from the column headers (To do is Ready's)", () => {
    seed({ stories: stories() });
    renderBoard();
    const input = screen.getByRole("spinbutton", { name: "WIP limit for To do" });
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    expect(flowBoard()!.wipLimits.ready).toBe(4);
    expect(screen.queryByRole("spinbutton", { name: "WIP limit for Done" })).toBeNull();
  });

  it("exports the board on screen as Markdown", () => {
    seed({ sprints: [sprint({ goal: "Pay with a saved card" })], stories: stories() });
    renderBoard();
    const md = exported();
    expect(md).toContain("# Sprint 7 board — ");
    expect(md).toContain("**Sprint goal:** Pay with a saved card");
    expect(md).toContain("## In progress (1/3)");
    expect(md).toContain("- Pay by card (5 pts, 2 days in column)");
    expect(md).toContain("- Refund flow (3 pts)");
    expect(md).not.toContain("Another sprint's story");
  });

  it("points an empty sprint at Sprint Planning", () => {
    seed({ stories: [] });
    renderBoard();
    expect(screen.getByText(/No stories in Sprint 7 yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan stories into Sprint 7" })).toHaveAttribute(
      "href",
      "/sprint-planning?sprint=s7"
    );
  });

  it("shows a long To do against its limit without a nudge, and a move back says only the move", async () => {
    const queued = Array.from({ length: 6 }, (_, i) =>
      story(`t${i}`, `Queued ${i}`, { points: 1 })
    );
    seed({ stories: [...stories(), ...queued] });
    renderBoard();
    const todo = within(screen.getByRole("region", { name: "To do" }));
    const count = todo.getByText(/^7 \/ 5/);
    expect(todo.getByText("(over the WIP limit)")).toBeInTheDocument();
    expect(count.closest(".rounded-lg")).not.toHaveClass("bg-warning/5");
    expect(screen.queryByText(/To do has/)).toBeNull();
    expect(screen.getByText("2 of 16 points done (13%).")).toBeInTheDocument();

    openMenu("Move to…: Pay by card");
    fireEvent.click(screen.getByRole("menuitem", { name: "To do" }));
    expect(storyById("a").status).toBe("todo");
    await waitFor(() => expect(live()).toHaveTextContent("Moved “Pay by card” to To do."));
    expect(live().textContent).not.toMatch(/limit/);
  });

  it("opens a completed sprint read-only: no moves, flags, owner edits or limits", () => {
    seed({
      sprints: [sprint({ status: "completed" })],
      stories: [...stories(), story("o", "Saved cards", { status: "review", owner: "Ben" })],
    });
    window.history.replaceState(null, "", "/kanban?sprint=s7");
    renderBoard();
    expect(screen.getByText(closedBoardNote(sprint({ status: "completed" })))).toBeInTheDocument();
    expect(screen.getByText("Pay by card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move to…/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Flag blocked/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Owner of/ })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /^WIP limit/ })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Review" })).getByText("Ben")).toBeVisible();
    // Still exportable.
    expect(exported()).toContain("## Review (1/2)");
  });

  it("words the closed-sprint note, and doesn't offer to plan into an empty closed sprint", () => {
    expect(isClosedSprint(sprint({ status: "completed" }))).toBe(true);
    expect(isClosedSprint(sprint({ status: "cancelled" }))).toBe(true);
    expect(isClosedSprint(sprint({ status: "active" }))).toBe(false);
    expect(isClosedSprint(sprint({ status: "planned" }))).toBe(false);
    expect(closedBoardNote(sprint({ status: "cancelled" }))).toBe(
      "Sprint 7 is cancelled, so its board is read-only: moving its stories now would change what the sprint delivered. Pick an open sprint to keep working."
    );

    seed({ sprints: [sprint({ status: "cancelled" })], stories: [] });
    window.history.replaceState(null, "", "/kanban?sprint=s7");
    renderBoard();
    expect(screen.getByText("No stories were planned into Sprint 7.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Plan stories into/ })).toBeNull();
  });

  it("offers to add a new owner to the team on the real board", () => {
    seed({ stories: stories() });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Owner of Pay by card: no owner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Owner of Pay by card" }), {
      target: { value: "Zed" },
    });
    expect(screen.getByRole("button", { name: /Add to the team/ })).toBeInTheDocument();
  });
});

describe("sprint board example", () => {
  it("is built from example ids, with In progress over the default limit and one story blocked", () => {
    const { sprint: s, stories: list } = buildSprintExample("2026-10-20", NOW);
    expect(isExampleSprintId(s.id)).toBe(true);
    expect(list.every((x) => x.id.startsWith("example-") && x.sprintId === s.id)).toBe(true);
    const cols = storiesByColumn(list, s.id);
    expect(cols.in_progress.length).toBeGreaterThan(LIMITS.in_progress);
    expect(list.filter((x) => x.blocked)).toHaveLength(1);
    expect(list.some((x) => x.points === undefined)).toBe(true);
    // The history ends where the story is, so ages read from it.
    for (const x of list) expect(x.statusHistory!.at(-1)!.status).toBe(x.status);
    expect(daysInColumn(list.find((x) => x.status === "review")!, NOW)).toBe(3);
  });

  it("opens from the empty state in memory only, and Clear example closes it", () => {
    seed({ sprints: [], stories: [] });
    localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify("sprint"));
    renderBoard();
    expect(screen.getByText(/No sprint to show yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan a sprint" })).toHaveAttribute(
      "href",
      "/sprint-planning"
    );

    fireEvent.click(screen.getByRole("button", { name: "See an example board" }));
    expect(screen.getByText("Pay with a saved card")).toBeInTheDocument();
    expect(
      screen.getByText("In progress has 4 stories, limit 3: finish something before starting more.")
    ).toBeInTheDocument();
    expect(exported()).toContain("# Sprint 5 board");

    openMenu("Move to…: Refund flow");
    fireEvent.click(screen.getByRole("menuitem", { name: "Done" }));
    expect(within(screen.getByRole("region", { name: "Done" })).getByText("Refund flow"));
    expect(useWorkspaceStore.getState().stories).toEqual([]);
    // Not the user's work: nothing logged or sonified.
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.sonify).not.toHaveBeenCalled();
    // The example's WIP limits are the user's, shown but not edited from here.
    expect(screen.queryByRole("spinbutton", { name: "WIP limit for To do" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText("Pay with a saved card")).toBeNull();
    expect(screen.getByText(/No sprint to show yet/)).toBeInTheDocument();
  });

  it("never offers an example owner for the team roster", () => {
    seed({ sprints: [], stories: [] });
    localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify("sprint"));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "See an example board" }));
    fireEvent.click(screen.getByRole("button", { name: "Owner of Refund flow: Dev" }));
    expect(screen.getByText(/“Dev” isn.t on the team\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add to the team/ })).toBeNull();
    expect(useWorkspaceStore.getState().teamMembers).toEqual([]);
  });

  it("offers the Flow board to a team without sprints", () => {
    seed({ sprints: [] });
    localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify("sprint"));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Use the Flow board" }));
    expect(screen.getByRole("textbox", { name: "New card title" })).toBeInTheDocument();
  });
});

/* ── Flow board: pure logic ─────────────────────────────────────────── */

describe("flow board cards", () => {
  it("won't add a card without a title", () => {
    expect(validateCard({ title: "  ", description: "x" })).toEqual({
      ok: false,
      errors: { title: "Enter a card title." },
    });
    expect(validateCard({ title: " Pay ", description: "  " })).toEqual({
      ok: true,
      values: { title: "Pay" },
    });
    expect(validateCard({ title: "Pay", description: " card " })).toEqual({
      ok: true,
      values: { title: "Pay", description: "card" },
    });
  });

  it("stamps a move: the column stay always, start and finish the way the agent's move does", () => {
    const at = ago(0);
    const c = card("a", "A", { blocked: true });
    expect(movedCard(c, "backlog", at)).toBe(c);

    const started = movedCard(c, "in_progress", at);
    expect(started).toMatchObject({
      column: "in_progress",
      columnSince: at,
      startedAt: at,
      blocked: true,
    });
    // Re-entering In progress keeps the first start.
    const again = movedCard({ ...started, column: "review" }, "in_progress", ago(-1));
    expect(again.startedAt).toBe(at);

    const done = movedCard(started, "done", ago(-2));
    expect(done).toMatchObject({ completedAt: ago(-2), columnSince: ago(-2) });
    expect("blocked" in done).toBe(false);
    // Reopened: no completion; back to Ready: no start either.
    const reopened = movedCard(done, "review", ago(-3));
    expect("completedAt" in reopened).toBe(false);
    expect(reopened.startedAt).toBe(at);
    const back = movedCard(reopened, "ready", ago(-4));
    expect("startedAt" in back).toBe(false);
    expect(Object.values(back).includes(undefined)).toBe(false);

    // Pulled straight into Review: work started there, so it counts towards cycle time.
    const reviewed = movedCard(card("b", "B", { column: "ready" }), "review", at);
    expect(reviewed.startedAt).toBe(at);
    const finished = movedCard(reviewed, "done", ago(-2));
    // Whole local days with the start and finish day both counted: 3, not 2.
    expect(cycleTimeDays(finished)).toBe(3);
    expect(cycleStats([finished]).count).toBe(1);
    // Dropped straight into Done: nobody saw it worked on, so no made-up 0 days.
    const skipped = movedCard(card("c", "C", { column: "ready" }), "done", at);
    expect("startedAt" in skipped).toBe(false);
    expect(cycleTimeDays(skipped)).toBeNull();
  });

  it("dates the stay from the column's own stamp when an agent's move left columnSince behind", () => {
    // move_card into In progress stamps a date-only start and leaves columnSince.
    expect(
      cardColumnSince(
        card("a", "A", { column: "in_progress", columnSince: ago(10), startedAt: "2026-10-20" })
      )
    ).toBe("2026-10-20");
    expect(
      cardColumnSince(
        card("a", "A", {
          column: "done",
          columnSince: ago(10),
          startedAt: ago(9),
          completedAt: ago(2),
        })
      )
    ).toBe(ago(2));
    // Moved on the board, columnSince is the newest stamp and wins.
    expect(
      cardColumnSince(card("a", "A", { column: "review", columnSince: ago(3), startedAt: ago(5) }))
    ).toBe(ago(3));
    expect(
      cardColumnSince(
        card("a", "A", { column: "in_progress", columnSince: ago(1), startedAt: ago(6) })
      )
    ).toBe(ago(1));
    // A garbled stamp is skipped, not preferred.
    expect(
      cardColumnSince(
        card("a", "A", { column: "in_progress", columnSince: ago(2), startedAt: "soon" })
      )
    ).toBe(ago(2));
  });

  it("an agent's move_card restarts the age in column on the board", async () => {
    const now = new Date();
    seed({
      sprints: [],
      cards: [card("a", "Search", { createdAt: ago(10, now), columnSince: ago(10, now) })],
    });
    const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
    await registry
      .get("tool.kanban.move_card")!
      .handler({ cardId: "a", column: "in_progress" }, ctx);
    expect(daysSince(cardColumnSince(flowBoard()!.cards[0]), now)).toBe(0);
    await registry.get("tool.kanban.move_card")!.handler({ cardId: "a", column: "done" }, ctx);
    expect(daysSince(cardColumnSince(flowBoard()!.cards[0]), now)).toBe(0);
  });

  it("counts time in work from the start, which a move from In progress to Review keeps", () => {
    // Counted like a cycle time (lib/flow cycleDays): the start day is day 1.
    expect(
      daysInWork(card("a", "A", { column: "review", columnSince: ago(1), startedAt: ago(9) }), NOW)
    ).toBe(10);
    // No start: from when it entered its column, else when it was created.
    expect(daysInWork(card("a", "A", { column: "review", columnSince: ago(3) }), NOW)).toBe(4);
    expect(daysInWork(card("a", "A", { column: "review", createdAt: ago(4) }), NOW)).toBe(5);
    expect(daysInWork(card("a", "A", { createdAt: "never" }), NOW)).toBeNull();
    // Started today; started "tomorrow" by another device's clock: just started.
    expect(daysInWork(card("a", "A", { column: "in_progress", startedAt: ago(0) }), NOW)).toBe(1);
    expect(daysInWork(card("a", "A", { column: "in_progress", startedAt: ago(-2) }), NOW)).toBe(1);
  });

  it("ages a card in work as lib/flow ageingWip does, so the tint flags it a day past P85", () => {
    // P85 6 days: 6 days in work is within it, 7 is past it.
    const within = card("a", "A", { column: "in_progress", startedAt: ago(5) });
    const past = card("b", "B", { column: "review", startedAt: ago(6), columnSince: ago(1) });
    expect(daysInWork(within, NOW)).toBe(6);
    expect(daysInWork(past, NOW)).toBe(7);
    expect(
      ageingWip(cardItems([within, past]), todayIso(NOW), 6).map((a) => [
        a.id,
        a.ageDays,
        a.overP85,
      ])
    ).toEqual([
      ["b", 7, true],
      ["a", 6, false],
    ]);
  });

  it("dates the column stay of an old card from its best stamp", () => {
    expect(cardColumnSince(card("a", "A", { columnSince: ago(1), startedAt: ago(5) }))).toBe(
      ago(1)
    );
    expect(cardColumnSince(card("a", "A", { column: "in_progress", startedAt: ago(5) }))).toBe(
      ago(5)
    );
    expect(cardColumnSince(card("a", "A", { column: "review" }))).toBe(ago(10));
    expect(
      cardColumnSince(card("a", "A", { column: "done", startedAt: ago(5), completedAt: ago(2) }))
    ).toBe(ago(2));
    expect(cardColumnSince(card("a", "A", { column: "ready" }))).toBe(ago(10));
    expect(cardColumnSince(card("a", "A", { createdAt: "not a date" }))).toBeNull();
    expect(daysSince(ago(3.5), NOW)).toBe(3);
    expect(daysSince(ago(-2), NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
  });

  it("takes P85 from the shared percentile and counts only cards in Done", () => {
    expect(cycleStats([])).toEqual({ count: 0, average: null, spread: null, p85: null });
    const finished = (days: number, i: number) =>
      card(`d${i}`, "D", { column: "done", startedAt: ago(days + i), completedAt: ago(i) });
    const cards = [1, 2, 3, 4, 10].map(finished);
    // Moved out of Done by an agent, which leaves the completion behind.
    cards.push(card("r", "R", { column: "review", startedAt: ago(40), completedAt: ago(1) }));
    const stats = cycleStats(cards);
    expect(stats.count).toBe(5);
    // 1, 2, 3, 4 and 10 days apart: 2, 3, 4, 5 and 11 days with both ends counted.
    expect(stats.average).toBe(5);
    expect(stats.spread).toBeCloseTo(Math.sqrt(10));
    expect(stats.p85).toBe(percentile([2, 3, 4, 5, 11], 85)!);
    expect(stats.p85).toBe(11);
    const huge = cycleStats([finished(10_000, 0)]);
    expect(huge).toMatchObject({ count: 1, spread: 0 });
    expect(huge.p85).toBe(10_001);
    // Same day: 1 day, not a made-up 0.
    const local = (h: number) => new Date(2026, 9, 20, h).toISOString();
    expect(cycleTimeDays({ startedAt: local(9), completedAt: local(17) })).toBe(1);
    // Finished "before" it started (bad data): no cycle time.
    expect(cycleTimeDays({ startedAt: ago(1), completedAt: ago(3) })).toBeNull();
  });

  it("counts throughput for the last 7 days and per week, gaps included", () => {
    const done = (daysAgo: number, i: number) =>
      card(`t${i}`, "T", {
        column: "done",
        startedAt: ago(daysAgo + 1),
        completedAt: ago(daysAgo),
      });
    const cards = [done(1, 1), done(6, 2), done(8, 3), done(30, 4)];
    cards.push(card("r", "R", { column: "in_progress", completedAt: ago(2) }));
    expect(throughputLastWeek(cards, NOW)).toBe(2);
    expect(throughputLastWeek([], NOW)).toBe(0);

    const series = weeklyThroughput(cards);
    expect(series.length).toBeGreaterThanOrEqual(5);
    expect(series.reduce((a, p) => a + p.value, 0)).toBe(4);
    expect(series.some((p) => p.value === 0)).toBe(true);
    expect(weeklyThroughput([])).toEqual([]);

    const text = throughputChartText([
      { label: "2026-W40", value: 2 },
      { label: "2026-W41", value: 0 },
      { label: "2026-W42", value: 5 },
    ]);
    expect(text.summary).toBe(
      "Cards finished per week rose from 2 to 5 over 3 weeks; 7 cards finished in all."
    );
    expect(text.table.columns).toEqual(["Week", "Cards finished"]);
    expect(text.table.rows).toEqual([
      ["2026-W40", 2],
      ["2026-W41", 0],
      ["2026-W42", 5],
    ]);
  });

  it("says what most needs attention", () => {
    const stats = (cards: KanbanCard[]) => cycleStats(cards);
    expect(flowVerdict([], LIMITS, stats([]))).toBe("No cards on the board yet.");

    const busy = Array.from({ length: 4 }, (_, i) => card(`w${i}`, "W", { column: "in_progress" }));
    expect(flowBreaches(busy, LIMITS)).toEqual([
      { column: "in_progress", label: "In progress", count: 4, limit: 3 },
    ]);
    expect(flowVerdict(busy, LIMITS, stats(busy))).toBe(
      "In progress has 4 cards against a limit of 3: finish something before starting more."
    );
    // Backlog and Done are never limited.
    expect(
      flowBreaches(
        Array.from({ length: 9 }, (_, i) => card(`b${i}`, "B")),
        { ...LIMITS, backlog: 2 }
      )
    ).toEqual([]);

    const blocked = [
      card("a", "A", { column: "review", blocked: true }),
      card("b", "B", { column: "in_progress" }),
    ];
    expect(flowVerdict(blocked, LIMITS, stats(blocked))).toBe(
      "1 of 2 cards in progress is blocked: clear it before pulling more work."
    );

    const done = (d: number, i: number) =>
      card(`d${i}`, "D", { column: "done", startedAt: ago(d), completedAt: ago(0) });
    // Started 2, 4 and 6 days ago and done today: 3, 5 and 7 days with both ends counted.
    const three = [2, 4, 6].map(done);
    expect(flowVerdict(three, LIMITS, stats(three))).toBe(
      "Cards take 5 days on average from start to done."
    );
    const five = [1, 2, 3, 4, 10].map(done);
    expect(flowVerdict(five, LIMITS, stats(five))).toBe(
      "Cards take 5 days on average from start to done, and 85% finished within 11 days."
    );
    const two = [card("x", "X", { column: "in_progress" }), done(3, 1)];
    expect(flowVerdict(two, LIMITS, stats(two))).toBe(
      "1 card in progress; finish 2 more to see how long cards take."
    );
  });
});

describe("flow board markdown and example", () => {
  it("tags blocked and assigned cards", () => {
    const md = toMarkdown(
      {
        cards: [
          card("a", "Wallet payments", { column: "in_progress", blocked: true, assignee: "Chloé" }),
          card("b", "Reorder"),
        ],
        wipLimits: LIMITS,
      },
      NOW
    );
    expect(md.split("\n")).toContain("- Wallet payments (blocked, assigned to Chloé)");
    expect(md.split("\n")).toContain("- Reorder");
  });

  it("doesn't tag a done card as blocked (an agent's move into Done leaves the flag)", () => {
    const md = toMarkdown(
      {
        cards: [
          card("a", "Wallet", {
            column: "done",
            blocked: true,
            startedAt: ago(3),
            completedAt: ago(1),
          }),
        ],
        wipLimits: LIMITS,
      },
      NOW
    );
    // Started 3 days ago, done yesterday: 3 days with both ends counted.
    expect(md.split("\n")).toContain("- Wallet (cycle time 3.0 days)");
  });

  it("the example shows assignees, a blocked card and an age in column", () => {
    const cards = buildExample(NOW);
    expect(cards.some((c) => c.assignee)).toBe(true);
    expect(cards.filter((c) => c.blocked)).toHaveLength(1);
    expect(cards.find((c) => c.column === "review")!.columnSince).toBe(ago(2));
  });

  it("the example has enough done cards for the average, P85 and the ageing tint", () => {
    const cards = buildExample(NOW);
    const stats = cycleStats(cards);
    expect(stats.count).toBeGreaterThanOrEqual(MIN_SAMPLE.distribution);
    // 2 to 6 days apart, so 3 to 7 days with both ends counted.
    expect(stats.average).toBe(5);
    expect(stats.p85).toBe(7);
    const review = cards.find((c) => c.column === "review")!;
    expect(daysInWork(review, NOW)).toBeGreaterThan(stats.p85!);
    // New rows went at the end: the earlier cards keep their example ids.
    expect(cards.find((c) => c.title === "Fix tax rounding on split shipments")!.id).toBe(
      exampleId("kanban-9")
    );
  });

  it("writes the sprint board's Markdown for an empty sprint too", () => {
    expect(sprintBoardMarkdown({ sprint: sprint(), stories: [], wipLimits: LIMITS }, NOW)).toBe(
      "# Sprint 7 board — 20 Oct 2026\n\nNo stories are planned into Sprint 7 yet.\n"
    );
    const md = sprintBoardMarkdown(
      {
        sprint: sprint(),
        stories: [
          story("a", "Pay\nby card", {
            status: "in_progress",
            points: 1,
            owner: "Ben",
            blocked: true,
            startedAt: ago(4),
          }),
          story("b", "Fraud checks"),
          story("c", "Receipts", { status: "done", points: 2, blocked: true }),
        ],
        wipLimits: { ...LIMITS, in_progress: 0 },
      },
      NOW
    );
    expect(md).toContain("3 stories: To do 1, In progress 1, Review 0, Done 1. 1 blocked.");
    expect(md).toContain("## In progress (1)");
    expect(md).toContain("- Pay by card (1 pt, Ben, blocked, 4 days in column)");
    expect(md).toContain("- Fraud checks (no estimate)");
    expect(md).toContain("- Receipts (2 pts)");
    expect(md).toContain("## Review (0/2)\n\nNo stories.");
  });
});

/* ── Flow board: on screen ──────────────────────────────────────────── */

describe("flow board", () => {
  it("says what's missing instead of adding a blank card", () => {
    seed({ sprints: [], cards: [card("a", "Search")] });
    renderBoard();
    const title = screen.getByRole("textbox", { name: "New card title" });
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Enter a card title.")).toBeInTheDocument();
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveFocus();
    expect(flowBoard()!.cards).toHaveLength(1);

    fireEvent.change(title, { target: { value: "Exports" } });
    expect(screen.queryByText("Enter a card title.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const added = flowBoard()!.cards[1];
    expect(added).toMatchObject({ title: "Exports", column: "backlog" });
    expect(added.columnSince).toBe(added.createdAt);
  });

  it("assigns a card from the roster in place and flags it blocked", async () => {
    seed({
      sprints: [],
      cards: [card("a", "Search", { column: "in_progress", startedAt: ago(3, new Date()) })],
    });
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Amira" }] });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Assignee of Search: unassigned" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Assignee of Search" }), {
      target: { value: "Amira" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(flowBoard()!.cards[0].assignee).toBe("Amira");

    fireEvent.click(screen.getByRole("button", { name: "Flag blocked: Search" }));
    expect(flowBoard()!.cards[0].blocked).toBe(true);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    await waitFor(() => expect(live()).toHaveTextContent("Flagged “Search” as blocked."));
    fireEvent.click(screen.getByRole("button", { name: "Unblock: Search" }));
    expect("blocked" in flowBoard()!.cards[0]).toBe(false);
  });

  it("shows each card's age in its column, from old cards' stamps too", () => {
    const now = new Date();
    seed({
      sprints: [],
      cards: [
        card("a", "Search", { createdAt: ago(3, now) }),
        card("b", "Exports", { column: "review", createdAt: ago(9, now), startedAt: ago(4, now) }),
        card("c", "Audit", { column: "review", columnSince: ago(1, now), createdAt: ago(9, now) }),
      ],
    });
    renderBoard();
    expect(screen.getByText("3 days in Backlog")).toBeInTheDocument();
    expect(screen.getByText("4 days in Review")).toBeInTheDocument();
    expect(screen.getByText("1 day in Review")).toBeInTheDocument();
  });

  it("opens a stored board from an older build", () => {
    useWorkspaceStore.setState({
      sprints: [],
      stories: [],
      kanbanBoards: [
        {
          id: "kanban:current",
          cards: [
            { ...card("a", "Old card"), column: "icebox" as never, class: undefined as never },
          ],
          wipLimits: undefined as never,
        },
      ],
    });
    renderBoard();
    expect(within(screen.getByRole("region", { name: "Backlog" })).getByText("Old card"));
  });

  it("holds the averages until there are enough done cards", () => {
    const done = (d: number, i: number) =>
      card(`d${i}`, `Done ${i}`, { column: "done", startedAt: ago(d + 1), completedAt: ago(1) });
    seed({ sprints: [], cards: [done(2, 1), done(4, 2)] });
    const { unmount } = renderBoard();
    expect(screen.getByText("finish 1 more")).toBeInTheDocument();
    expect(screen.getByText("finish 3 more")).toBeInTheDocument();
    unmount();

    seed({ sprints: [], cards: [1, 2, 3, 4, 10].map(done) });
    renderBoard();
    const tile = (label: string) => within(screen.getByText(label).closest(".rounded-xl")!);
    // 2, 3, 4, 5 and 11 days with both ends counted.
    expect(tile("Cycle avg").getByText("5d")).toBeInTheDocument();
    expect(tile("Cycle avg").getByText("±3.2 days")).toBeInTheDocument();
    expect(tile("85% within").getByText("11d")).toBeInTheDocument();
  });

  it("tints a card in work for longer than P85, counting from its start, not its column", () => {
    // The board reads its clock at mount: hold it, so the days are exact.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const done = (d: number, i: number) =>
      card(`d${i}`, `Done ${i}`, {
        column: "done",
        startedAt: ago(d + 1),
        completedAt: ago(1),
      });
    seed({
      sprints: [],
      cards: [
        // 2 to 6 days with both ends counted: P85 is 6 days.
        ...[1, 2, 3, 4, 5].map(done),
        // Just moved on to Review, started 9 days ago: 10 days in work.
        card("r", "Audit", { column: "review", startedAt: ago(9), columnSince: ago(1) }),
        card("p", "Search", { column: "in_progress", startedAt: ago(2), columnSince: ago(2) }),
        // Exactly P85 days in work isn't flagged; a day more is.
        card("e", "Exports", { column: "in_progress", startedAt: ago(5), columnSince: ago(5) }),
        card("b", "Billing", { column: "review", startedAt: ago(6), columnSince: ago(6) }),
      ],
    });
    renderBoard();
    expect(
      screen.getByText(
        "1 day in Review, in work for 10 days, longer than 85% of finished cards took"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("2 days in In progress")).toBeInTheDocument();
    expect(screen.getByText("5 days in In progress")).toBeInTheDocument();
    expect(
      screen.getByText(
        "6 days in Review, in work for 7 days, longer than 85% of finished cards took"
      )
    ).toBeInTheDocument();
  });

  it("doesn't show a done card as blocked", () => {
    seed({
      sprints: [],
      cards: [card("a", "Search", { column: "done", blocked: true })],
    });
    renderBoard();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByRole("button", { name: /Unblock/ })).toBeNull();
  });

  it("after a delete, focus goes to the next card in the column, else the one above, else the heading", () => {
    seed({
      sprints: [],
      cards: [
        card("a", "Search"),
        card("b", "Exports"),
        card("c", "Audit"),
        card("z", "Other", { column: "ready" }),
      ],
    });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Remove Search" }));
    expect(screen.getByRole("combobox", { name: "Move Exports" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Remove Audit" }));
    expect(screen.getByRole("combobox", { name: "Move Exports" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Remove Exports" }));
    expect(screen.getByRole("heading", { name: "Backlog" })).toHaveFocus();
    expect(flowBoard()!.cards.map((c) => c.id)).toEqual(["z"]);
  });

  it("the example shows cycle time and P85, and never offers its names for the team", () => {
    // The board's clock is read at mount and the example's dates when it
    // loads: hold the clock, so the card in Review is exactly 9 days in work
    // (started 8 days ago, the start day counted like a cycle time's).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    seed({ sprints: [], cards: [] });
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const tile = (label: string) => within(screen.getByText(label).closest(".rounded-xl")!);
    expect(tile("Cycle avg").getByText("5d")).toBeInTheDocument();
    expect(tile("85% within").getByText("7d")).toBeInTheDocument();
    expect(
      screen.getByText(/in Review, in work for 9 days, longer than 85% of finished cards took/)
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Assignee of Fix double charge when a payment retries: Amira",
      })
    );
    expect(screen.getByText(/“Amira” isn.t on the team\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add to the team/ })).toBeNull();
  });
});

/* ── Theme ──────────────────────────────────────────────────────────── */

describe("theme colours", () => {
  it("uses no hard-coded hex colours", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/kanban");
    for (const name of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, name), "utf8");
      expect(src, name).not.toMatch(/["'`[(]#[0-9a-f]{3,8}\b/i);
      expect(src, name).not.toMatch(/rgba?\(/i);
    }
  });
});
