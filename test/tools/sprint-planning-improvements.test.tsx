import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Impediment,
  RetroBoard,
  RetroCard,
  Sprint,
  Story,
} from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { collectRetroActions } from "@/lib/retro/actions";
import {
  improvementsFor,
  impedimentStory,
  isImprovementStory,
  linkedStory,
  storyPlace,
} from "@/lib/retro/improvement";

/**
 * "From the last retro" in Sprint Planning: the last retro's open actions
 * and the open impediments, each with "Add to this sprint". Adding makes a
 * story in the sprint that links back, with Undo; a retro action closes when
 * its story is done and reads as open again if the story is deleted; an
 * impediment stays open. The example plan does the same in memory.
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
const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "test",
  }),
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
import { buildExample } from "@/app/(tools)/sprint-planning/example";
import { addMode, improvementsHeading, placeText } from "@/app/(tools)/sprint-planning/view";
import { createExampleStore, exampleWriter } from "@/app/(tools)/sprint-planning/writer";

const TODAY = "2026-10-22";

const sprint = (id: string, patch: Partial<Sprint> = {}): Sprint => ({
  id,
  name: `Sprint ${id.slice(1)}`,
  startDate: "2026-10-19",
  endDate: "2026-11-01",
  pointsPlanned: 0,
  status: "planned",
  ...patch,
});
const S1 = sprint("s1", {
  startDate: "2026-10-05",
  endDate: "2026-10-18",
  pointsPlanned: 20,
  pointsCompleted: 18,
  status: "completed",
});
const S2 = sprint("s2");

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

const OLD_ID = "retro:2026-10-04T10:00:00.000Z";
const OLD = board(OLD_ID, [card("o1", "Rotate the on-call earlier")], {
  archivedAt: "2026-10-04T10:00:00.000Z",
});
const CURRENT = board("retro:current", [
  card("a1", "Pair on flaky tests", { assignee: "Sam", dueDate: "2026-10-30" }),
  card("a2", "Write the deploy runbook"),
  card("a3", "Thank the platform team", { done: true, doneAt: "2026-10-20T09:00:00.000Z" }),
  card("n1", "Demo on Fridays", { isActionItem: false }),
]);

const IMPEDIMENTS: Impediment[] = [
  {
    id: "imp1",
    title: "VPN drops every hour",
    severity: "high",
    raisedAt: "2026-10-16",
    owner: "Bo",
  },
  {
    id: "imp2",
    title: "Staging was down",
    severity: "low",
    raisedAt: "2026-10-10",
    resolvedAt: "2026-10-12",
  },
];

const STORIES: Story[] = [
  { id: "in-1", title: "Pay with a saved card", status: "todo", sprintId: "s2", points: 8 },
  { id: "b1", title: "Remove a saved card", status: "backlog", points: 5 },
];

const state = () => useWorkspaceStore.getState();
const stories = () => state().stories;
const currentCard = (id: string) =>
  state()
    .retroBoards?.find((b) => b.id === "retro:current")
    ?.cards.find((c) => c.id === id);
const renderPlanning = () =>
  render(
    <TooltipProvider>
      <SprintPlanning />
    </TooltipProvider>
  );
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => act(() => lastToast()[1].action.onClick());
const panel = () => screen.getByRole("region", { name: /^From the last retro/ });
const rowOf = (title: string) => within(panel()).getByText(title).closest("li")!;
const addButton = (title: string) =>
  within(panel()).getByRole("button", { name: `Add to this sprint: ${title}` });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
  toastSpy.mockClear();
  logs.length = 0;
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({
    sprints: [S1, S2],
    sprintSeries: [],
    stories: STORIES.map((s) => ({ ...s })),
    backlogItems: [],
    capacityPlans: [],
    pokerEstimationLogs: [],
    whiteboardObjects: [],
    retroBoards: [OLD, CURRENT].map((b) => ({ ...b, cards: b.cards.map((c) => ({ ...c })) })),
    impediments: IMPEDIMENTS.map((i) => ({ ...i })),
    kanbanBoards: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    sprints: [],
    stories: [],
    backlogItems: [],
    capacityPlans: [],
    retroBoards: [],
    impediments: [],
  });
});

/* ── The reading ─────────────────────────────────────────────────────── */

describe("improvementsFor", () => {
  const read = (patch: Partial<Parameters<typeof improvementsFor>[0]> = {}) =>
    improvementsFor({
      sprint: S2,
      sprints: [S1, S2],
      retroBoards: [OLD, CURRENT],
      impediments: IMPEDIMENTS,
      stories: STORIES,
      today: TODAY,
      ...patch,
    });

  it("takes the open actions of the last retro that agreed one, and counts the earlier ones", () => {
    const i = read();
    expect(i.retroLabel).toBe("Current retro");
    expect(i.actions.map((a) => a.action.id)).toEqual(["a1", "a2"]);
    expect(i.actions.every((a) => a.place.where === "none")).toBe(true);
    expect(i.earlierOpen).toBe(1);
    expect(improvementsHeading(i)).toEqual({
      lead: "From the last retro",
      counts: "2 open actions, 1 open impediment",
    });
  });

  it("falls back to the newest archive when the current board has no action yet", () => {
    const blank = board("retro:current", [card("n", "A note", { isActionItem: false })]);
    const i = read({ retroBoards: [OLD, blank] });
    expect(i.retroLabel).toBe("Start / Stop / Continue · 4 Oct 2026");
    expect(i.actions.map((a) => a.action.id)).toEqual(["o1"]);
    expect(i.earlierOpen).toBe(0);
  });

  it("lists only unresolved impediments, each with the story planned from it", () => {
    const planned: Story = {
      id: "st-imp",
      title: "VPN drops every hour",
      status: "todo",
      sprintId: "s2",
      sourceRef: { tool: "impediments", id: "imp1" },
    };
    const i = read({ stories: [...STORIES, planned] });
    expect(i.impediments.map((p) => p.impediment.id)).toEqual(["imp1"]);
    expect(i.impediments[0].place).toEqual({ where: "sprint", story: planned });
    expect(i.improvementStories).toEqual([planned]);
  });

  it("says where an action's story is: this sprint, the backlog, another sprint, or gone", () => {
    const linked = (targetId: string) =>
      board("retro:current", [
        card("a1", "Pair on flaky tests", {
          sentTo: [{ route: "backlog-story", targetId, at: "2026-10-20" }],
        }),
      ]);
    const story = (patch: Partial<Story>): Story => ({
      id: "st1",
      title: "Pair on flaky tests",
      status: "todo",
      sourceRef: { tool: "retro", id: "a1", doc: "retro:current" },
      ...patch,
    });
    const place = (s: Story[]) =>
      read({ retroBoards: [linked("st1")], stories: s }).actions[0]?.place;

    expect(place([story({ sprintId: "s2" })])).toMatchObject({ where: "sprint" });
    expect(place([story({ status: "backlog" })])).toMatchObject({ where: "backlog" });
    expect(place([story({ sprintId: "s1" })])).toEqual({
      where: "elsewhere",
      story: story({ sprintId: "s1" }),
      sprintName: "Sprint 1",
    });
    // The story was deleted: the link stops counting.
    expect(place([])).toEqual({ where: "none" });
  });

  it("counts how many of the last retro's actions are in the sprint, a done one included", () => {
    const inSprint = board("retro:current", [
      card("a1", "Pair on flaky tests", {
        sentTo: [{ route: "backlog-story", targetId: "st1", at: "2026-10-20" }],
      }),
      card("a2", "Write the deploy runbook", {
        sentTo: [{ route: "backlog-story", targetId: "st2", at: "2026-10-20" }],
      }),
      card("a3", "Tidy the board"),
      card("a4", "Thank the platform team", { done: true }),
    ]);
    const i = read({
      retroBoards: [inSprint],
      stories: [
        { id: "st1", title: "Pair on flaky tests", status: "done", sprintId: "s2" },
        { id: "st2", title: "Write the deploy runbook", status: "in_progress", sprintId: "s2" },
      ],
    });
    // a1 is done through its story in this sprint: still counted, no longer listed.
    expect(i.actions.map((a) => a.action.id)).toEqual(["a2", "a3"]);
    expect(i.actionsInSprint).toBe(2);
    expect(i.actionsCounted).toBe(3);
  });

  it("has nothing to say with no retro action and no open impediment", () => {
    const i = read({ retroBoards: [], impediments: [IMPEDIMENTS[1]] });
    expect(i.retroLabel).toBeUndefined();
    expect(i.actions).toEqual([]);
    expect(i.impediments).toEqual([]);
    expect(improvementsHeading({ ...i, impediments: read().impediments })).toEqual({
      lead: "From the impediments log",
      counts: "1 open impediment",
    });
  });
});

describe("the small readers", () => {
  const story = (patch: Partial<Story> = {}): Story => ({
    id: "st",
    title: "S",
    status: "todo",
    ...patch,
  });

  it("finds a linked story only while it exists", () => {
    const links = [{ route: "backlog-story" as const, targetId: "st", at: "2026-10-20" }];
    expect(linkedStory(links, [story()])?.id).toBe("st");
    expect(linkedStory(links, [])).toBeUndefined();
    expect(linkedStory([{ route: "kanban", targetId: "st", at: "x" }], [story()])).toBeUndefined();
  });

  it("prefers the impediment's story in this sprint, then one still open", () => {
    const from = { sourceRef: { tool: "impediments", id: "imp1" } };
    const done = story({ id: "d", status: "done", sprintId: "s1", ...from });
    const open = story({ id: "o", status: "backlog", ...from });
    const here = story({ id: "h", sprintId: "s2", ...from });
    expect(impedimentStory("imp1", [done, open, here], "s2")?.id).toBe("h");
    expect(impedimentStory("imp1", [done, open], "s2")?.id).toBe("o");
    expect(impedimentStory("imp1", [done], "s2")?.id).toBe("d");
    expect(impedimentStory("other", [done, open, here], "s2")).toBeUndefined();
  });

  it("knows improvement work by where the story came from", () => {
    expect(isImprovementStory({ sourceRef: { tool: "retro", id: "a1" } })).toBe(true);
    expect(isImprovementStory({ sourceRef: { tool: "impediments", id: "i" } })).toBe(true);
    expect(isImprovementStory({ sourceRef: { tool: "sprint-review", id: "f" } })).toBe(false);
    expect(isImprovementStory({})).toBe(false);
  });

  it("decides what Add does, and words where the story is", () => {
    const sprints = [S1, S2];
    const none = storyPlace(undefined, "s2", sprints);
    const here = storyPlace(story({ sprintId: "s2" }), "s2", sprints);
    const waiting = storyPlace(story({ status: "backlog" }), "s2", sprints);
    const other = storyPlace(story({ sprintId: "s1" }), "s2", sprints);
    const gone = storyPlace(story({ sprintId: "deleted" }), "s2", sprints);
    const doneOther = storyPlace(story({ sprintId: "s1", status: "done" }), "s2", sprints);
    const doneHere = storyPlace(story({ sprintId: "s2", status: "done" }), "s2", sprints);

    expect([none, here, waiting, other, doneOther, doneHere].map(addMode)).toEqual([
      "new",
      null,
      "move",
      null,
      "new",
      null,
    ]);
    expect([none, here, waiting, other, gone, doneOther, doneHere].map(placeText)).toEqual([
      null,
      "In this sprint",
      "Its story is in the backlog",
      "In Sprint 1",
      "In another sprint",
      "Its story was done in Sprint 1",
      "Done in this sprint",
    ]);
  });
});

/* ── The panel ───────────────────────────────────────────────────────── */

describe("From the last retro, in Sprint Planning", () => {
  it("lists the last retro's open actions and the open impediments", () => {
    renderPlanning();
    expect(
      within(panel()).getByRole("heading", {
        name: "From the last retro: 2 open actions, 1 open impediment",
      })
    ).toBeInTheDocument();
    const actions = within(panel()).getByRole("list", { name: "Retro actions · Current retro" });
    expect(within(actions).getAllByRole("listitem")).toHaveLength(2);
    expect(rowOf("Pair on flaky tests")).toHaveTextContent("Sam · due 30 Oct");
    expect(rowOf("Write the deploy runbook")).toHaveTextContent("No owner");
    // Done actions, plain cards and resolved impediments stay out.
    expect(within(panel()).queryByText("Thank the platform team")).toBeNull();
    expect(within(panel()).queryByText("Demo on Fridays")).toBeNull();
    expect(within(panel()).queryByText("Staging was down")).toBeNull();
    expect(rowOf("VPN drops every hour")).toHaveTextContent("High · open 6 days · Bo");
    expect(within(panel()).getByText(/1 more open action is from an earlier retro/)).toBeVisible();
  });

  it("adds a retro action as a story in the sprint, linked back, and Undo removes both", () => {
    renderPlanning();
    fireEvent.click(addButton("Pair on flaky tests"));

    const made = stories().find((s) => s.title === "Pair on flaky tests")!;
    expect(made).toMatchObject({
      status: "todo",
      sprintId: "s2",
      owner: "Sam",
      sourceRef: { tool: "retro", id: "a1", doc: "retro:current" },
    });
    expect(currentCard("a1")?.sentTo).toEqual([
      { route: "backlog-story", targetId: made.id, at: expect.any(String) },
    ]);
    expect(lastToast()[0]).toBe("Added “Pair on flaky tests” to Sprint 2");
    expect(lastToast()[1].description).toBe("The retro action closes when this story is done.");
    expect(logs).toContainEqual({
      action: "improvement_added",
      payload: { sprintId: "s2", storyId: made.id, from: "retro", sourceId: "a1" },
    });

    // The story is in the sprint's list, saying where it came from.
    expect(
      within(screen.getByRole("list", { name: "Stories in Sprint 2" })).getByText(
        "Pair on flaky tests"
      )
    ).toBeInTheDocument();
    // The row says so in place of its button, and holds the keyboard's place.
    const row = rowOf("Pair on flaky tests");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(within(row).getByText("In this sprint")).toHaveFocus();
    expect(
      within(panel()).getByRole("heading", { name: /2 open actions, 1 open impediment$/ })
    ).toBeInTheDocument();

    undoLast();
    expect(stories().some((s) => s.id === made.id)).toBe(false);
    expect(currentCard("a1")?.sentTo).toEqual([]);
    expect(addButton("Pair on flaky tests")).toBeInTheDocument();
  });

  it("closes the action when its story is done, and reopens it when the story is deleted", () => {
    renderPlanning();
    fireEvent.click(addButton("Pair on flaky tests"));
    const made = stories().find((s) => s.title === "Pair on flaky tests")!;
    const targetDone = (link: { route: Parameters<typeof getHandoffRoute>[0]; targetId: string }) =>
      getHandoffRoute(link.route).isDone?.(link.targetId) ?? false;
    const action = () =>
      collectRetroActions(state().retroBoards ?? [], { today: TODAY, targetDone }).find(
        (a) => a.id === "a1"
      )!;
    expect(action().done).toBe(false);

    act(() => state().upsertStory({ ...made, status: "done" }));
    expect(action()).toMatchObject({ done: true, closedByTarget: true });
    // Done work is no longer something to plan in.
    expect(within(panel()).queryByText("Pair on flaky tests")).toBeNull();
    expect(
      within(panel()).getByRole("heading", { name: /1 open action, 1 open impediment$/ })
    ).toBeInTheDocument();

    act(() => state().removeStory(made.id));
    expect(action()).toMatchObject({ done: false, closedByTarget: false });
    expect(addButton("Pair on flaky tests")).toBeInTheDocument();
  });

  it("moves in the story an action already has in the backlog, instead of making a second", () => {
    const waiting: Story = {
      id: "st-wait",
      title: "Write the deploy runbook",
      status: "backlog",
      sourceRef: { tool: "retro", id: "a2", doc: "retro:current" },
    };
    useWorkspaceStore.setState({
      stories: [...STORIES, waiting],
      retroBoards: [
        board("retro:current", [
          card("a2", "Write the deploy runbook", {
            sentTo: [{ route: "backlog-story", targetId: "st-wait", at: "2026-10-20" }],
          }),
        ]),
      ],
    });
    renderPlanning();
    expect(rowOf("Write the deploy runbook")).toHaveTextContent("Its story is in the backlog");

    fireEvent.click(addButton("Write the deploy runbook"));
    expect(stories().filter((s) => s.title === "Write the deploy runbook")).toHaveLength(1);
    expect(stories().find((s) => s.id === "st-wait")).toMatchObject({
      sprintId: "s2",
      status: "todo",
    });
    expect(within(rowOf("Write the deploy runbook")).getByText("In this sprint")).toHaveFocus();

    undoLast();
    expect(stories().find((s) => s.id === "st-wait")).toEqual(waiting);
  });

  it("adds an open impediment as a story, and leaves the impediment open", () => {
    renderPlanning();
    fireEvent.click(addButton("VPN drops every hour"));
    const made = stories().find((s) => s.title === "VPN drops every hour")!;
    expect(made).toMatchObject({
      status: "todo",
      sprintId: "s2",
      owner: "Bo",
      sourceRef: { tool: "impediments", id: "imp1" },
    });
    expect(lastToast()[1].description).toBe(
      "The impediment stays open until you resolve it in Impediments."
    );
    expect(logs).toContainEqual({
      action: "improvement_added",
      payload: { sprintId: "s2", storyId: made.id, from: "impediments", sourceId: "imp1" },
    });
    expect(within(rowOf("VPN drops every hour")).getByText("In this sprint")).toBeInTheDocument();

    // The story being done doesn't resolve the impediment.
    act(() => state().upsertStory({ ...made, status: "done" }));
    expect(state().impediments.find((i) => i.id === "imp1")?.resolvedAt).toBeUndefined();
    expect(rowOf("VPN drops every hour")).toHaveTextContent("Done in this sprint");

    act(() => state().upsertStory({ ...made, status: "todo" }));
    undoLast();
    expect(stories().some((s) => s.id === made.id)).toBe(false);
    expect(addButton("VPN drops every hour")).toBeInTheDocument();
  });

  it("keeps a long action whole in the story's notes when its title is cut", () => {
    const long = `Agree ${"a very long action ".repeat(15)}end`;
    useWorkspaceStore.setState({ retroBoards: [board("retro:current", [card("a9", long)])] });
    renderPlanning();
    fireEvent.click(addButton(long));
    const made = stories().find((s) => s.sourceRef?.id === "a9")!;
    expect(made.title).toHaveLength(200);
    expect(made.notes).toBe(long);
  });

  it("can't add to a closed sprint", () => {
    resetSelectedSprint();
    useWorkspaceStore.setState({ sprints: [S1] });
    renderPlanning();
    const button = addButton("Pair on flaky tests");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Sprint 1 is closed");
  });

  it("is left out when there is nothing to plan in, and heads impediments on their own", () => {
    useWorkspaceStore.setState({ retroBoards: [], impediments: [] });
    const { unmount } = renderPlanning();
    expect(screen.queryByRole("region", { name: /^From the/ })).toBeNull();
    unmount();

    useWorkspaceStore.setState({ impediments: IMPEDIMENTS.map((i) => ({ ...i })) });
    renderPlanning();
    expect(
      screen.getByRole("heading", { name: "From the impediments log: 1 open impediment" })
    ).toBeInTheDocument();
  });

  it("leaves an example loaded into Impediments out of the team's plan", () => {
    useWorkspaceStore.setState({
      retroBoards: [],
      impediments: [
        { id: "example-imp", title: "An example blocker", severity: "low", raisedAt: "2026-10-20" },
      ],
    });
    renderPlanning();
    expect(screen.queryByText("An example blocker")).toBeNull();
    expect(screen.queryByRole("region", { name: /^From the/ })).toBeNull();
  });

  it("puts what is left to plan in into the Markdown export", () => {
    renderPlanning();
    fireEvent.click(addButton("Pair on flaky tests"));
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("## From the last retro");
    expect(md).toContain("2 open actions, 1 open impediment.");
    expect(md).toContain("- Pair on flaky tests (Sam · due 30 Oct): in this sprint");
    expect(md).toContain("- Write the deploy runbook (No owner): not planned yet");
    expect(md).toContain("1 more open action is from an earlier retro.");
    expect(md).toContain("- VPN drops every hour (high): not planned yet");
  });
});

/* ── The example plan ────────────────────────────────────────────────── */

describe("the example plan", () => {
  it("takes its retro's actions in, in memory only", () => {
    useWorkspaceStore.setState({ sprints: [], stories: [], retroBoards: [], impediments: [] });
    renderPlanning();
    fireEvent.click(screen.getByRole("button", { name: "See an example plan" }));

    expect(
      screen.getByRole("heading", {
        name: "From the last retro: 2 open actions, 1 open impediment",
      })
    ).toBeInTheDocument();
    fireEvent.click(addButton("Pair on every payment change"));
    expect(
      within(screen.getByRole("list", { name: "Stories in Sprint 5" })).getByText(
        "Pair on every payment change"
      )
    ).toBeInTheDocument();
    expect(
      within(rowOf("Pair on every payment change")).getByText("In this sprint")
    ).toBeInTheDocument();
    fireEvent.click(addButton("The payment sandbox is down most mornings"));

    // Nothing reached the workspace.
    expect(state().stories).toEqual([]);
    expect(state().retroBoards).toEqual([]);
    expect(state().impediments).toEqual([]);

    undoLast();
    expect(addButton("The payment sandbox is down most mornings")).toBeInTheDocument();
  });

  it("records the link on the example's own copy of the board", () => {
    const example = buildExample(TODAY);
    const store = createExampleStore(example);
    const writer = exampleWriter(store);
    const [retro] = example.retroBoards;
    const link = { route: "backlog-story" as const, targetId: "st", at: "2026-10-22" };
    writer.setActionLinks(retro.id, retro.cards[0].id, () => [link]);
    expect(store.getState().retroBoards[0].cards[0].sentTo).toEqual([link]);
    // The example it was built from is untouched, and an unknown card is ignored.
    expect(retro.cards[0].sentTo).toBeUndefined();
    writer.setActionLinks(retro.id, "nope", () => [link]);
    writer.setActionLinks("nope", retro.cards[0].id, () => []);
    expect(store.getState().retroBoards[0].cards[0].sentTo).toEqual([link]);
  });
});
