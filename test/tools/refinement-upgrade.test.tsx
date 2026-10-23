import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { gatherCockpitData } from "@/app/(tools)/sprint/view";

/**
 * Refinement as a backlog-driven session: the stories that aren't ready,
 * walked one at a time against the Definition of Ready, unsized ones
 * queued for Planning Poker, "Mark ready" written to Story.readiness. Plus
 * the tool UX contract: one editable criteria list, Undo on deletes and the
 * reset, checks by name kept as "Earlier checks", statistics behind a
 * minimum sample, a local example and a Markdown export.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
// The export's CSV and Markdown, as the page last handed them over.
type ExportProps = { csvData: { headers: string[]; rows: unknown[][] }; markdown: string };
const exported = vi.hoisted(() => ({ props: null as null | ExportProps }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: ExportProps) => {
    exported.props = p;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { RefinementClient } from "@/app/(tools)/refinement/refinement-client";
import {
  DEFAULT_CRITERIA,
  useRefinementStore,
  type Criterion,
  type StorySave,
} from "@/app/(tools)/refinement/store";
import {
  dorCheckHistory,
  isUnsized,
  keepsReady,
  localDateOf,
  metCriteria,
  passRateRecords,
  readinessFromCheck,
  readinessState,
  refinementSession,
  titleKey,
  validateCheck,
  validateReady,
} from "@/app/(tools)/refinement/session";
import { refinementVerdict } from "@/app/(tools)/refinement/verdict";
import { toMarkdown } from "@/app/(tools)/refinement/markdown";
import { passRateAnalysis, trendSentence } from "@/app/(tools)/refinement/analysis";
import { buildExample } from "@/app/(tools)/refinement/example";
import { validateCriterion } from "@/app/(tools)/refinement/criteria-list";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";

const C: Criterion[] = [
  { id: "c1", label: "Acceptance criteria defined" },
  { id: "c2", label: "Fits in a sprint" },
];

const story = (id: string, extra: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "backlog",
  ...extra,
});

const readiness = (checked: string[], ready: boolean, updatedAt = "2026-10-20T10:00:00.000Z") => ({
  checked,
  ready,
  updatedAt,
});

const save = (id: string, extra: Partial<StorySave> = {}): StorySave => ({
  id,
  storyName: `Check ${id}`,
  date: "2026-10-10",
  checks: [],
  totalCriteria: 8,
  metCount: 6,
  passRate: 75,
  ...extra,
});

const wsStory = (id: string) => useWorkspaceStore.getState().stories.find((s) => s.id === id);
const queue = () =>
  (useWorkspaceStore.getState().pokerEstimationLogs ?? []).find((d) => d.id === POKER_LOG_ID)
    ?.queue ?? [];
const lastUndo = () => {
  const call = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  return { label: call[0] as string, undo: () => act(() => call[1].action.onClick()) };
};
const renderPage = () =>
  render(
    <TooltipProvider>
      <RefinementClient />
    </TooltipProvider>
  );
const panel = () => screen.getByRole("button", { name: "Mark ready" }).closest("section")!;
const toRefine = () =>
  within(screen.getByRole("list", { name: "Stories to refine" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");

beforeEach(() => {
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  exported.props = null;
  window.localStorage.clear();
  // The workspace store skips hydration in tests; the page waits for it.
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({ stories: [], sprints: [], pokerEstimationLogs: [] });
  useRefinementStore.setState({
    criteria: C,
    history: [],
    exampleStories: [],
    storyName: "",
    storyDescription: "",
    currentChecks: {},
  });
});

/* -------------------------------------------------------------------------- */
/*  Logic                                                                     */
/* -------------------------------------------------------------------------- */

describe("which stories the session walks", () => {
  const stories: Story[] = [
    story("unsized", { priorityScore: 10 }),
    story("sized", { points: 3, priorityScore: 50 }),
    story("ready", { points: 5, readiness: readiness(["c1", "c2"], true) }),
    // Marked ready (by an agent, say) but no points: still to refine.
    story("ready-unsized", { status: "todo", sprintId: "s1", readiness: readiness([], true) }),
    story("zero", { points: 0 }),
    story("nan", { points: Number.NaN }),
    story("doing", { status: "in_progress" }),
    story("done", { status: "done" }),
    story("todo-sprint", { status: "todo", sprintId: "s1", points: 2, priorityScore: 99 }),
  ];

  it("lists what isn't ready in priority order, unscored last in stored order", () => {
    const s = refinementSession(stories);
    expect(s.toRefine.map((x) => x.id)).toEqual([
      "todo-sprint",
      "sized",
      "unsized",
      "ready-unsized",
      "zero",
      "nan",
    ]);
    expect(s.ready.map((x) => x.id)).toEqual(["ready"]);
    expect(s.total).toBe(7);
    expect(s.unsized).toBe(4);
    // Two of the seven are planned into a sprint; one unsized story is.
    expect(s.backlog).toBe(5);
    expect(s.backlogUnsized).toBe(3);
  });

  it("includes every story the cockpit counts behind “Refine the backlog”", () => {
    const sprint: Sprint = {
      id: "s1",
      name: "Sprint 1",
      startDate: "2026-10-12",
      endDate: "2026-10-23",
      pointsPlanned: 10,
      status: "active",
    };
    const cockpit = gatherCockpitData({
      sprint,
      series: undefined,
      stories,
      impediments: [],
      standupEntries: [],
      teamMembers: [],
      retroBoards: [],
      reviews: [],
      today: "2026-10-23",
    });
    const s = refinementSession(stories);
    expect(s.backlogUnsized).toBe(cockpit.backlogUnestimated);
    const cockpitIds = stories
      .filter((x) => !x.sprintId && x.status === "backlog" && isUnsized(x))
      .map((x) => x.id);
    expect(cockpitIds).toEqual(["unsized", "zero", "nan"]);
    for (const id of cockpitIds) expect(s.toRefine.map((x) => x.id)).toContain(id);
  });

  it("handles an empty or huge backlog", () => {
    expect(refinementSession([])).toMatchObject({ toRefine: [], ready: [], total: 0, unsized: 0 });
    const many = Array.from({ length: 2000 }, (_, i) => story(`s${i}`, { points: i % 2 }));
    const s = refinementSession(many);
    expect(s.total).toBe(2000);
    expect(s.unsized).toBe(1000);
    expect(s.toRefine).toHaveLength(2000);
  });
});

describe("readiness of a story", () => {
  it("counts only criteria still in the Definition of Ready", () => {
    expect(metCriteria(["c2", "gone", "c1"], C)).toEqual(["c1", "c2"]);
    expect(metCriteria(undefined, C)).toEqual([]);
    expect(readinessState(story("a"), C)).toBe("unchecked");
    expect(readinessState(story("a", { readiness: readiness(["gone"], false) }), C)).toBe(
      "not-ready"
    );
    expect(readinessState(story("a", { readiness: readiness(["c1"], false) }), C)).toBe("partial");
    expect(
      readinessState(story("a", { points: 1, readiness: readiness(["c1", "c2"], true) }), C)
    ).toBe("ready");
  });

  it("calls a story ready but for its points “Ready once sized”, not “Partial”", () => {
    // Marked ready (by an agent, or its estimate was cleared) with no points.
    expect(readinessState(story("a", { readiness: readiness(["c1", "c2"], true) }), C)).toBe(
      "needs-points"
    );
    expect(readinessState(story("a", { points: 0, readiness: readiness([], true) }), C)).toBe(
      "needs-points"
    );
    // Every criterion met, not marked yet, no points.
    expect(readinessState(story("a", { readiness: readiness(["c1", "c2"], false) }), C)).toBe(
      "needs-points"
    );
    // Criteria missing too: still partial. Without criteria nothing is "all met".
    expect(readinessState(story("a", { readiness: readiness(["c1"], false) }), C)).toBe("partial");
    expect(readinessState(story("a", { readiness: readiness([], false) }), [])).toBe("not-ready");
  });

  it("asks for every criterion and some points before “Mark ready”", () => {
    expect(validateReady({ checked: [] }, [], { points: 3 })).toEqual({
      ok: false,
      errors: { criteria: "Add a Definition of Ready criterion first." },
    });
    expect(validateReady({ checked: ["c1"] }, C, {})).toEqual({
      ok: false,
      errors: {
        criteria:
          "1 of 2 criteria isn't ticked yet. Tick it, or save the checks and come back to it.",
        points: "It has no points yet. Queue it for Planning Poker, then mark it ready.",
      },
    });
    // The verb follows the open count, the noun the list.
    expect(validateReady({ checked: [] }, C, { points: 1 })).toMatchObject({
      errors: {
        criteria: expect.stringMatching(/^2 of 2 criteria aren't ticked yet\. Tick them,/),
      },
    });
    expect(validateReady({ checked: [] }, [C[0]], { points: 1 })).toMatchObject({
      errors: { criteria: expect.stringMatching(/^1 of 1 criterion isn't ticked yet\. Tick it,/) },
    });
    expect(validateReady({ checked: ["gone", "c2", "c1"] }, C, { points: 8 })).toEqual({
      ok: true,
      values: { checked: ["c1", "c2"] },
    });
  });

  it("checks a check-by-name's name and date", () => {
    const today = "2026-10-23";
    const draft = { storyName: "  ", description: "", date: "2026-10-24", checked: [] };
    expect(validateCheck(draft, C, today)).toEqual({
      ok: false,
      errors: {
        storyName: "Enter the story's name or ID.",
        date: "A check can't be dated in the future.",
      },
    });
    expect(validateCheck({ ...draft, storyName: "x", date: "2026-02-30" }, C, today)).toMatchObject(
      { ok: false, errors: { date: "Enter a date as YYYY-MM-DD." } }
    );
    expect(validateCheck({ ...draft, storyName: "x", date: "" }, C, today)).toMatchObject({
      ok: false,
      errors: { date: "Pick the date of the check." },
    });
    expect(
      validateCheck(
        { storyName: " USER-1 ", description: " ", date: "2026-09-01", checked: ["c2", "gone"] },
        C,
        today
      )
    ).toEqual({ ok: true, values: { storyName: "USER-1", date: "2026-09-01", checked: ["c2"] } });
  });

  it("refuses a blank or duplicate criterion", () => {
    expect(validateCriterion({ label: " ", description: "" }, C)).toEqual({
      ok: false,
      errors: { label: "Enter the criterion." },
    });
    expect(validateCriterion({ label: "fits IN a sprint", description: "" }, C)).toEqual({
      ok: false,
      errors: { label: "That criterion is already on the list." },
    });
    expect(validateCriterion({ label: " Test data ", description: " seeded " }, C)).toEqual({
      ok: true,
      values: { label: "Test data", description: "seeded" },
    });
  });
});

describe("the verdict", () => {
  const ready = (n: number) => Array.from({ length: n }, (_, i) => story(`r${i}`));
  /** A session with nothing planned into a sprint unless `planned` says so. */
  const v = (r: number, total: number, unsized: number, planned = 0, plannedUnsized = 0) =>
    refinementVerdict({
      ready: ready(r),
      total,
      unsized,
      backlog: total - planned,
      backlogUnsized: unsized - plannedUnsized,
    });

  it("says how much of the backlog is ready, in a sentence", () => {
    expect(v(0, 0, 0)).toBe("No backlog stories to refine yet.");
    expect(v(7, 12, 3)).toBe("7 of 12 backlog stories are ready. 3 still need points.");
    expect(v(1, 12, 1)).toBe("1 of 12 backlog stories is ready. 1 still needs points.");
    expect(v(0, 4, 0)).toBe("None of the 4 backlog stories are ready yet.");
    expect(v(5, 5, 0)).toBe("All 5 backlog stories are ready.");
    expect(v(1, 1, 0)).toBe("The backlog story is ready.");
    expect(v(0, 1, 1)).toBe("The backlog story isn't ready yet. It still needs points.");
  });

  it("names the backlog's unsized stories apart from planned ones, as the cockpit counts", () => {
    expect(v(7, 12, 5, 4, 2)).toBe(
      "7 of 12 stories are ready. 3 backlog stories and 2 planned ones still need points."
    );
    expect(v(7, 12, 4, 4, 1)).toBe(
      "7 of 12 stories are ready. 3 backlog stories and 1 planned one still need points."
    );
    expect(v(7, 12, 1, 4, 0)).toBe(
      "7 of 12 stories are ready. 1 backlog story still needs points."
    );
    expect(v(0, 3, 2, 3, 2)).toBe(
      "None of the 3 stories are ready yet. 2 planned stories still need points."
    );
    expect(v(3, 3, 0, 1, 0)).toBe("All 3 stories are ready.");
    expect(v(0, 1, 1, 1, 1)).toBe("The planned story isn't ready yet. It still needs points.");
  });
});

describe("pass rate over time", () => {
  it("merges checks by name (old shape) and stories' readiness, oldest first", () => {
    const history = [
      save("new", { date: "2026-10-18", metCount: 1, totalCriteria: 2, passRate: 50 }),
      save("empty", { date: "2026-10-01", totalCriteria: 0, metCount: 0, passRate: 0 }),
      save("old", { date: "2026-10-02" }),
    ];
    const stories = [
      story("late", { readiness: readiness(["c1", "c2"], true, "2026-10-21T09:00:00.000Z") }),
      story("early", { readiness: readiness(["c1", "gone"], false, "2026-10-05T09:00:00.000Z") }),
      story("bad", { readiness: readiness(["c1"], false, "not a date") }),
      story("never"),
    ];
    const records = passRateRecords(stories, history, C);
    expect(records.map((r) => [r.id, r.passRate])).toEqual([
      ["old", 75],
      ["early", 50],
      ["new", 50],
      ["late", 100],
    ]);
    expect(records[1]).toMatchObject({ metCount: 1, totalCriteria: 2, source: "story" });
    // Without criteria a story's readiness can't be counted; saved checks still can.
    expect(passRateRecords(stories, history, []).map((r) => r.id)).toEqual(["old", "new"]);
  });

  it("runs the trend and control-chart statistics only with enough checks", () => {
    const rec = (i: number, passRate: number) => ({
      id: `r${i}`,
      name: `S${i}`,
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      metCount: passRate / 10,
      totalCriteria: 10,
      passRate,
      source: "check" as const,
    });
    const five = [50, 60, 70, 80, 90].map((p, i) => rec(i, p));
    expect(passRateAnalysis(five)).toMatchObject({ chart: null, trend: null, control: null });

    const six = [...five, rec(5, 100)];
    const a6 = passRateAnalysis(six);
    expect(a6.chart?.summary).toBe(
      "Pass rate rose from 50% to 100% over the last 6 checks; the average is 75%."
    );
    expect(a6.chart?.table.rows[0]).toEqual(["S0", "2026-10-01", 50]);
    // Mann-Kendall needs 10 points to call a trend; control limits need 8.
    expect(a6.trend).toBeNull();
    expect(a6.control).toBeNull();

    const rising = passRateAnalysis(Array.from({ length: 10 }, (_, i) => rec(i, 10 + i * 9)));
    expect(rising.trend?.trend).toBe("up");
    expect(trendSentence(rising.trend!)).toMatch(/^Stories are arriving readier over time/);
    expect(rising.control).not.toBeNull();

    // Nine high, then nine low: the last nine sit below the centre line.
    const drifting = [
      ...Array.from({ length: 9 }, (_, i) => rec(i, 100)),
      ...Array.from({ length: 9 }, (_, i) => rec(9 + i, 50)),
    ];
    const a = passRateAnalysis(drifting);
    expect(a.control?.centerLinePct).toBeCloseTo(75);
    expect(a.drift).toBe(true);
    // Only the latest 20 checks count.
    expect(passRateAnalysis(Array.from({ length: 30 }, (_, i) => rec(i, 80))).window).toHaveLength(
      20
    );
  });
});

describe("the Markdown export", () => {
  it("has the verdict, the criteria, the stories and the earlier checks", () => {
    const stories = [
      story("a", { title: "Login | SSO" }),
      story("b", { title: "Export", points: 3, readiness: readiness(["c1", "c2"], true) }),
    ];
    const md = toMarkdown(
      refinementSession(stories),
      [{ id: "c1", label: "Acceptance criteria", description: "Given/when/then" }, C[1]],
      [save("h", { storyName: "Other team's story" })],
      new Date("2026-10-23T12:00:00Z")
    );
    expect(md).toContain("# Backlog refinement — 23 Oct 2026");
    expect(md).toContain("**1 of 2 backlog stories is ready. 1 still needs points.**");
    expect(md).toContain("- Acceptance criteria — Given/when/then");
    expect(md).toContain("## To refine (1)");
    expect(md).toContain("| Login \\| SSO | Unsized | — | Not checked |");
    expect(md).toContain("## Ready (1)");
    expect(md).toContain("| Export | 3 | 2/2 | Ready |");
    expect(md).toContain("| Other team's story | 2026-10-10 | 6/8 | 75% |");
    expect(toMarkdown(refinementSession([]), [], [])).toContain("No criteria yet.");
  });
});

describe("saved state from before the session", () => {
  it("loads old stored shapes: no example, checks without ticks", async () => {
    window.localStorage.setItem(
      "agile-toolkit:refinement",
      JSON.stringify({
        state: {
          criteria: DEFAULT_CRITERIA,
          history: [{ ...save("legacy"), checks: undefined }, null],
          storyName: "Half typed",
        },
        version: 0,
      })
    );
    await useRefinementStore.persist.rehydrate();
    const s = useRefinementStore.getState();
    expect(s.history.map((h) => h.id)).toEqual(["legacy"]);
    expect(s.history[0].checks).toEqual([]);
    expect(s.exampleStories).toEqual([]);
    expect(s.storyName).toBe("Half typed");
  });
});

/* -------------------------------------------------------------------------- */
/*  The page                                                                  */
/* -------------------------------------------------------------------------- */

describe("first run", () => {
  it("loads a local example session that never reaches the backlog", () => {
    useRefinementStore.setState({ criteria: DEFAULT_CRITERIA });
    renderPage();
    expect(screen.getByText("No backlog stories to refine yet.")).toBeInTheDocument();
    expect(screen.getByText(/The session lists the backlog stories/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText("3 of 8 backlog stories are ready. 2 still need points.")
    ).toBeInTheDocument();
    expect(
      useRefinementStore.getState().exampleStories.every((s) => s.id.startsWith("example-"))
    ).toBe(true);
    expect(useWorkspaceStore.getState().stories).toEqual([]);

    // Checks on an example story stay in the example.
    fireEvent.click(within(panel()).getByRole("button", { name: "Save checks" }));
    expect(useWorkspaceStore.getState().stories).toEqual([]);
    // Unsized example stories aren't queued for real.
    fireEvent.click(screen.getByRole("button", { name: /Needs points/ }));
    expect(
      within(panel()).getByText(/Example stories aren’t sent to Planning Poker/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unsized for Planning Poker/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(useRefinementStore.getState().exampleStories).toEqual([]);
    expect(screen.getByText(/The session lists the backlog stories/)).toBeInTheDocument();
  });

  it("builds the example against the team's own criteria", () => {
    const ex = buildExample(C, new Date("2026-10-23T12:00:00Z"));
    expect(ex).toHaveLength(8);
    const ready = ex.filter((s) => s.readiness?.ready);
    expect(ready).toHaveLength(3);
    for (const s of ready) expect(s.readiness?.checked).toEqual(["c1", "c2"]);
    // With no criteria nothing can be ready.
    expect(buildExample([]).some((s) => s.readiness?.ready)).toBe(false);
  });
});

describe("walking the backlog", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      stories: [
        story("a", { title: "Unsized story", priorityScore: 90 }),
        story("b", {
          title: "Partly checked",
          points: 3,
          priorityScore: 80,
          readiness: readiness(["c1"], false),
        }),
        story("c", { title: "Never checked", points: 5, priorityScore: 70 }),
        story("d", { title: "In progress", status: "in_progress" }),
      ],
      sprints: [],
    });
  });

  it("shows the unready stories with the unsized one flagged, and the verdict", () => {
    renderPage();
    expect(
      screen.getByText("None of the 3 backlog stories are ready yet. 1 still needs points.")
    ).toBeInTheDocument();
    expect(toRefine()).toEqual([
      expect.stringContaining("Unsized story"),
      expect.stringContaining("Partly checked"),
      expect.stringContaining("Never checked"),
    ]);
    expect(toRefine()[0]).toContain("Unsized");
    expect(toRefine()[1]).toContain("1/2");
    expect(within(panel()).getByText("Story 1 of 3 to refine")).toBeInTheDocument();
  });

  it("won't mark an unsized or unticked story ready, and says why", () => {
    renderPage();
    fireEvent.click(within(panel()).getByRole("button", { name: "Mark ready" }));
    expect(within(panel()).getByText(/2 of 2 criteria aren't ticked yet/)).toBeInTheDocument();
    expect(within(panel()).getByText(/It has no points yet/)).toBeInTheDocument();
    expect(within(panel()).getByRole("checkbox", { name: C[0].label })).toHaveFocus();
    expect(wsStory("a")?.readiness).toBeUndefined();
  });

  it("marks a story ready on Story.readiness, moves on, and Undo puts it back", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Partly checked/ }));
    expect(within(panel()).getByRole("checkbox", { name: C[0].label })).toBeChecked();
    fireEvent.click(within(panel()).getByRole("checkbox", { name: C[1].label }));
    fireEvent.click(within(panel()).getByRole("button", { name: "Mark ready" }));

    expect(wsStory("b")?.readiness).toMatchObject({ checked: ["c1", "c2"], ready: true });
    expect(toRefine().join()).not.toContain("Partly checked");
    // On to the next story, focus on its name.
    expect(within(panel()).getByRole("heading", { name: "Never checked" })).toHaveFocus();
    expect(
      screen.getByText("1 of 3 backlog stories is ready. 1 still needs points.")
    ).toBeInTheDocument();

    const { label, undo } = lastUndo();
    expect(label).toBe("Marked “Partly checked” ready");
    undo();
    expect(wsStory("b")?.readiness).toMatchObject({ checked: ["c1"], ready: false });
  });

  it("re-checking a story updates its readiness instead of adding a row", () => {
    useWorkspaceStore
      .getState()
      .upsertStory(
        story("b", { title: "Partly checked", points: 3, readiness: readiness(["c1", "c2"], true) })
      );
    renderPage();
    const ready = screen.getByRole("list", { name: "Ready stories" });
    fireEvent.click(within(ready).getByRole("button", { name: "Re-check Partly checked" }));
    expect(within(panel()).getByText("Re-checking a ready story")).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("checkbox", { name: C[1].label }));
    // Unticking a box on a ready story: the button says what saving does.
    expect(within(panel()).queryByRole("button", { name: "Save checks" })).toBeNull();
    fireEvent.click(within(panel()).getByRole("button", { name: "Save as not ready" }));

    expect(useWorkspaceStore.getState().stories.filter((s) => s.id === "b")).toHaveLength(1);
    expect(wsStory("b")?.readiness).toMatchObject({ checked: ["c1"], ready: false });
    expect(useRefinementStore.getState().history).toEqual([]);
    expect(lastUndo().label).toBe("“Partly checked” is no longer ready");
    expect(toRefine().join()).toContain("Partly checked");
  });

  it("re-checking a ready story with every box still ticked keeps it ready", () => {
    useWorkspaceStore.setState({
      stories: [
        story("b", { title: "Ready one", points: 3, readiness: readiness(["c1", "c2"], true) }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Re-check Ready one" }));
    fireEvent.click(within(panel()).getByRole("button", { name: "Save checks" }));

    expect(wsStory("b")?.readiness).toMatchObject({ checked: ["c1", "c2"], ready: true });
    expect(wsStory("b")?.readiness?.updatedAt).not.toBe("2026-10-20T10:00:00.000Z");
    expect(lastUndo().label).toBe("Saved the checks on “Ready one”");
    expect(
      within(screen.getByRole("list", { name: "Ready stories" })).getByText("Ready one")
    ).toBeInTheDocument();
  });

  it("saves checks without the call and walks on", () => {
    renderPage();
    fireEvent.click(within(panel()).getByRole("checkbox", { name: C[0].label }));
    fireEvent.click(within(panel()).getByRole("button", { name: "Save checks" }));
    expect(wsStory("a")?.readiness).toMatchObject({ checked: ["c1"], ready: false });
    expect(within(panel()).getByText("Story 2 of 3 to refine")).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Previous story" }));
    expect(within(panel()).getByText("Story 1 of 3 to refine")).toBeInTheDocument();
    expect(within(panel()).getByRole("checkbox", { name: C[0].label })).toBeChecked();
  });

  it("filters to the stories that need points", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Needs points (1)" }));
    expect(toRefine()).toEqual([expect.stringContaining("Unsized story")]);
    expect(screen.getByRole("button", { name: "Needs points (1)" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("queues an unsized story for Planning Poker with Undo, once", () => {
    renderPage();
    fireEvent.click(within(panel()).getByRole("button", { name: "Queue for Poker" }));
    expect(queue()).toEqual([
      expect.objectContaining({ title: "Unsized story", sourceRef: { tool: "story", id: "a" } }),
    ]);
    expect(within(panel()).getByText("Queued for Poker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unsized for Planning Poker/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Open Planning Poker \(1 queued\)/ })).toHaveAttribute(
      "href",
      "/planning-poker"
    );
    lastUndo().undo();
    expect(queue()).toEqual([]);
  });

  it("queues every unsized story in one go", () => {
    useWorkspaceStore.getState().upsertStory(story("e", { title: "Another unsized" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Queue 2 unsized for Planning Poker" }));
    expect(
      queue()
        .map((q) => q.sourceRef.id)
        .sort()
    ).toEqual(["a", "e"]);
    expect(lastUndo().label).toBe("Queued 2 stories for Planning Poker");
    lastUndo().undo();
    expect(queue()).toEqual([]);
  });

  it("shows the sprint a planned story is in", () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "s9",
          name: "Sprint 9",
          startDate: "2026-10-12",
          endDate: "2026-10-23",
          pointsPlanned: 0,
          status: "planned",
        },
      ],
      stories: [story("t", { title: "Planned", status: "todo", sprintId: "s9", points: 2 })],
    });
    renderPage();
    expect(within(panel()).getByText("In Sprint 9")).toBeInTheDocument();
  });
});

describe("the Definition of Ready", () => {
  it("is one editable list: add, edit in place, delete with Undo", () => {
    renderPage();
    // One list: each criterion has exactly one Edit and one Delete.
    expect(screen.getAllByRole("button", { name: `Edit ${C[0].label}` })).toHaveLength(1);
    const list = () => screen.getByRole("list", { name: "Definition of Ready criteria" });

    // A blank add saves nothing.
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(screen.getByText("Enter the criterion.")).toBeInTheDocument();
    expect(useRefinementStore.getState().criteria).toHaveLength(2);

    fireEvent.change(screen.getByLabelText(/New criterion/), { target: { value: "Test data" } });
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(useRefinementStore.getState().criteria.map((c) => c.label)).toEqual([
      C[0].label,
      C[1].label,
      "Test data",
    ]);

    fireEvent.click(within(list()).getByRole("button", { name: "Edit Test data" }));
    const title = screen.getByRole("textbox", { name: "Criterion" });
    fireEvent.change(title, { target: { value: "Test data seeded" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(useRefinementStore.getState().criteria[2].label).toBe("Test data seeded");

    fireEvent.click(within(list()).getByRole("button", { name: `Delete ${C[0].label}` }));
    expect(useRefinementStore.getState().criteria.map((c) => c.id)).not.toContain("c1");
    const { label, undo } = lastUndo();
    expect(label).toBe(`Deleted “${C[0].label}”`);
    undo();
    expect(useRefinementStore.getState().criteria[0].id).toBe("c1");
  });

  it("resets criteria and earlier checks only after confirming, with Undo", () => {
    useRefinementStore.setState({ history: [save("h1")] });
    useWorkspaceStore.setState({
      stories: [story("b", { points: 3, readiness: readiness(["c1"], false) })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reset checklist" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Reset the refinement checklist?");
    expect(dialog).toHaveTextContent("Readiness saved on backlog stories stays.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset checklist" }));

    expect(useRefinementStore.getState().criteria).toEqual(DEFAULT_CRITERIA);
    expect(useRefinementStore.getState().history).toEqual([]);
    expect(wsStory("b")?.readiness?.checked).toEqual(["c1"]);
    lastUndo().undo();
    expect(useRefinementStore.getState().criteria).toEqual(C);
    expect(useRefinementStore.getState().history.map((h) => h.id)).toEqual(["h1"]);
  });

  it("has nothing to reset on the defaults", () => {
    useRefinementStore.setState({ criteria: DEFAULT_CRITERIA });
    renderPage();
    expect(screen.getByRole("button", { name: "Reset checklist" })).toBeDisabled();
  });
});

describe("earlier checks", () => {
  const checks = () => screen.getByRole("list", { name: "Earlier checks" });

  it("keeps the old checks by name readable, editable and deletable with Undo", () => {
    useRefinementStore.setState({ history: [save("h1", { storyName: "Login with SSO" })] });
    renderPage();
    expect(within(checks()).getByText("Login with SSO")).toBeInTheDocument();
    expect(within(checks()).getByText("2026-10-10 · 6/8 criteria met")).toBeInTheDocument();

    fireEvent.click(within(checks()).getByRole("button", { name: "Edit Login with SSO" }));
    const name = within(checks()).getByLabelText(/Story name or ID/);
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "" } });
    fireEvent.click(within(checks()).getByRole("button", { name: "Save" }));
    expect(within(checks()).getByText("Enter the story's name or ID.")).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "SSO login" } });
    fireEvent.change(within(checks()).getByLabelText(/Checked on/), {
      target: { value: "2026-09-30" },
    });
    fireEvent.click(within(checks()).getByRole("button", { name: "Save" }));
    expect(useRefinementStore.getState().history[0]).toMatchObject({
      storyName: "SSO login",
      date: "2026-09-30",
      passRate: 75,
    });

    fireEvent.click(within(checks()).getByRole("button", { name: "Delete SSO login" }));
    expect(useRefinementStore.getState().history).toEqual([]);
    lastUndo().undo();
    expect(useRefinementStore.getState().history.map((h) => h.id)).toEqual(["h1"]);
  });

  it("still checks a story by name, backdated, with nothing saved until it's valid", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Check a story by name" }));
    fireEvent.click(screen.getByRole("button", { name: "Save check" }));
    expect(screen.getByText("Enter the story's name or ID.")).toBeInTheDocument();
    expect(useRefinementStore.getState().history).toEqual([]);

    const form = screen.getByRole("button", { name: "Save check" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/Story name or ID/), {
      target: { value: "PAY-7 Partner refunds" },
    });
    // The draft survives a reload.
    expect(useRefinementStore.getState().storyName).toBe("PAY-7 Partner refunds");
    fireEvent.change(within(form).getByLabelText(/Checked on/), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(within(form).getByRole("checkbox", { name: C[0].label }));
    fireEvent.click(within(form).getByRole("button", { name: "Save check" }));

    expect(useRefinementStore.getState().history).toEqual([
      expect.objectContaining({
        storyName: "PAY-7 Partner refunds",
        date: "2026-10-01",
        metCount: 1,
        totalCriteria: 2,
        passRate: 50,
      }),
    ]);
    expect(useRefinementStore.getState().storyName).toBe("");
  });

  it("adds a check to the backlog, ticks included, where the session picks it up", () => {
    useRefinementStore.setState({
      history: [
        save("h1", {
          storyName: "Partner refunds",
          date: "2026-10-10",
          checks: [
            { criterionId: "c1", checked: true },
            { criterionId: "c2", checked: false },
          ],
          metCount: 1,
          totalCriteria: 2,
          passRate: 50,
        }),
      ],
    });
    renderPage();
    fireEvent.click(
      within(checks()).getByRole("button", { name: "Add to backlog: Partner refunds" })
    );
    const created = useWorkspaceStore.getState().stories;
    expect(created).toEqual([
      expect.objectContaining({
        title: "Partner refunds",
        status: "backlog",
        sourceRef: { tool: "refinement", id: "h1" },
        // Where it stood when checked, not "Not checked"; the call is made in the session.
        readiness: expect.objectContaining({ checked: ["c1"], ready: false }),
      }),
    ]);
    expect(localDateOf(created[0].readiness?.updatedAt)).toBe("2026-10-10");
    // It's in the session now, so the check opens it there instead of adding a copy.
    expect(
      within(checks()).getByRole("button", { name: "Open in session: Partner refunds" })
    ).toBeInTheDocument();
    expect(toRefine()).toEqual([expect.stringContaining("Partner refunds")]);
    expect(toRefine()[0]).toContain("1/2");
    expect(within(panel()).getByText("Partial")).toBeInTheDocument();
    // The check and the story it became are one check in the trend, not two.
    expect(
      screen.getByText("Check 5 more stories to see the pass-rate trend.")
    ).toBeInTheDocument();

    // Undo of the hand-off removes the story, ticks and all.
    lastUndo().undo();
    expect(useWorkspaceStore.getState().stories).toEqual([]);
    expect(
      within(checks()).getByRole("button", { name: "Add to backlog: Partner refunds" })
    ).toBeInTheDocument();
  });

  it("links a check naming a story the backlog has instead of adding a copy", () => {
    useWorkspaceStore.setState({
      stories: [
        story("w", { title: "Top of the list", points: 1, priorityScore: 99 }),
        story("x", { title: "Partner Refunds", points: 3 }),
        story("y", { title: "Shipped one", status: "in_progress" }),
        story("z", { title: "Finished", status: "done" }),
      ],
    });
    useRefinementStore.setState({
      history: [
        // Case and spacing don't make it a different story.
        save("h1", { storyName: " partner  refunds" }),
        save("h2", { storyName: "Shipped one" }),
        save("h3", { storyName: "Finished" }),
      ],
    });
    renderPage();
    // Not started: opens it in the session, focus on its name.
    fireEvent.click(
      within(checks()).getByRole("button", { name: "Open in session: Partner Refunds" })
    );
    expect(within(panel()).getByRole("heading", { name: "Partner Refunds" })).toHaveFocus();
    // Started: in the backlog already, nothing to add.
    expect(within(checks()).getByRole("link", { name: "In the backlog" })).toBeInTheDocument();
    // A done story doesn't count: adding it again is a new story.
    expect(
      within(checks()).getByRole("button", { name: "Add to backlog: Finished" })
    ).toBeInTheDocument();
    expect(within(checks()).queryByRole("button", { name: /Add to backlog: partner/ })).toBeNull();
  });

  it("warns when a check by name names a backlog story, and opens it in the session", () => {
    useWorkspaceStore.setState({
      stories: [
        story("a", { title: "Login with SSO", points: 3, priorityScore: 1 }),
        story("b", { title: "First", priorityScore: 9 }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Needs points (1)" }));
    expect(toRefine()).toEqual([expect.stringContaining("First")]);
    fireEvent.click(screen.getByRole("button", { name: "Check a story by name" }));
    const form = screen.getByRole("button", { name: "Save check" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/Story name or ID/), {
      target: { value: "  login WITH sso " },
    });
    expect(within(form).getByRole("status")).toHaveTextContent(
      "“Login with SSO” is already in the backlog. Check it in the session"
    );
    // Narrowed to the stories that need points, the session still opens it.
    fireEvent.click(within(form).getByRole("button", { name: "Open it in the session" }));
    expect(within(panel()).getByRole("heading", { name: "Login with SSO" })).toHaveFocus();

    fireEvent.change(within(form).getByLabelText(/Story name or ID/), {
      target: { value: "Another team's story" },
    });
    expect(within(form).queryByRole("status")).toBeNull();
  });

  it("clears every earlier check after confirming, with Undo", () => {
    useRefinementStore.setState({ history: [save("h1"), save("h2")] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear earlier checks" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("All 2 earlier checks will be removed");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear checks" }));
    expect(useRefinementStore.getState().history).toEqual([]);
    lastUndo().undo();
    expect(useRefinementStore.getState().history.map((h) => h.id)).toEqual(["h1", "h2"]);
  });
});

describe("advanced analysis", () => {
  it("asks for more checks before showing a trend", () => {
    useRefinementStore.setState({ history: [save("h1"), save("h2")] });
    renderPage();
    // Counted in stories: re-checking one replaces its record.
    expect(
      screen.getByText("Check 4 more stories to see the pass-rate trend.")
    ).toBeInTheDocument();
  });

  it("doesn't count a re-checked story twice towards the sample", () => {
    useWorkspaceStore.setState({
      stories: [story("b", { title: "Rechecked", points: 3, readiness: readiness(["c1"], false) })],
    });
    renderPage();
    expect(
      screen.getByText("Check 5 more stories to see the pass-rate trend.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Rechecked/ }));
    fireEvent.click(within(panel()).getByRole("button", { name: "Save checks" }));
    expect(
      screen.getByText("Check 5 more stories to see the pass-rate trend.")
    ).toBeInTheDocument();
  });

  it("shows the trend with a summary, and control limits only from 8 checks", () => {
    useRefinementStore.setState({
      history: Array.from({ length: 6 }, (_, i) =>
        save(`h${i}`, { date: `2026-10-0${i + 1}`, metCount: 4, totalCriteria: 8, passRate: 50 })
      ),
    });
    renderPage();
    expect(
      screen.getByText("Pass rate stayed at 50% over the last 6 checks; the average is 50%.")
    ).toBeInTheDocument();
    expect(screen.getByText("Check 4 more stories to see a trend test.")).toBeInTheDocument();
    expect(screen.getByText("Check 2 more stories to see control limits.")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/*  Review fixes                                                              */
/* -------------------------------------------------------------------------- */

describe("the cockpit's count on the page", () => {
  const stories: Story[] = [
    // What the cockpit counts behind "Refine the backlog": no sprint, backlog, no points.
    story("u1", { title: "Backlog A", priorityScore: 50 }),
    story("u2", { title: "Backlog B", priorityScore: 40 }),
    story("u3", { title: "Backlog C", points: 0, priorityScore: 30 }),
    story("sized", { title: "Sized one", points: 5, priorityScore: 20 }),
    // Planned into sprints and unsized: on the page, not on that card.
    story("p1", { title: "Planned A", status: "todo", sprintId: "s1", priorityScore: 10 }),
    story("p2", { title: "Planned B", sprintId: "s2", priorityScore: 5 }),
  ];
  const sprint: Sprint = {
    id: "s1",
    name: "Sprint 1",
    startDate: "2026-10-12",
    endDate: "2026-10-23",
    pointsPlanned: 10,
    status: "active",
  };

  it("shows the number the cockpit links with, and filters to exactly those stories", () => {
    const cockpit = gatherCockpitData({
      sprint,
      series: undefined,
      stories,
      impediments: [],
      standupEntries: [],
      teamMembers: [],
      retroBoards: [],
      reviews: [],
      today: "2026-10-23",
    });
    expect(cockpit.backlogUnestimated).toBe(3);
    useWorkspaceStore.setState({ stories });
    renderPage();
    expect(
      screen.getByText(
        "None of the 6 stories are ready yet. 3 backlog stories and 2 planned ones still need points."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs points (5)" })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: `In the backlog, no points (${cockpit.backlogUnestimated})`,
      })
    );
    expect(toRefine()).toEqual([
      expect.stringContaining("Backlog A"),
      expect.stringContaining("Backlog B"),
      expect.stringContaining("Backlog C"),
    ]);
    expect(screen.getByText("Backlog stories that need points")).toBeInTheDocument();

    // Once the planned ones have points the two filters are one list, and one button.
    act(() => {
      const ws = useWorkspaceStore.getState();
      ws.upsertStory({ ...stories[4], points: 2 });
      ws.upsertStory({ ...stories[5], points: 3 });
    });
    expect(screen.queryByRole("button", { name: /In the backlog, no points/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Needs points (3)" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(toRefine()).toHaveLength(3);
  });

  it("has no separate backlog filter while every unsized story is in the backlog", () => {
    useWorkspaceStore.setState({ stories: stories.slice(0, 4) });
    renderPage();
    expect(
      screen.getByText("None of the 4 backlog stories are ready yet. 3 still need points.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs points (3)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /In the backlog, no points/ })).toBeNull();
  });
});

describe("review fixes: logic", () => {
  it("keeps a ready story ready only while every criterion is still ticked", () => {
    const r = story("r", { points: 3, readiness: readiness(["c1", "c2"], true) });
    expect(keepsReady(r, ["c1", "c2"], C)).toBe(true);
    expect(keepsReady(r, ["c1", "gone"], C)).toBe(false);
    expect(keepsReady(r, ["c1", "c2"], [])).toBe(false);
    const notReady = story("n", { points: 3, readiness: readiness(["c1", "c2"], false) });
    expect(keepsReady(notReady, ["c1", "c2"], C)).toBe(false);
    expect(keepsReady(story("u"), ["c1", "c2"], C)).toBe(false);
  });

  it("turns a check's ticks into a story's readiness, dated the day of the check", () => {
    const now = new Date(2026, 9, 23, 9, 0);
    const ticks = [
      { criterionId: "c1", checked: true },
      { criterionId: "c2", checked: false },
    ];
    const r = readinessFromCheck({ date: "2026-10-10", checks: ticks }, now);
    expect(r).toMatchObject({ checked: ["c1"], ready: false });
    expect(localDateOf(r.updatedAt)).toBe("2026-10-10");
    // Today's check isn't stamped later than now; a bad date or an old shape still works.
    expect(readinessFromCheck({ date: "2026-10-23", checks: [] }, now).updatedAt).toBe(
      now.toISOString()
    );
    expect(readinessFromCheck({ date: "soon", checks: undefined as unknown as [] }, now)).toEqual({
      checked: [],
      ready: false,
      updatedAt: now.toISOString(),
    });
  });

  it("reads a readiness stamp as the local day, and compares titles loosely", () => {
    expect(localDateOf(new Date(2026, 9, 20, 0, 30).toISOString())).toBe("2026-10-20");
    expect(localDateOf(new Date(2026, 9, 20, 23, 30).toISOString())).toBe("2026-10-20");
    expect(localDateOf("garbage")).toBe("");
    expect(localDateOf(undefined)).toBe("");
    expect(titleKey("  Login  WITH\tsso ")).toBe("login with sso");
  });

  it("counts a check added to the backlog once, by the story it became", () => {
    const history = [
      save("h2", { date: "2026-10-02", storyName: "Sent earlier" }),
      save("h1", { date: "2026-10-01", storyName: "Sent" }),
    ];
    const stories = [
      story("s1", {
        title: "Sent",
        sourceRef: { tool: "refinement", id: "h1" },
        readiness: readiness(["c1"], false, "2026-10-05T09:00:00.000Z"),
      }),
      // Sent before the ticks were carried over: no readiness, so its check still counts.
      story("s2", { title: "Sent earlier", sourceRef: { tool: "refinement", id: "h2" } }),
      // Another tool's item with the same id is a different thing.
      story("s3", {
        sourceRef: { tool: "retro", id: "h2" },
        readiness: readiness(["c1", "c2"], true, "2026-10-06T09:00:00.000Z"),
      }),
    ];
    expect(passRateRecords(stories, history, C).map((r) => r.id)).toEqual(["h2", "s1", "s3"]);
    // The Team charter's Definition of Ready card can read the same series, newest first.
    expect(dorCheckHistory(stories, history, C)).toEqual([
      { passRate: 100, date: "2026-10-06", storyName: "Story s3" },
      { passRate: 50, date: "2026-10-05", storyName: "Sent" },
      { passRate: 75, date: "2026-10-02", storyName: "Sent earlier" },
    ]);
    expect(dorCheckHistory([], [], C)).toEqual([]);
  });

  it("marks example stories in the Markdown and names the ready-but-unsized badge", () => {
    const stories = [
      story("example-1", { title: "Sample", readiness: readiness(["c1", "c2"], true) }),
      story("own", { title: "Own" }),
    ];
    const md = toMarkdown(refinementSession(stories), C, [], new Date("2026-10-23T12:00:00Z"));
    expect(md).toContain("_Includes example stories, marked (example)._");
    expect(md).toContain("| Sample (example) | Unsized | 2/2 | Ready once sized |");
    expect(md).toContain("| Own | Unsized | — | Not checked |");
    expect(toMarkdown(refinementSession([story("own")]), C, [])).not.toContain("example");
  });
});

describe("review fixes: the page", () => {
  it("marks example rows in the CSV and dates each check by its local day", () => {
    const at = new Date(2026, 9, 20, 0, 30).toISOString();
    useWorkspaceStore.setState({
      stories: [
        story("own", {
          title: "Own story",
          points: 2,
          readiness: readiness(
            C.map((c) => c.id),
            true,
            at
          ),
        }),
      ],
    });
    useRefinementStore.setState({ exampleStories: buildExample(C, new Date(2026, 9, 23, 12)) });
    renderPage();
    const { csvData, markdown } = exported.props!;
    const row = (title: string) => csvData.rows.find((r) => r[0] === title)!;
    expect(row("Own story")[1]).toBe("Backlog");
    expect(row("Own story")[7]).toBe("2026-10-20");
    expect(row("Freeze a lost card from the app")[1]).toBe("Example");
    // Every criterion met, no points: ready but for the estimate.
    expect(row("Split a bill with contacts")[6]).toBe("Ready once sized");
    expect(markdown).toContain("| Freeze a lost card from the app (example) |");
    expect(markdown).toContain("| Own story | 2 |");
  });

  it("accepts today's date after the page stayed open past midnight", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 23, 23, 58));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Check a story by name" }));
      const form = screen.getByRole("button", { name: "Save check" }).closest("form")!;
      fireEvent.change(within(form).getByLabelText(/Story name or ID/), {
        target: { value: "Late one" },
      });
      vi.setSystemTime(new Date(2026, 9, 24, 0, 5));
      fireEvent.change(within(form).getByLabelText(/Checked on/), {
        target: { value: "2026-10-24" },
      });
      fireEvent.click(within(form).getByRole("button", { name: "Save check" }));
      expect(useRefinementStore.getState().history[0]).toMatchObject({
        storyName: "Late one",
        date: "2026-10-24",
      });
      // The next check starts on the new day.
      expect(within(form).getByLabelText(/Checked on/)).toHaveValue("2026-10-24");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Reset clears the check-by-name form on screen, and its Undo brings the draft back", () => {
    useRefinementStore.setState({ history: [save("h1")] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Check a story by name" }));
    const form = () => screen.getByRole("button", { name: "Save check" }).closest("form")!;
    fireEvent.change(within(form()).getByLabelText(/Story name or ID/), {
      target: { value: "Half typed" },
    });
    fireEvent.click(within(form()).getByRole("checkbox", { name: C[0].label }));

    fireEvent.click(screen.getByRole("button", { name: "Reset checklist" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reset checklist" })
    );
    expect(within(form()).getByLabelText(/Story name or ID/)).toHaveValue("");
    expect(useRefinementStore.getState()).toMatchObject({ storyName: "", currentChecks: {} });
    // A later keystroke doesn't write the old draft back.
    fireEvent.change(within(form()).getByLabelText(/Description/), { target: { value: "x" } });
    expect(useRefinementStore.getState().storyName).toBe("");

    lastUndo().undo();
    expect(within(form()).getByLabelText(/Story name or ID/)).toHaveValue("Half typed");
    expect(within(form()).getByRole("checkbox", { name: C[0].label })).toBeChecked();
    expect(useRefinementStore.getState().storyName).toBe("Half typed");
  });

  it("puts focus back on Edit after editing an earlier check in place", () => {
    useRefinementStore.setState({ history: [save("h1", { storyName: "Login with SSO" })] });
    renderPage();
    const checks = () => screen.getByRole("list", { name: "Earlier checks" });
    fireEvent.click(within(checks()).getByRole("button", { name: "Edit Login with SSO" }));
    const name = within(checks()).getByLabelText(/Story name or ID/);
    fireEvent.change(name, { target: { value: "SSO login" } });
    fireEvent.click(within(checks()).getByRole("button", { name: "Save" }));
    expect(within(checks()).getByRole("button", { name: "Edit SSO login" })).toHaveFocus();

    fireEvent.click(within(checks()).getByRole("button", { name: "Edit SSO login" }));
    fireEvent.keyDown(within(checks()).getByLabelText(/Story name or ID/), { key: "Escape" });
    expect(within(checks()).getByRole("button", { name: "Edit SSO login" })).toHaveFocus();

    fireEvent.click(within(checks()).getByRole("button", { name: "Edit SSO login" }));
    fireEvent.click(within(checks()).getByRole("button", { name: "Cancel" }));
    expect(within(checks()).getByRole("button", { name: "Edit SSO login" })).toHaveFocus();
  });

  it("moves focus to the next story once, not on every later remount", () => {
    useWorkspaceStore.setState({
      stories: [
        story("a", { title: "First unsized", priorityScore: 90 }),
        story("b", { title: "Sized", points: 3, priorityScore: 80 }),
        story("c", { title: "Second unsized", priorityScore: 70 }),
      ],
    });
    renderPage();
    fireEvent.click(within(panel()).getByRole("button", { name: "Save checks" }));
    expect(within(panel()).getByRole("heading", { name: "Sized" })).toHaveFocus();

    // A filter remounts the panel on another story; focus stays on the filter.
    const filter = screen.getByRole("button", { name: "Needs points (2)" });
    filter.focus();
    fireEvent.click(filter);
    expect(within(panel()).getByRole("heading", { name: "First unsized" })).not.toHaveFocus();
    expect(filter).toHaveFocus();
    const all = screen.getByRole("button", { name: "All to refine (3)" });
    all.focus();
    fireEvent.click(all);
    expect(all).toHaveFocus();
  });

  it("ties a refused Mark ready to the controls, and focuses the points message", () => {
    useWorkspaceStore.setState({ stories: [story("a", { title: "Unsized story" })] });
    renderPage();
    fireEvent.click(within(panel()).getByRole("button", { name: "Mark ready" }));
    const first = within(panel()).getByRole("checkbox", { name: C[0].label });
    expect(first).toHaveFocus();
    expect(first).toHaveAccessibleDescription(/^2 of 2 criteria aren't ticked yet/);
    expect(
      within(panel()).getByRole("group", { name: "Definition of Ready" })
    ).toHaveAccessibleDescription(/^2 of 2 criteria aren't ticked yet/);
    expect(
      within(panel()).getByRole("button", { name: "Queue for Poker" })
    ).toHaveAccessibleDescription(
      "It has no points yet. Queue it for Planning Poker, then mark it ready."
    );

    // Every box ticked, only the points missing: the message takes focus, every time.
    fireEvent.click(first);
    fireEvent.click(within(panel()).getByRole("checkbox", { name: C[1].label }));
    fireEvent.click(within(panel()).getByRole("button", { name: "Mark ready" }));
    const message = within(panel()).getByText(/^It has no points yet/);
    expect(message).toHaveFocus();
    first.focus();
    fireEvent.click(within(panel()).getByRole("button", { name: "Mark ready" }));
    expect(message).toHaveFocus();
    expect(wsStory("a")?.readiness).toBeUndefined();
  });

  it("refuses renaming a criterion to one the list already has", () => {
    renderPage();
    const list = () => screen.getByRole("list", { name: "Definition of Ready criteria" });
    fireEvent.click(within(list()).getByRole("button", { name: `Edit ${C[1].label}` }));
    let title = screen.getByRole("textbox", { name: "Criterion" });
    fireEvent.change(title, { target: { value: "acceptance CRITERIA defined" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(useRefinementStore.getState().criteria.map((c) => c.label)).toEqual([
      C[0].label,
      C[1].label,
    ]);
    expect(toastSpy.error).toHaveBeenCalledWith(
      "“acceptance CRITERIA defined” is already on the list.",
      { description: `The criterion keeps its name, “${C[1].label}”.` }
    );

    // Its own name in other case is fine.
    fireEvent.click(within(list()).getByRole("button", { name: `Edit ${C[1].label}` }));
    title = screen.getByRole("textbox", { name: "Criterion" });
    fireEvent.change(title, { target: { value: "Fits in a Sprint" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(useRefinementStore.getState().criteria[1].label).toBe("Fits in a Sprint");
  });
});
