import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KanbanCard, Sprint, Story } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { storyProgress } from "@/lib/sprints/progress";
import { percentile } from "@/lib/sprints/metrics";
import { isExampleSprintId } from "@/lib/sprints/example";

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
  columnEnteredAt,
  daysInColumn,
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

  it("dates the column stay from the history, walking back over moves inside the same column", () => {
    const s = story("a", "A", {
      status: "todo",
      statusHistory: [
        { status: "in_progress", from: "todo", at: ago(9) },
        { status: "backlog", from: "in_progress", at: ago(6) },
        { status: "todo", from: "backlog", at: ago(2) },
      ],
    });
    expect(columnEnteredAt(s)).toBe(ago(6));
    expect(daysInColumn(s, NOW)).toBe(6);
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

  it("nudges columns over their limit, sharing the Flow board's limits (Ready for To do), never Done", () => {
    const many = (n: number, status: Story["status"]) =>
      Array.from({ length: n }, (_, i) => story(`${status}${i}`, `S${i}`, { status }));
    const cols = storiesByColumn(
      [...many(6, "todo"), ...many(4, "in_progress"), ...many(2, "review"), ...many(9, "done")],
      "s7"
    );
    const breaches = sprintBreaches(cols, LIMITS);
    expect(breaches.map((b) => [b.column, b.count, b.limit])).toEqual([
      ["todo", 6, 5],
      ["in_progress", 4, 3],
    ]);
    expect(wipNudge(breaches[1])).toBe(
      "In progress has 4 stories, limit 3: finish something before starting more."
    );
    expect(wipNudge(breaches[0])).toBe(
      "To do has 6 stories, limit 5: plan less into the sprint, or raise the limit."
    );
    // A limit of 0 means no limit.
    expect(sprintBreaches(cols, { ...LIMITS, ready: 0, in_progress: 0 })).toEqual([]);
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
    expect(stats.average).toBeCloseTo(4);
    expect(stats.spread).toBeCloseTo(Math.sqrt(10));
    expect(stats.p85).toBeCloseTo(percentile([1, 2, 3, 4, 10], 85)!);
    expect(stats.p85).toBeCloseTo(10);
    const huge = cycleStats([finished(1e6, 0)]);
    expect(huge).toMatchObject({ count: 1, spread: 0 });
    expect(huge.p85).toBeCloseTo(1e6);
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
    const three = [2, 4, 6].map(done);
    expect(flowVerdict(three, LIMITS, stats(three))).toBe(
      "Cards take 4 days on average from start to done."
    );
    const five = [1, 2, 3, 4, 10].map(done);
    expect(flowVerdict(five, LIMITS, stats(five))).toBe(
      "Cards take 4 days on average from start to done, and 85% finished within 10 days."
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

  it("the example shows assignees, a blocked card and an age in column", () => {
    const cards = buildExample(NOW);
    expect(cards.some((c) => c.assignee)).toBe(true);
    expect(cards.filter((c) => c.blocked)).toHaveLength(1);
    expect(cards.find((c) => c.column === "review")!.columnSince).toBe(ago(2));
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
    expect(screen.getByText("needs 5 done cards")).toBeInTheDocument();
    unmount();

    seed({ sprints: [], cards: [1, 2, 3, 4, 10].map(done) });
    renderBoard();
    const tile = (label: string) => within(screen.getByText(label).closest(".rounded-xl")!);
    expect(tile("Cycle avg").getByText("4d")).toBeInTheDocument();
    expect(tile("Cycle avg").getByText("±3.2 days")).toBeInTheDocument();
    expect(tile("85% within").getByText("10d")).toBeInTheDocument();
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
