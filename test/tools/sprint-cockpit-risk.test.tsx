/**
 * The Sprint Cockpit's goal check, interrupt tile and wall mode: the data
 * the page reads (gatherCockpitData's `risk` and `interrupts`), the tile
 * that links to the Interrupt Buffer on the sprint, the card with its
 * reasons and the note without AI, the export, the example, and the wall
 * view that opens over the page in large type and closes with Escape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Impediment,
  InterruptItem,
  Sprint,
  SprintSeries,
  Story,
} from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { usePresentation } from "@/components/presentation/presentation-mode";

vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => undefined, toolRunId: "test" }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/app/(tools)/burndown/charts", () => ({
  BurndownChart: () => <div data-testid="burndown-chart" />,
}));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE: d } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [d, () => undefined] };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { SprintCockpit } from "@/app/(tools)/sprint/cockpit";
import { cockpitTiles, gatherCockpitData, interruptsTile } from "@/app/(tools)/sprint/view";
import { cockpitMarkdown } from "@/app/(tools)/sprint/markdown";
import { buildExample } from "@/app/(tools)/sprint/example";
import { interruptBufferStatus } from "@/lib/sprints/interrupts";
import { riskNoteInput } from "@/app/(tools)/sprint/components/risk";
import { sprintRiskNoteTask } from "@/lib/ai/tasks/sprint";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

const TODAY = "2026-10-22";
const S2: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-15",
  endDate: "2026-10-25",
  goal: "Checkout works end to end",
  pointsPlanned: 30,
  status: "active",
  interruptBuffer: { points: 8 },
};
const SERIES: SprintSeries = { id: "s2", days: [{ day: 0, remaining: 30 }] };
/** 24 of 30 points done by day 6, steadily: on pace to finish on time. */
const done = (id: string, title: string, day: number): Story => ({
  id,
  title,
  points: 8,
  status: "done",
  sprintId: "s2",
  startedAt: `2026-10-${15 + day - 1}T10:00:00.000Z`,
  doneAt: `2026-10-${15 + day}T10:00:00.000Z`,
});
const STORIES: Story[] = [
  done("a", "Save a card", 1),
  done("d", "Pay with a saved card", 4),
  done("e", "Remove a saved card", 6),
  {
    id: "b",
    title: "Refund flow",
    points: 3,
    status: "in_progress",
    sprintId: "s2",
    blocked: true,
  },
  { id: "c", title: "Receipts", points: 3, status: "todo", sprintId: "s2" },
];
const IMPS: Impediment[] = [
  {
    id: "i1",
    title: "Sandbox 500s",
    severity: "high",
    raisedAt: "2026-10-17",
    escalatedAt: "2026-10-19",
  },
];
const interrupt = (over: Partial<InterruptItem>): InterruptItem => ({
  id: "int",
  sprintId: "s2",
  title: "Checkout down",
  kind: "incident",
  size: 3,
  emergency: false,
  loggedAt: "2026-10-17T09:00:00.000Z",
  ...over,
});
const INTERRUPTS: InterruptItem[] = [
  interrupt({ id: "int1", size: 5 }),
  interrupt({ id: "int2", size: 2, resolvedAt: "2026-10-19T09:00:00.000Z" }),
  // An example row loaded into the Interrupt Buffer: never the team's.
  interrupt({ id: "example-int", size: 20 }),
];

const gather = (over: Partial<Parameters<typeof gatherCockpitData>[0]> = {}) =>
  gatherCockpitData({
    sprint: S2,
    series: SERIES,
    stories: STORIES,
    impediments: IMPS,
    standupEntries: [],
    teamMembers: [],
    retroBoards: [],
    reviews: [],
    today: TODAY,
    interruptItems: INTERRUPTS,
    ...over,
  });

function seed(interruptItems: InterruptItem[] = INTERRUPTS) {
  useWorkspaceStore.setState({
    sprints: [S2],
    sprintSeries: [SERIES],
    stories: STORIES,
    impediments: IMPS,
    teamMembers: [],
    standupEntries: [],
    retroBoards: [],
    sprintReviews: [],
    interruptItems,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 8, 0, 0)); // day 7 of Sprint 2
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/sprint");
  usePresentation.setState({ presenting: false });
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({ sprints: [], stories: [], impediments: [], interruptItems: [] });
});

describe("the example", () => {
  it("keeps a 5-point buffer with 4 points used, so the goal check watches it", () => {
    const ex = buildExample(TODAY);
    expect(ex.current.interruptBuffer).toEqual({ points: 5 });
    expect(ex.sprints.find((s) => s.id === ex.current.id)).toBe(ex.current);
    expect(ex.interruptItems.every((i) => i.id.startsWith("example-"))).toBe(true);
    const data = gatherCockpitData({
      sprint: ex.current,
      series: ex.series.find((s) => s.id === ex.current.id),
      stories: ex.stories,
      impediments: ex.impediments,
      standupEntries: ex.standupEntries,
      teamMembers: ex.teamMembers,
      retroBoards: ex.retroBoards,
      reviews: ex.reviews,
      sprints: ex.sprints,
      today: TODAY,
      interruptItems: ex.interruptItems,
    });
    expect(data.interrupts).toMatchObject({ usedPoints: 4, bufferPoints: 5, state: "watch" });
    expect(data.risk.level).toBe("watch");
    expect(data.risk.reasons.map((r) => r.id).sort()).toEqual(
      ["blocked", "impediments", "interrupts"].sort()
    );
  });

  it("shows the goal check on the read-only preview without the note", () => {
    useWorkspaceStore.setState({ sprints: [], stories: [], impediments: [], interruptItems: [] });
    render(<SprintCockpit />);
    fireEvent.click(screen.getByRole("button", { name: /see an example/i }));
    const card = screen.getByRole("region", { name: "Goal check: worth watching" });
    expect(within(card).queryByRole("button")).toBeNull();
    expect(document.querySelector('[data-tile="interrupts"]')).toHaveTextContent("of 5 pts");
  });
});

describe("the data", () => {
  it("reads the sprint's interrupt buffer, leaving example rows out", () => {
    const data = gather();
    expect(data.interrupts).toMatchObject({
      bufferPoints: 8,
      usedPoints: 7,
      total: 2,
      open: 1,
      state: "watch",
    });
  });

  it("has no buffer to show when none is set and nothing was logged", () => {
    const { interruptBuffer: _drop, ...noBuffer } = S2;
    void _drop;
    expect(gather({ sprint: noBuffer, interruptItems: [] }).interrupts).toBeNull();
    expect(gather({ sprint: noBuffer }).interrupts).toMatchObject({ set: false, total: 2 });
  });

  it("ends the tiles with the buffer's, linking to the Interrupt Buffer on the sprint", () => {
    const tiles = cockpitTiles(gather(), [S2], TODAY);
    const last = tiles[tiles.length - 1];
    expect(last).toMatchObject({
      id: "interrupts",
      label: "Interrupt buffer",
      value: "7",
      unit: "of 8 pts",
      hint: "1 left · 2 interrupts · 1 open",
      tone: "warning",
      href: "/interrupt-buffer?sprint=s2",
      linkLabel: "Open the Interrupt Buffer",
    });
    expect(cockpitTiles(gather({ interruptItems: [] }), [S2], TODAY).map((t) => t.id)).toContain(
      "interrupts"
    );
  });

  it("words the buffer's tile when it is over or has no points", () => {
    const over = interruptBufferStatus(S2, [interrupt({ size: 11 })]);
    expect(interruptsTile(over, S2)).toMatchObject({
      value: "11",
      hint: "3 over the buffer · 1 open",
    });
    const share = interruptBufferStatus({ ...S2, pointsPlanned: 0, interruptBuffer: { pct: 20 } }, [
      interrupt({}),
    ]);
    expect(interruptsTile(share, S2)).toMatchObject({
      value: "1",
      unit: "interrupt",
      hint: "Plan the sprint's points to size the buffer",
      tone: "default",
    });
  });

  it("checks the goal: a blocked story, an escalated impediment and the buffer", () => {
    const { risk } = gather();
    expect(risk.applies).toBe(true);
    expect(risk.level).toBe("watch");
    expect(risk.reasons.map((r) => r.id)).toEqual(
      expect.arrayContaining(["blocked", "impediments", "interrupts"])
    );
  });

  it("says the goal is at risk once the buffer is spent", () => {
    const { risk } = gather({ interruptItems: [interrupt({ size: 12 })] });
    expect(risk.level).toBe("at_risk");
    expect(risk.reasons[0]).toMatchObject({
      id: "interrupts",
      text: "Interrupt buffer: 12 of 8 points used: 4 points over the buffer.",
    });
  });

  it("puts the goal check and the buffer in the report", () => {
    const md = cockpitMarkdown({ data: gather(), series: SERIES, sprints: [S2], today: TODAY });
    // The level once, then the headline in its own words.
    expect(md).toContain(
      "**Goal check: Worth watching.** 3 signs could put the sprint goal at risk."
    );
    expect(md).not.toContain("Worth watching: 3 signs");
    expect(md).toContain("- Worth watching: 1 story is blocked on the board. Try: Unblock");
    expect(md).toContain("## Interrupt buffer\n\n7 of 8 points used, 1 point left.");
    expect(md).toContain("| Interrupt buffer | 7 of 8 pts | 1 left · 2 interrupts · 1 open |");
  });

  it("cuts the AI note's input to the task's caps", () => {
    const data = gather();
    const input = riskNoteInput(
      data.risk,
      { name: "S".repeat(200), goal: "G".repeat(500) },
      data.burndown.todayDay,
      data.burndown.length
    );
    expect(sprintRiskNoteTask.input.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({ day: 7, length: 10, level: "watch" });
  });
});

describe("the page", () => {
  it("shows the goal check with its reasons, and sums it up without AI", () => {
    seed();
    render(<SprintCockpit />);
    const card = screen.getByRole("region", { name: "Goal check: worth watching" });
    expect(within(card).getByText(/3 signs could put the sprint goal at risk/)).toBeInTheDocument();
    expect(within(card).getByText("1 story is blocked on the board.")).toBeInTheDocument();
    expect(within(card).getAllByText(/^Try:/)).toHaveLength(3);

    const ask = within(card).getByRole("button", { name: "Sum it up without AI" });
    fireEvent.click(ask);
    const note = card.querySelector("[data-risk-note]") as HTMLElement;
    expect(note).toHaveTextContent("Summed up without AI");
    expect(note).toHaveTextContent(/3 signs could put the sprint goal at risk\. .* Try this: /);
    const hide = within(card).getByRole("button", { name: "Hide the note" });
    hide.focus();
    fireEvent.click(hide);
    expect(card.querySelector("[data-risk-note]")).toBeNull();
    // Focus goes back to the button that asked for the note, not to the page.
    expect(document.activeElement).toBe(ask);
  });

  it("drops the note once the facts it was written from change", () => {
    seed();
    render(<SprintCockpit />);
    const card = screen.getByRole("region", { name: "Goal check: worth watching" });
    fireEvent.click(within(card).getByRole("button", { name: "Sum it up without AI" }));
    expect(card.querySelector("[data-risk-note]")).toHaveTextContent("1 story is blocked");
    // The story is unblocked: the note would now state a reason that's no longer true.
    act(() =>
      useWorkspaceStore.setState({ stories: STORIES.map((s) => ({ ...s, blocked: false })) })
    );
    const after = screen.getByRole("region", { name: "Goal check: worth watching" });
    expect(after.querySelector('[data-risk-reason="blocked"]')).toBeNull();
    expect(after.querySelector("[data-risk-note]")).toBeNull();
    // Asked again, it reads the facts as they are now.
    fireEvent.click(within(after).getByRole("button", { name: "Sum it up without AI" }));
    const note = after.querySelector("[data-risk-note]") as HTMLElement;
    expect(note).toHaveTextContent("2 signs could put the sprint goal at risk.");
    expect(note).not.toHaveTextContent("blocked");
  });

  it("links the interrupt tile to the Interrupt Buffer on this sprint", () => {
    seed();
    render(<SprintCockpit />);
    const link = screen.getByRole("link", { name: "Open the Interrupt Buffer" });
    expect(link).toHaveAttribute("href", "/interrupt-buffer?sprint=s2");
    const tile = document.querySelector('[data-tile="interrupts"]') as HTMLElement;
    expect(tile).toHaveTextContent("Interrupt buffer");
    expect(tile).toHaveTextContent("of 8 pts");
  });

  it("says a quiet line when nothing puts the goal at risk", () => {
    useWorkspaceStore.setState({
      sprints: [{ ...S2, interruptBuffer: undefined }],
      sprintSeries: [SERIES],
      stories: STORIES.map((s) => ({ ...s, blocked: false })),
      impediments: [],
      teamMembers: [],
      standupEntries: [],
      retroBoards: [],
      sprintReviews: [],
      interruptItems: [],
    });
    render(<SprintCockpit />);
    expect(document.querySelector('[data-risk="none"]')).toHaveTextContent(
      "The sprint goal looks on track: nothing puts it at risk today."
    );
    expect(document.querySelector('[data-tile="interrupts"]')).toBeNull();
  });

  it("keeps the home card short: the reasons without the things to try or the note", () => {
    seed();
    render(<SprintCockpit compact />);
    const card = screen.getByRole("region", { name: "Goal check: worth watching" });
    expect(within(card).queryAllByText(/^Try:/)).toHaveLength(0);
    expect(within(card).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Wall mode" })).toBeNull();
  });

  it("opens wall mode over the page in large type, and Escape closes it", () => {
    seed();
    render(<SprintCockpit />);
    fireEvent.click(screen.getByRole("button", { name: "Wall mode" }));
    expect(usePresentation.getState().presenting).toBe(true);
    const wall = screen.getByRole("dialog", { name: "Sprint 2" });
    expect(within(wall).getByText("Goal: Checkout works end to end")).toBeInTheDocument();
    expect(within(wall).getByText(/^Day 7 of 10 · 3 days left$/)).toBeInTheDocument();
    // The level once, then the headline.
    const risk = wall.querySelector('[data-wall-risk="watch"]') as HTMLElement;
    expect(within(risk).getByText("Goal check: Worth watching")).toBeInTheDocument();
    expect(
      within(risk).getByText("3 signs could put the sprint goal at risk.")
    ).toBeInTheDocument();
    expect(risk).not.toHaveTextContent("Worth watching: Worth watching");
    expect(within(wall).getByText("Interrupt buffer")).toBeInTheDocument();
    // Nothing in it is a control.
    expect(within(wall).queryByRole("button")).toBeNull();
    expect(within(wall).queryByRole("link")).toBeNull();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "Sprint 2" })).toBeNull();
    expect(usePresentation.getState().presenting).toBe(false);
  });

  it("closes the wall when Present mode ends some other way", () => {
    seed();
    render(<SprintCockpit />);
    fireEvent.click(screen.getByRole("button", { name: "Wall mode" }));
    expect(screen.getByRole("dialog", { name: "Sprint 2" })).toBeInTheDocument();
    act(() => usePresentation.getState().set(false));
    expect(screen.queryByRole("dialog", { name: "Sprint 2" })).toBeNull();
  });
});
