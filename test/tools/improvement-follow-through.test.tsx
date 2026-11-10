import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Impediment,
  RetroBoard,
  RetroCard,
  Sprint,
  SprintGoal,
  Story,
  Workspace,
} from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { goalDocId } from "@/lib/sprints/goal-doc";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { getNextStepRule } from "@/lib/tools/next-steps";

/**
 * Improvement work, followed past the retro: the cockpit's cards (a closed
 * sprint's goal still unanswered, "N of M retro actions are in this
 * sprint", no improvement item in the sprint), the cockpit's next step for
 * the unanswered goal, and the retros' follow-through beside say/do in
 * Sprint Metrics. Cards and a line on a page: never a toast.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test" }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/app/(tools)/burndown/charts", () => ({ BurndownChart: () => null }));
vi.mock("@/app/(tools)/sprint-metrics/charts", () => ({
  SayDoChart: () => null,
  ChurnChart: () => null,
}));
vi.mock("@/lib/sprints/use-ceremony-cadence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sprints/use-ceremony-cadence")>();
  const { DEFAULT_CADENCE: d } = await import("@/lib/sprints/cadence");
  // The next-step rules read the stored cadence through the real selector.
  return { ...actual, useCeremonyCadence: () => [d, () => {}] };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { cockpitNotes, gatherCockpitData, type CockpitSources } from "@/app/(tools)/sprint/view";
import { cockpitMarkdown } from "@/app/(tools)/sprint/markdown";
import { SprintCockpit } from "@/app/(tools)/sprint/cockpit";
import { SprintMetricsClient } from "@/app/(tools)/sprint-metrics/sprint-metrics-client";
import { toMarkdown } from "@/app/(tools)/sprint-metrics/markdown";
import { followThroughText, retroFollowThrough } from "@/app/(tools)/sprint-metrics/view";
import { sprintTrends } from "@/lib/sprints/trends";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

const TODAY = "2026-10-22";

const S1: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-01",
  endDate: "2026-10-14",
  goal: "Search finds every product",
  pointsPlanned: 20,
  pointsCompleted: 18,
  status: "completed",
};
const S2: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-15",
  endDate: "2026-10-28",
  goal: "Checkout works end to end",
  pointsPlanned: 30,
  status: "active",
};

const card = (id: string, text: string, extra: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text,
  votes: 0,
  groupedWith: null,
  isActionItem: true,
  assignee: "",
  discussing: false,
  ...extra,
});
const board = (id: string, cards: RetroCard[], extra: Partial<RetroBoard> = {}): RetroBoard => ({
  id,
  format: retroFormats[0],
  phase: "actions",
  cards,
  userVotes: 0,
  timerSeconds: 300,
  timerRunning: false,
  discussingIndex: 0,
  ...extra,
});
const sentToStory = (targetId: string) => ({
  sentTo: [{ route: "backlog-story" as const, targetId, at: "2026-10-15" }],
});

const RETRO = board("retro:current", [
  card("a1", "Pair on flaky tests", sentToStory("st1")),
  card("a2", "Write the deploy runbook"),
  card("a3", "Tidy the board"),
]);
const IN_SPRINT: Story = {
  id: "st1",
  title: "Pair on flaky tests",
  status: "in_progress",
  sprintId: "s2",
  sourceRef: { tool: "retro", id: "a1", doc: "retro:current" },
};
const PLAIN: Story = { id: "p1", title: "Pay with a saved card", status: "todo", sprintId: "s2" };
const IMP: Impediment = { id: "i1", title: "VPN drops", severity: "high", raisedAt: "2026-10-16" };

const sources = (over: Partial<CockpitSources> = {}): CockpitSources => ({
  sprint: S2,
  series: undefined,
  stories: [PLAIN],
  impediments: [],
  standupEntries: [],
  teamMembers: [],
  retroBoards: [],
  reviews: [],
  sprints: [S1, S2],
  today: TODAY,
  goals: [],
  ...over,
});
const notes = (over: Partial<CockpitSources> = {}) =>
  cockpitNotes(gatherCockpitData(sources(over)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
  toastSpy.mockClear();
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/sprint");
  useSprintMigrationStore.setState({ status: "idle" });
});
afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    sprints: [],
    sprintSeries: [],
    stories: [],
    retroBoards: [],
    impediments: [],
    sprintGoals: [],
  });
});

/* ── The cockpit's cards ─────────────────────────────────────────────── */

describe("cockpitNotes", () => {
  it("is empty for a sprint with nothing to raise", () => {
    expect(notes()).toEqual([]);
  });

  it("asks for the goal answer on a closed sprint that has a goal and none yet", () => {
    const [note, ...rest] = notes({ sprint: S1, stories: [] });
    expect(rest).toEqual([]);
    expect(note).toEqual({
      id: "goal-answer",
      tone: "warning",
      title: "Sprint 1 closed without an answer to “Did we meet the sprint goal?”",
      detail:
        "Its goal: “Search finds every product”. The Sprint Review, the retro and Sprint Comparison read the answer.",
      href: "/sprint-goal?sprint=s1",
      cta: "Answer it in Sprint Goal",
    });
  });

  it("stops asking once it is answered, and never asks while the sprint is open or has no goal", () => {
    const answered: SprintGoal = {
      id: goalDocId("s1"),
      sprintId: "s1",
      businessObjective: "",
      goal: "Search finds every product",
      criteria: [],
      keyResults: [],
      outcome: { met: "partly", decidedAt: "2026-10-14T16:00:00.000Z" },
    };
    expect(notes({ sprint: S1, stories: [], goals: [answered] })).toEqual([]);
    expect(notes({ sprint: { ...S1, goal: undefined }, stories: [] })).toEqual([]);
    // An open sprint with a goal: the close dialog will ask.
    expect(notes().some((n) => n.id === "goal-answer")).toBe(false);
    // A preview has no goals to read (the example): nothing to ask.
    expect(notes({ sprint: S1, stories: [], goals: undefined })).toEqual([]);
  });

  it("asks a cancelled sprint too, as the Sprint Goal page does", () => {
    expect(notes({ sprint: { ...S1, status: "cancelled" }, stories: [] })[0]?.id).toBe(
      "goal-answer"
    );
  });

  it("counts the last retro's actions that are in the sprint", () => {
    const [note] = notes({ retroBoards: [RETRO], stories: [PLAIN, IN_SPRINT] });
    expect(note).toEqual({
      id: "improvement-in",
      tone: "info",
      title: "1 of 3 retro actions is in this sprint",
      detail: "2 more are still open. Each closes when its story is done.",
      href: "/sprint-planning?sprint=s2",
      cta: "Add the rest in Sprint Planning",
    });
  });

  it("keeps counting an action its story has finished in this sprint", () => {
    const both = board("retro:current", [
      card("a1", "Pair on flaky tests", sentToStory("st1")),
      card("a2", "Write the deploy runbook", sentToStory("st2")),
    ]);
    const [note] = notes({
      retroBoards: [both],
      stories: [
        { ...IN_SPRINT, status: "done" },
        { id: "st2", title: "Write the deploy runbook", status: "todo", sprintId: "s2" },
      ],
    });
    expect(note).toMatchObject({
      id: "improvement-in",
      title: "2 of 2 retro actions are in this sprint",
      detail: "Each closes when its story is done.",
      cta: "See them in Sprint Planning",
    });
  });

  it("says when no improvement item is in the sprint, and what could be added", () => {
    const [note] = notes({ retroBoards: [RETRO], impediments: [IMP] });
    expect(note).toEqual({
      id: "improvement-none",
      tone: "warning",
      title: "No improvement item is in this sprint",
      detail:
        "3 retro actions and 1 impediment are open. Add one, so the sprint improves how the team works.",
      href: "/sprint-planning?sprint=s2",
      cta: "Add one in Sprint Planning",
    });
    expect(notes({ impediments: [IMP] })[0]?.detail).toMatch(/^1 impediment is open\./);
  });

  it("counts a story planned from an impediment as improvement work", () => {
    const fromImpediment: Story = {
      id: "st-i",
      title: "VPN drops",
      status: "todo",
      sprintId: "s2",
      sourceRef: { tool: "impediments", id: "i1" },
    };
    expect(notes({ retroBoards: [RETRO], impediments: [IMP], stories: [fromImpediment] })).toEqual(
      []
    );
  });

  it("doesn't nag a planned sprint nobody has started planning, nor a closed one", () => {
    const planned: Sprint = { ...S2, status: "planned" };
    expect(notes({ sprint: planned, stories: [], retroBoards: [RETRO] })).toEqual([]);
    expect(
      notes({ sprint: planned, stories: [{ ...PLAIN }], retroBoards: [RETRO] }).map((n) => n.id)
    ).toEqual(["improvement-none"]);
    expect(
      notes({ sprint: { ...S1, goal: undefined }, stories: [], retroBoards: [RETRO] })
    ).toEqual([]);
  });

  it("has nothing to say with no open action or impediment to add", () => {
    const done = board("retro:current", [card("a1", "Done already", { done: true })]);
    expect(notes({ retroBoards: [done] })).toEqual([]);
  });

  it("puts the improvement line in the sprint report, under the retro", () => {
    const report = (over: Partial<CockpitSources>) =>
      cockpitMarkdown({
        data: gatherCockpitData(sources(over)),
        series: undefined,
        sprints: [S1, S2],
        today: TODAY,
      });
    expect(report({ retroBoards: [RETRO], stories: [PLAIN, IN_SPRINT] })).toContain(
      "**Improvement work:** 1 of 3 retro actions is in this sprint."
    );
    expect(report({ retroBoards: [RETRO] })).toContain(
      "**Improvement work:** No improvement item is in this sprint."
    );
    expect(report({})).not.toContain("Improvement work");
    // The unanswered goal is a card to act on, not a line for stakeholders.
    expect(report({ sprint: S1, stories: [] })).not.toContain("Improvement work");
  });
});

describe("the cockpit shows its notes as cards", () => {
  const seed = (over: Partial<Workspace> = {}) =>
    useWorkspaceStore.setState({
      sprints: [S1, S2],
      sprintSeries: [],
      stories: [PLAIN],
      impediments: [],
      teamMembers: [],
      standupEntries: [],
      asyncUpdates: [],
      retroBoards: [RETRO],
      sprintReviews: [],
      sprintGoals: [],
      ...over,
    });
  const list = () => screen.getByRole("list", { name: "Worth a look" });

  it("shows the improvement card on the running sprint, and updates when an action is planned in", () => {
    seed();
    render(<SprintCockpit />);
    expect(within(list()).getByText("No improvement item is in this sprint")).toBeInTheDocument();
    expect(
      within(list()).getByRole("link", { name: "Add one in Sprint Planning" })
    ).toHaveAttribute("href", "/sprint-planning?sprint=s2");

    act(() => useWorkspaceStore.getState().upsertStory(IN_SPRINT));
    expect(within(list()).getByText("1 of 3 retro actions is in this sprint")).toBeInTheDocument();
    expect(within(list()).queryByText("No improvement item is in this sprint")).toBeNull();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("shows the goal card on a closed sprint until the answer is recorded", () => {
    seed({ retroBoards: [] });
    window.history.replaceState(null, "", "/sprint?sprint=s1");
    render(<SprintCockpit />);
    expect(
      within(list()).getByText(
        "Sprint 1 closed without an answer to “Did we meet the sprint goal?”"
      )
    ).toBeInTheDocument();
    expect(within(list()).getByRole("link", { name: "Answer it in Sprint Goal" })).toHaveAttribute(
      "href",
      "/sprint-goal?sprint=s1"
    );

    act(() =>
      useWorkspaceStore.getState().upsertSprintGoal({
        id: goalDocId("s1"),
        sprintId: "s1",
        businessObjective: "",
        goal: "Search finds every product",
        criteria: [],
        keyResults: [],
        outcome: { met: "met", decidedAt: "2026-10-22T09:00:00.000Z" },
      })
    );
    expect(screen.queryByRole("list", { name: "Worth a look" })).toBeNull();
  });
});

/* ── The cockpit's next step ─────────────────────────────────────────── */

describe("sprint (cockpit) next step: an unanswered goal", () => {
  const steps = (ws: Partial<Workspace>) => {
    const rule = getNextStepRule("sprint")!;
    return rule.steps(rule.select(ws as Workspace));
  };

  it("nudges the last closed sprint's goal when no sprint is open", () => {
    const [step, ...rest] = steps({ sprints: [S1], sprintGoals: [] });
    expect(rest).toEqual([]);
    expect(step).toEqual({
      id: "cockpit-goal-answer",
      label: "Answer whether Sprint 1 met its goal",
      detail:
        "It closed without an answer to “Did we meet the sprint goal?”. The Sprint Review, the retro and Sprint Comparison read it.",
      href: "/sprint-goal?sprint=s1",
    });
  });

  it("comes after what the running sprint needs today", () => {
    // Mid-afternoon: no ceremony within the hour to offer the timer for.
    vi.setSystemTime(new Date(`${TODAY}T14:00:00`));
    const blocked: Story = { ...PLAIN, blocked: true };
    expect(
      steps({ sprints: [S1, S2], stories: [blocked], impediments: [], sprintReviews: [] }).map(
        (s) => s.id
      )
    ).toEqual(["cockpit-blocked", "cockpit-goal-answer"]);
  });

  it("only asks about the newest closed sprint, and not once it is answered", () => {
    const older: Sprint = { ...S1, id: "s0", name: "Sprint 0", endDate: "2026-09-30" };
    const newest: Sprint = { ...S1, goal: undefined };
    // The newest closed sprint has no goal: the older one isn't dug up.
    expect(steps({ sprints: [older, newest] })).toEqual([]);
    const answered: SprintGoal = {
      id: goalDocId("s1"),
      sprintId: "s1",
      businessObjective: "",
      goal: "Search finds every product",
      criteria: [],
      keyResults: [],
      outcome: { met: "not-met", decidedAt: "2026-10-14T16:00:00.000Z" },
    };
    expect(steps({ sprints: [S1], sprintGoals: [answered] })).toEqual([]);
    // An example sprint is never the team's to answer for.
    expect(steps({ sprints: [{ ...S1, id: "example-s1" }] })).toEqual([]);
  });
});

/* ── Follow-through beside say/do ────────────────────────────────────── */

describe("retro follow-through in Sprint Metrics", () => {
  const archived = (n: number, cards: RetroCard[]) => {
    const at = `2026-0${n}-10T10:00:00.000Z`;
    return board(`retro:${at}`, cards, { archivedAt: at });
  };
  /** Three settled retros (4 of 6 done) and the latest, which isn't rated yet. */
  const BOARDS: RetroBoard[] = [
    archived(1, [card("r1a", "A", { done: true }), card("r1b", "B")]),
    archived(2, [card("r2a", "A", { done: true }), card("r2b", "B", { done: true })]),
    archived(3, [card("r3a", "A", sentToStory("st-done")), card("r3b", "B")]),
    archived(4, [card("r4a", "A"), card("r4b", "B")]),
  ];
  const storyDone = (link: { targetId: string }) => link.targetId === "st-done";

  it("rates the settled retros in the window, leaving out the one still being followed up", () => {
    expect(retroFollowThrough(BOARDS, null, storyDone)).toEqual({
      retros: 3,
      agreed: 6,
      done: 4,
      pct: 67,
    });
    // The window is in retros, newest last.
    expect(retroFollowThrough(BOARDS, 2, storyDone)).toMatchObject({
      retros: 2,
      agreed: 4,
      done: 3,
    });
    // Without the story being done, that action is open.
    expect(retroFollowThrough(BOARDS, null)).toMatchObject({ done: 3, pct: 50 });
  });

  it("gives no percentage on too few actions, and says when nothing can be rated", () => {
    const few = retroFollowThrough(BOARDS.slice(0, 2), null);
    expect(few).toEqual({ retros: 1, agreed: 2, done: 1, pct: null });
    expect(followThroughText(few)).toBe("1 of 2 actions done at the last retro");
    expect(followThroughText(retroFollowThrough([], null))).toBe(
      "No past retro with actions to rate yet"
    );
    expect(followThroughText(retroFollowThrough(BOARDS, null, storyDone))).toBe(
      "67% · 4 of 6 actions done over the last 3 retros"
    );
  });

  it("stands beside say/do on the page and in the export", () => {
    const sprint = (n: number): Sprint => ({
      id: `m${n}`,
      name: `Sprint ${n}`,
      startDate: `2026-0${n}-01`,
      endDate: `2026-0${n}-14`,
      pointsPlanned: 30,
      pointsCompleted: 27,
      status: "completed",
    });
    useWorkspaceStore.setState({
      sprints: [1, 2, 3, 4].map(sprint),
      sprintSeries: [],
      stories: [{ id: "st-done", title: "A", status: "done" }],
      retroBoards: BOARDS,
      impediments: [],
      kanbanBoards: [],
    });
    const { container } = render(<SprintMetricsClient />);
    const item = container.querySelector('[data-field="retro-follow-through"]')!;
    expect(item).toHaveTextContent("Retro follow-through");
    expect(item).toHaveTextContent("67% · 4 of 6 actions done over the last 3 retros");
    expect(
      within(item as HTMLElement).getByRole("link", { name: "Retro Actions" })
    ).toHaveAttribute("href", "/retro-actions");
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "- **Retro follow-through:** 67% · 4 of 6 actions done over the last 3 retros"
    );
  });

  it("is left out of the Markdown when it isn't given", () => {
    const summary = sprintTrends({ sprints: [], stories: [], series: [], window: 3 });
    expect(toMarkdown(summary)).not.toContain("Retro follow-through");
  });
});
