import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Impediment, Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import { TOUCH_LINK } from "@/components/ui/touch-target";

/**
 * The Sprint Cockpit: with no sprint it runs the start flow; with one it
 * shows the ceremony strip, the next ceremony, the tiles, the burndown with
 * today's log, and the blockers. The home card is the compact form.
 */

const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown> = {}) => logs.push({ action, payload }),
    toolRunId: "test",
  }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/app/(tools)/burndown/charts", () => ({
  BurndownChart: ({ data }: { data: { day: number }[] }) => (
    <div data-testid="burndown-chart">{data.length} rows</div>
  ),
}));
const cadence = vi.hoisted(() => ({ patches: [] as unknown[] }));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE: d } = await import("@/lib/sprints/cadence");
  return {
    useCeremonyCadence: () => [d, (patch: unknown) => cadence.patches.push(patch)],
  };
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

// The start flow's remove buttons are IconButtons, which need the app's TooltipProvider.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

const S1: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-09-21",
  endDate: "2026-10-01",
  pointsPlanned: 30,
  pointsCompleted: 26,
  status: "completed",
};
const S2: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-15",
  endDate: "2026-10-25",
  goal: "Checkout works end to end",
  pointsPlanned: 30,
  status: "active",
};
const SERIES2: SprintSeries = {
  id: "s2",
  days: [
    { day: 0, remaining: 30 },
    { day: 2, remaining: 27 },
  ],
};
const STORIES: Story[] = [
  { id: "a", title: "Save a card", points: 8, status: "done", sprintId: "s2" },
  { id: "b", title: "Refund flow", status: "todo", sprintId: "s2" },
];
const IMPS: Impediment[] = [
  { id: "i1", title: "Sandbox 500s", severity: "high", raisedAt: "2026-10-17" },
];

const state = () => useWorkspaceStore.getState();

function seed(sprints: Sprint[], series: SprintSeries[] = []) {
  useWorkspaceStore.setState({
    sprints,
    sprintSeries: series,
    stories: sprints.length ? STORIES : [],
    impediments: sprints.length ? IMPS : [],
    teamMembers: [],
    standupEntries: [],
    retroBoards: [],
    sprintReviews: [],
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 8, 0, 0)); // Thu 22 Oct 2026: day 7 of Sprint 2
  logs.length = 0;
  cadence.patches.length = 0;
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/sprint");
});

afterEach(() => {
  vi.useRealTimers();
  seed([]);
});

describe("with no sprint", () => {
  it("runs the start flow and adds team members", () => {
    seed([]);
    render(<SprintCockpit />);
    expect(screen.getByRole("heading", { name: "Set up your sprint" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create the sprint" })).toBeInTheDocument();

    const input = screen.getByLabelText("Team member name");
    fireEvent.change(input, { target: { value: "Ann" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: " ann " } }); // duplicate, ignored
    fireEvent.keyDown(input, { key: "Enter" });
    expect(state().teamMembers.map((m) => m.name)).toEqual(["Ann"]);
    expect(
      within(screen.getByRole("list", { name: "Team members" })).getAllByRole("listitem")
    ).toHaveLength(1);
  });

  it("gives the start card's standalone links a 44px touch height", () => {
    seed([]);
    render(<SprintCockpit />);
    expect(screen.getByRole("link", { name: "Just browse the tools" })).toHaveClass(
      ...TOUCH_LINK.split(" ")
    );
    expect(screen.getByRole("link", { name: "Team page" })).toHaveClass(
      ...TOUCH_LINK.split(" "),
      "ml-auto"
    );
  });

  it("creates the first sprint from the dialog and opens on it", () => {
    seed([]);
    render(<SprintCockpit />);
    fireEvent.click(screen.getByRole("button", { name: "Create the sprint" }));
    const dialog = screen.getByRole("dialog", { name: "New sprint" });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Sprint 1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create sprint/ }));
    expect(state().sprints).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Sprint 1" })).toBeInTheDocument();
    expect(logs.map((l) => l.action)).toContain("sprint_created");
  });

  it("shows the example without saving anything", () => {
    seed([]);
    render(<SprintCockpit />);
    fireEvent.click(screen.getByRole("button", { name: "See an example first" }));
    expect(screen.getByRole("status")).toHaveTextContent("Example data");
    expect(screen.getByRole("heading", { level: 2, name: "Sprint 5" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Sprint ceremonies" })).toBeInTheDocument();
    expect(state().sprints).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("heading", { name: "Set up your sprint" })).toBeInTheDocument();
  });
});

describe("with a sprint", () => {
  beforeEach(() => seed([S1, S2], [SERIES2]));

  it("opens on the active sprint with the ceremony strip, next ceremony and tiles", () => {
    const { container } = render(<SprintCockpit />);
    expect(screen.getByRole("heading", { level: 2, name: "Sprint 2" })).toBeInTheDocument();
    expect(screen.getByText("Day 7 of 10")).toBeInTheDocument();

    const strip = screen.getByRole("list", { name: "Sprint ceremonies" });
    const cards = within(strip).getAllByRole("listitem");
    expect(cards).toHaveLength(5);
    expect(cards[0]).toHaveTextContent("Goal set · 30 pts committed · 2 stories");
    expect(cards[1]).toHaveTextContent("No updates yet today");
    expect(cards[2]).toHaveTextContent("1 sprint story without points");
    expect(cards[4]).toHaveTextContent("No retro for this sprint yet");

    // Thursday 08:00: the daily at 09:30 is next, then Friday's.
    const next = screen.getByRole("region", { name: "Next ceremony" });
    expect(next).toHaveTextContent("Daily Scrum · Today 09:30");
    expect(next).toHaveTextContent("then Daily Scrum · Tomorrow 09:30");

    expect(container.querySelector('[data-tile="committed"]')?.textContent).toContain("30");
    expect(container.querySelector('[data-tile="blockers"]')?.textContent).toContain("1");
    expect(screen.getByRole("heading", { name: "Open blockers" })).toBeInTheDocument();
    expect(screen.getByText("Sandbox 500s")).toBeInTheDocument();
    // The plot itself is lazy (and Recharts has no size in jsdom); the card's
    // text summary is built from the same rows. The sprint's only pointed
    // story is done, so the board (not the typed log) is the source; "Refund
    // flow" has no points, so the sprint reads neither finished nor ahead.
    expect(screen.getByRole("figure", { name: "Burndown" })).toHaveTextContent(
      "No pointed work left on day 7. 1 open story has no points, so the board can't show all that's left."
    );
    expect(container.querySelector("[data-cockpit-verdict]")).toHaveTextContent(
      "Day 7 of 10: every pointed story is done, but 1 open story has no points yet, and 1 blocker is open."
    );
    for (const id of ["gap", "finish"]) {
      const tile = container.querySelector(`[data-tile="${id}"]`);
      expect(tile).toHaveTextContent("Can't tell yet");
      expect(tile).toHaveTextContent("1 open story has no points");
      expect(tile?.textContent).not.toMatch(/Finished|Ahead/);
    }
  });

  it("logs today's points left into the shared sprint series", () => {
    // Without pointed stories the board can't say, so the log is asked.
    useWorkspaceStore.setState({
      stories: STORIES.map((s) => {
        const copy = { ...s };
        delete copy.points;
        return copy;
      }),
    });
    render(<SprintCockpit />);
    // The ideal line counts the team's working days (Mon–Fri): by Saturday,
    // day 2, it has burned 2 of the sprint's 7 working days (30 → 21.4).
    expect(screen.getByRole("figure", { name: "Burndown" })).toHaveTextContent(
      "Remaining points fell from 30 to 27 over 2 days; 5.6 points behind the ideal line."
    );
    const input = screen.getByLabelText("Points left today (day 7)");
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    const series = state().sprintSeries?.find((s) => s.id === "s2");
    expect(series?.days?.find((d) => d.day === 7)).toMatchObject({ remaining: 20 });
    expect(logs.map((l) => l.action)).toContain("day_logged");
  });

  it("gives the ceremony and blocker links a 44px touch height", () => {
    useWorkspaceStore.setState({
      stories: STORIES.map((s) => (s.id === "b" ? { ...s, blocked: true } : s)),
    });
    render(<SprintCockpit />);
    const strip = screen.getByRole("list", { name: "Sprint ceremonies" });
    const ctas = within(strip).getAllByRole("link");
    expect(ctas).toHaveLength(5);
    for (const link of ctas) expect(link).toHaveClass(...TOUCH_LINK.split(" "), "mt-auto");

    // The Open blockers card: its header link and the board link.
    expect(screen.getByRole("link", { name: "Impediments" })).toHaveClass(...TOUCH_LINK.split(" "));
    expect(screen.getByRole("link", { name: "Unblock them on the board" })).toHaveClass(
      ...TOUCH_LINK.split(" ")
    );
  });

  it("edits ceremony times from the next-ceremony card", () => {
    render(<SprintCockpit />);
    fireEvent.click(screen.getByRole("button", { name: /Ceremony times/ }));
    fireEvent.change(screen.getByLabelText("Daily Scrum"), { target: { value: "10:15" } });
    expect(cadence.patches).toContainEqual({ dailyTime: "10:15" });
  });

  it("closes the sprint with the points done", () => {
    render(<SprintCockpit />);
    fireEvent.click(screen.getByRole("button", { name: "Close sprint" }));
    const dialog = screen.getByRole("dialog");
    // "Refund flow" isn't done: the dialog asks where it goes first.
    fireEvent.click(within(dialog).getByRole("radio", { name: /Back to the backlog/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Close sprint/ }));
    expect(state().sprints.find((s) => s.id === "s2")).toMatchObject({ status: "completed" });
    expect(state().stories.find((s) => s.id === "b")).toMatchObject({ status: "backlog" });
    expect(logs.map((l) => l.action)).toContain("sprint_closed");
  });

  it("exports a sprint report with every section", () => {
    render(<SprintCockpit />);
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Sprint 2");
    expect(md).toContain("## Sprint backlog");
    expect(md).toContain("| Refund flow | — | To do |  |");
    expect(md).toContain("| Sandbox 500s | High | 2026-10-17 |  |");
  });

  it("keeps the home card compact: no chart, no log, a link to the page", () => {
    render(<SprintCockpit compact />);
    expect(screen.getByRole("list", { name: "Sprint ceremonies" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Points left today/)).toBeNull();
    expect(screen.queryByRole("figure", { name: "Burndown" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ceremony times/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Open the full cockpit" })).toHaveAttribute(
      "href",
      "/sprint"
    );
  });
});

describe("cadence defaults", () => {
  it("documents the two-week default", () => {
    expect(DEFAULT_CADENCE.sprintLengthDays).toBe(14);
  });
});
