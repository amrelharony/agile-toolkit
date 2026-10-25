import { describe, expect, it } from "vitest";
import type { Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { DEFAULT_CALENDAR, normalizeCalendar } from "@/lib/sprints/calendar";
import {
  boardBurn,
  burnCaveats,
  burnReport,
  burnSeries,
  burnStatus,
  churnLine,
  idealBase,
  offDayRanges,
  openUnpointed,
  trendPoints,
  type BurnInput,
} from "@/lib/sprints/burn";
import { remainingToday, storyProgress } from "@/lib/sprints/progress";
import { sprintStatus } from "@/lib/sprints/metrics";
import { exampleBurndown } from "@/app/(tools)/burndown/example";
import { cockpitBurndown, cockpitChartText } from "@/app/(tools)/sprint/view";

/**
 * lib/sprints/burn: the one burn model Burndown, Burnup, the cockpit and
 * their agent actions read. Membership by day from the stories' sprint
 * moves, done by day from their status history, the log as the fallback,
 * the ideal line on working days, and the shared gap / % / projection.
 */

const at = (day: string) => `${day}T12:00:00.000Z`;

/** Mon 5 Oct → Mon 19 Oct 2026: 14 days, 10 working days (Mon–Fri). */
const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 7",
  startDate: "2026-10-05",
  endDate: "2026-10-19",
  pointsPlanned: 38,
  status: "active",
};

const joined = (day: string, points?: number) => ({
  sprintId: "s1",
  at: at(day),
  ...(points !== undefined ? { points } : {}),
});

/**
 * 38 points planned in on day 0; "Refund" (7) added on day 3, "Analytics"
 * (5) taken out on day 4; "Save" (8) done on day 2, "Pay" (5) on day 4;
 * "Legacy" (10) has no record of joining.
 */
const BOARD: Story[] = [
  {
    id: "a",
    title: "Save",
    points: 8,
    status: "done",
    sprintId: "s1",
    doneAt: at("2026-10-07"),
    sprintHistory: [joined("2026-10-05", 8)],
  },
  {
    id: "b",
    title: "Pay",
    points: 5,
    status: "done",
    sprintId: "s1",
    doneAt: at("2026-10-09"),
    sprintHistory: [joined("2026-10-05", 5)],
  },
  {
    id: "c",
    title: "Refund flow",
    points: 10,
    status: "in_progress",
    sprintId: "s1",
    sprintHistory: [joined("2026-10-05", 10)],
  },
  {
    id: "d",
    title: "Refund",
    points: 7,
    status: "todo",
    sprintId: "s1",
    sprintHistory: [joined("2026-10-08", 7)],
  },
  {
    id: "e",
    title: "Analytics",
    points: 5,
    status: "backlog",
    sprintHistory: [joined("2026-10-05", 5), { from: "s1", at: at("2026-10-09"), points: 5 }],
  },
  { id: "f", title: "Legacy", points: 10, status: "todo", sprintId: "s1" },
  { id: "x", title: "Elsewhere", points: 3, status: "todo", sprintId: "other" },
];

const input = (over: Partial<BurnInput> = {}): BurnInput => ({
  sprint: SPRINT,
  series: undefined,
  stories: BOARD,
  calendar: DEFAULT_CALENDAR,
  today: "2026-10-12", // Monday, day 7
  ...over,
});

describe("the board as the source", () => {
  const burn = burnSeries(input());

  it("reads scope by day from the sprint moves and done by day from the done dates", () => {
    expect(burn.source).toBe("stories");
    expect(burn.lastDay).toBe(7);
    const days = burn.days.slice(0, 8);
    expect(days.map((d) => d.scope)).toEqual([38, 38, 38, 45, 40, 40, 40, 40]);
    expect(days.map((d) => d.done)).toEqual([0, 0, 8, 8, 13, 13, 13, 13]);
    expect(days.map((d) => d.remaining)).toEqual([38, 38, 30, 37, 27, 27, 27, 27]);
    expect(days.map((d) => d.added)).toEqual([0, 0, 0, 7, 0, 0, 0, 0]);
    expect(days.map((d) => d.removed)).toEqual([0, 0, 0, 0, 5, 0, 0, 0]);
    // Days not reached carry only the ideal line.
    expect(burn.days[8]).toMatchObject({ remaining: null, done: null, scope: null, from: null });
  });

  it("adds scope without counting it as burn, and a removal lowers scope, not done", () => {
    expect(burn).toMatchObject({
      initialScope: 38,
      scopeNow: 40,
      scopeAdded: 7,
      scopeRemoved: 5,
      done: 13,
      remaining: 27,
      unknownJoin: 1,
    });
    // Today's numbers are the board's own (the cockpit's tiles).
    const now = storyProgress(BOARD, "s1");
    expect(burn.remaining).toBe(now.remaining);
    expect(burn.scopeNow).toBe(now.scope);
  });

  it("is the remainingToday rule: the board while it has pointed stories", () => {
    expect(
      remainingToday({ sprint: SPRINT, stories: BOARD, series: undefined, today: "2026-10-12" })
        .source
    ).toBe("stories");
    const unsized = BOARD.map((s) => {
      const copy = { ...s };
      delete copy.points;
      return copy;
    });
    expect(burnSeries(input({ stories: unsized })).source).toBe("none");
    expect(burnSeries(input({ stories: [] })).available).toEqual({ stories: false, log: false });
  });

  it("stops counting a story that was done and reopened, and counts a late finish on the last day", () => {
    const reopened: Story = {
      id: "g",
      title: "Reopened",
      points: 4,
      status: "in_progress",
      sprintId: "s1",
      statusHistory: [
        { status: "in_progress", from: "todo", at: at("2026-10-05") },
        { status: "done", from: "in_progress", at: at("2026-10-06") },
        { status: "in_progress", from: "done", at: at("2026-10-07") },
      ],
    };
    const late: Story = {
      id: "h",
      title: "Late",
      points: 2,
      status: "done",
      sprintId: "s1",
      doneAt: at("2026-10-20"),
    };
    const b = burnSeries(input({ stories: [reopened, late], today: "2026-10-21" }));
    expect(b.days.map((d) => d.done)).toEqual([0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(b.phase).toBe("over");
    expect(b.lastDay).toBe(14);
  });

  it("counts an undated done story from the day it arrived, and says so", () => {
    const old: Story = { id: "o", title: "Old", points: 3, status: "done", sprintId: "s1" };
    const b = burnSeries(input({ stories: [old, BOARD[2]] }));
    expect(b.days[0].done).toBe(3);
    expect(b.undatedDone).toBe(1);
    expect(burnCaveats(b).join(" ")).toMatch(/1 done story with no done date/);
  });

  it("a carry-over at the close keeps the story in scope to the end", () => {
    const carried: Story = {
      ...BOARD[2],
      sprintId: "s2",
      sprintHistory: [
        joined("2026-10-05", 10),
        { sprintId: "s2", from: "s1", at: at("2026-10-16"), points: 10, carriedOver: true },
      ],
    };
    const closed: Sprint = { ...SPRINT, status: "completed", pointsCompleted: 13 };
    const stories = [BOARD[0], BOARD[1], carried];
    // With no daily log typed, a closed sprint is rebuilt from its board…
    const b = burnSeries(input({ sprint: closed, stories, today: "2026-10-21" }));
    expect(b.source).toBe("stories");
    expect(b.days[14]).toMatchObject({ scope: 23, done: 13, remaining: 10, removed: 0 });
    expect(b.scopeRemoved).toBe(0);
    expect(burnCaveats(b, closed)).toContain(
      "Rebuilt from the stories' sprint moves: the sprint is closed and no daily log was typed for it."
    );
    expect(burnStatus(b, closed).verdict).toMatch(/^Sprint 7 is closed: 13 of 23 points done/);
    // …the cockpit reads it only as recorded…
    expect(
      burnSeries(input({ sprint: closed, stories, today: "2026-10-21", recordedOnly: true })).source
    ).toBe("none");
    // …and with a log, the log is what was recorded; the board on request.
    const log: SprintSeries = { id: "s1", days: [{ day: 14, remaining: 12 }] };
    const logged = burnSeries(input({ sprint: closed, stories, series: log, today: "2026-10-21" }));
    expect(logged.source).toBe("log");
    expect(burnCaveats(logged, closed)[0]).toBe(
      "Read from the typed daily log, as the sprint is closed (closing can move its stories)."
    );
    const asked = burnSeries(
      input({ sprint: closed, stories, series: log, today: "2026-10-21", prefer: "stories" })
    );
    expect(asked).toMatchObject({ source: "stories", remaining: 10 });
  });

  it("says nothing is recorded for a closed sprint only when neither source holds anything", () => {
    const closed: Sprint = { ...SPRINT, status: "completed" };
    // No sprint moves: the board can't be rebuilt, and nothing was logged.
    const stories: Story[] = [{ id: "z", title: "Z", points: 5, status: "done", sprintId: "s1" }];
    const b = burnSeries(input({ sprint: closed, stories, today: "2026-10-21" }));
    expect(b).toMatchObject({ source: "none", available: { stories: false, log: false } });
    expect(burnStatus(b, closed).verdict).toBe("Sprint 7 is closed with nothing recorded.");
    expect(burnCaveats(b, closed)).toContain(
      "Nothing is recorded: no daily log was typed, and the stories' sprint moves can't rebuild the board."
    );
  });
});

describe("the typed log as the fallback", () => {
  const series: SprintSeries = {
    id: "s1",
    days: [
      { day: 0, remaining: 40 },
      { day: 2, remaining: 34, note: "Pairing" },
      { day: 3, completed: 10, scope: 44, scopeChange: true },
      { day: 9, remaining: 30 }, // typed ahead of today
    ],
  };
  const burn = burnSeries(input({ stories: [], series, sprint: { ...SPRINT, pointsPlanned: 40 } }));

  it("maps typed, worked-out and planned numbers, and reads up to today", () => {
    expect(burn.source).toBe("log");
    expect(burn.days.slice(0, 4).map((d) => [d.remaining, d.from])).toEqual([
      [40, "typed"],
      [null, null],
      [34, "typed"],
      [34, "derived"],
    ]);
    expect(burn.days[2].note).toBe("Pairing");
    expect(burn.days[3]).toMatchObject({ scope: 44, added: 4, scopeChangeFlag: true });
    // Day 9 is after today (day 7): it is charted, not read.
    expect(burn.days[9].remaining).toBe(30);
    expect(burn.lastDay).toBe(3);
    expect(burn).toMatchObject({ remaining: 34, done: 10, scopeNow: 44, scopeAdded: 4 });
  });

  it("plans day 0 from the commitment when nothing is typed, and reads nothing as none", () => {
    const none = burnSeries(input({ stories: [] }));
    expect(none.source).toBe("none");
    expect(none.days[0]).toMatchObject({ remaining: 38, from: "plan", done: 0 });
    expect(none.remaining).toBeNull();
    expect(burnStatus(none, SPRINT).gap).toBeNull();
  });

  it("agrees with the hub's sprintStatus on the team's working days", () => {
    const sprint = { ...SPRINT, pointsPlanned: 40 };
    const log: SprintSeries = {
      id: "s1",
      days: [
        { day: 0, remaining: 40 },
        { day: 1, remaining: 37 },
        { day: 3, remaining: 33 },
        { day: 4, remaining: 31 },
      ],
    };
    const b = burnSeries({
      sprint,
      series: log,
      stories: [],
      calendar: DEFAULT_CALENDAR,
      today: "2026-10-09",
    });
    const s = burnStatus(b, sprint);
    const hub = sprintStatus(sprint, log, { calendar: DEFAULT_CALENDAR });
    expect(s.idealRemaining).toBe(hub.idealRemaining);
    expect(s.gap).toBe(hub.gap);
    expect(s.projectedFinishDay).toBe(hub.projectedFinishDay);
    expect(s.willFinishOnTime).toBe(hub.willFinishOnTime);
    expect(s.completionPct).toBe(hub.percentDone);
  });
});

describe("the working-day ideal line and the numbers", () => {
  const burn = burnSeries(input());
  const status = burnStatus(burn, SPRINT);

  it("is flat over the weekend and holidays and 0 by the last day", () => {
    expect(burn.workingDays).toBe(10);
    expect(burn.days.map((d) => d.ideal)).toEqual([
      38, 34.2, 30.4, 26.6, 22.8, 19, 19, 19, 15.2, 11.4, 7.6, 3.8, 0, 0, 0,
    ]);
    expect(burn.days.filter((d) => !d.working).map((d) => d.day)).toEqual([5, 6, 12, 13]);
    expect(offDayRanges(burn)).toEqual([
      { from: 5, to: 7, off: "weekend" },
      { from: 12, to: 14, off: "weekend" },
    ]);
    const holiday = burnSeries(
      input({ calendar: normalizeCalendar({ holidays: ["2026-10-07"] }) })
    );
    expect(holiday.workingDays).toBe(9);
    expect(holiday.days[2]).toMatchObject({ working: false, off: "holiday" });
    expect(holiday.days[2].ideal).toBe(holiday.days[3].ideal);
  });

  it("without a calendar keeps the calendar-day line", () => {
    const plain = burnSeries(input({ calendar: undefined }));
    expect(plain.onWorkingDays).toBe(false);
    expect(plain.days[7].ideal).toBe(19);
    expect(plain.days.every((d) => d.working)).toBe(true);
    expect(burnCaveats(plain)).toContain("The ideal line counts calendar days.");
  });

  it("uses the shared gap (positive behind), completion of the current scope and the projection", () => {
    // Ideal on day 7: 38 × (1 − 5/10) = 19; 27 left.
    expect(status).toMatchObject({
      idealRemaining: 19,
      gap: 8,
      gapLabel: "Behind by 8 points",
      completionPct: 33, // 13 of the 40 now, not of the 38 planned
      cantTell: false,
    });
    expect(status.projectedFinishDay).not.toBeNull();
    expect(status.willFinishOnTime).toBe(false);
    expect(status.verdict).toMatch(
      /^Day 7 of 14: 13 of 40 points done, behind by 8 points; at this pace it finishes on day \d+, \d+ days late\.$/
    );
    expect(status.scopeVerdict).toMatch(
      /^Day 7 of 14: 13 of 40 points done \(33%\); the scope grew by 7 and lost 5 points since day 0; at this pace the work meets the scope /
    );
    expect(trendPoints(burn, SPRINT, "remaining").map((p) => p.x)).toEqual([
      0, 1, 2, 3, 4, 5, 5, 5,
    ]);
  });

  it("starts the ideal from the starting scope without a commitment", () => {
    expect(idealBase({ pointsPlanned: 0 }, 21)).toBe(21);
    expect(idealBase({ pointsPlanned: 30 }, 21)).toBe(30);
    const b = burnSeries(input({ sprint: { ...SPRINT, pointsPlanned: 0 } }));
    expect(b.base).toBe(38);
  });

  it("can't tell the pace while every pointed story is done and others have no points", () => {
    const stories: Story[] = [
      { ...BOARD[0] },
      { id: "u", title: "Unsized", status: "todo", sprintId: "s1" },
    ];
    const b = burnSeries(input({ stories }));
    const s = burnStatus(b, SPRINT);
    expect(b.unpointedOpen).toBe(1);
    expect(openUnpointed(stories, "s1")).toBe(1);
    expect(s.cantTell).toBe(true);
    expect(s.projectedFinishDay).toBeNull();
    expect(s.verdict).toMatch(/every pointed story is done, but 1 open story has no points yet/);
  });
});

describe("edges", () => {
  it("says when the sprint hasn't started, has no dates, or was cancelled", () => {
    const before = burnSeries(input({ today: "2026-10-01" }));
    expect(before.phase).toBe("before");
    expect(before.lastDay).toBeNull();
    expect(before.scopeNow).toBe(storyProgress(BOARD, "s1").scope);
    expect(burnStatus(before, SPRINT).verdict).toBe(
      "Sprint 7 starts in 4 days with 40 points planned."
    );

    const undated: Sprint = { ...SPRINT, startDate: "2020-01-01", endDate: "2020-01-02" };
    const u = burnSeries(input({ sprint: undated }));
    expect(u).toMatchObject({ phase: "undated", dated: false, lastDay: null });
    expect(u.days.every((d) => d.date === null)).toBe(true);
    expect(burnStatus(u, undated).verdict).toBe(
      "Sprint 7 has no dates yet, so its days can't be charted."
    );
    const cancelled: Sprint = { ...SPRINT, status: "cancelled" };
    expect(burnStatus(burnSeries(input({ sprint: cancelled })), cancelled).verdict).toBe(
      "Sprint 7 was cancelled."
    );
  });

  it("handles zero points, a huge board and a long sprint", () => {
    const zero: Story[] = [{ id: "z", title: "Z", points: 0, status: "done", sprintId: "s1" }];
    expect(burnSeries(input({ stories: zero })).source).toBe("none");

    const long: Sprint = { ...SPRINT, endDate: "2026-12-04" }; // 60 days
    const many: Story[] = Array.from({ length: 3000 }, (_, i) => ({
      id: `m${i}`,
      title: `M${i}`,
      points: 1,
      status: i % 2 === 0 ? "done" : "todo",
      sprintId: "s1",
      doneAt: at("2026-10-06"),
    }));
    const started = Date.now();
    const b = burnSeries(input({ sprint: long, stories: many, today: "2026-12-01" }));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(b.days).toHaveLength(61);
    expect(b.days[0].remaining).toBe(3000);
    expect(b.days[1].remaining).toBe(1500);
    expect(burnStatus(b, long).completionPct).toBe(50);
  });

  it("reads the board whatever the rule says, for the cockpit's board rows", () => {
    const closed: Sprint = { ...SPRINT, status: "completed" };
    expect(burnSeries(input({ sprint: closed, recordedOnly: true })).source).toBe("none");
    expect(boardBurn(input({ sprint: closed, recordedOnly: true })).source).toBe("stories");
  });

  it("words the scope churn", () => {
    expect(churnLine({ scopeAdded: 0, scopeRemoved: 0 })).toBe(
      "the scope hasn't changed since day 0"
    );
    expect(churnLine({ scopeAdded: 8, scopeRemoved: 0 })).toBe(
      "the scope grew by 8 points since day 0"
    );
    expect(churnLine({ scopeAdded: 0, scopeRemoved: 1 })).toBe(
      "the scope lost 1 point since day 0"
    );
  });
});

describe("review fixes", () => {
  const history = (status: Story["status"], from: Story["status"], day: string) => ({
    status,
    from,
    at: at(day),
  });

  it("reads the log's churn, scope, done and % on one day: its last reading", () => {
    const sprint = { ...SPRINT, pointsPlanned: 40 };
    // Scope typed on day 4 (Friday, today) with no done figure yet.
    const series: SprintSeries = {
      id: "s1",
      days: [
        { day: 3, completed: 13 },
        { day: 4, scope: 45 },
      ],
    };
    const b = burnSeries(input({ sprint, series, stories: [], today: "2026-10-09" }));
    expect(b).toMatchObject({ lastDay: 3, scopeNow: 40, scopeAdded: 0, done: 13 });
    // The chart still draws the rise on day 4.
    expect(b.days[4]).toMatchObject({ scope: 45, added: 5 });
    expect(burnStatus(b, sprint).scopeVerdict).toMatch(
      /^Day 4 of 14 \(last logged day 3\): 13 of 40 points done \(33%\); the scope hasn't changed since day 0/
    );
    // Once day 4 has a done figure, everything moves to it together.
    const later = burnSeries(
      input({
        sprint,
        stories: [],
        today: "2026-10-09",
        series: {
          id: "s1",
          days: [
            { day: 3, completed: 13 },
            { day: 4, scope: 45, completed: 15 },
          ],
        },
      })
    );
    expect(later).toMatchObject({ lastDay: 4, scopeNow: 45, scopeAdded: 5, done: 15 });
    expect(burnStatus(later, sprint).completionPct).toBe(33);
  });

  it("names the last logged day when the log's numbers are older than the sentence's day", () => {
    const series: SprintSeries = { id: "s1", days: [{ day: 9, remaining: 12 }] };
    const over = burnSeries(input({ series, stories: [], today: "2026-10-21" }));
    expect(burnStatus(over, SPRINT).verdict).toMatch(
      /^Sprint 7 ended 2 days ago \(last logged day 9\): 26 of 38 points done/
    );
    // A reading on the day itself needs no aside, and the board never has one.
    const today = burnSeries(input({ series, stories: [], today: "2026-10-14" }));
    expect(burnStatus(today, SPRINT).verdict).toMatch(/^Day 9 of 14: 26 of 38 points done/);
    expect(burnStatus(burnSeries(input()), SPRINT).verdict).toMatch(/^Day 7 of 14: /);
  });

  it("reads stories planned in before the work began as the starting scope (a backdated sprint)", () => {
    // Created on Thursday (day 3) with Monday as its first day; nothing moved yet.
    const planned: Story[] = ["p", "q", "r", "s"].map((id) => ({
      id,
      title: id,
      points: 10,
      status: "todo",
      sprintId: "s1",
      sprintHistory: [joined("2026-10-08", 10)],
    }));
    const b = burnSeries(input({ stories: planned, today: "2026-10-08" }));
    expect(b.days.slice(0, 4).map((d) => d.scope)).toEqual([40, 40, 40, 40]);
    expect(b.days.slice(0, 4).map((d) => d.remaining)).toEqual([40, 40, 40, 40]);
    expect(b).toMatchObject({ initialScope: 40, scopeAdded: 0, scopeRemoved: 0 });
    // Without a commitment the ideal starts from that scope, not from 0.
    const uncommitted = { ...SPRINT, pointsPlanned: 0 };
    const u = burnSeries(input({ sprint: uncommitted, stories: planned, today: "2026-10-08" }));
    expect(u.base).toBe(40);
    expect(u.days[0].ideal).toBe(40);

    // A story planned in and taken out again before anyone started isn't churn either.
    const dropped: Story = {
      id: "t",
      title: "t",
      points: 5,
      status: "backlog",
      sprintHistory: [joined("2026-10-06", 5), { from: "s1", at: at("2026-10-07"), points: 5 }],
    };
    const d = burnSeries(input({ stories: [...planned, dropped], today: "2026-10-08" }));
    expect(d).toMatchObject({ initialScope: 40, scopeAdded: 0, scopeRemoved: 0 });
  });

  it("still counts scope added once the work has begun", () => {
    const stories: Story[] = [
      {
        id: "a",
        title: "A",
        points: 10,
        status: "in_progress",
        sprintId: "s1",
        sprintHistory: [joined("2026-10-05", 10)],
        statusHistory: [history("in_progress", "todo", "2026-10-06")],
      },
      {
        id: "b",
        title: "B",
        points: 10,
        status: "todo",
        sprintId: "s1",
        sprintHistory: [joined("2026-10-05", 10)],
      },
      {
        id: "c",
        title: "C",
        points: 7,
        status: "todo",
        sprintId: "s1",
        sprintHistory: [joined("2026-10-08", 7)],
      },
    ];
    const b = burnSeries(input({ stories, today: "2026-10-08" }));
    expect(b.days.slice(0, 4).map((d) => d.scope)).toEqual([20, 20, 20, 27]);
    expect(b).toMatchObject({ initialScope: 20, scopeAdded: 7 });
  });

  it("starts the ideal from the first scope when day 0 had none and nothing was committed", () => {
    const sprint = { ...SPRINT, pointsPlanned: 0 };
    const stories: Story[] = [
      // Unsized work started on day 0, so the work began then…
      { id: "u", title: "Spike", status: "in_progress", sprintId: "s1" },
      // …and the pointed story arrived on day 2: scope added.
      {
        id: "p",
        title: "P",
        points: 10,
        status: "todo",
        sprintId: "s1",
        sprintHistory: [joined("2026-10-07", 10)],
      },
    ];
    const b = burnSeries(input({ sprint, stories, today: "2026-10-08" }));
    expect(b).toMatchObject({ initialScope: 0, scopeAdded: 10, base: 10 });
    expect(b.days[0].ideal).toBe(10);
  });

  it("reads an ended, still open sprint's last day as the board now", () => {
    const stories: Story[] = [
      {
        id: "x",
        title: "X",
        points: 10,
        status: "in_progress",
        sprintId: "s1",
        sprintHistory: [joined("2026-10-05", 10)],
        statusHistory: [history("in_progress", "todo", "2026-10-06")],
      },
      {
        id: "y",
        title: "Y",
        points: 5,
        status: "backlog",
        // Moved back to the backlog on day 15, after the end, before the close.
        sprintHistory: [joined("2026-10-05", 5), { from: "s1", at: at("2026-10-20"), points: 5 }],
      },
    ];
    const open = burnSeries(input({ stories, today: "2026-10-21" }));
    expect(open.remaining).toBe(storyProgress(stories, "s1").remaining);
    expect(open.days[14]).toMatchObject({ scope: 10, remaining: 10, removed: 5 });
    expect(burnStatus(open, SPRINT).gapLabel).toBe("Behind by 10 points");
    // Once it is closed, a move after the end (Sprint Planning's carry-over) is its unfinished work.
    const closed = { ...SPRINT, status: "completed" as const };
    const after = burnSeries(input({ sprint: closed, stories, today: "2026-10-21" }));
    expect(after.days[14]).toMatchObject({ scope: 15, remaining: 15, removed: 0 });
  });

  it("works each day's gap out from the exact ideal, as the tiles do", () => {
    // Mon 5 → Thu 15 Oct: 8 working days, so day 1's ideal is 26.25 (26.3 on the chart).
    const sprint: Sprint = { ...SPRINT, endDate: "2026-10-15", pointsPlanned: 30 };
    const series: SprintSeries = {
      id: "s1",
      days: [
        { day: 0, remaining: 30 },
        { day: 1, remaining: 26 },
      ],
    };
    const b = burnSeries(input({ sprint, series, stories: [], today: "2026-10-06" }));
    const s = burnStatus(b, sprint);
    expect(b.days[1]).toMatchObject({ ideal: 26.3, remaining: 26, gap: -0.2 });
    expect(s).toMatchObject({ gap: -0.2, gapLabel: "Ahead by 0.2 points" });
    expect(
      burnReport({ sprint, series, stories: [], calendar: DEFAULT_CALENDAR, today: "2026-10-06" })
        .days[1].gap
    ).toBe(-0.2);
  });

  it("keeps the cockpit on what a closed sprint recorded, and its chart text on the day's gap", () => {
    const closed: Sprint = { ...SPRINT, status: "completed", pointsCompleted: 13 };
    const recorded = cockpitBurndown(
      closed,
      undefined,
      BOARD,
      "2026-10-21",
      undefined,
      DEFAULT_CALENDAR
    );
    expect(recorded.source).toBe("none");

    const sprint: Sprint = { ...SPRINT, endDate: "2026-10-15", pointsPlanned: 30 };
    const series: SprintSeries = {
      id: "s1",
      days: [
        { day: 0, remaining: 30 },
        { day: 1, remaining: 26 },
      ],
    };
    const cockpit = cockpitBurndown(sprint, series, [], "2026-10-06", undefined, DEFAULT_CALENDAR);
    expect(cockpit.burnStatus.gapLabel).toBe("Ahead by 0.2 points");
    expect(cockpitChartText(cockpit).summary).toMatch(/0\.2 points ahead of the ideal line/);
  });

  it("says why an open sprint is read from its log", () => {
    const series: SprintSeries = { id: "s1", days: [{ day: 2, remaining: 30 }] };
    const asked = burnSeries(input({ series, prefer: "log" }));
    expect(asked.source).toBe("log");
    expect(burnCaveats(asked, SPRINT)).toContain(
      "Read from the typed daily log, as asked; the board has pointed stories too."
    );
    expect(burnCaveats(asked, SPRINT).join(" ")).not.toMatch(/closed/);
  });
});

describe("the example", () => {
  it("burns 13 of 38 points by day 5, with 8 added and 5 removed, and writes nothing", () => {
    const ex = exampleBurndown("2026-10-22");
    const b = burnSeries({
      sprint: ex.current,
      series: ex.series.find((s) => s.id === ex.current.id),
      stories: ex.stories,
      calendar: DEFAULT_CALENDAR,
      today: "2026-10-22",
    });
    expect(b.source).toBe("stories");
    expect(b.available).toEqual({ stories: true, log: true });
    expect(b).toMatchObject({
      initialScope: 35,
      scopeNow: 38,
      scopeAdded: 8,
      scopeRemoved: 5,
      done: 13,
      remaining: 25,
      lastDay: 5,
    });
    expect(burnStatus(b, ex.current).completionPct).toBe(34);
    expect(ex.stories.every((s) => s.id.startsWith("example-"))).toBe(true);
  });

  it("gives an agent the same numbers as the page", () => {
    const ex = exampleBurndown("2026-10-22");
    const args: BurnInput = {
      sprint: ex.current,
      series: ex.series.find((s) => s.id === ex.current.id),
      stories: ex.stories,
      calendar: DEFAULT_CALENDAR,
      today: "2026-10-22",
    };
    const b = burnSeries(args);
    const s = burnStatus(b, ex.current);
    const r = burnReport(args);
    expect(r).toMatchObject({
      source: b.source,
      remaining: b.remaining,
      gap: s.gap,
      completionPct: s.completionPct,
      projectedFinishDay: s.projectedFinishDay,
      projectedMeetDay: s.projectedMeetDay,
      verdict: s.verdict,
    });
    expect(r.days).toHaveLength(b.days.length);
  });
});
