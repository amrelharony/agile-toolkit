/**
 * Flow Insights against the tool UX contract: an empty state with an
 * in-memory example; the verdict and the tiles; the board toggle and the
 * window; the mix bars, their words and the table; the target mix with its
 * checked form and Undo; sorting one item, "Repeat work", "Accept all
 * guesses" as one write with Undo, and the no-AI sort; team stability and
 * its notices; the Markdown without names; and the pure pieces under them.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  WORKFLOW_DEFINITION_ID,
  type CapacityPlan,
  type KanbanBoard,
  type KanbanCard,
  type Sprint,
  type Story,
} from "@/lib/stores/workspace-types";
import { capacityPlanIdFor } from "@/lib/sprints/capacity";
import { todayIso } from "@/lib/sprints/series";
import { addDays } from "@/lib/flow";
import { flowInsights, mixByPeriod } from "@/lib/flow/distribution";
import { targetSplitOf } from "@/lib/flow/work-types";
import { FLOW_INSIGHTS_ACTIONS } from "@/lib/history/event-actions";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/flow-insights",
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "t",
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { FlowInsightsClient } from "@/app/(tools)/flow-insights/flow-insights-client";
import { buildExample } from "@/app/(tools)/flow-insights/example";
import { toMarkdown } from "@/app/(tools)/flow-insights/markdown";
import {
  classifyPlan,
  segmentsOf,
  splitWords,
  typeWrite,
  undoChanges,
} from "@/app/(tools)/flow-insights/model";
import { suggestionChange } from "@/app/(tools)/flow-insights/components/sort-section";
import {
  DEFAULT_PREFS,
  normalizePrefs,
  useFlowInsightsPrefs,
} from "@/app/(tools)/flow-insights/store";

const TODAY = todayIso();
const day = (n: number) => addDays(TODAY, n) as string;

const sprint = (n: number, patch: Partial<Sprint> = {}): Sprint => {
  const end = day(-1 - (3 - n) * 14);
  return {
    id: `s${n}`,
    name: `Sprint ${n}`,
    startDate: addDays(end, -11) as string,
    endDate: end,
    pointsPlanned: 20,
    status: "completed",
    ...patch,
  };
};
const done = (id: string, n: number, patch: Partial<Story> = {}): Story => {
  const end = sprint(n).endDate;
  return {
    id,
    title: `Story ${id}`,
    status: "done",
    sprintId: `s${n}`,
    owner: "Ana",
    startedAt: `${addDays(end, -3)}T09:00:00.000Z`,
    doneAt: `${addDays(end, -1)}T15:00:00.000Z`,
    ...patch,
  };
};
const plan = (n: number, people: string[]): CapacityPlan => ({
  id: capacityPlanIdFor(`s${n}`),
  sprintId: `s${n}`,
  members: people.map((name) => ({ id: name, name, role: "Dev", availability: 100, daysOff: 0 })),
  config: {
    sprintDays: 10,
    ceremonyOverhead: 10,
    focusFactor: 0.8,
    hoursPerDay: 6,
    pointsCommitted: "",
  },
});
const card = (id: string, patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title: `Card ${id}`,
  column: "done",
  class: "standard",
  createdAt: day(-5),
  startedAt: `${day(-4)}T09:00:00.000Z`,
  completedAt: `${day(-2)}T09:00:00.000Z`,
  ...patch,
});
const board = (cards: KanbanCard[]): KanbanBoard => ({
  id: KANBAN_BOARD_ID,
  cards,
  wipLimits: { backlog: 0, ready: 0, in_progress: 3, review: 2, done: 0 },
});

const STORIES: Story[] = [
  done("a", 1, { workType: "feature" }),
  done("b", 1, { title: "Fix the totals" }),
  done("c", 2, { tags: ["refactor"], owner: "Ben" }),
  done("d", 3, { title: "Pay with a saved card", owner: "Cy" }),
  done("e", 3, { workType: "risk", owner: "Cy" }),
];

const ws = () => useWorkspaceStore.getState();
const seed = (patch: Partial<ReturnType<typeof ws>> = {}) =>
  useWorkspaceStore.setState({
    stories: STORIES,
    sprints: [sprint(1), sprint(2), sprint(3)],
    kanbanBoards: [],
    capacityPlans: [plan(1, ["Ana", "Ben"]), plan(2, ["Ana", "Ben"]), plan(3, ["Ana", "Cy"])],
    workflowDefinitions: [],
    ...patch,
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <FlowInsightsClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const story = (id: string) => ws().stories.find((s) => s.id === id);
const sortList = () => screen.getByRole("list", { name: "Items to sort" });

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  localStorage.clear();
  useFlowInsightsPrefs.setState({ ...DEFAULT_PREFS });
  useWorkspaceStore.setState({
    stories: [],
    sprints: [],
    kanbanBoards: [],
    capacityPlans: [],
    workflowDefinitions: [],
  });
});

/* ── Pure pieces ────────────────────────────────────────────────────── */

describe("writing types", () => {
  it("writes only the rows that change, and the board only when a card does", () => {
    const b = board([card("c1"), card("c2", { workType: "debt" })]);
    const w = typeWrite(STORIES, b, [
      { kind: "story", id: "a", type: "feature" },
      { kind: "story", id: "b", type: "defect" },
      { kind: "card", id: "c2", type: "debt" },
      { kind: "story", id: "nope", type: "risk" },
    ]);
    expect(w.stories.map((s) => s.id)).toEqual(["b"]);
    expect(w.board).toBeNull();
    expect(w.before).toEqual([
      {
        kind: "story",
        id: "b",
        type: undefined,
        demand: undefined,
        wroteType: "defect",
        wroteDemand: undefined,
      },
    ]);
    const withCard = typeWrite(STORIES, b, [{ kind: "card", id: "c1", demand: "failure" }]);
    expect(withCard.board?.cards[0]).toMatchObject({ id: "c1", demand: "failure" });
    expect(withCard.board?.cards[1]).toBe(b.cards[1]);
  });

  it("puts back only the rows still holding what the write wrote", () => {
    const w = typeWrite(STORIES, null, [
      { kind: "story", id: "b", type: "defect" },
      { kind: "story", id: "d", type: "feature" },
    ]);
    const after = STORIES.map((s) => w.stories.find((x) => x.id === s.id) ?? s);
    // "d" was changed again since, by hand.
    const since = after.map((s) => (s.id === "d" ? { ...s, workType: "risk" as const } : s));
    expect(undoChanges(w.before, since, null)).toEqual([
      { kind: "story", id: "b", type: null, demand: null },
    ]);
  });
});

describe("the bars", () => {
  const [p] = mixByPeriod({
    board: "sprint",
    stories: STORIES,
    sprints: [sprint(1)],
    cards: [],
  });

  it("has a segment per kind with work, the guessed part counted", () => {
    expect(segmentsOf(p)).toEqual([
      { key: "feature", count: 1, guessed: 0, pct: 50 },
      { key: "defect", count: 1, guessed: 1, pct: 50 },
    ]);
  });

  it("says its split in words, so colour is never the only cue", () => {
    expect(splitWords(p)).toBe("Feature 1, Defect 1 (1 guessed)");
  });
});

describe("the AI input", () => {
  it("sends short ids, a story's tags, a card's description and where it came from", () => {
    const stories = [
      done("x", 1, { tags: ["refactor", " "], sourceRef: { tool: "tech-debt", id: "t" } }),
    ];
    const cards = [
      card("k", {
        description: "Users see an error page",
        sourceRef: { tool: "bug-triage", id: "b" },
      }),
    ];
    const items = [
      ...mixByPeriod({ board: "sprint", stories, sprints: [sprint(1)], cards: [] })[0].items,
      ...mixByPeriod({ board: "flow", stories: [], sprints: [], cards })[0].items,
    ];
    const { input, byShortId } = classifyPlan(items, stories, cards);
    expect(input.items).toEqual([
      { id: "i1", title: "Story x", tags: ["refactor"], from: "tech-debt", reopened: false },
      {
        id: "i2",
        title: "Card k",
        text: "Users see an error page",
        tags: [],
        from: "bug-triage",
        reopened: false,
      },
    ]);
    expect(byShortId.get("i2")).toEqual({ kind: "card", id: "k" });
  });

  it("marks repeat work only when a defect doesn't already imply it", () => {
    const base = { kind: "story" as const, id: "x", title: "X", reason: "r" };
    expect(suggestionChange({ ...base, type: "feature", failure: true })).toEqual({
      kind: "story",
      id: "x",
      type: "feature",
      demand: "failure",
    });
    expect(suggestionChange({ ...base, type: "defect", failure: true })).not.toHaveProperty(
      "demand"
    );
  });
});

describe("the prefs", () => {
  it("read back only the choices the page offers", () => {
    expect(normalizePrefs({ board: "flow", sprintWindow: 12, weekWindow: 26 })).toEqual({
      board: "flow",
      sprintWindow: 12,
      weekWindow: 26,
    });
    expect(normalizePrefs({ board: "kanban", sprintWindow: 5, weekWindow: "x" })).toEqual(
      DEFAULT_PREFS
    );
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
  });
});

describe("the example", () => {
  const ex = buildExample(TODAY);
  const x = flowInsights({
    board: "sprint",
    stories: ex.stories,
    sprints: ex.sprints,
    cards: [],
    plans: ex.plans,
    workflow: ex.workflow,
    periods: 6,
    today: TODAY,
    now: Date.now(),
    includeExamples: true,
  });

  it("is six finished sprints of example rows, with their own plans and a target", () => {
    expect(ex.sprints).toHaveLength(6);
    expect(ex.sprints.every((s) => s.id.startsWith("example-") && s.status === "completed")).toBe(
      true
    );
    expect(ex.stories.every((s) => s.id.startsWith("example-"))).toBe(true);
    expect(ex.plans).toHaveLength(6);
    expect(targetSplitOf(ex.workflow)).toEqual({ feature: 60, defect: 15, debt: 15, risk: 10 });
    expect(x.periods.map((p) => p.finished).every((n) => n >= 8 && n <= 12)).toBe(true);
  });

  it("drifts towards repeat work after the team changed in sprint 4", () => {
    const first = x.periods[0];
    const last = x.periods[5];
    expect(last.counts.defect / last.finished > first.counts.defect / first.finished).toBe(true);
    const change = x.stability.rows.filter((r) => r.joined.length || r.left.length);
    expect(change.map((r) => [r.name, r.joined, r.left])).toEqual([
      ["Checkout sprint 4", ["Fay"], ["Eli"]],
    ]);
    expect(x.periods.flatMap((p) => p.items).filter((i) => i.reopened)).toHaveLength(2);
    expect(x.totals.unsorted).toBeGreaterThan(0);
  });

  it("exports counts, never who joined or left", () => {
    const md = toMarkdown(x, TODAY);
    expect(md).toMatch(/^# Flow Insights — /);
    expect(md).toContain("## Work mix");
    expect(md).toContain(
      "| Sprint | Finished | Feature | Defect | Debt | Risk | Not sorted | Failure demand |"
    );
    expect(md).toContain("## Against the target");
    expect(md).toContain("| Feature | 60% |");
    expect(md).toContain("## Team stability");
    expect(md).toContain("| Checkout sprint 4 | 5 | 4 | 1 | 1 | 67% |");
    expect(md).not.toMatch(/\b(Eli|Fay|Ana|Ben)\b/);
    expect(md).toContain("## Data notes");
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the empty state and the example", () => {
  it("offers the example, which never reaches the workspace, and clears it", async () => {
    renderPage();
    expect(await screen.findByText(/Finish work on the Sprint or Flow board/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getAllByText(/items finished over the last 6 sprints/)[0].tagName).toBe("P");
    expect(ws().stories).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(await screen.findByText(/Finish work on the Sprint or Flow board/)).toBeInTheDocument();
  });

  it("sorts inside the example's copy only, and logs nothing", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Load an example" }));
    const select = within(sortList()).getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "debt" } });
    fireEvent.click(within(sortList()).getAllByRole("button", { name: /^Set the type of/ })[0]);
    expect(screen.getByText(/as debt\./)).toBeInTheDocument();
    expect(ws().stories).toEqual([]);
    expect(logs).toEqual([]);
  });
});

describe("the read", () => {
  it("shows the verdict and the tiles, with links to go deeper", async () => {
    seed();
    renderPage();
    expect(
      await screen.findByText(/^5 items finished over the last 3 sprints/)
    ).toBeInTheDocument();
    const glance = document.querySelector<HTMLElement>('dl[aria-label="At a glance"]')!;
    expect(within(glance).getByText("Repeat work")).toBeInTheDocument();
    expect(within(glance).getByRole("link", { name: "Cycle Time" })).toHaveAttribute(
      "href",
      "/cycle-time"
    );
    expect(within(glance).getByRole("link", { name: "Impediments" })).toHaveAttribute(
      "href",
      "/impediments"
    );
    expect(within(glance).getByRole("link", { name: "Capacity Planner" })).toHaveAttribute(
      "href",
      "/capacity-planner"
    );
  });

  it("draws a bar per sprint, newest first, each saying its split", async () => {
    seed();
    renderPage();
    const bars = await screen.findByRole("list", { name: "Work mix per sprint, newest first" });
    const items = within(bars).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Sprint 3");
    expect(items[0]).toHaveTextContent("Risk 1, Not sorted 1");
    expect(items[2]).toHaveTextContent("Feature 1, Defect 1 (1 guessed)");
    expect(
      screen.getByRole("table", { name: "Finished work by kind, per sprint" })
    ).toBeInTheDocument();
  });

  it("switches to the Flow board, per week, and remembers it", async () => {
    seed({ kanbanBoards: [board([card("c1", { workType: "debt" })])] });
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: "Flow board" }));
    expect(
      (await screen.findAllByText(/^1 item finished over the last \d+ weeks?/))[0].tagName
    ).toBe("P");
    expect(useFlowInsightsPrefs.getState().board).toBe("flow");
    expect(
      screen.getByRole("list", { name: "Work mix per week, newest first" })
    ).toBeInTheDocument();
  });

  it("reads a shorter window", async () => {
    seed();
    renderPage();
    fireEvent.change(await screen.findByLabelText("Window"), { target: { value: "3" } });
    expect(useFlowInsightsPrefs.getState().sprintWindow).toBe(3);
    expect(screen.getAllByText(/over the last 3 sprints/)[0].tagName).toBe("P");
  });
});

describe("the target mix", () => {
  it("refuses four numbers that don't add up to 100", async () => {
    seed();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Set a target" }));
    fireEvent.change(screen.getByLabelText("Feature %"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Defect %"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Debt %"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Risk %"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(await screen.findByText(/The four add up to 80./)).toBeInTheDocument();
    expect(ws().workflowDefinitions).toEqual([]);
  });

  it("saves the target on the workflow definition, shows the gaps, and undoes", async () => {
    seed();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Set a target" }));
    for (const [label, v] of [
      ["Feature %", "60"],
      ["Defect %", "15"],
      ["Debt %", "15"],
      ["Risk %", "10"],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    const def = ws().workflowDefinitions?.find((d) => d.id === WORKFLOW_DEFINITION_ID);
    expect(targetSplitOf(def)).toEqual({ feature: 60, defect: 15, debt: 15, risk: 10 });
    expect(logs.at(-1)).toEqual({
      action: FLOW_INSIGHTS_ACTIONS.TARGET_SPLIT_SET,
      payload: { feature: 60, defect: 15, debt: 15, risk: 10 },
    });
    const gaps = await screen.findByRole("list", { name: "Against the target" });
    expect(within(gaps).getByText("Risk 25% vs 10% target")).toBeInTheDocument();
    undoLast();
    expect(targetSplitOf(ws().workflowDefinitions?.[0])).toBeNull();
  });
});

describe("sorting the work", () => {
  it("writes one item's type with Undo, and says so", async () => {
    seed();
    renderPage();
    const row = within(await screen.findByRole("list", { name: "Items to sort" }));
    const set = row.getByRole("button", { name: "Set the type of Pay with a saved card" });
    expect(set).toBeDisabled();
    fireEvent.change(row.getByRole("combobox", { name: "Type of Pay with a saved card" }), {
      target: { value: "feature" },
    });
    // Choosing writes nothing (an arrow key on a closed select changes it): Set does.
    expect(story("d")).not.toHaveProperty("workType");
    fireEvent.click(set);
    expect(story("d")?.workType).toBe("feature");
    expect(screen.getByText("Sorted “Pay with a saved card” as feature.")).toBeInTheDocument();
    expect(logs.at(-1)).toEqual({
      action: FLOW_INSIGHTS_ACTIONS.WORK_TYPE_SET,
      payload: { id: "d", kind: "story", type: "feature" },
    });
    undoLast();
    expect(story("d")).not.toHaveProperty("workType");
  });

  it("moves focus to the next item once one is sorted, then to the list's last line", async () => {
    seed();
    renderPage();
    await screen.findByRole("list", { name: "Items to sort" });
    const sortOne = async () => {
      const first = within(sortList()).getAllByRole("combobox")[0];
      fireEvent.change(first, { target: { value: "feature" } });
      fireEvent.click(within(sortList()).getAllByRole("button", { name: /^Set the type of/ })[0]);
    };
    const count = within(sortList()).getAllByRole("combobox").length;
    for (let n = 1; n < count; n++) {
      await sortOne();
      await waitFor(() => expect(within(sortList()).getAllByRole("combobox")[0]).toHaveFocus());
    }
    await sortOne();
    await waitFor(() =>
      expect(screen.getByText(/^Every finished item in the window has a type/)).toHaveFocus()
    );
  });

  it("marks repeat work, and takes it back", async () => {
    seed();
    renderPage();
    await screen.findByRole("list", { name: "Items to sort" });
    const toggles = within(sortList()).getAllByRole("button", { name: "Repeat work" });
    const unpressed = toggles.find((b) => b.getAttribute("aria-pressed") === "false")!;
    fireEvent.click(unpressed);
    expect(ws().stories.filter((s) => s.demand === "failure")).toHaveLength(1);
    undoLast();
    expect(ws().stories.filter((s) => s.demand)).toHaveLength(0);
  });

  it("accepts all guesses in one write, with one Undo", async () => {
    seed({ kanbanBoards: [board([card("c1", { sourceRef: { tool: "bug-triage", id: "b" } })])] });
    renderPage();
    let storyWrites = 0;
    let boardWrites = 0;
    const unsub = useWorkspaceStore.subscribe((s, prev) => {
      if (s.stories !== prev.stories) storyWrites++;
      if (s.kanbanBoards !== prev.kanbanBoards) boardWrites++;
    });
    fireEvent.click(await screen.findByRole("button", { name: "Accept all guesses (2)" }));
    unsub();
    expect(storyWrites).toBe(1);
    expect(boardWrites).toBe(0);
    expect(story("b")?.workType).toBe("defect");
    expect(story("c")?.workType).toBe("debt");
    expect(logs.at(-1)).toMatchObject({
      action: FLOW_INSIGHTS_ACTIONS.WORK_TYPES_SORTED,
      payload: { count: 2, source: "guesses" },
    });
    undoLast();
    expect(story("b")).not.toHaveProperty("workType");
    expect(story("c")).not.toHaveProperty("workType");
  });

  it("leaves a row changed since alone on Undo", async () => {
    seed();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Accept all guesses (2)" }));
    act(() => ws().upsertStory({ ...story("b")!, workType: "risk" }));
    undoLast();
    expect(story("b")?.workType).toBe("risk");
    expect(story("c")).not.toHaveProperty("workType");
  });

  it("sorts by keywords without AI, for the person to accept one or all", async () => {
    seed();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Sort by keywords" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(within(list).getByText(/Suggested without AI/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: /^Accept: Fix the totals: Defect/ }));
    expect(story("b")?.workType).toBe("defect");
    fireEvent.click(within(list).getByRole("button", { name: /^Accept all/ }));
    await waitFor(() => expect(story("d")?.workType).toBe("feature"));
    expect(story("c")?.workType).toBe("debt");
  });
});

describe("team stability", () => {
  it("lists who joined and left, with the forecast note after a recent change", async () => {
    seed();
    renderPage();
    const table = await screen.findByRole("table", { name: /Who was in each sprint/ });
    const last = within(table).getByRole("row", { name: /Sprint 3/ });
    expect(last).toHaveTextContent("Cy");
    expect(last).toHaveTextContent("Ben");
    expect(last).toHaveTextContent("33%");
    expect(screen.getByText(/Forecasts lean on sprints before the change/)).toBeInTheDocument();
  });

  it("says the rows are rough without each sprint's own plan", async () => {
    seed({ capacityPlans: [] });
    renderPage();
    expect(await screen.findByText(/Rough rows have no capacity plan/)).toBeInTheDocument();
  });

  it("points at the Capacity Planner when no sprint has finished", async () => {
    seed({ sprints: [], kanbanBoards: [board([card("c1")])] });
    renderPage();
    expect(
      await screen.findByText(/No finished sprints yet, so there is no team to compare/)
    ).toBeInTheDocument();
  });
});

describe("repeat work", () => {
  it("shows the latest period's repeat work with why, and where to take it", async () => {
    seed({ stories: [...STORIES, done("f", 3, { title: "Bug: VAT rounding" })] });
    renderPage();
    expect(await screen.findByText("Repeat work in Sprint 3")).toBeInTheDocument();
    expect(screen.getByText("(a defect)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find the cause with Root Cause" })).toHaveAttribute(
      "href",
      "/root-cause"
    );
    expect(screen.getByRole("link", { name: "Take it to the retro" })).toHaveAttribute(
      "href",
      "/retro"
    );
    expect(screen.getByText(/more sprints to see a trend in repeat work/)).toBeInTheDocument();
  });

  it("exports Markdown with counts and no names", async () => {
    seed();
    renderPage();
    const md = (await screen.findByTestId("export-markdown")).textContent ?? "";
    expect(md).toContain("## Team stability");
    expect(md).not.toMatch(/\b(Ana|Ben|Cy)\b/);
  });
});
