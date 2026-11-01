import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  type KanbanCard,
  type Sprint,
  type Story,
  type StoryStatusChange,
} from "@/lib/stores/workspace-types";
import { registry } from "@/lib/actions/registry";
import { addDays } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { STORY_STATUS_HISTORY_CAP } from "@/lib/sprints/story-status";
import "@/lib/actions/tools/cumulative-flow";

/**
 * Cumulative Flow, upgraded: generated from the Sprint board's status
 * history or the Flow board's card history (live, through lib/flow), typed
 * snapshots as the fallback with draft-then-save, backdating and one
 * snapshot per date, throughput per elapsed day and a Little's Law lead
 * time from enough days, the control chart and trend test behind Advanced
 * analysis from their sample floors, resets with a confirm and Undo, a new
 * column before Done, an in-memory example, a verdict, a Markdown export,
 * and the agent reading the same numbers.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
// Recharts has nothing to measure in jsdom; the charts' text is tested directly.
vi.mock("@/app/(tools)/cumulative-flow/charts", () => ({
  CumulativeFlowAreaChart: () => null,
  WipControlLineChart: () => null,
}));

import { CFDClient } from "@/app/(tools)/cumulative-flow/cfd-client";
import { migrateCfdState, useCFDStore } from "@/app/(tools)/cumulative-flow/use-cfd-store";
import { DEFAULT_COLUMNS } from "@/app/(tools)/cumulative-flow/constants";
import {
  autoSource,
  boardWipLimit,
  cfdMetrics,
  flowView,
  sprintRange,
  sprintView,
  typedView,
  typedWorkflow,
} from "@/app/(tools)/cumulative-flow/view";
import { cfdVerdict } from "@/app/(tools)/cumulative-flow/verdict";
import { cfdToMarkdown } from "@/app/(tools)/cumulative-flow/markdown";
import { buildExample } from "@/app/(tools)/cumulative-flow/example";
import { analyseWip } from "@/app/(tools)/cumulative-flow/analysis";
import { emptySnapshot, validateSnapshot } from "@/app/(tools)/cumulative-flow/form";
import { stageColors } from "@/app/(tools)/cumulative-flow/stage-colors";

const TODAY = todayIso();
const day = (n: number) => addDays(TODAY, -n) as string;
const at = (n: number) => new Date(`${day(n)}T12:00:00`).toISOString();

const SPRINT: Sprint = {
  id: "s-1",
  name: "Sprint 7",
  startDate: day(5),
  endDate: day(-8),
  pointsPlanned: 20,
  status: "active",
};

/** A sprint story planned in at the start, with moves as [status, days ago]. */
function story(id: string, moves: [Story["status"], number][], extra: Partial<Story> = {}): Story {
  const history: StoryStatusChange[] = [{ status: "todo", from: "backlog", at: at(5) }];
  let prev: Story["status"] = "todo";
  for (const [status, n] of moves) {
    history.push({ status, from: prev, at: at(n) });
    prev = status;
  }
  const started = moves[0];
  const done = moves.find(([s]) => s === "done");
  return {
    id,
    title: id,
    status: prev,
    sprintId: SPRINT.id,
    statusHistory: history,
    ...(started ? { startedAt: at(started[1]) } : {}),
    ...(done ? { doneAt: at(done[1]) } : {}),
    ...extra,
  };
}

const entry = (id: string, date: string, c: [number, number, number, number]) => ({
  id,
  date,
  counts: { "col-1": c[0], "col-2": c[1], "col-3": c[2], "col-4": c[3] },
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <CFDClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const opts = toastSpy.mock.calls[toastSpy.mock.calls.length - 1][1];
  act(() => opts.action.onClick());
};

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  useWorkspaceStore.setState({ stories: [], sprints: [], kanbanBoards: [] });
  useCFDStore.setState({ columns: DEFAULT_COLUMNS, entries: [], wipLimit: null, source: null });
});

/* ── Generated from the boards ──────────────────────────────────────── */

describe("from the Sprint board's status history", () => {
  it("charts the sprint day by day from its start to today", () => {
    const v = sprintView(
      [
        story("a", [
          ["in_progress", 4],
          ["review", 2],
          ["done", 1],
        ]),
        story("b", [["in_progress", 3]]),
        story("c", []),
      ],
      SPRINT,
      TODAY
    );
    expect(v.days.map((d) => d.date)).toEqual([day(5), day(4), day(3), day(2), day(1), day(0)]);
    expect(v.days[0].counts).toEqual({ todo: 3, in_progress: 0, review: 0, done: 0 });
    expect(v.days[3].counts).toEqual({ todo: 1, in_progress: 1, review: 1, done: 0 });
    expect(v.days[5].counts).toEqual({ todo: 1, in_progress: 1, review: 0, done: 1 });
    expect(v.approximate).toBe(0);
  });

  it("puts a story on the chart when it was planned in, not before", () => {
    const late = story("late", []);
    // Planned in two days after the start (Sprint Planning's backlog → todo move).
    late.statusHistory = [{ status: "todo", from: "backlog", at: at(3) }];
    const v = sprintView([late], SPRINT, TODAY);
    expect(v.days[0].counts.todo).toBe(0);
    expect(v.days[2].counts.todo).toBe(1);
  });

  it("reads a story still marked backlog as To do, and places a story with no history from its stamps", () => {
    const planned: Story = { id: "p", title: "p", status: "backlog", sprintId: SPRINT.id };
    const stamped: Story = {
      id: "s",
      title: "s",
      status: "done",
      sprintId: SPRINT.id,
      startedAt: at(4),
      doneAt: at(2),
    };
    const v = sprintView([planned, stamped], SPRINT, TODAY);
    const last = v.days[v.days.length - 1].counts;
    expect(last.todo).toBe(1);
    expect(last.done).toBe(1);
    expect(v.days[2].counts.in_progress).toBe(1); // day(3): started, not done yet
    expect(v.approximate).toBe(1);
  });

  it("marks a story whose history hit the cap as approximate", () => {
    const changes: StoryStatusChange[] = [];
    for (let i = 0; i < STORY_STATUS_HISTORY_CAP; i++) {
      // The first kept entry has a `from`: the creation entry was dropped.
      changes.push({
        status: i % 2 ? "review" : "in_progress",
        from: i % 2 ? "in_progress" : "review",
        at: at(5),
      });
    }
    const capped = story("capped", [], {
      status: "in_progress",
      statusHistory: changes,
      startedAt: at(5),
    });
    const v = sprintView([capped], SPRINT, TODAY);
    expect(v.approximate).toBe(1);
  });

  it("charts nothing before the sprint starts, and stops at its end", () => {
    expect(sprintRange({ startDate: day(-2), endDate: day(-15) }, TODAY)).toBeNull();
    expect(sprintRange({ startDate: day(20), endDate: day(7) }, TODAY)).toEqual({
      from: day(20),
      to: day(7),
    });
    expect(sprintView([], SPRINT, TODAY).days).toEqual([]);
  });

  it("leaves example stories out of a real sprint", () => {
    const v = sprintView([story("example-x", [["in_progress", 2]])], SPRINT, TODAY);
    expect(v.itemCount).toBe(0);
  });
});

describe("from the Flow board", () => {
  const board = (cards: KanbanCard[]) => ({ cards });

  it("follows each card's recorded history through Ready and Review", () => {
    const card: KanbanCard = {
      id: "k",
      title: "k",
      column: "done",
      class: "standard",
      createdAt: at(6),
      startedAt: at(4),
      completedAt: at(1),
      history: [
        { column: "ready", from: "backlog", at: at(5) },
        { column: "in_progress", from: "ready", at: at(4) },
        { column: "review", from: "in_progress", at: at(2) },
        { column: "done", from: "review", at: at(1) },
      ],
    };
    const v = flowView(board([card]), TODAY, 30);
    // Clamped to the first card's arrival: no month of zeros.
    expect(v.days[0].date).toBe(day(6));
    const stageOn = (n: number) =>
      Object.entries(v.days.find((d) => d.date === day(n))!.counts).find(([, c]) => c === 1)?.[0];
    expect([6, 5, 4, 2, 1].map(stageOn)).toEqual([
      "backlog",
      "ready",
      "in_progress",
      "review",
      "done",
    ]);
    expect(v.approximate).toBe(0);
  });

  it("rebuilds a card with no history from its stamps, and says so", () => {
    const card: KanbanCard = {
      id: "k",
      title: "k",
      column: "in_progress",
      class: "standard",
      createdAt: at(5),
      startedAt: at(2),
    };
    const v = flowView(board([card]), TODAY, 14);
    expect(v.days[0].counts.backlog).toBe(1);
    expect(v.days[v.days.length - 1].counts.in_progress).toBe(1);
    expect(v.approximate).toBe(1);
  });

  it("limits the range to the days asked for", () => {
    const card: KanbanCard = {
      id: "k",
      title: "k",
      column: "backlog",
      class: "standard",
      createdAt: at(100),
    };
    expect(flowView(board([card]), TODAY, 14).days).toHaveLength(14);
    expect(flowView(board([]), TODAY, 14).days).toEqual([]);
  });

  it("sums the board's In progress and Review limits only when both are set", () => {
    expect(
      boardWipLimit({ wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 } })
    ).toBe(5);
    expect(
      boardWipLimit({ wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 0, done: 0 } })
    ).toBeNull();
    expect(boardWipLimit(undefined)).toBeNull();
  });
});

/* ── The numbers ────────────────────────────────────────────────────── */

describe("throughput and Little's Law", () => {
  it("divides by the elapsed days between uneven typed snapshots", () => {
    const v = typedView(DEFAULT_COLUMNS, [
      entry("a", "2026-10-01", [10, 3, 0, 0]),
      entry("b", "2026-10-02", [9, 3, 0, 1]),
      entry("c", "2026-10-30", [0, 3, 0, 29]),
    ]);
    const m = cfdMetrics(v);
    // 29 finished over 29 elapsed days, not 2 snapshots.
    expect(m.throughputPerDay).toBe(1);
    expect(m.littles?.avgWip).toBe(3);
    // 3 ÷ 1, plus the day end-of-day WIP misses (a same-day item is 1 day).
    expect(m.littles?.leadTimeDays).toBe(4);
  });

  it("reads Little's Law on the cycle-time day rule: same-day work is ≈ 1 day", async () => {
    // One story started and finished each day, nothing left in progress overnight.
    const stories = [4, 3, 2, 1, 0].map((n) =>
      story(`s${n}`, [
        ["in_progress", n],
        ["done", n],
      ])
    );
    const m = cfdMetrics(sprintView(stories, SPRINT, TODAY));
    expect(m.littles?.avgWip).toBe(0);
    expect(m.littles?.leadTimeDays).toBe(1);
    // The measured cycle time beside it agrees.
    expect(m.measured?.average).toBe(1);
    useWorkspaceStore.setState({ sprints: [SPRINT], stories });
    const agent = (await registry.get("tool.cumulative_flow.list_state")!.handler({}, ctx)) as {
      littlesLawDays: number | null;
      measuredCycleTime: { averageDays: number | null };
    };
    expect(agent.littlesLawDays).toBe(1);
    expect(agent.measuredCycleTime.averageDays).toBe(1);
  });

  it("quotes nothing below MIN_SAMPLE.average points, and no lead time without throughput", () => {
    const two = cfdMetrics(
      typedView(DEFAULT_COLUMNS, [
        entry("a", "2026-10-01", [1, 1, 0, 0]),
        entry("b", "2026-10-02", [1, 1, 0, 1]),
      ])
    );
    expect(two.enough).toBe(false);
    expect(two.throughputPerDay).toBeNull();
    expect(two.littles).toBeNull();
    const flat = cfdMetrics(
      typedView(DEFAULT_COLUMNS, [
        entry("a", "2026-10-01", [1, 2, 0, 3]),
        entry("b", "2026-10-02", [1, 2, 0, 3]),
        entry("c", "2026-10-03", [1, 2, 0, 3]),
      ])
    );
    expect(flat.throughputPerDay).toBe(0);
    expect(flat.littles).toBeNull();
  });

  it("flags a Done count that goes down", () => {
    const m = cfdMetrics(
      typedView(DEFAULT_COLUMNS, [
        entry("a", "2026-10-04", [1, 1, 0, 14]),
        entry("b", "2026-10-05", [1, 1, 0, 12]),
      ])
    );
    expect(m.doneDrops).toEqual([{ date: "2026-10-05", from: 14, to: 12 }]);
  });

  it("reads WIP as — without a middle column", () => {
    const two = [DEFAULT_COLUMNS[0], DEFAULT_COLUMNS[3]];
    const m = cfdMetrics(typedView(two, [entry("a", "2026-10-01", [1, 0, 0, 2])]));
    expect(m.latest?.wip).toBeNull();
    expect(m.wipSeries).toEqual([]);
  });

  it("measures the board's finished items as a cross-check", () => {
    const stories = [
      story("a", [
        ["in_progress", 5],
        ["done", 4],
      ]),
      story("b", [
        ["in_progress", 5],
        ["done", 3],
      ]),
      story("c", [
        ["in_progress", 4],
        ["done", 2],
      ]),
    ];
    const m = cfdMetrics(sprintView(stories, SPRINT, TODAY));
    expect(m.measured?.count).toBe(3);
    // 2, 3 and 3 days, start and finish both counted.
    expect(m.measured?.average).toBeCloseTo(8 / 3);
  });

  it("gates the control chart at MIN_SAMPLE.changePoint and the trend at MIN_SAMPLE.trend", () => {
    const series = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ date: day(n - i), value: 4 + (i % 2) }));
    expect(analyseWip(series(7)).limits).toBeNull();
    expect(analyseWip(series(5)).trend).toBeNull();
    expect(analyseWip(series(6)).trend).not.toBeNull();
    expect(analyseWip(series(8)).limits).not.toBeNull();
  });
});

describe("the verdict", () => {
  it("names a widening band first", () => {
    const { sprint, stories } = buildExample(TODAY);
    const v = sprintView(stories, sprint, TODAY, { includeExamples: true });
    expect(cfdVerdict(v, cfdMetrics(v))).toBe(
      "Review grew from 1 to 4 stories over 8 days while 4 were finished: finish reviews before starting more."
    );
  });

  it("calls a stall, steady flow, and too few days", () => {
    const stall = typedView(DEFAULT_COLUMNS, [
      entry("a", "2026-10-01", [5, 3, 0, 2]),
      entry("b", "2026-10-02", [5, 3, 0, 2]),
      entry("c", "2026-10-03", [5, 3, 0, 2]),
      entry("d", "2026-10-04", [5, 3, 0, 2]),
    ]);
    expect(cfdVerdict(stall, cfdMetrics(stall))).toBe(
      "Nothing was finished in the last 3 snapshots while 3 items are in progress: swarm on the oldest before starting more."
    );
    const steady = typedView(DEFAULT_COLUMNS, [
      entry("a", "2026-10-01", [5, 2, 0, 0]),
      entry("b", "2026-10-02", [5, 2, 0, 1]),
      entry("c", "2026-10-03", [5, 2, 0, 2]),
    ]);
    expect(cfdVerdict(steady, cfdMetrics(steady))).toBe(
      "About 1 items finished a day; at that pace an item takes ≈ 3 days from start to done (Little's Law)."
    );
    const short = typedView(DEFAULT_COLUMNS, [entry("a", "2026-10-01", [5, 2, 0, 0])]);
    expect(cfdVerdict(short, cfdMetrics(short))).toBe(
      "Only 1 snapshot so far: throughput and lead time show from 3 snapshots."
    );
    const none = sprintView([], SPRINT, TODAY);
    expect(cfdVerdict(none, cfdMetrics(none))).toBe("No stories on this sprint's board yet.");
  });
});

/* ── Typed snapshots ────────────────────────────────────────────────── */

describe("typed snapshots", () => {
  it("validates a snapshot: a date, not in the future, not taken, and every count typed", () => {
    const entries = [entry("a", "2026-10-01", [1, 1, 1, 1])];
    const blank = validateSnapshot(emptySnapshot(), DEFAULT_COLUMNS, entries, TODAY);
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(Object.keys(blank.errors)).toHaveLength(5);
    const taken = validateSnapshot(
      {
        date: "2026-10-01",
        counts: { "col-1": "1", "col-2": "0", "col-3": "0", "col-4": "2" },
        note: "",
      },
      DEFAULT_COLUMNS,
      entries,
      TODAY
    );
    expect(!taken.ok && taken.errors.date).toMatch(/already exists/);
    const future = validateSnapshot({ ...emptySnapshot(day(-1)) }, DEFAULT_COLUMNS, [], TODAY);
    expect(!future.ok && future.errors.date).toMatch(/hasn't happened/);
    const fraction = validateSnapshot(
      {
        date: day(3),
        counts: { "col-1": "1.5", "col-2": "0", "col-3": "0", "col-4": "2" },
        note: "",
      },
      DEFAULT_COLUMNS,
      [],
      TODAY
    );
    expect(!fraction.ok && fraction.errors["count:col-1"]).toMatch(/whole number/);
    // Backdated, zero is a count, and a note is kept.
    const ok = validateSnapshot(
      {
        date: day(3),
        counts: { "col-1": "4", "col-2": "0", "col-3": "1", "col-4": "2" },
        note: " standup ",
      },
      DEFAULT_COLUMNS,
      [],
      TODAY
    );
    expect(ok).toEqual({
      ok: true,
      values: {
        date: day(3),
        counts: { "col-1": 4, "col-2": 0, "col-3": 1, "col-4": 2 },
        description: "standup",
      },
    });
  });

  it("adds a snapshot from the form only once it's valid, backdated", () => {
    useCFDStore.setState({ source: "typed" });
    renderPage();
    const form = screen.getByRole("button", { name: "Add snapshot" }).closest("form")!;
    fireEvent.click(screen.getByRole("button", { name: "Add snapshot" }));
    expect(useCFDStore.getState().entries).toEqual([]);
    expect(within(form).getByText("Enter a count for Done.")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/^Date/), { target: { value: day(2) } });
    for (const [label, v] of [
      ["To Do", "5"],
      ["In Progress", "2"],
      ["In Review", "1"],
      ["Done", "3"],
    ]) {
      fireEvent.change(within(form).getByLabelText(new RegExp(`^${label}`)), {
        target: { value: v },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "Add snapshot" }));
    expect(useCFDStore.getState().entries).toEqual([
      expect.objectContaining({
        date: day(2),
        counts: { "col-1": 5, "col-2": 2, "col-3": 1, "col-4": 3 },
      }),
    ]);
    expect(logs.map((l) => l.action)).toContain("snapshot_logged");
  });

  it("refuses a second snapshot for one date, on add and on a date edit", () => {
    const s = useCFDStore.getState();
    expect(s.addEntry({ date: "2026-10-01", counts: { "col-1": 1 } })).toBe(true);
    expect(useCFDStore.getState().addEntry({ date: "2026-10-01", counts: {} })).toBe(false);
    useCFDStore.getState().addEntry({ date: "2026-10-02", counts: {} });
    const second = useCFDStore.getState().entries[1];
    expect(useCFDStore.getState().updateEntry(second.id, { date: "2026-10-01" })).toBe(false);
    expect(useCFDStore.getState().entries[1].date).toBe("2026-10-02");
  });

  it("never writes 0 for a cleared count, and refuses a taken date inline", () => {
    useCFDStore.setState({
      source: "typed",
      entries: [entry("a", "2026-10-01", [5, 2, 1, 3]), entry("b", "2026-10-02", [4, 2, 1, 4])],
    });
    renderPage();
    const count = screen.getAllByLabelText("Done on 2026-10-02")[0];
    fireEvent.change(count, { target: { value: "" } });
    fireEvent.blur(count);
    expect(useCFDStore.getState().entries[1].counts["col-4"]).toBe(4);
    expect(screen.getAllByText("Enter a count for Done.").length).toBeGreaterThan(0);
    const date = screen.getAllByLabelText("Date of the snapshot from 2026-10-02")[0];
    fireEvent.change(date, { target: { value: "2026-10-01" } });
    fireEvent.blur(date);
    expect(useCFDStore.getState().entries[1].date).toBe("2026-10-02");
    expect(screen.getAllByText(/A snapshot for this date already exists/).length).toBeGreaterThan(
      0
    );
  });

  it("deletes a snapshot with Undo", () => {
    useCFDStore.setState({ source: "typed", entries: [entry("a", "2026-10-01", [5, 2, 1, 3])] });
    renderPage();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete the snapshot from 2026-10-01" })[0]
    );
    expect(useCFDStore.getState().entries).toEqual([]);
    undoLast();
    expect(useCFDStore.getState().entries.map((e) => e.id)).toEqual(["a"]);
  });

  it("won't Undo a delete into a date that has had a snapshot since", () => {
    useCFDStore.setState({
      source: "typed",
      entries: [entry("a", "2026-10-01", [5, 2, 1, 3]), entry("b", "2026-10-02", [4, 2, 1, 4])],
    });
    renderPage();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete the snapshot from 2026-10-01" })[0]
    );
    const undo = toastSpy.mock.calls[toastSpy.mock.calls.length - 1][1];
    act(() => {
      useCFDStore.getState().addEntry({ date: "2026-10-01", counts: { "col-4": 9 } });
    });
    act(() => undo.action.onClick());
    const dates = useCFDStore.getState().entries.map((e) => e.date);
    expect(dates.filter((d) => d === "2026-10-01")).toHaveLength(1);
    expect(useCFDStore.getState().entries.find((e) => e.id === "a")).toBeUndefined();
    expect(toastSpy).toHaveBeenLastCalledWith(
      "Kept the snapshot typed for 2026-10-01 since: one date has one snapshot."
    );
    // Without a clash it goes back in its place, and a second restore is a no-op.
    const z = entry("z", "2026-10-09", [1, 1, 1, 1]);
    act(() => {
      expect(useCFDStore.getState().restoreEntry(z, 0)).toBe(true);
      expect(useCFDStore.getState().restoreEntry(z, 0)).toBe(true);
    });
    expect(useCFDStore.getState().entries.filter((e) => e.id === "z")).toHaveLength(1);
    expect(useCFDStore.getState().entries[0].id).toBe("z");
  });

  it("keeps a row in place while its date is edited, with a Re-sort chip", () => {
    useCFDStore.setState({
      source: "typed",
      entries: [entry("a", "2026-10-01", [5, 2, 1, 3]), entry("b", "2026-10-02", [4, 2, 1, 4])],
    });
    renderPage();
    const date = screen.getAllByLabelText("Date of the snapshot from 2026-10-01")[0];
    fireEvent.change(date, { target: { value: "2026-10-03" } });
    fireEvent.blur(date);
    expect(useCFDStore.getState().entries.find((e) => e.id === "a")?.date).toBe("2026-10-03");
    // Still the first row, so Tab goes on into its own counts.
    const firstRow = () =>
      screen.getAllByLabelText(/^Date of the snapshot from/)[0].getAttribute("aria-label");
    expect(firstRow()).toBe("Date of the snapshot from 2026-10-03");
    expect(screen.getByText(/Dates changed since the last sort/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(firstRow()).toBe("Date of the snapshot from 2026-10-02");
  });

  it("moves focus to the next snapshot after a delete, then to the form", async () => {
    useCFDStore.setState({
      source: "typed",
      entries: [entry("a", "2026-10-01", [5, 2, 1, 3]), entry("b", "2026-10-02", [4, 2, 1, 4])],
    });
    renderPage();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete the snapshot from 2026-10-01" })[0]
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Delete the snapshot from 2026-10-02" })[0]
      ).toHaveFocus()
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete the snapshot from 2026-10-02" })[0]
    );
    const form = screen.getByRole("button", { name: "Add snapshot" }).closest("form")!;
    await waitFor(() => expect(within(form).getByLabelText(/^Date/)).toHaveFocus());
  });

  it("asks for a middle column only when there's none to count WIP in", () => {
    useCFDStore.setState({ source: "typed" });
    const { unmount } = renderPage();
    const tile = () => screen.getByText("Work in progress").parentElement!;
    // The default columns have two in progress: nothing typed yet is all that's missing.
    expect(tile()).not.toHaveTextContent("add a middle column");
    unmount();
    useCFDStore.setState({
      source: "typed",
      columns: [DEFAULT_COLUMNS[0], DEFAULT_COLUMNS[3]],
      entries: [entry("a", "2026-10-01", [1, 0, 0, 2])],
    });
    renderPage();
    expect(tile()).toHaveTextContent("add a middle column");
  });

  it("clears the snapshots after a confirm, keeps the columns, and undoes", () => {
    const renamed = DEFAULT_COLUMNS.map((c, i) => (i === 0 ? { ...c, name: "Queue" } : c));
    useCFDStore.setState({
      source: "typed",
      columns: renamed,
      entries: [entry("a", "2026-10-01", [5, 2, 1, 3])],
      wipLimit: 4,
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear snapshots" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear snapshots" })
    );
    expect(useCFDStore.getState().entries).toEqual([]);
    expect(useCFDStore.getState().wipLimit).toBeNull();
    expect(useCFDStore.getState().columns[0].name).toBe("Queue");
    expect(logs.map((l) => l.action)).toContain("cfd_reset");
    undoLast();
    expect(useCFDStore.getState().entries).toHaveLength(1);
    expect(useCFDStore.getState().wipLimit).toBe(4);
  });

  it("adds a column before Done, and a removed column comes back with its counts", async () => {
    useCFDStore.setState({ source: "typed", entries: [entry("a", "2026-10-01", [5, 2, 1, 3])] });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^New column/), { target: { value: "Blocked" } });
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    const names = () => useCFDStore.getState().columns.map((c) => c.name);
    expect(names()).toEqual(["To Do", "In Progress", "In Review", "Blocked", "Done"]);
    // Done is still the done stage.
    expect(typedWorkflow(useCFDStore.getState().columns).stages.at(-1)).toMatchObject({
      label: "Done",
      kind: "done",
    });
    // A duplicate name is refused inline.
    fireEvent.change(screen.getByLabelText(/^New column/), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(screen.getByText("A column named “done” already exists.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove column In Review" }));
    expect(names()).not.toContain("In Review");
    expect(useCFDStore.getState().entries[0].counts["col-3"]).toBeUndefined();
    // Focus moves on to the next column's Remove, not to <body>.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove column Blocked" })).toHaveFocus()
    );
    undoLast();
    expect(names()).toEqual(["To Do", "In Progress", "In Review", "Blocked", "Done"]);
    expect(useCFDStore.getState().entries[0].counts["col-3"]).toBe(1);
  });

  it("loads data saved before this version, twice over without change", () => {
    const old = {
      columns: [
        { id: "col-1", name: "To Do", color: "#64748b" },
        { id: "col-2", name: "Doing", color: "#00f0ff" },
        { id: "col-4", name: "Done", color: "#00ff88" },
      ],
      entries: [
        { id: "e1", date: "2026-10-01", counts: { "col-1": 0, "col-2": 0, "col-4": 0 } },
        { id: "e2", date: "2026-10-02", counts: { "col-1": 3, "col-2": 2.5, "col-4": "x" } },
      ],
      wipLimit: 6,
    };
    const once = migrateCfdState(old);
    expect(once.columns).toHaveLength(3);
    expect(once.entries[0].counts).toEqual({ "col-1": 0, "col-2": 0, "col-4": 0 });
    expect(once.entries[1].counts).toEqual({ "col-1": 3, "col-2": 2.5 });
    expect(once.wipLimit).toBe(6);
    expect(once.source).toBeNull();
    expect(migrateCfdState(once)).toEqual(once);
    expect(migrateCfdState(null).columns).toEqual(DEFAULT_COLUMNS);
    expect(migrateCfdState({ columns: "nope", entries: 3 }).entries).toEqual([]);
  });

  it("colours stages from theme tokens, never a stored hex", () => {
    const colors = stageColors(
      typedWorkflow([...DEFAULT_COLUMNS.map((c) => ({ ...c, color: "#ff0000" }))]).stages
    );
    expect(colors.every((c) => c.startsWith("var("))).toBe(true);
    expect(colors[3]).toContain("--chart-3");
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("Cumulative Flow page", () => {
  it("starts empty, offers the example and typed snapshots", () => {
    renderPage();
    expect(screen.getByText(/Nothing to chart yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Type snapshots instead" }));
    expect(useCFDStore.getState().source).toBe("typed");
    expect(screen.getByRole("button", { name: "Add snapshot" })).toBeInTheDocument();
  });

  it("leaves the user's own board limits out of the example", () => {
    useWorkspaceStore.setState({
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          cards: [],
          wipLimits: { backlog: 0, ready: 5, in_progress: 1, review: 1, done: 0 },
        },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.queryByText(/from the board/)).not.toBeInTheDocument();
    const tile = screen.getByText("Work in progress").parentElement!;
    expect(tile).not.toHaveTextContent("allowed");
    expect(screen.queryByText(/over the limit/)).not.toBeInTheDocument();
  });

  it("shows the example in memory and clears it", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(
      screen.getByText(/Review grew from 1 to 4 stories/, { selector: "p" })
    ).toBeInTheDocument();
    expect(useWorkspaceStore.getState().stories).toEqual([]);
    expect(useWorkspaceStore.getState().sprints).toEqual([]);
    expect(buildExample(TODAY).stories.every((s) => isExampleId(s.id))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/Nothing to chart yet/)).toBeInTheDocument();
  });

  it("opens on the Sprint board when the sprint has stories, and logs a switch", () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      stories: [
        story("a", [
          ["in_progress", 4],
          ["done", 2],
        ]),
        story("b", [["in_progress", 3]]),
      ],
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          cards: [{ id: "k", title: "k", column: "backlog", class: "standard", createdAt: at(3) }],
          wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
        },
      ],
    });
    renderPage();
    expect(screen.getByRole("button", { name: "Sprint board" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByText(/WIP limit 5 \(In progress and Review together\), from the board/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Flow board" }));
    expect(useCFDStore.getState().source).toBe("flow");
    expect(logs).toContainEqual({ action: "source_switched", payload: { source: "flow" } });
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(autoSource({ sprint: false, flow: false, typed: true })).toBe("typed");
    expect(autoSource({ sprint: false, flow: false, typed: false })).toBeNull();
  });

  it("keeps the control chart and trend behind Advanced analysis until there are enough days", () => {
    useWorkspaceStore.setState({ sprints: [SPRINT], stories: [story("a", [["in_progress", 4]])] });
    renderPage();
    const advanced = screen
      .getByText(/Advanced analysis: WIP control chart and trend/)
      .closest("details")!;
    expect(advanced).not.toHaveAttribute("open");
    // 6 days of the sprint: the trend test runs from 6, the control chart from 8.
    expect(within(advanced).getByText(/2 more days to see WIP control limits/)).toBeInTheDocument();
    expect(within(advanced).getByText(/No clear trend in WIP|WIP is trending/)).toBeInTheDocument();
  });

  it("exports the source, the numbers and the days as Markdown", () => {
    const { sprint, stories } = buildExample(TODAY);
    const v = sprintView(stories, sprint, TODAY, { includeExamples: true });
    const md = cfdToMarkdown(v, cfdMetrics(v), {
      today: TODAY,
      sprintName: sprint.name,
      wipLimit: 5,
    });
    expect(md).toContain(`# Cumulative flow — ${TODAY}`);
    expect(md).toContain(
      `From the Sprint board's stories (Sprint 12), ${sprint.startDate} to ${TODAY}.`
    );
    expect(md).toContain("**Review grew from 1 to 4 stories");
    expect(md).toContain("- Work in progress: 6 (limit 5)");
    expect(md).toContain("- Throughput: 0.44 a day");
    expect(md).toContain("| Date | To do | In progress | Review | Done |");
    expect(md.split("\n").filter((l) => /^\| \d{4}-/.test(l))).toHaveLength(10);
  });

  it("reads the same numbers as tool.cumulative_flow.list_state", async () => {
    const stories = [
      story("a", [
        ["in_progress", 5],
        ["done", 3],
      ]),
      story("b", [
        ["in_progress", 4],
        ["review", 2],
        ["done", 1],
      ]),
      story("c", [["in_progress", 2]]),
      story("d", []),
    ];
    useWorkspaceStore.setState({ sprints: [SPRINT], stories });
    const page = cfdMetrics(sprintView(stories, SPRINT, TODAY));
    const agent = (await registry.get("tool.cumulative_flow.list_state")!.handler({}, ctx)) as {
      throughputPerDay: number | null;
      littlesLawDays: number | null;
      avgWip: number | null;
      days: { date: string; counts: Record<string, number> }[];
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;
    expect(agent.throughputPerDay).toBe(r2(page.throughputPerDay!));
    expect(agent.littlesLawDays).toBe(r2(page.littles!.leadTimeDays));
    expect(agent.avgWip).toBe(r2(page.littles!.avgWip));
    expect(agent.days).toEqual(
      sprintView(stories, SPRINT, TODAY).days.map((d) => ({
        date: d.date,
        counts: { ...d.counts },
      }))
    );
  });
});
