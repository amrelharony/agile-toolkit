import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { KANBAN_BOARD_ID, type Story, type ValueStreamStage } from "@/lib/stores/workspace-types";
import { registry } from "@/lib/actions/registry";
import { addDays } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";
import {
  appendStage,
  bottleneck,
  changedStages,
  compareStates,
  comparisonVerdict,
  copyToFuture,
  moveStage,
  orderedStages,
  stageState,
  vsmSummary,
  vsmVerdict,
} from "@/lib/value-stream/summary";
import "@/lib/actions/tools/value-stream";

/**
 * Value Stream, upgraded: stages in a stored order that survives a fresh
 * device, Move earlier / later, the bottleneck marked and leading the
 * verdict, a future state drafted from the current one and compared with
 * it, draft-then-save with no default times, edits in place that never
 * write 0 for a cleared field, Delete and Clear with Undo, the board
 * activity chip with its corrected label, an example that stays in
 * memory, and the agent reading the page's numbers.
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
// Recharts has nothing to measure in jsdom; the chart's text is tested directly.
vi.mock("@/app/(tools)/value-stream/charts", () => ({ StageTimesChart: () => null }));

import { ValueStreamClient } from "@/app/(tools)/value-stream/value-stream-client";
import { buildExample } from "@/app/(tools)/value-stream/example";
import { valueStreamToMarkdown } from "@/app/(tools)/value-stream/markdown";
import { comparisonRows, stageChartText } from "@/app/(tools)/value-stream/chart-text";
import { EMPTY_STAGE, editError, validateStage } from "@/app/(tools)/value-stream/form";

const TODAY = todayIso();

const stage = (
  id: string,
  processTime: number,
  leadTime: number,
  extra: Partial<ValueStreamStage> = {}
): ValueStreamStage => ({ id, name: id, processTime, leadTime, completeAccurate: 100, ...extra });

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().valueStreamStages ?? [];

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <ValueStreamClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** The Undo of the latest toast. */
const undoLast = () => {
  const opts = toastSpy.mock.calls[toastSpy.mock.calls.length - 1][1];
  act(() => opts.action.onClick());
};

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  useWorkspaceStore.setState({
    valueStreamStages: [],
    stories: [],
    kanbanBoards: [],
    retroBoards: [],
  });
});

/* ── lib/value-stream/summary ───────────────────────────────────────── */

describe("lib/value-stream/summary", () => {
  it("orders a map by `order`, then the unnumbered stages in their stored order", () => {
    const list = [
      stage("legacy-b", 1, 2),
      stage("n1", 1, 2, { order: 1 }),
      stage("legacy-a", 1, 2),
      stage("n0", 1, 2, { order: 0 }),
      stage("f0", 1, 2, { order: 0, state: "future" }),
    ];
    expect(orderedStages(list).map((s) => s.id)).toEqual(["n0", "n1", "legacy-b", "legacy-a"]);
    expect(orderedStages(list, "future").map((s) => s.id)).toEqual(["f0"]);
    // Absent or unknown state reads as current.
    expect(stageState({})).toBe("current");
    expect(stageState({ state: "nonsense" as never })).toBe("current");
    // A list that isn't one reads as empty.
    expect(orderedStages(null)).toEqual([]);
    expect(orderedStages("x" as never)).toEqual([]);
  });

  it("clamps the numbers and caps flow efficiency at 100", () => {
    expect(vsmSummary([])).toEqual({
      stageCount: 0,
      totalProcess: 0,
      totalLead: 0,
      totalWait: 0,
      flowEfficiency: null,
      rolledCA: null,
    });
    const s = vsmSummary([
      stage("a", 9, 3, { completeAccurate: 150 }),
      stage("b", -1, 1, { completeAccurate: 50 }),
    ]);
    expect(s.totalProcess).toBe(9);
    expect(s.totalLead).toBe(4);
    expect(s.totalWait).toBe(1);
    expect(s.flowEfficiency).toBe(100);
    expect(s.rolledCA).toBe(50);
    // Huge values stay finite.
    expect(vsmSummary([stage("h", 1e9, 2e9)]).flowEfficiency).toBe(50);
    // No lead time at all: no flow efficiency, not 0%.
    expect(vsmSummary([stage("z", 0, 0)]).flowEfficiency).toBeNull();
  });

  it("picks the longest wait as the bottleneck, ties to the longer lead time", () => {
    expect(bottleneck([stage("only", 1, 9)])).toBeNull();
    expect(bottleneck([stage("a", 1, 1), stage("b", 2, 2)])).toBeNull(); // nothing waits
    const tie = bottleneck([stage("a", 1, 4), stage("b", 5, 8), stage("c", 0, 2)]);
    expect(tie?.stage.id).toBe("b"); // a and b both wait 3; b's lead is longer
    expect(tie?.waitDays).toBe(3);
    expect(tie?.sharePct).toBeCloseTo((3 / 14) * 100);
    // A full tie goes to the earlier stage.
    expect(bottleneck([stage("x", 1, 3), stage("y", 1, 3)])?.stage.id).toBe("x");
  });

  it("moves a stage within its map and numbers the whole map", () => {
    const list = [
      stage("a", 1, 2),
      stage("b", 1, 2),
      stage("c", 1, 2),
      stage("f", 1, 2, { state: "future" }),
    ];
    const moved = moveStage(list, "c", 0);
    expect(orderedStages(moved).map((s) => [s.id, s.order])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
    // The future map is another map: untouched.
    expect(moved.find((s) => s.id === "f")).toBe(list[3]);
    // A reload on a fresh device gets the rows sorted by id: the order holds.
    const byId = [...moved].sort((x, y) => x.id.localeCompare(y.id));
    expect(orderedStages(byId).map((s) => s.id)).toEqual(["c", "a", "b"]);
    // Clamped; a no-op on a numbered map changes nothing; an unknown id is ignored.
    expect(orderedStages(moveStage(moved, "a", 99)).map((s) => s.id)).toEqual(["c", "b", "a"]);
    expect(moveStage(moved, "c", 0)).toBe(moved);
    expect(moveStage(moved, "nope", 1)).toBe(moved);
    expect(
      changedStages(list, moved)
        .map((s) => s.id)
        .sort()
    ).toEqual(["a", "b", "c"]);
  });

  it("appends after stages saved before reordering, and copies the future map once", () => {
    const legacy = [stage("a", 1, 2), stage("b", 1, 2)];
    const added = appendStage(legacy, stage("new", 1, 2));
    expect(orderedStages(added).map((s) => [s.id, s.order])).toEqual([
      ["a", 0],
      ["b", 1],
      ["new", 2],
    ]);
    let n = 0;
    const copies = copyToFuture(added, () => `copy-${n++}`);
    expect(copies.map((s) => [s.id, s.name, s.state, s.order])).toEqual([
      ["copy-0", "a", "future", 0],
      ["copy-1", "b", "future", 1],
      ["copy-2", "new", "future", 2],
    ]);
    // Run twice: the second copy finds the future map and adds nothing.
    expect(copyToFuture([...added, ...copies], () => "again")).toEqual([]);
  });

  it("compares the maps in one sentence", () => {
    const current = [stage("a", 2, 10), stage("b", 3, 10)];
    const future = [stage("a", 2, 6), stage("b", 3, 6)];
    const c = compareStates(current, future)!;
    expect(c.leadDelta).toBe(-8);
    expect(c.flowEfficiencyDelta).toBeCloseTo(41.67 - 25, 1);
    expect(comparisonVerdict(c)).toBe(
      "The future state cuts lead time from 20 to 12 days and lifts flow efficiency from 25% to 42%."
    );
    expect(compareStates(current, [])).toBeNull();
    expect(comparisonVerdict(null)).toBeNull();
    expect(comparisonRows(c).map((r) => [r.measure, r.change, r.better])).toEqual([
      ["Lead time", "-8 d", true],
      ["Process time", "No change", null],
      ["Wait time", "-8 d", true],
      ["Flow efficiency", "+17 pts", true],
      ["Rolled %C/A", "No change", null],
    ]);
  });

  it("leads the verdict with the bottleneck", () => {
    expect(vsmVerdict([])).toBe("No stages mapped yet.");
    expect(vsmVerdict([stage("Dev", 3, 5)])).toBe(
      "Waiting is 40% of the 5-day lead time; map the next stage to see where work waits."
    );
    expect(vsmVerdict([stage("Analysis", 1, 3), stage("Code review", 1, 7)])).toBe(
      "Waiting is 80% of the 10-day lead time; Code review waits longest (6 days)."
    );
    expect(vsmVerdict([stage("a", 2, 2), stage("b", 1, 1)])).toBe(
      "Nothing waits in the 3-day lead time."
    );
  });
});

/* ── The form ───────────────────────────────────────────────────────── */

describe("add-stage validation", () => {
  it("has no defaults: every field is typed", () => {
    const r = validateStage(EMPTY_STAGE);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.errors).sort()).toEqual([
        "completeAccurate",
        "leadTime",
        "name",
        "processTime",
      ]);
  });

  it("rejects a process time longer than the lead time and impossible %C/A", () => {
    const r = validateStage({
      name: "Test",
      description: "",
      processTime: "5",
      leadTime: "3",
      completeAccurate: "101",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.processTime).toMatch(/can't be longer than the lead time/);
      expect(r.errors.completeAccurate).toMatch(/0 to 100/);
    }
    const zero = validateStage({
      name: "T",
      description: "",
      processTime: "0",
      leadTime: "0",
      completeAccurate: "90",
    });
    expect(zero.ok).toBe(false);
  });

  it("edits in place: a cleared or impossible number isn't saved", () => {
    const s = stage("Review", 1, 5);
    expect(editError(s, "leadTime", "")).toMatch(/Enter the lead time/);
    expect(editError(s, "processTime", "6")).toMatch(/can't be longer/);
    expect(editError(s, "leadTime", "0.5")).toMatch(/can't be shorter than the process time/);
    expect(editError(s, "completeAccurate", "-1")).toMatch(/0 to 100/);
    expect(editError(s, "processTime", "2")).toBeNull();
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

const fill = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Value Stream page", () => {
  it("starts empty with an example that never reaches the workspace", () => {
    renderPage();
    expect(screen.getByText(/No stages yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.", { exact: false })).toBeInTheDocument();
    expect(
      screen.getByText(/Code review waits longest \(6 days\)/, { selector: "p" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The future state cuts lead time from 20 to 12 days and lifts flow efficiency from 25% to 42%."
      )
    ).toBeInTheDocument();
    expect(stored()).toEqual([]);
    // Edits stay in the example too.
    fireEvent.click(screen.getByRole("button", { name: "Move Development later" }));
    expect(stored()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No stages yet/)).toBeInTheDocument();
    expect(logs).toEqual([]);
    expect(buildExample().every((s) => isExampleId(s.id))).toBe(true);
  });

  it("adds a stage only once every number is typed", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add stage" }));
    expect(stored()).toEqual([]);
    expect(screen.getByText("Name the stage, e.g. Code review.")).toBeInTheDocument();
    fill(/Stage name/, "Analysis");
    fill(/Process time \(days\)/, "1");
    fill(/Lead time \(days\)/, "3");
    fill(/%C\/A/, "90");
    fireEvent.click(screen.getByRole("button", { name: "Add stage" }));
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      name: "Analysis",
      processTime: 1,
      leadTime: 3,
      completeAccurate: 90,
      order: 0,
      state: "current",
    });
    expect(stored()[0].id).toMatch(/^vsstage_/);
    expect(logs.map((l) => l.action)).toContain("stage_added");
  });

  it("marks the bottleneck and has no IQR outlier callout on a short map", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [
        stage("Analysis", 1, 3, { order: 0 }),
        stage("Dev", 3, 5, { order: 1 }),
        stage("Review", 1, 30, { order: 2 }),
        stage("Test", 1, 2, { order: 3 }),
      ],
    });
    renderPage();
    expect(screen.getByText(/Bottleneck: waits 29 d/)).toBeInTheDocument();
    expect(screen.queryByText(/outlier/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Review waits longest \(29 days\)/, { selector: "p" })
    ).toBeInTheDocument();
  });

  it("moves a stage, writes its order and announces it", async () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", 1, 2), stage("b", 1, 2), stage("c", 1, 2)],
    });
    renderPage();
    expect(screen.getByRole("button", { name: "Move a earlier" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move c earlier" }));
    expect(orderedStages(stored()).map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(stored().every((s) => typeof s.order === "number")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Moved c to position 2 of 3")
    );
    expect(logs.find((l) => l.action === "stage_moved")?.payload).toMatchObject({ from: 2, to: 1 });
  });

  it("deletes with Undo, back in its place", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", 1, 2, { order: 0 }), stage("b", 1, 2, { order: 1 })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete stage a" }));
    expect(stored().map((s) => s.id)).toEqual(["b"]);
    expect(toastSpy.mock.calls[0][0]).toBe("Deleted “a”");
    undoLast();
    expect(orderedStages(stored()).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("clears one map after a confirm, with Undo", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [
        stage("a", 1, 2, { order: 0 }),
        stage("f", 1, 2, { order: 0, state: "future" }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear the current state" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear stages" }));
    expect(stored().map((s) => s.id)).toEqual(["f"]);
    expect(logs.map((l) => l.action)).toContain("value_stream_reset");
    undoLast();
    expect(
      stored()
        .map((s) => s.id)
        .sort()
    ).toEqual(["a", "f"]);
  });

  it("never writes 0 for a cleared number", () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage("a", 1, 4, { order: 0 })] });
    renderPage();
    const lead = screen.getByLabelText("Lead time (days)");
    fireEvent.change(lead, { target: { value: "" } });
    fireEvent.blur(lead);
    expect(stored()[0].leadTime).toBe(4);
    expect(screen.getByText("Enter the lead time, in days.")).toBeInTheDocument();
    fireEvent.change(lead, { target: { value: "6" } });
    fireEvent.blur(lead);
    expect(stored()[0].leadTime).toBe(6);
    expect(logs.find((l) => l.action === "stage_updated")?.payload).toMatchObject({
      field: "leadTime",
    });
  });

  it("starts the future state from the current one and compares them", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", 2, 10, { order: 0 }), stage("b", 3, 10, { order: 1 })],
    });
    renderPage();
    const futureMap = screen.getByRole("button", { name: /^Future state/ });
    fireEvent.click(futureMap);
    expect(futureMap).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Start the future state from the current one" })
    );
    const future = orderedStages(stored(), "future");
    expect(future.map((s) => s.name)).toEqual(["a", "b"]);
    expect(logs.map((l) => l.action)).toContain("future_state_started");
    // The copy compares equal until it's edited.
    expect(screen.getAllByText("No change").length).toBeGreaterThan(0);
    undoLast();
    expect(orderedStages(stored(), "future")).toEqual([]);
  });

  it("counts distinct items moved on the boards this week, under the right label", () => {
    const at = (n: number) => new Date(`${addDays(TODAY, -n)}T12:00:00`).toISOString();
    const story: Story = {
      id: "s1",
      title: "s1",
      status: "review",
      startedAt: at(3),
      statusHistory: [
        { status: "in_progress", from: "todo", at: at(3) },
        { status: "review", from: "in_progress", at: at(1) },
      ],
    };
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", 1, 2, { order: 0 })],
      stories: [story],
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          wipLimits: { backlog: 0, ready: 0, in_progress: 0, review: 0, done: 0 },
          cards: [
            {
              id: "k1",
              title: "k1",
              column: "done",
              class: "standard",
              createdAt: at(20),
              startedAt: at(15),
              completedAt: at(12),
            },
            {
              id: "k2",
              title: "k2",
              column: "in_progress",
              class: "standard",
              createdAt: at(4),
              startedAt: at(2),
            },
          ],
        },
      ],
    });
    renderPage();
    // s1 moved twice and k2 once this week; k1 last moved 12 days ago.
    expect(
      screen.getByRole("link", {
        name: /2 items moved on the boards in the last 7 days: check the stage times still match/,
      })
    ).toHaveAttribute("href", "/kanban");
    expect(screen.queryByText(/stories changed status/)).not.toBeInTheDocument();
  });

  it("exports the maps, the bottleneck and the comparison as Markdown", () => {
    const md = valueStreamToMarkdown(buildExample(), "2026-10-24");
    expect(md).toContain("# Value stream map — 2026-10-24");
    expect(md).toContain(
      "**Waiting is 75% of the 20-day lead time; Code review waits longest (6 days).**"
    );
    expect(md).toContain("| 3 | Code review (bottleneck) | 1 | 6 | 7 | 80% |");
    expect(md).toContain("## Future state");
    expect(md).toContain("| Lead time | 20 d | 12 d | -8 d |");
    expect(valueStreamToMarkdown([], "2026-10-24")).toBe(
      "# Value stream map — 2026-10-24\n\nNo stages mapped yet.\n"
    );
    expect(stageChartText(orderedStages(buildExample()), "Current state").summary).toBe(
      "Code review waits longest: 6 of its 7 days; 15 of the 20 days across 5 stages are waiting."
    );
  });

  it("reads the same numbers as the agent", async () => {
    const stages = [
      stage("Analysis", 1, 3, { order: 0 }),
      stage("Dev", 2, 5, { order: 1 }),
      stage("Review", 1, 7, { order: 2 }),
    ];
    useWorkspaceStore.setState({ valueStreamStages: stages });
    renderPage();
    const agent = (await registry.get("tool.value_stream.list_state")!.handler(
      {},
      {
        userId: "u",
        source: "agent",
        squadProfileIds: [],
      }
    )) as { verdict: string; flowEfficiencyPct: number; bottleneck: { id: string } };
    expect(screen.getByText(agent.verdict)).toBeInTheDocument();
    expect(screen.getByText(`${agent.flowEfficiencyPct}%`)).toBeInTheDocument();
    expect(agent.bottleneck.id).toBe(bottleneck(stages)!.stage.id);
  });
});
