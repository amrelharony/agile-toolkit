import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Impediment,
  RetroBoard,
  Sprint,
  SprintSeries,
  StandupEntry,
  Story,
} from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import { sprintStatus } from "@/lib/sprints/metrics";
import { retroFormats } from "@/lib/constants/retro-formats";
import { localDayOf, sprintReport } from "@/lib/sprints/report";

/**
 * Sprint Cockpit gap-filling: the pure view helpers' edges, each panel on
 * its own (blockers, ceremony strip, mini burndown, next ceremony, start
 * flow), and the cockpit's compact tiles, new-sprint button and log
 * validation. The happy paths live in sprint-cockpit(-view).test.
 */

const logs = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: (action: string) => logs.push(action), toolRunId: "test" }),
}));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/app/(tools)/burndown/charts", () => ({
  BurndownChart: ({ data }: { data: { day: number }[] }) => (
    <div data-testid="burndown-chart">{data.length} rows</div>
  ),
}));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE: d } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [d, () => {}] };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import {
  blockersTile,
  daysLeftLine,
  flowCards,
  gatherCockpitData,
  impedimentAgeDays,
  openImpediments,
  RETRO_CURRENT_ID,
  storyCounts,
  type CockpitInput,
  type FlowCard,
} from "@/app/(tools)/sprint/view";
import { Blockers } from "@/app/(tools)/sprint/components/blockers";
import { FlowStrip } from "@/app/(tools)/sprint/components/flow-strip";
import { MiniBurndown, miniBurndownRows } from "@/app/(tools)/sprint/components/mini-burndown";
import { NextCeremony } from "@/app/(tools)/sprint/components/next-ceremony";
import { StartFlow } from "@/app/(tools)/sprint/components/start-flow";
import { SprintCockpit } from "@/app/(tools)/sprint/cockpit";

const SPRINT: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-15",
  endDate: "2026-10-25",
  goal: "Checkout works end to end",
  pointsPlanned: 30,
  status: "active",
};

const base: CockpitInput = {
  sprint: SPRINT,
  status: sprintStatus(SPRINT, undefined),
  sprintStories: [],
  backlogUnestimated: 0,
  standup: { posted: 0, members: 0, blockers: 0 },
  openImpediments: [],
  review: { demoItems: 0, feedback: 0 },
  retro: { hasRetro: false, openActions: 0, overdue: 0, currentCards: 0 },
};
const card = (input: CockpitInput, kind: FlowCard["kind"]) =>
  flowCards(input).find((c) => c.kind === kind)!;

const imp = (id: string, severity: Impediment["severity"], raisedAt: string): Impediment => ({
  id,
  title: id,
  severity,
  raisedAt,
});

/* ── Pure helpers ──────────────────────────────────────────────────────── */

describe("storyCounts", () => {
  it("counts done stories and treats 0, negative and missing points as unestimated", () => {
    const stories: Story[] = [
      { id: "a", title: "A", status: "done", points: 3 },
      { id: "b", title: "B", status: "todo", points: 0 },
      { id: "c", title: "C", status: "todo", points: -2 },
      { id: "d", title: "D", status: "done" },
      { id: "e", title: "E", status: "in_progress", points: 0.5 },
    ];
    expect(storyCounts(stories)).toEqual({ total: 5, done: 2, unestimated: 3 });
    expect(storyCounts([])).toEqual({ total: 0, done: 0, unestimated: 0 });
  });
});

describe("flowCards edges", () => {
  it("planning: a whitespace-only goal is no goal", () => {
    expect(card({ ...base, sprint: { ...SPRINT, goal: "   " } }, "planning")).toMatchObject({
      state: "doing",
      line: "30 pts committed · no goal yet",
      cta: "Write the goal",
    });
    expect(card({ ...base, sprint: { ...SPRINT, pointsPlanned: 0 } }, "planning")).toMatchObject({
      line: "Goal set · no points committed yet",
      cta: "Set the commitment",
    });
  });

  it("planning: a fractional commitment is shown to one decimal", () => {
    expect(card({ ...base, sprint: { ...SPRINT, pointsPlanned: 12.25 } }, "planning").line).toBe(
      "Goal set · 12.3 pts committed"
    );
  });

  it("daily: more posters than roster members still reads as everyone; blockers are plural", () => {
    expect(card({ ...base, standup: { posted: 4, members: 3, blockers: 2 } }, "daily")).toEqual(
      expect.objectContaining({
        state: "done",
        line: "Everyone updated today · 2 blockers",
        cta: "Open the standup",
        href: "/standup",
      })
    );
    expect(card({ ...base, standup: { posted: 1, members: 0, blockers: 0 } }, "daily").line).toBe(
      "1 update today"
    );
  });

  it("refinement: an empty sprint and an empty backlog ask for stories", () => {
    expect(card(base, "refinement")).toMatchObject({
      state: "todo",
      line: "No stories in the sprint yet",
      cta: "Refine the backlog",
    });
    expect(card({ ...base, backlogUnestimated: 1 }, "refinement").line).toBe(
      "1 backlog story to size"
    );
  });

  it("review: demo items without feedback leave the feedback out", () => {
    expect(card({ ...base, review: { demoItems: 1, feedback: 0 } }, "review")).toMatchObject({
      state: "done",
      line: "1 demo item",
      cta: "Open the review kit",
    });
  });

  it("retro: past retros with no open actions are done; open actions without overdue have no brackets", () => {
    expect(
      card(
        { ...base, retro: { hasRetro: true, openActions: 0, overdue: 0, currentCards: 0 } },
        "retro"
      )
    ).toMatchObject({
      state: "done",
      line: "No open retro actions",
      href: "/retro-actions",
      cta: "See past actions",
    });
    expect(
      card(
        { ...base, retro: { hasRetro: true, openActions: 1, overdue: 0, currentCards: 0 } },
        "retro"
      ).line
    ).toBe("1 open action");
    expect(
      card(
        { ...base, retro: { hasRetro: true, openActions: 0, overdue: 0, currentCards: 1 } },
        "retro"
      ).line
    ).toBe("Retro in progress · 1 card");
  });
});

describe("openImpediments", () => {
  it("doesn't reorder the list it is given and keeps equal ones in their order", () => {
    const list = [
      imp("m1", "medium", "2026-10-10"),
      imp("c1", "critical", "2026-10-12"),
      imp("m2", "medium", "2026-10-10"),
    ];
    const copy = list.map((i) => i.id);
    expect(openImpediments(list).map((i) => i.id)).toEqual(["c1", "m1", "m2"]);
    expect(list.map((i) => i.id)).toEqual(copy);
  });

  it("returns nothing when every impediment is resolved", () => {
    expect(
      openImpediments([{ ...imp("x", "high", "2026-10-01"), resolvedAt: "2026-10-02" }])
    ).toEqual([]);
  });
});

describe("impedimentAgeDays", () => {
  it("counts whole days since a dated impediment, never below 0", () => {
    expect(impedimentAgeDays({ raisedAt: "2026-10-22" }, "2026-10-22")).toBe(0);
    expect(impedimentAgeDays({ raisedAt: "2026-10-21" }, "2026-10-22")).toBe(1);
    expect(impedimentAgeDays({ raisedAt: "2026-10-01" }, "2026-10-22")).toBe(21);
    // Raised "in the future" (a clock or typing slip) reads as today.
    expect(impedimentAgeDays({ raisedAt: "2026-10-25" }, "2026-10-22")).toBe(0);
    expect(impedimentAgeDays({ raisedAt: "" }, "2026-10-22")).toBe(0);
  });

  it("counts a timestamped impediment by its local day, not its UTC day", () => {
    // Bug: a full ISO timestamp (the agent's log-impediment intent writes one) was sliced to
    // its UTC date, so one raised just after local midnight read as a day old.
    const justAfterMidnight = new Date(2026, 9, 22, 0, 30).toISOString();
    const lateEvening = new Date(2026, 9, 22, 23, 30).toISOString();
    expect(impedimentAgeDays({ raisedAt: justAfterMidnight }, "2026-10-22")).toBe(0);
    expect(impedimentAgeDays({ raisedAt: lateEvening }, "2026-10-22")).toBe(0);
    expect(impedimentAgeDays({ raisedAt: justAfterMidnight }, "2026-10-25")).toBe(3);
    expect(impedimentAgeDays({ raisedAt: lateEvening }, "2026-10-25")).toBe(3);
  });
});

describe("the sprint report's impediments", () => {
  it("dates a timestamped impediment by its local day", () => {
    // Bug: the report sliced the UTC timestamp, so "Raised" could show the day before.
    const raisedAt = new Date(2026, 9, 22, 0, 30).toISOString();
    const md = sprintReport({
      sprint: SPRINT,
      series: undefined,
      sprints: [SPRINT],
      today: "2026-10-22",
      stories: [],
      openImpediments: [{ id: "i1", title: "Sandbox", severity: "high", raisedAt }],
      standup: { posted: 0, members: 0, blockers: 0 },
      retroActions: [],
      review: null,
    });
    expect(md).toContain("| Sandbox | High | 2026-10-22 |  |");
  });

  it("keeps a plain date as stored", () => {
    expect(localDayOf("2026-10-17")).toBe("2026-10-17");
    expect(localDayOf("not a date")).toBe("not a date");
    expect(localDayOf("")).toBe("");
  });
});

describe("blockersTile and daysLeftLine edges", () => {
  it("says none are high or critical when only low and medium are open", () => {
    expect(
      blockersTile([imp("a", "low", "2026-10-10"), imp("b", "medium", "2026-10-11")])
    ).toMatchObject({
      value: "2",
      unit: "impediments",
      hint: "None high or critical",
      tone: "default",
    });
    expect(blockersTile([])).toMatchObject({
      hint: "Nothing blocking the team",
      unit: "impediments",
    });
  });

  it("has a singular day left", () => {
    expect(daysLeftLine("Day 9 of 10")).toBe("Day 9 of 10 · 1 day left");
    expect(daysLeftLine("Day 0 of 14")).toBe("Day 0 of 14 · 14 days left");
    expect(daysLeftLine("Day 3 of 10 ")).toBe("Day 3 of 10 ");
  });
});

describe("gatherCockpitData edges", () => {
  const entry = (
    member: string,
    blockers = "",
    extra: Partial<StandupEntry> = {}
  ): StandupEntry => ({
    id: `${member}-${blockers}`,
    member,
    date: "2026-10-22",
    yesterday: "",
    today: "",
    blockers,
    timestamp: 0,
    ...extra,
  });
  const board = (over: Partial<RetroBoard>): RetroBoard => ({
    id: RETRO_CURRENT_ID,
    format: retroFormats[0],
    phase: "write",
    cards: [],
    userVotes: 0,
    timerSeconds: 0,
    timerRunning: false,
    discussingIndex: 0,
    ...over,
  });
  const retroCard = (id: string) => ({
    id,
    columnKey: "start",
    text: id,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
  });
  const gather = (over: Partial<Parameters<typeof gatherCockpitData>[0]>) =>
    gatherCockpitData({
      sprint: SPRINT,
      series: undefined,
      stories: [],
      impediments: [],
      standupEntries: [],
      teamMembers: [],
      retroBoards: [],
      reviews: [],
      today: "2026-10-22",
      ...over,
    });

  it("counts only unresolved, non-blank blockers and ignores nameless entries", () => {
    const data = gather({
      standupEntries: [
        entry("Ann", "Waiting on API"),
        entry("Bob", "   "),
        entry("Cy", "Flaky CI", { blockerResolved: true }),
        entry("  ", "Something"),
      ],
    });
    expect(data.standup).toEqual({ posted: 3, members: 0, blockers: 2 });
  });

  it("counts only backlog-status stories without a sprint as backlog to size", () => {
    const data = gather({
      stories: [
        { id: "a", title: "A", status: "backlog" },
        { id: "b", title: "B", status: "todo" },
        { id: "c", title: "C", status: "backlog", points: 0 },
        { id: "d", title: "D", status: "backlog", sprintId: "other" },
      ],
    });
    expect(data.backlogUnestimated).toBe(2);
    expect(data.sprintStories).toEqual([]);
  });

  it("reads a current retro with cards as in progress, and an archived one as past", () => {
    const current = gather({ retroBoards: [board({ cards: [retroCard("c1"), retroCard("c2")] })] });
    expect(current.retro).toMatchObject({ hasRetro: true, currentCards: 2 });

    const emptyCurrent = gather({ retroBoards: [board({})] });
    expect(emptyCurrent.retro).toMatchObject({ hasRetro: false, currentCards: 0 });

    // A board under the current id that has been archived isn't the current one.
    const archived = gather({
      retroBoards: [board({ archivedAt: "2026-10-10T10:00:00.000Z", cards: [retroCard("x")] })],
    });
    expect(archived.retro).toMatchObject({ hasRetro: true, currentCards: 0 });
  });

  it("reports an empty review when there is no review document", () => {
    const data = gather({});
    expect(data.review).toEqual({ demoItems: 0, feedback: 0 });
    expect(data.reviewDoc).toBeUndefined();
    expect(data.openActions).toEqual([]);
  });
});

/* ── Panels ────────────────────────────────────────────────────────────── */

describe("Blockers panel", () => {
  it("says nothing is blocking when the list is empty", () => {
    render(<Blockers open={[]} today="2026-10-22" />);
    expect(screen.getByText(/Nothing is blocking the team/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Impediments" })).toHaveAttribute(
      "href",
      "/impediments"
    );
  });

  it("shows the four worst with their age and owner, and links to all of them", () => {
    const open = [
      { ...imp("Sandbox down", "critical", "2026-10-22"), owner: "Ben" },
      imp("Legal copy", "high", "2026-10-21"),
      imp("Design review", "medium", "2026-10-19"),
      imp("Old laptop", "low", "2026-10-12"),
      imp("Fifth", "low", "2026-10-13"),
    ];
    render(<Blockers open={open} today="2026-10-22" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("CriticalSandbox downRaised today · Ben");
    expect(items[1]).toHaveTextContent("Open 1 day");
    expect(items[2]).toHaveTextContent("Open 3 days");
    expect(screen.queryByText("Fifth")).toBeNull();
    expect(screen.getByRole("link", { name: "All 5" })).toHaveAttribute("href", "/impediments");
  });
});

describe("FlowStrip", () => {
  it("numbers each ceremony, states it for screen readers and links its tool", () => {
    render(<FlowStrip cards={flowCards(base)} />);
    const items = within(screen.getByRole("list", { name: "Sprint ceremonies" })).getAllByRole(
      "listitem"
    );
    expect(items.map((li) => li.getAttribute("data-state"))).toEqual([
      "done",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
    expect(items[0]).toHaveTextContent("1. Sprint Planning, done");
    expect(items[1]).toHaveTextContent(", not started");
    expect(within(items[0]).getByRole("link", { name: "Review the plan" })).toHaveAttribute(
      "href",
      "/sprint-planning"
    );
    expect(within(items[4]).getByRole("link", { name: "Open the retro board" })).toHaveAttribute(
      "href",
      "/retro"
    );
  });
});

describe("miniBurndownRows", () => {
  it("draws the ideal line to 0 and leaves out days logged after the end", () => {
    const series: SprintSeries = {
      id: "s2",
      days: [
        { day: 0, remaining: 30 },
        { day: 4, remaining: 20 },
        { day: 12, remaining: 5 },
      ],
    };
    const { rows, length } = miniBurndownRows(SPRINT, series);
    expect(length).toBe(10);
    expect(rows).toHaveLength(11);
    expect(rows[0]).toEqual({ day: 0, ideal: 30, actual: 30 });
    expect(rows[3]).toEqual({ day: 3, ideal: 21, actual: null });
    expect(rows[4]).toEqual({ day: 4, ideal: 18, actual: 20 });
    expect(rows[10]).toMatchObject({ day: 10, ideal: 0 });
    expect(rows.some((r) => r.day === 12)).toBe(false);
  });

  it("rounds the ideal line to one decimal", () => {
    const { rows } = miniBurndownRows(
      { ...SPRINT, pointsPlanned: 10, endDate: "2026-10-18" },
      {
        id: "s2",
      }
    );
    expect(rows.map((r) => r.ideal)).toEqual([10, 6.7, 3.3, 0]);
  });
});

describe("MiniBurndown log", () => {
  it("refuses a blank or negative number with a message and logs nothing", () => {
    const onLog = vi.fn();
    render(<MiniBurndown sprint={SPRINT} series={{ id: "s2" }} today="2026-10-19" onLog={onLog} />);
    const input = screen.getByLabelText("Points left today (day 4)");
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(screen.getByText("Enter 0 or more points.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(onLog).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(onLog).toHaveBeenCalledWith(0);
    expect(screen.queryByText("Enter 0 or more points.")).toBeNull();
  });

  it("starts from the number already logged today", () => {
    render(
      <MiniBurndown
        sprint={SPRINT}
        series={{ id: "s2", days: [{ day: 4, remaining: 18.5 }] }}
        today="2026-10-19"
        onLog={() => {}}
      />
    );
    expect(screen.getByLabelText("Points left today (day 4)")).toHaveValue(18.5);
  });

  it("has no log field outside the sprint's days or in a read-only preview", () => {
    const { unmount } = render(
      <MiniBurndown sprint={SPRINT} series={{ id: "s2" }} today="2026-11-30" onLog={() => {}} />
    );
    expect(screen.queryByLabelText(/Points left today/)).toBeNull();
    unmount();
    render(<MiniBurndown sprint={SPRINT} series={{ id: "s2" }} today="2026-10-19" />);
    expect(screen.queryByLabelText(/Points left today/)).toBeNull();
    expect(screen.getByRole("figure", { name: "Burndown" })).toBeInTheDocument();
  });
});

describe("NextCeremony", () => {
  const now = new Date(2026, 9, 22, 8, 0);

  it("tells an ended sprint to close, and a quiet one that nothing is left", () => {
    const { rerender } = render(
      <NextCeremony occurrences={[]} now={now} ended cadence={DEFAULT_CADENCE} />
    );
    expect(
      screen.getByText("This sprint is over — close it and plan the next one.")
    ).toBeInTheDocument();
    rerender(<NextCeremony occurrences={[]} now={now} ended={false} cadence={DEFAULT_CADENCE} />);
    expect(screen.getByText("No more ceremonies in this sprint.")).toBeInTheDocument();
    // Read-only: no way to change the times.
    expect(screen.queryByRole("button", { name: /Ceremony times/ })).toBeNull();
  });

  it("shows one ceremony without a 'then' line, and toggles the times form", () => {
    const onCadence = vi.fn();
    render(
      <NextCeremony
        occurrences={[{ kind: "review", at: new Date(2026, 9, 24, 14, 0), day: 9 }]}
        now={now}
        ended={false}
        cadence={DEFAULT_CADENCE}
        onCadence={onCadence}
      />
    );
    const region = screen.getByRole("region", { name: "Next ceremony" });
    expect(region).toHaveTextContent("Sprint Review");
    expect(region).not.toHaveTextContent("then");
    expect(within(region).getByRole("link", { name: "Sprint Review" })).toHaveAttribute(
      "href",
      "/sprint-review"
    );
    const toggle = screen.getByRole("button", { name: /Ceremony times/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Daily Scrum")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByLabelText("Daily Scrum")).toBeNull();
  });
});

describe("StartFlow", () => {
  beforeEach(() => useWorkspaceStore.setState({ teamMembers: [] }));
  afterEach(() => useWorkspaceStore.setState({ teamMembers: [] }));

  it("adds with the button, ignores a blank name and removes a member", () => {
    render(
      <StartFlow
        onCreate={() => {}}
        onExample={() => {}}
        cadence={DEFAULT_CADENCE}
        onCadence={() => {}}
      />
    );
    const input = screen.getByLabelText("Team member name");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(useWorkspaceStore.getState().teamMembers).toEqual([]);

    fireEvent.change(input, { target: { value: "  Dana  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(useWorkspaceStore.getState().teamMembers.map((m) => m.name)).toEqual(["Dana"]);
    expect(input).toHaveValue("");
    expect(screen.getByRole("heading", { name: /Add your team\s*\(done\)/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Dana" }));
    expect(useWorkspaceStore.getState().teamMembers).toEqual([]);
    expect(screen.queryByRole("list", { name: "Team members" })).toBeNull();
  });

  it("shows the default times and opens the times form", () => {
    const onCadence = vi.fn();
    const onCreate = vi.fn();
    const onExample = vi.fn();
    render(
      <StartFlow
        onCreate={onCreate}
        onExample={onExample}
        cadence={DEFAULT_CADENCE}
        onCadence={onCadence}
      />
    );
    expect(
      screen.getByText(
        new RegExp(`Daily at ${DEFAULT_CADENCE.dailyTime}, review at ${DEFAULT_CADENCE.reviewTime}`)
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change the times" }));
    fireEvent.change(screen.getByLabelText("Daily Scrum"), { target: { value: "08:45" } });
    expect(onCadence).toHaveBeenCalledWith({ dailyTime: "08:45" });
    fireEvent.click(screen.getByRole("button", { name: "Hide the times" }));
    expect(screen.queryByLabelText("Daily Scrum")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create the sprint" }));
    fireEvent.click(screen.getByRole("button", { name: "See an example first" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onExample).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Just browse the tools" })).toHaveAttribute(
      "href",
      "/#all-tools"
    );
  });
});

/* ── The cockpit ───────────────────────────────────────────────────────── */

describe("SprintCockpit", () => {
  const S2: Sprint = { ...SPRINT };
  const state = () => useWorkspaceStore.getState();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 22, 8, 0, 0)); // day 7 of Sprint 2
    logs.length = 0;
    resetSelectedSprint();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/sprint");
    useWorkspaceStore.setState({
      sprints: [S2],
      sprintSeries: [{ id: "s2", days: [{ day: 0, remaining: 30 }] }],
      stories: [],
      impediments: [],
      teamMembers: [],
      standupEntries: [],
      retroBoards: [],
      sprintReviews: [],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
  });

  it("keeps only five tiles on the home card", () => {
    const { container } = render(<SprintCockpit compact />);
    const ids = Array.from(container.querySelectorAll("[data-tile]")).map((el) =>
      el.getAttribute("data-tile")
    );
    expect(ids).toEqual(["committed", "done", "remaining", "gap", "blockers"]);
    expect(container.querySelector('[data-cockpit="compact"]')).not.toBeNull();
  });

  it("shows every tile on the full page, the blockers one last", () => {
    const { container } = render(<SprintCockpit />);
    const ids = Array.from(container.querySelectorAll("[data-tile]")).map((el) =>
      el.getAttribute("data-tile")
    );
    expect(ids.length).toBeGreaterThan(5);
    expect(ids[ids.length - 1]).toBe("blockers");
    expect(container.querySelector('[data-tile="blockers"]')).toHaveTextContent(
      "Nothing blocking the team"
    );
  });

  it("opens the new-sprint dialog from the picker row", () => {
    render(<SprintCockpit />);
    fireEvent.click(screen.getByRole("button", { name: "New sprint" }));
    const dialog = screen.getByRole("dialog", { name: "New sprint" });
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Sprint 3");
  });

  it("won't log a negative number into the shared series", () => {
    render(<SprintCockpit />);
    const input = screen.getByLabelText("Points left today (day 7)");
    fireEvent.change(input, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(screen.getByText("Enter 0 or more points.")).toBeInTheDocument();
    expect(state().sprintSeries?.find((s) => s.id === "s2")?.days).toEqual([
      { day: 0, remaining: 30 },
    ]);
    expect(logs).not.toContain("day_logged");
  });

  it("logs 0 points left as a real value", () => {
    render(<SprintCockpit />);
    fireEvent.change(screen.getByLabelText("Points left today (day 7)"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(
      state()
        .sprintSeries?.find((s) => s.id === "s2")
        ?.days?.find((d) => d.day === 7)
    ).toMatchObject({ remaining: 0 });
  });
});
