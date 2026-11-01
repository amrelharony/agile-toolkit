import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { KANBAN_BOARD_ID, type KanbanCard, type Story } from "@/lib/stores/workspace-types";
import { registry } from "@/lib/actions/registry";
import { addDays } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import "@/lib/actions/tools/cycle-time";

/**
 * Cycle Time, upgraded: finished stories and Flow-board cards read live
 * from their start and done times, typed items as the fallback with
 * draft-then-save; one day convention (a same-day item is 1 day); the
 * scatter by completion date; ageing work in progress flagged against the
 * P85; statistics from their sample floors with the heavy ones behind
 * Advanced analysis; Undo on delete and reset; the old blank rows
 * migrated away; an in-memory example; and the agent quoting the page's P85.
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
vi.mock("@/app/(tools)/cycle-time/charts", () => ({
  CycleTimeHistogramChart: () => null,
  CycleTimeScatterChart: () => null,
}));

import { CycleTimeClient } from "@/app/(tools)/cycle-time/cycle-time-client";
import {
  isBlankItem,
  migrateCycleTimeState,
  useCycleTimeStore,
} from "@/app/(tools)/cycle-time/use-cycle-time-store";
import {
  ageingRows,
  boardRows,
  cycleStats,
  histogram,
  rowsFrom,
  scatterPoints,
  sleDays,
  typedDays,
  typedRows,
  weeklyMeans,
  withinTarget,
} from "@/app/(tools)/cycle-time/helpers";
import { analyseCycleTimes } from "@/app/(tools)/cycle-time/analysis";
import { cycleTimeVerdict } from "@/app/(tools)/cycle-time/verdict";
import { cycleTimeToMarkdown } from "@/app/(tools)/cycle-time/markdown";
import { buildExample } from "@/app/(tools)/cycle-time/example";
import { editDateError, validateItem } from "@/app/(tools)/cycle-time/form";
import { scatterText } from "@/app/(tools)/cycle-time/chart-text";
import { blockedTitle } from "@/app/(tools)/cycle-time/components/ageing-table";
import type { CycleRow, CycleSource } from "@/app/(tools)/cycle-time/types";

const TODAY = todayIso();
const day = (n: number) => addDays(TODAY, -n) as string;
const at = (n: number) => new Date(`${day(n)}T12:00:00`).toISOString();
const ALL = new Set<CycleSource>(["story", "card", "typed"]);

const doneStory = (id: string, started: number, done: number): Story => ({
  id,
  title: id,
  status: "done",
  startedAt: at(started),
  doneAt: at(done),
  statusHistory: [
    { status: "in_progress", from: "todo", at: at(started) },
    { status: "done", from: "in_progress", at: at(done) },
  ],
});
const card = (id: string, extra: Partial<KanbanCard>): KanbanCard => ({
  id,
  title: id,
  column: "done",
  class: "standard",
  createdAt: at(40),
  ...extra,
});
const board = (cards: KanbanCard[]) => ({
  id: KANBAN_BOARD_ID,
  cards,
  wipLimits: { backlog: 0, ready: 0, in_progress: 0, review: 0, done: 0 },
});
const row = (
  id: string,
  days: number,
  doneOn: string,
  source: CycleSource = "typed"
): CycleRow => ({
  id,
  title: id,
  source,
  startedOn: addDays(doneOn, -(days - 1)) as string,
  doneOn,
  days,
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <CycleTimeClient />
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
  useWorkspaceStore.setState({ stories: [], sprints: [], kanbanBoards: [], impediments: [] });
  useCycleTimeStore.setState({ items: [], targetPct: 85, sleTargetDays: null });
});

/* ── One day convention, every source ───────────────────────────────── */

describe("cycle days", () => {
  it("counts a same-day item as 1 day, start and finish both counted", () => {
    expect(typedDays({ startDate: "2026-10-05", endDate: "2026-10-05" })).toBe(1);
    expect(typedDays({ startDate: "2026-10-05", endDate: "2026-10-09" })).toBe(5);
    expect(typedDays({ startDate: "2026-10-09", endDate: "2026-10-05" })).toBeNull();
    expect(typedDays({ startDate: "", endDate: "2026-10-05" })).toBeNull();
    expect(boardRows([doneStory("s", 2, 2)], []).map((r) => r.days)).toEqual([1]);
  });

  it("reads finished stories and only the cards still in Done", () => {
    const rows = boardRows(
      [doneStory("s1", 6, 3), { id: "wip", title: "wip", status: "in_progress", startedAt: at(3) }],
      [
        card("k1", { startedAt: at(8), completedAt: at(4) }),
        card("k2", { column: "review", startedAt: at(9), completedAt: at(5) }),
        // Dropped straight into Done: no start, so no cycle time (it is still throughput).
        card("k3", { completedAt: at(2) }),
      ]
    );
    expect(rows.map((r) => [r.id, r.source, r.days])).toEqual([
      ["k1", "card", 5],
      ["s1", "story", 4],
    ]);
  });

  it("orders every source by completion date", () => {
    const rows = rowsFrom(
      [
        row("late", 2, "2026-10-09"),
        row("early", 3, "2026-10-01", "card"),
        row("mid", 1, "2026-10-05", "story"),
      ],
      ALL
    );
    expect(rows.map((r) => r.id)).toEqual(["early", "mid", "late"]);
    expect(scatterPoints(rows).map((p) => p.doneOn)).toEqual([
      "2026-10-01",
      "2026-10-05",
      "2026-10-09",
    ]);
    expect(rowsFrom(rows, new Set<CycleSource>(["typed"])).map((r) => r.id)).toEqual(["late"]);
    expect(scatterText(scatterPoints(rows), { median: null, p85: null, p95: null }).summary).toBe(
      "Cycle times of 3 items finished from 2026-10-01 to 2026-10-09, in order of completion, range from 1 to 3 days."
    );
  });

  it("starts the histogram at 1 day", () => {
    const bars = histogram([
      row("a", 1, "2026-10-01"),
      row("b", 2, "2026-10-02"),
      row("c", 20, "2026-10-03"),
    ]);
    expect(bars[0]).toEqual({ bucket: "1 day", count: 1 });
    expect(bars.at(-1)).toEqual({ bucket: "15+ days", count: 1 });
  });
});

/* ── Statistics from their sample floors ────────────────────────────── */

describe("statistics", () => {
  it("quotes nothing without items, the average from 3 and the percentiles from 5", () => {
    const none = cycleStats([]);
    expect(none.summary.average).toBeNull();
    expect(none.averageQuoted).toBe(false);
    const threeRows = [
      row("a", 1, "2026-10-01"),
      row("b", 2, "2026-10-02"),
      row("c", 6, "2026-10-03"),
    ];
    const three = cycleStats(threeRows);
    expect(sleDays(threeRows, 85)).toBeNull();
    expect(three.averageQuoted).toBe(true);
    expect(three.distributionQuoted).toBe(false);
    expect(three.percentiles[85]).toBeNull();
    const five = cycleStats([1, 2, 3, 4, 10].map((d, i) => row(`r${i}`, d, `2026-10-0${i + 1}`)));
    expect(five.distributionQuoted).toBe(true);
    // Nearest rank, the shared percentile.
    expect(five.percentiles[85]).toBe(10);
    expect(five.percentiles[50]).toBe(3);
  });

  it("checks finished work against a target", () => {
    const rows = [1, 2, 3, 4, 10].map((d, i) => row(`r${i}`, d, `2026-10-0${i + 1}`));
    expect(withinTarget(rows, 3)).toEqual({ within: 3, total: 5, pct: 60 });
    expect(withinTarget([], 3).pct).toBeNull();
  });

  it("runs the heavy statistics only from their floors", () => {
    const few = analyseCycleTimes([1, 2, 3, 4].map((d, i) => row(`r${i}`, d, `2026-10-0${i + 1}`)));
    expect(few.p85Range).toBeNull();
    expect(few.shifts).toEqual([]);
    expect(few.trend).toBeNull();
    // A sustained jump part way, one item a week: CUSUM marks it at the finish day.
    const days = [...Array(10).fill(2), ...Array(14).fill(12)] as number[];
    const jump = days.map((d, i) => row(`r${i}`, d, addDays("2026-04-01", i * 7) as string));
    const a = analyseCycleTimes(jump);
    expect(a.p85Range).not.toBeNull();
    expect(a.shifts.length).toBeGreaterThan(0);
    expect(typeof a.shifts[0].x).toBe("number");
    expect(a.weeks).toBe(24);
    expect(a.trend?.trend).toBe("up");
    expect(weeklyMeans(jump)).toHaveLength(24);
  });
});

/* ── Ageing work in progress ────────────────────────────────────────── */

describe("ageing work in progress", () => {
  it("lists both boards' active items oldest first, flagged against the P85", () => {
    const stories: Story[] = [
      { id: "s", title: "s", status: "review", startedAt: at(9), blocked: true, owner: "Sam" },
      { id: "t", title: "t", status: "todo" },
    ];
    const cards = [
      card("k", { column: "in_progress", startedAt: at(2) }),
      card("d", { startedAt: at(5), completedAt: at(1) }),
    ];
    const flagged = ageingRows(stories, cards, TODAY, 5);
    expect(flagged.map((a) => [a.id, a.ageDays, a.overP85, a.blocked])).toEqual([
      ["s", 10, true, true],
      ["k", 3, false, false],
    ]);
    // No P85 to compare with yet: nothing is flagged.
    expect(ageingRows(stories, cards, TODAY, null).every((a) => a.overP85 === null)).toBe(true);
  });

  it("raises a blocked, ageing item as an impediment, and sees it after a reload", () => {
    useWorkspaceStore.setState({
      stories: [
        {
          id: "s",
          title: "Wallet payments",
          status: "in_progress",
          startedAt: at(6),
          blocked: true,
          owner: "Chloé",
        },
      ],
    });
    renderPage();
    const send = screen.getAllByRole("button", { name: /^Send to… Wallet payments is blocked/ })[0];
    fireEvent.pointerDown(send, { button: 0, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Impediment" }));
    const imps = useWorkspaceStore.getState().impediments ?? [];
    expect(imps).toHaveLength(1);
    expect(imps[0]).toMatchObject({
      title: "Wallet payments is blocked (in progress for 7 days)",
      sourceRef: { tool: "cycle-time", id: "s" },
      owner: "Chloé",
    });
    // The link is read back from the impediment, so it shows as sent.
    expect(screen.getAllByRole("button", { name: /\(sent\)$/ }).length).toBeGreaterThan(0);
  });

  it("words the impediment's stage and age as a phrase", () => {
    expect(blockedTitle({ title: "Login", stage: "review", ageDays: 1 })).toBe(
      "Login is blocked (in review for 1 day)"
    );
    expect(blockedTitle({ title: "Login", stage: "in_progress", ageDays: 12 })).toBe(
      "Login is blocked (in progress for 12 days)"
    );
  });
});

/* ── The verdict and the export ─────────────────────────────────────── */

describe("the verdict", () => {
  it("states the SLE and what's already past it", () => {
    const rows = [2, 3, 3, 4, 7].map((d, i) => row(`r${i}`, d, `2026-10-0${i + 1}`));
    const stats = cycleStats(rows);
    const ageing = ageingRows(
      [{ id: "w", title: "w", status: "in_progress", startedAt: at(9) }],
      [],
      TODAY,
      7
    );
    expect(cycleTimeVerdict(stats, ageing, { pct: 85, days: sleDays(rows, 85) })).toBe(
      "85% of items finish within 7 days (5 finished); 1 item in progress is already older than that."
    );
    expect(cycleTimeVerdict(cycleStats(rows.slice(0, 2)), [], { pct: 85, days: null })).toBe(
      "Finish 3 more items to set a service-level expectation (it needs 5)."
    );
    expect(cycleTimeVerdict(cycleStats([]), [], { pct: 85, days: null })).toBe(
      "No finished items yet."
    );
  });

  it("exports the summary, the SLE, the ageing items and the items by source", () => {
    const ex = buildExample(TODAY);
    const rows = rowsFrom(
      [...boardRows([], ex.cards, { includeExamples: true }), ...typedRows(ex.items)],
      ALL
    );
    const stats = cycleStats(rows);
    const ageing = ageingRows([], ex.cards, TODAY, stats.summary.p85, { includeExamples: true });
    const md = cycleTimeToMarkdown({
      today: TODAY,
      rows,
      sources: ALL,
      stats,
      ageing,
      sle: { pct: 85, days: sleDays(rows, 85) },
    });
    expect(md).toContain("From: Sprint board, Flow board, Typed.");
    expect(md).toContain(
      "**85% of items finish within 10 days (16 finished); 1 item in progress is already older than that.**"
    );
    expect(md).toContain("- 85th percentile: 10 days");
    expect(md).toContain(
      "| Wallet payments on Android (blocked) | In progress | Chloé | 13 days | Yes |"
    );
    expect(md).toContain("| Accessibility audit fixes | Typed |");
  });
});

/* ── Typed items ────────────────────────────────────────────────────── */

describe("typed items", () => {
  it("validates before saving: a name, both dates, the finish not before the start", () => {
    const blank = validateItem({ name: "", startDate: "", endDate: "" }, TODAY);
    expect(!blank.ok && Object.keys(blank.errors).sort()).toEqual(["endDate", "name", "startDate"]);
    const backwards = validateItem({ name: "x", startDate: day(2), endDate: day(4) }, TODAY);
    expect(!backwards.ok && backwards.errors.endDate).toBe("The finish can't be before the start.");
    const future = validateItem({ name: "x", startDate: day(1), endDate: day(-1) }, TODAY);
    expect(!future.ok && future.errors.endDate).toMatch(/hasn't happened/);
    expect(validateItem({ name: " Checkout ", startDate: day(4), endDate: day(4) }, TODAY)).toEqual(
      {
        ok: true,
        values: { name: "Checkout", startDate: day(4), endDate: day(4) },
      }
    );
  });

  it("drops the old blank rows, including the seeded one, and keeps typed work", () => {
    const old = {
      items: [
        { id: "default:item-1", name: "", startDate: "", endDate: "" },
        { id: "u1", name: "", startDate: "", endDate: "" },
        { id: "u2", name: "Half done", startDate: "2026-10-01", endDate: "" },
        { id: "u3", name: "", startDate: "2026-10-01", endDate: "2026-10-03" },
        "junk",
      ],
    };
    const once = migrateCycleTimeState(old);
    expect(once.items.map((i) => i.id)).toEqual(["u2", "u3"]);
    expect(once).toMatchObject({ targetPct: 85, sleTargetDays: null });
    expect(migrateCycleTimeState(once)).toEqual(once);
    expect(migrateCycleTimeState(undefined).items).toEqual([]);
    expect(isBlankItem({ name: " ", startDate: "", endDate: "" })).toBe(true);
  });

  it("adds an item only once it's valid, then deletes it with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(useCycleTimeStore.getState().items).toEqual([]);
    expect(screen.getByText("Name the item, e.g. a story title.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Item/), { target: { value: "Checkout redesign" } });
    fireEvent.change(screen.getByLabelText(/^Started/), { target: { value: day(3) } });
    fireEvent.change(screen.getByLabelText(/^Finished/), { target: { value: day(3) } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const items = useCycleTimeStore.getState().items;
    expect(items).toEqual([
      expect.objectContaining({ name: "Checkout redesign", startDate: day(3), endDate: day(3) }),
    ]);
    expect(screen.getAllByText("1d").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Checkout redesign" })[0]);
    expect(useCycleTimeStore.getState().items).toEqual([]);
    undoLast();
    expect(useCycleTimeStore.getState().items).toHaveLength(1);
    expect(logs.map((l) => l.action)).toEqual(["item_added", "item_removed"]);
  });

  it("refuses a finish edited to before the start", () => {
    useCycleTimeStore.setState({
      items: [{ id: "a", name: "A", startDate: day(4), endDate: day(2) }],
    });
    renderPage();
    const end = screen.getAllByLabelText("Finish of A")[0];
    fireEvent.change(end, { target: { value: day(6) } });
    fireEvent.blur(end);
    expect(useCycleTimeStore.getState().items[0].endDate).toBe(day(2));
    expect(screen.getAllByText("The finish can't be before the start.").length).toBeGreaterThan(0);
  });

  it("refuses a start edited to after the finish, on the start itself", () => {
    useCycleTimeStore.setState({
      items: [{ id: "a", name: "A", startDate: day(4), endDate: day(2) }],
    });
    renderPage();
    const start = screen.getAllByLabelText("Start of A")[0];
    fireEvent.change(start, { target: { value: day(1) } });
    fireEvent.blur(start);
    // Saved, it would have no cycle time and leave every statistic with a "—".
    expect(useCycleTimeStore.getState().items[0].startDate).toBe(day(4));
    expect(start).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getAllByText(`The start can't be after the finish (${day(2)}).`).length
    ).toBeGreaterThan(0);
    // The same day is fine (1 day).
    fireEvent.change(start, { target: { value: day(2) } });
    fireEvent.blur(start);
    expect(useCycleTimeStore.getState().items[0].startDate).toBe(day(2));
    expect(editDateError({ startDate: day(4), endDate: day(2) }, "endDate", day(5), TODAY)).toBe(
      "The finish can't be before the start."
    );
    expect(editDateError({ startDate: "", endDate: "" }, "startDate", day(3), TODAY)).toBeNull();
  });

  it("moves focus to the next typed item after a delete, then to the form", async () => {
    useCycleTimeStore.setState({
      items: [
        { id: "a", name: "A", startDate: day(6), endDate: day(4) },
        { id: "b", name: "B", startDate: day(3), endDate: day(2) },
      ],
    });
    renderPage();
    expect(screen.getAllByLabelText("Name of A").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete A" })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Delete B" })[0]).toHaveFocus()
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Delete B" })[0]);
    expect(useCycleTimeStore.getState().items).toEqual([]);
    await waitFor(() => expect(screen.getByLabelText(/^Item/)).toHaveFocus());
  });

  it("clears the typed items after a confirm, leaving the boards, with Undo", () => {
    useCycleTimeStore.setState({
      items: [{ id: "a", name: "A", startDate: day(4), endDate: day(2) }],
    });
    useWorkspaceStore.setState({ stories: [doneStory("s", 3, 1)] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear typed items" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear typed items" })
    );
    expect(useCycleTimeStore.getState().items).toEqual([]);
    expect(useWorkspaceStore.getState().stories).toHaveLength(1);
    expect(logs.map((l) => l.action)).toContain("cycle_time_reset");
    undoLast();
    expect(useCycleTimeStore.getState().items).toHaveLength(1);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("Cycle Time page", () => {
  it("starts empty, and shows the example in memory only", () => {
    renderPage();
    expect(screen.getByText(/No finished work yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(
      screen.getByText(/85% of items finish within 10 days \(16 finished\)/, { selector: "p" })
    ).toBeInTheDocument();
    expect(useCycleTimeStore.getState().items).toEqual([]);
    expect(useWorkspaceStore.getState().kanbanBoards).toEqual([]);
    const ex = buildExample(TODAY);
    expect([...ex.cards, ...ex.items].every((x) => isExampleId(x.id))).toBe(true);
    // No Type an item form: an item typed in would go with Clear example.
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No finished work yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
  });

  it("keeps the Include chips when the only source with data is switched off", () => {
    // Work in progress on the Flow board, nothing finished or typed.
    useWorkspaceStore.setState({
      kanbanBoards: [board([card("k", { column: "in_progress", startedAt: at(3) })])],
    });
    renderPage();
    const flow = screen.getByRole("button", { name: "Flow board cards, 0 finished" });
    fireEvent.click(flow);
    expect(flow).toHaveAttribute("aria-pressed", "false");
    // Not the first-run empty state: the chip is still there to switch back.
    expect(screen.queryByText(/No finished work yet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Flow board cards, 0 finished" }));
    expect(screen.getByText("Ageing work in progress")).toBeInTheDocument();
  });

  it("says in the scatter's text where the change points it draws are", () => {
    const rows = [2, 3, 9, 8].map((d, i) => row(`r${i}`, d, addDays("2026-09-01", i) as string));
    // As analyseCycleTimes words a shift, for the lines ScatterTab draws.
    const shifts = [
      {
        detail:
          "CUSUM detected a sustained increase in cycle time from the item finished on 2026-09-03.",
      },
    ];
    const text = scatterText(scatterPoints(rows), { median: null, p85: null, p95: null }, shifts);
    expect(text.summary).toContain(
      "Marked on the chart: CUSUM detected a sustained increase in cycle time from the item finished on 2026-09-03."
    );
    expect(
      scatterText(scatterPoints(rows), { median: null, p85: null, p95: null }).summary
    ).not.toContain("Marked on the chart");
  });

  it("shows — and what's missing below the sample floor, never 0", () => {
    useWorkspaceStore.setState({ stories: [doneStory("a", 3, 2), doneStory("b", 5, 2)] });
    renderPage();
    // Two items: the average waits for 3, the rest for 5.
    for (const label of ["Average", "Median (50th %ile)", "85th percentile", "Spread (std dev)"]) {
      const tile = screen.getByText(label).parentElement!;
      expect(tile, label).toHaveTextContent("—");
      expect(tile, label).not.toHaveTextContent(/\b0\b/);
    }
    expect(
      screen.getAllByText(/Finish 3 more finished items to see the spread/).length
    ).toBeGreaterThan(0);
  });

  it("filters by source and keeps the heavy statistics in Advanced analysis", () => {
    useWorkspaceStore.setState({
      stories: [doneStory("a", 3, 2), doneStory("b", 5, 2), doneStory("c", 6, 1)],
      kanbanBoards: [board([card("k", { startedAt: at(4), completedAt: at(1) })])],
    });
    renderPage();
    const flow = screen.getByRole("button", { name: /^Flow board cards/ });
    expect(flow).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(flow);
    expect(flow).toHaveAttribute("aria-pressed", "false");
    const advanced = screen.getByText(/Advanced analysis: confidence ranges/).closest("details")!;
    expect(advanced).not.toHaveAttribute("open");
    expect(
      within(advanced).getByText(/more finished items to see change points/)
    ).toBeInTheDocument();
  });

  it("quotes the same P85 as tool.cycle_time.list_state", async () => {
    const stories = [
      doneStory("a", 5, 4),
      doneStory("b", 6, 4),
      doneStory("c", 7, 5),
      doneStory("d", 8, 5),
    ];
    const cards = [card("k", { startedAt: at(12), completedAt: at(6) })];
    useWorkspaceStore.setState({ stories, kanbanBoards: [board(cards)] });
    renderPage();
    const agent = (await registry.get("tool.cycle_time.list_state")!.handler({}, ctx)) as {
      p85: number;
      count: number;
    };
    const page = cycleStats(rowsFrom(boardRows(stories, cards), ALL));
    expect(agent.count).toBe(page.summary.count);
    expect(agent.p85).toBe(page.summary.p85);
    const tile = screen.getByText("85th percentile").parentElement!;
    expect(tile).toHaveTextContent(String(agent.p85));
  });

  it("checks finished and ageing work against a typed target", () => {
    useWorkspaceStore.setState({
      stories: [
        doneStory("a", 2, 1),
        doneStory("b", 3, 1),
        doneStory("c", 4, 1),
        doneStory("d", 5, 1),
        doneStory("e", 9, 1),
        { id: "w", title: "w", status: "in_progress", startedAt: at(6) },
      ],
    });
    renderPage();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "SLE" }));
    fireEvent.click(screen.getByRole("tab", { name: "SLE" }));
    const target = screen.getByLabelText(/^Target \(days\)/);
    fireEvent.change(target, { target: { value: "0" } });
    fireEvent.blur(target);
    expect(
      screen.getByText("A target is a whole number of days, from 1 to 365.")
    ).toBeInTheDocument();
    fireEvent.change(target, { target: { value: "4" } });
    fireEvent.blur(target);
    expect(useCycleTimeStore.getState().sleTargetDays).toBe(4);
    expect(
      screen.getByText(
        /3 of 5 finished items \(60%\) made it within 4 days; 1 item in progress is already older than that\./
      )
    ).toBeInTheDocument();
  });
});
