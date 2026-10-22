import { describe, expect, it } from "vitest";
import type { Impediment, RetroBoard, Sprint, StandupEntry } from "@/lib/stores/workspace-types";
import { sprintStatus } from "@/lib/sprints/metrics";
import { retroFormats } from "@/lib/constants/retro-formats";
import {
  blockersTile,
  daysLeftLine,
  flowCards,
  gatherCockpitData,
  openImpediments,
  RETRO_CURRENT_ID,
  type CockpitInput,
} from "@/app/(tools)/sprint/view";

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
  retro: { hasRetro: false, lastActions: 0, currentCards: 0 },
};

const card = (input: CockpitInput, kind: string) => flowCards(input).find((c) => c.kind === kind)!;

describe("flowCards", () => {
  it("lists the five ceremonies in sprint order", () => {
    expect(flowCards(base).map((c) => c.kind)).toEqual([
      "planning",
      "daily",
      "refinement",
      "review",
      "retro",
    ]);
  });

  it("planning: goal and commitment make it done; either alone is in progress", () => {
    expect(card(base, "planning")).toMatchObject({
      state: "done",
      line: "Goal set · 30 pts committed",
      href: "/sprint-planning",
    });
    expect(
      card(
        { ...base, sprintStories: [{ id: "a", title: "A", status: "todo", points: 3 }] },
        "planning"
      ).line
    ).toBe("Goal set · 30 pts committed · 1 story");
    expect(card({ ...base, sprint: { ...SPRINT, goal: "" } }, "planning")).toMatchObject({
      state: "doing",
      line: "30 pts committed · no goal yet",
      href: "/sprint-planning",
    });
    expect(card({ ...base, sprint: { ...SPRINT, pointsPlanned: 0 } }, "planning")).toMatchObject({
      state: "doing",
      href: "/sprint-planning",
    });
    expect(
      card({ ...base, sprint: { ...SPRINT, goal: undefined, pointsPlanned: 0 } }, "planning")
    ).toMatchObject({ state: "todo", line: "No goal or commitment yet" });
  });

  it("daily: counts today's updates against the roster", () => {
    expect(card(base, "daily")).toMatchObject({ state: "todo", line: "No updates yet today" });
    expect(
      card({ ...base, standup: { posted: 3, members: 6, blockers: 1 } }, "daily")
    ).toMatchObject({ state: "doing", line: "3 of 6 updated today · 1 blocker" });
    expect(
      card({ ...base, standup: { posted: 6, members: 6, blockers: 0 } }, "daily")
    ).toMatchObject({ state: "done", line: "Everyone updated today" });
    expect(card({ ...base, standup: { posted: 2, members: 0, blockers: 0 } }, "daily").line).toBe(
      "2 updates today"
    );
  });

  it("refinement: unestimated sprint stories first, then the backlog", () => {
    const stories = [
      { id: "a", title: "A", status: "todo" as const, points: 3 },
      { id: "b", title: "B", status: "todo" as const },
    ];
    expect(card({ ...base, sprintStories: stories }, "refinement")).toMatchObject({
      state: "doing",
      line: "1 sprint story without points",
      href: "/planning-poker",
    });
    expect(card({ ...base, backlogUnestimated: 4 }, "refinement")).toMatchObject({
      state: "todo",
      line: "4 backlog stories to size",
      href: "/refinement",
    });
    expect(card({ ...base, sprintStories: [stories[0]] }, "refinement")).toMatchObject({
      state: "done",
      line: "All 1 sprint story sized",
    });
  });

  it("review and retro follow their tools' state", () => {
    expect(card(base, "review")).toMatchObject({ state: "todo", line: "No demo script yet" });
    expect(card({ ...base, review: { demoItems: 2, feedback: 1 } }, "review").line).toBe(
      "2 demo items · 1 feedback note"
    );
    expect(card(base, "retro")).toMatchObject({ state: "todo", line: "No retro yet" });
    expect(
      card({ ...base, retro: { hasRetro: true, lastActions: 3, currentCards: 0 } }, "retro")
    ).toMatchObject({ state: "doing", line: "3 actions from the last retro" });
    expect(
      card({ ...base, retro: { hasRetro: true, lastActions: 3, currentCards: 5 } }, "retro")
    ).toMatchObject({ state: "doing", line: "Retro in progress · 5 cards" });
    expect(
      card({ ...base, retro: { hasRetro: true, lastActions: 0, currentCards: 0 } }, "retro").state
    ).toBe("done");
  });
});

const IMPS: Impediment[] = [
  { id: "low", title: "Low", severity: "low", raisedAt: "2026-10-10" },
  { id: "crit", title: "Crit", severity: "critical", raisedAt: "2026-10-18" },
  {
    id: "done",
    title: "Done",
    severity: "critical",
    raisedAt: "2026-10-01",
    resolvedAt: "2026-10-05",
  },
  { id: "high-old", title: "High old", severity: "high", raisedAt: "2026-10-12" },
  { id: "high-new", title: "High new", severity: "high", raisedAt: "2026-10-16" },
];

describe("blockers", () => {
  it("lists open impediments worst and oldest first", () => {
    expect(openImpediments(IMPS).map((i) => i.id)).toEqual(["crit", "high-old", "high-new", "low"]);
  });

  it("tiles the count with the high-or-critical warning", () => {
    expect(blockersTile(openImpediments(IMPS))).toMatchObject({
      id: "blockers",
      value: "4",
      unit: "impediments",
      hint: "3 high or critical",
      tone: "warning",
    });
    expect(blockersTile([])).toMatchObject({ value: "0", tone: "success" });
    expect(blockersTile([IMPS[0]])).toMatchObject({ unit: "impediment", tone: "default" });
  });
});

describe("daysLeftLine", () => {
  it("adds the days left to the hub's day line", () => {
    expect(daysLeftLine("Day 3 of 10")).toBe("Day 3 of 10 · 7 days left");
    expect(daysLeftLine("Day 10 of 10")).toBe("Day 10 of 10 · last day");
    expect(daysLeftLine("No dates set")).toBe("No dates set");
  });
});

describe("gatherCockpitData", () => {
  const entry = (member: string, date: string, blockers = ""): StandupEntry => ({
    id: `${member}-${date}`,
    member,
    date,
    yesterday: "",
    today: "",
    blockers,
    timestamp: 0,
  });
  const retroCard = (id: string, action: boolean) => ({
    id,
    columnKey: "start",
    text: id,
    votes: 0,
    groupedWith: null,
    isActionItem: action,
    assignee: "",
    discussing: false,
  });
  const boards: RetroBoard[] = [
    {
      id: RETRO_CURRENT_ID,
      format: retroFormats[0],
      phase: "write",
      cards: [],
      userVotes: 0,
      timerSeconds: 0,
      timerRunning: false,
      discussingIndex: 0,
      previousRetroId: "retro:2026-10-10T10:00:00.000Z",
    },
    {
      id: "retro:2026-10-10T10:00:00.000Z",
      archivedAt: "2026-10-10T10:00:00.000Z",
      format: retroFormats[0],
      phase: "actions",
      cards: [retroCard("a1", true), retroCard("note", false), retroCard("a2", true)],
      userVotes: 0,
      timerSeconds: 0,
      timerRunning: false,
      discussingIndex: 0,
    },
  ];

  it("reads the sprint's stories, today's standup, open blockers, the review and the last retro", () => {
    const data = gatherCockpitData({
      sprint: SPRINT,
      series: undefined,
      stories: [
        { id: "in", title: "In", status: "todo", sprintId: "s2", points: 5 },
        { id: "other", title: "Other sprint", status: "todo", sprintId: "s1", points: 5 },
        { id: "bl", title: "Backlog unsized", status: "backlog" },
        { id: "bl2", title: "Backlog sized", status: "backlog", points: 3 },
      ],
      impediments: IMPS,
      standupEntries: [
        entry("Ann", "2026-10-19", "Waiting on API"),
        entry("ann", "2026-10-19"),
        entry("Bob", "2026-10-18"),
      ],
      teamMembers: [
        { id: "m1", name: "Ann" },
        { id: "m2", name: "Bob" },
      ],
      retroBoards: boards,
      reviews: [
        {
          id: "sprint-review:current",
          sprintName: "",
          sprintNumber: "",
          features: [
            { id: "f", name: "F", description: "", acceptanceCriteria: "", timeMinutes: 5 },
          ],
          meetingDate: "",
          feedbackItems: [],
          checklistItems: [],
          committed: 0,
          completed: 0,
          totalBacklog: 0,
          backlogDone: 0,
        },
      ],
      today: "2026-10-19",
    });
    expect(data.sprintStories.map((s) => s.id)).toEqual(["in"]);
    expect(data.backlogUnestimated).toBe(1);
    expect(data.standup).toEqual({ posted: 1, members: 2, blockers: 1 });
    expect(data.openImpediments.map((i) => i.id)).toEqual(["crit", "high-old", "high-new", "low"]);
    expect(data.review).toEqual({ demoItems: 1, feedback: 0 });
    expect(data.retro).toEqual({ hasRetro: true, lastActions: 2, currentCards: 0 });
    expect(data.lastRetroActions.map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(data.status.committed).toBe(30);
  });
});
