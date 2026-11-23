/**
 * Team Time's next steps (chain C18's own cases): time zones for the
 * roster, written updates when the saved cadence's Daily Scrum is outside
 * people's hours (never without a saved cadence), core hours and an urgency
 * ladder when the charter has neither, and a poll left waiting. Example rows
 * never count. Zones are passed in; nothing reads the machine's own.
 */

import { describe, expect, it } from "vitest";
import { getNextStepRule, loadNextStepRule } from "@/lib/tools/next-steps";
import { teamTimeSteps, type TeamTimeStepsInput } from "@/lib/team-time/next-step";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import {
  CEREMONY_CADENCE_ID,
  WORKING_AGREEMENT_ID,
  emptyWorkspace,
  type TeamTimePoll,
  type WorkingAgreement,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { AT, london, newYork, person, tokyo } from "../team-time/fixtures";

const NOW = new Date("2026-11-16T06:00:00Z");
const input = (over: Partial<TeamTimeStepsInput> = {}): TeamTimeStepsInput => ({
  people: [],
  members: [],
  cadences: undefined,
  agreements: undefined,
  polls: undefined,
  ...over,
});
const ids = (s: TeamTimeStepsInput, zone = "Europe/London") =>
  teamTimeSteps(s, NOW, zone).map((x) => x.id);
const cadence = { id: CEREMONY_CADENCE_ID, ...DEFAULT_CADENCE };
const charter = (templateIds: string[]): WorkingAgreement[] => [
  {
    id: WORKING_AGREEMENT_ID,
    meta: { version: 0 },
    rules: templateIds.map((id, i) => ({
      id: `r${i}`,
      category: "communication",
      text: `Rule ${i}`,
      agreedBy: [],
      template: { id: id as "core-hours", slot: "core" },
    })),
  } as WorkingAgreement,
];
const poll = (over: Partial<TeamTimePoll> = {}): TeamTimePoll => ({
  id: "poll1",
  title: "Review",
  minutes: 60,
  slots: [{ id: "a", start: "2026-11-20T15:00:00.000Z" }],
  answers: [],
  status: "open",
  createdAt: "2026-11-12T06:00:00.000Z",
  updatedAt: AT,
  ...over,
});

describe("team-time-zones", () => {
  const members = [
    { id: "m1", name: "Lou" },
    { id: "m2", name: "Noor" },
    { id: "m3", name: "Taro" },
  ];

  it("asks for the time zones while fewer than half of the roster have them", () => {
    const steps = teamTimeSteps(
      input({ members, people: [{ ...london, teamMemberId: "m1" }] }),
      NOW,
      "UTC"
    );
    expect(steps[0]).toEqual({
      id: "team-time-zones",
      label: "Add your team's time zones",
      detail: "1 of 3 people on the roster have their hours in Team Time.",
      href: "/team-time",
    });
  });

  it("stops once half have them, and needs two roster people", () => {
    const people = [
      { ...london, teamMemberId: "m1" },
      { ...newYork, name: "Noor" },
    ];
    expect(ids(input({ members, people }))).not.toContain("team-time-zones");
    expect(ids(input({ members: members.slice(0, 1) }))).not.toContain("team-time-zones");
  });

  it("never counts an example row", () => {
    const people = [
      { ...london, id: "example-1", teamMemberId: "m1" },
      { ...newYork, id: "example-2", name: "Noor" },
    ];
    expect(ids(input({ members, people }))).toContain("team-time-zones");
  });
});

describe("team-time-daily", () => {
  const people = [london, tokyo, newYork];

  it("suggests written updates for the people the Daily Scrum is outside hours for", () => {
    const step = teamTimeSteps(input({ people, cadences: [cadence] }), NOW, "Europe/London").find(
      (s) => s.id === "team-time-daily"
    );
    expect(step).toEqual({
      id: "team-time-daily",
      label: "Use written updates for 2 people outside their hours",
      detail: "The Daily Scrum at 09:30 your time is outside working hours for Taro and Noor.",
      href: "/async-standup",
    });
  });

  it("says nothing without a saved cadence, or when it suits everyone", () => {
    expect(ids(input({ people }))).not.toContain("team-time-daily");
    expect(ids(input({ people: [london], cadences: [cadence] }))).not.toContain("team-time-daily");
  });
});

describe("team-time-core-hours and team-time-ladder", () => {
  it("asks for core hours when everyone shares under an hour", () => {
    const steps = teamTimeSteps(input({ people: [london, tokyo] }), NOW, "UTC");
    expect(steps.find((s) => s.id === "team-time-core-hours")).toMatchObject({
      label: "Agree core hours",
      href: "/working-agreement?template=core-hours",
    });
    expect(ids(input({ people: [london, newYork] }))).not.toContain("team-time-core-hours");
  });

  it("leaves core hours out once the charter has them", () => {
    expect(
      ids(input({ people: [london, tokyo], agreements: charter(["core-hours"]) }))
    ).not.toContain("team-time-core-hours");
  });

  it("asks for an urgency ladder across places 3 hours apart or more", () => {
    const steps = teamTimeSteps(input({ people: [london, newYork] }), NOW, "UTC");
    expect(steps.find((s) => s.id === "team-time-ladder")).toMatchObject({
      label: "Add an urgency ladder",
      href: "/working-agreement?template=urgency-ladder",
    });
    const neighbour = person({ id: "dublin", timeZone: "Europe/Dublin" });
    expect(ids(input({ people: [london, neighbour] }))).not.toContain("team-time-ladder");
    expect(
      ids(input({ people: [london, newYork], agreements: charter(["urgency-ladder"]) }))
    ).not.toContain("team-time-ladder");
  });
});

describe("team-time-poll", () => {
  it("nudges a poll open for 3 days with no time chosen", () => {
    const steps = teamTimeSteps(input({ polls: [poll()] }), NOW, "UTC");
    expect(steps).toEqual([
      {
        id: "team-time-poll",
        label: "Choose a time for Review",
        detail: "The poll has been open for 4 days.",
        href: "/team-time",
      },
    ]);
  });

  it("leaves a new, a closed or an example poll alone", () => {
    expect(ids(input({ polls: [poll({ createdAt: "2026-11-15T06:00:00.000Z" })] }))).toEqual([]);
    expect(ids(input({ polls: [poll({ status: "closed", chosenSlotId: "a" })] }))).toEqual([]);
    expect(ids(input({ polls: [poll({ id: "example-poll" })] }))).toEqual([]);
  });
});

describe("the rule", () => {
  it("reads the workspace through its select and gives nothing for an empty one", async () => {
    await loadNextStepRule("team-time");
    const rule = getNextStepRule("team-time")!;
    expect(rule.steps(rule.select({ ...emptyWorkspace } as Workspace))).toEqual([]);
    const ws = {
      ...emptyWorkspace,
      teamTimePolls: [poll({ createdAt: "2020-01-01T00:00:00.000Z" })],
    };
    expect(rule.steps(rule.select(ws as Workspace)).map((s) => s.id)).toEqual(["team-time-poll"]);
  });
});
