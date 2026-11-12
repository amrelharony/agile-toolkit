import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import { registry } from "@/lib/actions/registry";
import { DEFAULT_WAITING, addDays, stageBreakdown, stageSentence, storyItems } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import "@/lib/actions/tools/cycle-time";

/**
 * Cycle Time, Time in each status (N32): the finished stories' and cards'
 * time per status from their recorded moves, each status's median and P85,
 * a stacked bar per item, and the flow efficiency once the person marks
 * the statuses where work waits (kept in the tool's store; the example
 * marks its own). Items with no recorded moves and typed items are left
 * out and said so; the export carries the section; the agent's by_stage
 * reads the same numbers.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => undefined }),
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
vi.mock("@/app/(tools)/cycle-time/charts", () => ({
  CycleTimeHistogramChart: () => null,
  CycleTimeScatterChart: () => null,
}));

import { CycleTimeClient } from "@/app/(tools)/cycle-time/cycle-time-client";
import {
  migrateCycleTimeState,
  useCycleTimeStore,
} from "@/app/(tools)/cycle-time/use-cycle-time-store";
import { boardStages } from "@/app/(tools)/cycle-time/helpers";
import { buildExample } from "@/app/(tools)/cycle-time/example";
import { barLabel, efficiencySentence, stageMarkdown } from "@/app/(tools)/cycle-time/stage-text";
import { BARS_SHOWN } from "@/app/(tools)/cycle-time/components/stage-section";
import type { CycleSource } from "@/app/(tools)/cycle-time/types";

// The first render imports the whole page; on a loaded machine that alone can pass 5 s.
vi.setConfig({ testTimeout: 20_000 });

const TODAY = todayIso();
const day = (n: number) => addDays(TODAY, -n) as string;
const at = (n: number, hour = 12) =>
  new Date(`${day(n)}T${String(hour).padStart(2, "0")}:00:00`).toISOString();
const BOARDS = new Set<CycleSource>(["story", "card"]);
const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };

/** A story worked `progress` days, then in Review `review` days, done `done` days ago. */
function reviewed(id: string, progress: number, review: number, done: number): Story {
  const started = done + review + progress;
  return {
    id,
    title: `Story ${id}`,
    status: "done",
    startedAt: at(started),
    doneAt: at(done),
    statusHistory: [
      { status: "in_progress", from: "todo", at: at(started) },
      { status: "review", from: "in_progress", at: at(done + review) },
      { status: "done", from: "review", at: at(done) },
    ],
  };
}

/** A done story from before the history was kept: stamps only. */
const stamped = (id: string): Story => ({
  id,
  title: `Old ${id}`,
  status: "done",
  startedAt: at(9),
  doneAt: at(6),
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <CycleTimeClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const waitingGroup = () => screen.getByRole("group", { name: "Statuses where work waits" });
const exported = () => screen.getByTestId("export-markdown").textContent ?? "";

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ stories: [], sprints: [], kanbanBoards: [], impediments: [] });
  useCycleTimeStore.setState({
    items: [],
    targetPct: 85,
    sleTargetDays: null,
    waitingStages: [...DEFAULT_WAITING],
  });
});

describe("Time in each status, on the page", () => {
  it("shows each status's median and P85 from 5 finished stories, and its share", () => {
    const stories = [1, 2, 3, 4, 5].map((n) => reviewed(`s${n}`, n, 2, n));
    useWorkspaceStore.setState({ stories });
    renderPage();
    const table = screen.getByRole("table", {
      name: "Time in each status, over the finished items",
    });
    const expected = stageBreakdown(storyItems(stories));
    const review = within(table).getByRole("rowheader", { name: "Review" }).closest("tr")!;
    const stat = expected.stages.find((s) => s.stage === "review")!;
    expect(review).toHaveTextContent(`${Math.round(stat.share!)}%`);
    expect(within(review).getAllByRole("cell").length).toBe(4);
    expect(screen.getByText(stageSentence(expected)!, { selector: "p" })).toBeInTheDocument();
    // Five items: nothing left to wait for.
    expect(screen.queryByText(/to see each status's median/)).not.toBeInTheDocument();
  });

  it("waits for 5 items before the medians, and says how many more", () => {
    useWorkspaceStore.setState({ stories: [reviewed("a", 2, 1, 3), reviewed("b", 1, 1, 2)] });
    renderPage();
    expect(
      screen.getByText(
        "Finish 3 more finished items to see each status's median and 85th percentile."
      )
    ).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Time in each status, over the finished items",
    });
    expect(
      within(table).getByRole("rowheader", { name: "Review" }).closest("tr")
    ).toHaveTextContent("—");
  });

  it("can't tell the flow efficiency until a status is marked waiting, then keeps the marking", async () => {
    useWorkspaceStore.setState({ stories: [1, 2, 3].map((n) => reviewed(`s${n}`, 2, 2, n)) });
    renderPage();
    expect(
      screen.getByText(/All the time counted is in statuses marked as active/, { selector: "p" })
    ).toBeInTheDocument();
    const review = within(waitingGroup()).getByRole("button", { name: "Review" });
    expect(review).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(review);
    expect(review).toHaveAttribute("aria-pressed", "true");
    expect(useCycleTimeStore.getState().waitingStages).toEqual([
      "backlog",
      "todo",
      "ready",
      "review",
      "done",
    ]);
    expect(
      screen.getByText(/^Flow efficiency 50%: from start to done/, { selector: "p" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Review counts as waiting")
    );
    // Each item's own share of active time, beside its bar.
    expect(screen.getAllByText(/50% active/).length).toBe(3);
    fireEvent.click(review);
    expect(useCycleTimeStore.getState().waitingStages).toEqual([...DEFAULT_WAITING]);
  });

  it("asks for 3 finished items before a flow efficiency", () => {
    useWorkspaceStore.setState({ stories: [reviewed("a", 2, 1, 3)] });
    useCycleTimeStore.setState({ waitingStages: ["review"] });
    renderPage();
    expect(
      screen.getByText("Finish 2 more finished items to see a flow efficiency.")
    ).toBeInTheDocument();
  });

  it("draws a stacked bar per item, newest first, read out as text", () => {
    const stories = Array.from({ length: BARS_SHOWN + 2 }, (_, i) =>
      reviewed(`s${i}`, 1, 1, i + 1)
    );
    useWorkspaceStore.setState({ stories });
    renderPage();
    const list = screen.getByRole("list", { name: "Time in each status, by item" });
    const bars = within(list).getAllByRole("img");
    expect(bars).toHaveLength(BARS_SHOWN);
    const b = boardStages(stories, [], BOARDS, DEFAULT_WAITING);
    // s0 was done most recently.
    expect(bars[0]).toHaveAccessibleName(barLabel(b.items[b.items.length - 1]));
    expect(bars[0].getAttribute("aria-label")).toMatch(/^Story s0: .*In progress .*, Review /);
    fireEvent.click(screen.getByRole("button", { name: `Show all ${BARS_SHOWN + 2}` }));
    expect(within(list).getAllByRole("img")).toHaveLength(BARS_SHOWN + 2);
    expect(
      within(screen.getByRole("list", { name: "Statuses in the bars" })).getByText("Review")
    ).toBeInTheDocument();
  });

  it("leaves out finished items with no recorded moves, and typed items, and says so", () => {
    useWorkspaceStore.setState({ stories: [reviewed("a", 2, 1, 3), stamped("old")] });
    useCycleTimeStore.setState({
      items: [{ id: "t1", name: "Typed thing", startDate: day(5), endDate: day(4) }],
    });
    renderPage();
    expect(
      screen.getByText(
        /1 finished item has no recorded moves \(from before the boards kept each one\)/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Typed items have no statuses, so the typed one is left out here.")
    ).toBeInTheDocument();
  });

  it("says nothing is recorded yet when only stamped items are finished", () => {
    useWorkspaceStore.setState({ stories: [stamped("old")] });
    renderPage();
    expect(
      screen.getByText(/No finished story or card has its moves recorded yet/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Statuses where work waits" })).toBeNull();
  });

  it("isn't shown for typed items alone", () => {
    useCycleTimeStore.setState({
      items: [{ id: "t1", name: "Typed thing", startDate: day(5), endDate: day(4) }],
    });
    renderPage();
    expect(screen.queryByRole("heading", { name: "Time in each status" })).toBeNull();
  });

  it("follows the Include chips", () => {
    useWorkspaceStore.setState({ stories: [reviewed("a", 2, 1, 3)] });
    renderPage();
    expect(screen.getByRole("heading", { name: "Time in each status" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Sprint board stories/ }));
    expect(screen.queryByRole("heading", { name: "Time in each status" })).toBeNull();
  });

  it("exports the section with the table and each item", () => {
    useWorkspaceStore.setState({ stories: [1, 2, 3].map((n) => reviewed(`s${n}`, 2, 2, n)) });
    useCycleTimeStore.setState({ waitingStages: ["review"] });
    renderPage();
    const md = exported();
    expect(md).toContain("## Time in each status");
    expect(md).toContain("| Status | Items | Median | P85 | Share of the time |");
    expect(md).toMatch(/\| Review \(waiting\) \| 3 \| — \| — \| 50% \|/);
    expect(md).toContain("Flow efficiency 50%");
    expect(md).toMatch(/\| Story s1 \| .* \| 50% \| In progress .*, Review .* \|/);
  });
});

describe("Time in each status, in the example", () => {
  it("reads the example's recorded moves, with Review marked waiting in the example only", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const ex = buildExample(TODAY);
    const b = boardStages([], ex.cards, BOARDS, ex.waiting, { includeExamples: true });
    expect(b.items).toHaveLength(14);
    expect(b.approximate).toBe(0);
    expect(screen.getByText(efficiencySentence(b)!, { selector: "p" })).toBeInTheDocument();
    const review = within(waitingGroup()).getByRole("button", { name: "Review" });
    expect(review).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(review);
    expect(review).toHaveAttribute("aria-pressed", "false");
    // The example's copy changed; the person's own marking didn't.
    expect(useCycleTimeStore.getState().waitingStages).toEqual([...DEFAULT_WAITING]);
    expect(
      screen.getByText(/All the time counted is in statuses marked as active/, { selector: "p" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByRole("heading", { name: "Time in each status" })).toBeNull();
  });

  it("keeps the example's cycle times as they were", () => {
    const ex = buildExample(TODAY);
    const b = boardStages([], ex.cards, BOARDS, ex.waiting, { includeExamples: true });
    const saved = b.items.find((i) => i.title === "Saved addresses")!;
    expect(saved.cycleDays).toBe(11);
    expect(saved.stages.map((s) => s.stage)).toEqual(["in_progress", "review"]);
    // Every in-progress card still ages from its start.
    expect(ex.cards.filter((c) => c.column !== "done").every((c) => c.history?.length)).toBe(true);
  });
});

describe("Time in each status, kept and shared", () => {
  it("keeps the waiting statuses, defaulting them when none were stored", () => {
    expect(migrateCycleTimeState({}).waitingStages).toEqual([...DEFAULT_WAITING]);
    expect(
      migrateCycleTimeState({ waitingStages: ["review", "lunch", "review"] }).waitingStages
    ).toEqual(["review"]);
    // An empty list is a choice: nothing waits.
    expect(migrateCycleTimeState({ waitingStages: [] }).waitingStages).toEqual([]);
    const once = migrateCycleTimeState({ waitingStages: ["todo", "review"] });
    expect(migrateCycleTimeState(once)).toEqual(once);
    useCycleTimeStore.getState().setWaitingStages(["review", "nope"]);
    expect(useCycleTimeStore.getState().waitingStages).toEqual(["review"]);
  });

  it("gives the agent the page's numbers", async () => {
    const stories = [1, 2, 3, 4, 5].map((n) => reviewed(`s${n}`, n, 2, n));
    useWorkspaceStore.setState({ stories });
    const page = boardStages(stories, [], BOARDS, ["review"]);
    const agent = (await registry
      .get("tool.cycle_time.by_stage")!
      .handler({ waiting: ["review"] }, ctx)) as {
      count: number;
      stages: { stage: string; median: number | null }[];
      flowEfficiency: { pct: number | null };
    };
    expect(agent.count).toBe(page.items.length);
    expect(agent.flowEfficiency.pct).toBe(page.efficiency.pct);
    const median = page.stages.find((s) => s.stage === "review")!.median!;
    expect(agent.stages.find((s) => s.stage === "review")!.median).toBeCloseTo(median, 2);
  });

  it("writes nothing for a board with no recorded moves", () => {
    expect(stageMarkdown(stageBreakdown([]))).toEqual([]);
  });
});
