import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getNextStepRule, loadAllNextStepRules } from "@/lib/tools/next-steps";
import type {
  AdkarInitiative,
  CharterRule,
  DefinitionOfDone,
  HandoffLink,
  HealthCheck,
  HealthCheckEntry,
  Kudos,
  MaturityAssessmentEntry,
  MeetingAudit,
  MoodEntry,
  MoodPulse,
  NotebookEntry,
  PsychSafetyCounts,
  PsychSafetyQuestionId,
  PsychSafetyResponse,
  PsychSafetyRound,
  RaciMatrix,
  Release,
  RetroBoard,
  RetroCard,
  SkillsMatrix,
  Sprint,
  Story,
  TeamMember,
  WorkingAgreement,
  Workspace,
} from "@/lib/stores/workspace-types";
import { HEALTH_CHECK_DIMENSIONS } from "@/lib/stores/workspace-types";
import { blankRetroBoard } from "@/lib/retro/board";
import { retroFormats } from "@/lib/constants/retro-formats";
import { DOD_GATE } from "@/lib/releases/gates";
import { emptySnapshot } from "@/lib/health-check/score";

/**
 * Next steps for the Team & people tools (Phase 6): each reads the
 * workspace through the tool's own model and points somewhere real,
 * ignores example rows, and stays quiet when nothing applies. Also the
 * Definition of Done as Release Readiness and the Sprint board read it.
 * The pulse tools' steps are team level: none names or singles out anyone.
 */

// The tools plan's phase 1 rules load their models on demand (lazyRule).
beforeAll(loadAllNextStepRules);

const steps = (toolId: string, ws: Partial<Workspace>) => {
  const rule = getNextStepRule(toolId);
  if (!rule) throw new Error(`no rule for ${toolId}`);
  return rule.steps(rule.select(ws as Workspace));
};
const ids = (toolId: string, ws: Partial<Workspace>) => steps(toolId, ws).map((s) => s.id);

// Monday 26 Oct 2026, mid-sprint.
const TODAY = "2026-10-26";

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  pointsPlanned: 20,
  status: "active",
  ...over,
});
const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: id,
  status: "todo",
  points: 3,
  sprintId: "s2",
  ...over,
});
const member = (id: string, name: string): TeamMember => ({ id, name });
const TEAM = [member("m1", "Ana"), member("m2", "Bo"), member("m3", "Cy")];

const board = (id: string, cards: RetroCard[], over: Partial<RetroBoard> = {}): RetroBoard => ({
  ...blankRetroBoard(retroFormats[0]),
  id,
  cards,
  ...over,
});
const card = (id: string, over: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text: id,
  votes: 0,
  groupedWith: null,
  isActionItem: false,
  assignee: "",
  discussing: false,
  ...over,
});

/** A hand-off link to the retro topic `targetId`. */
const toRetro = (targetId: string): HandoffLink[] => [
  { route: "retro-topic", targetId, at: "2026-10-21T10:00:00.000Z" },
];
const ARCHIVED = { archivedAt: "2026-10-23T16:00:00.000Z" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
});
afterEach(() => vi.useRealTimers());

describe("health check", () => {
  type Light = "green" | "yellow" | "red";
  const scores = (lights: Partial<Record<string, Light>> = {}) =>
    Object.fromEntries(
      HEALTH_CHECK_DIMENSIONS.map((d) => [d, { light: lights[d] ?? "green", trend: "same" }])
    ) as HealthCheckEntry["scores"];
  const check = (id: string, date: string, over: Partial<HealthCheckEntry> = {}) => ({
    id,
    sprintName: "",
    date,
    scores: scores(),
    ...over,
  });
  const doc = (history: HealthCheckEntry[]): HealthCheck[] => [
    { id: "healthCheck:current", current: emptySnapshot(), history },
  ];
  const s1 = sprint({
    id: "s1",
    name: "Sprint 1",
    startDate: "2026-10-05",
    endDate: "2026-10-16",
    status: "completed",
  });
  const reds = (over: Partial<HealthCheckEntry["scores"]> = {}) => ({
    ...scores({ "Health of Codebase": "red", Speed: "red" }),
    ...over,
  });

  it("sends the latest check's reds to the retro, in page order", () => {
    const out = steps("health-check", {
      healthChecks: doc([
        check("old", "2026-10-09", { scores: scores({ Fun: "red" }) }),
        check("c2", "2026-10-23", { sprintId: "s2", sprintName: "Sprint 2", scores: reds() }),
      ]),
      retroBoards: [],
      sprints: [sprint()],
    });
    expect(out).toEqual([
      {
        id: "health-check-send-reds",
        label: "Send the 2 red dimensions to the retro",
        detail:
          "Health of Codebase and Speed were red in the Sprint 2 check. “Send reds to retro” under Saved checks makes each one a topic.",
        href: "/health-check",
      },
    ]);
  });

  it("counts only the reds still to send, then points at the retro board", () => {
    const sentCodebase = { light: "red" as const, trend: "same" as const, sentTo: toRetro("t1") };
    const both = reds({
      "Health of Codebase": sentCodebase,
      Speed: { ...sentCodebase, sentTo: toRetro("t2") },
    });
    const ws = (s: HealthCheckEntry["scores"], boards: RetroBoard[]) => ({
      healthChecks: doc([check("c2", "2026-10-23", { scores: s })]),
      retroBoards: boards,
      sprints: [],
    });
    const current = board("retro:current", [card("t1"), card("t2")]);
    // One sent, one not: the check's button reads "Send 1 more" then.
    expect(
      steps("health-check", ws(reds({ "Health of Codebase": sentCodebase }), [current]))
    ).toEqual([
      expect.objectContaining({
        id: "health-check-send-reds",
        label: "Send the 1 red dimension to the retro",
        detail:
          "Speed was red in the check of 23 Oct. “Send 1 more” under Saved checks makes it a topic.",
      }),
    ]);
    // A red whose topic is on a held retro counts as sent, as on the page.
    expect(
      steps(
        "health-check",
        ws(reds({ "Health of Codebase": sentCodebase }), [
          board("retro:old", [card("t1")], ARCHIVED),
        ])
      )[0].detail
    ).toBe(
      "Speed was red in the check of 23 Oct. “Send 1 more” under Saved checks makes it a topic."
    );
    // The only red, not sent yet: the button keeps its first label.
    expect(steps("health-check", ws(scores({ Speed: "red" }), [current]))[0].detail).toBe(
      "Speed was red in the check of 23 Oct. “Send reds to retro” under Saved checks makes it a topic."
    );
    expect(steps("health-check", ws(both, [current]))).toEqual([
      {
        id: "health-check-discuss-reds",
        label: "Discuss the 2 red dimensions at the retro",
        detail:
          "Health of Codebase and Speed from the check of 23 Oct are on the current retro board as topics.",
        href: "/retro",
      },
    ]);
    // A card removed from the board can be sent again; an archived retro has been held.
    expect(ids("health-check", ws(both, [board("retro:current", [card("t1")])]))).toEqual([
      "health-check-send-reds",
    ]);
    expect(
      ids("health-check", ws(both, [board("retro:old", [card("t1"), card("t2")], ARCHIVED)]))
    ).toEqual([]);
  });

  it("compares quality across sprints once another sprint has a check", () => {
    const ws = (history: HealthCheckEntry[]) => ({
      healthChecks: doc(history),
      retroBoards: [],
      sprints: [s1, sprint()],
    });
    const latest = check("c2", "2026-10-23", { sprintId: "s2", sprintName: "Sprint 2" });
    expect(
      steps("health-check", ws([check("c1", "2026-10-15", { sprintId: "s1" }), latest]))
    ).toEqual([
      {
        id: "health-check-compare",
        label: "Compare quality across sprints",
        detail:
          "Sprint Comparison suggests Sprint 2's Quality from this check's Health of Codebase and Easy to Release lights, next to 1 other sprint with a check.",
        href: "/sprint-compare?sprint=s2",
      },
    ]);
    // Only this sprint has a check: nothing to compare it with yet.
    expect(ids("health-check", ws([latest]))).toEqual([]);
  });

  it("shows the change in health on the Team Dashboard when nothing else applies", () => {
    const yellow = (n: number) =>
      scores(Object.fromEntries(HEALTH_CHECK_DIMENSIONS.slice(0, n).map((d) => [d, "yellow"])));
    const ws = (a: number, b: number) => ({
      healthChecks: doc([
        check("c1", "2026-10-09", { scores: yellow(a) }),
        check("c2", "2026-10-23", { scores: yellow(b) }),
      ]),
      retroBoards: [],
      sprints: [],
    });
    expect(steps("health-check", ws(8, 4))).toEqual([
      {
        id: "health-check-dashboard",
        label: "See team health on the Team Dashboard",
        detail: "Health went from 50% to 75% since the check before.",
        href: "/health-dashboard",
      },
    ]);
    expect(steps("health-check", ws(4, 4))[0].detail).toBe(
      "Health held at 75% since the check before."
    );
  });

  it("reads saved checks only, never an example one", () => {
    expect(
      ids("health-check", {
        healthChecks: doc([check("example-c1", "2026-10-23", { scores: reds() })]),
        retroBoards: [],
        sprints: [],
      })
    ).toEqual([]);
    // One real check, all green, for no sprint: nothing to do.
    expect(
      ids("health-check", {
        healthChecks: doc([check("c1", "2026-10-23")]),
        retroBoards: [],
        sprints: [],
      })
    ).toEqual([]);
    expect(ids("health-check", { healthChecks: [], retroBoards: [], sprints: [] })).toEqual([]);
  });
});

describe("psych safety", () => {
  const SAFE: PsychSafetyCounts = [0, 0, 0, 3, 3]; // 4.5
  const SAFE_REVERSED: PsychSafetyCounts = [3, 3, 0, 0, 0]; // 1.5 raw, 4.5 reverse-scored
  const REVERSED = new Set(["q1", "q3", "q5"]);
  const counts = (over: Partial<Record<PsychSafetyQuestionId, PsychSafetyCounts>> = {}) =>
    Object.fromEntries(
      (["q1", "q2", "q3", "q4", "q5", "q6", "q7"] as const).map((q) => [
        q,
        over[q] ?? (REVERSED.has(q) ? SAFE_REVERSED : SAFE),
      ])
    ) as PsychSafetyRound["counts"];
  const round = (
    id: string,
    name: string,
    date: string,
    over: Partial<PsychSafetyRound> = {}
  ): PsychSafetyRound => ({
    id,
    name,
    date,
    source: "room",
    responses: 6,
    counts: counts(),
    createdAt: `${date}T10:00:00.000Z`,
    ...over,
  });
  const spring = round("r1", "Spring check-in", "2026-06-01");
  const log = (rounds: PsychSafetyRound[], responses: PsychSafetyResponse[] = []) => [
    { id: "psychSafety:current", responses, rounds },
  ];
  // Q4 falls from 4.5 to 3.
  const autumn = (over: Partial<PsychSafetyRound> = {}) =>
    round("r2", "Autumn check-in", "2026-10-20", {
      counts: counts({ q4: [0, 0, 6, 0, 0] }),
      ...over,
    });

  it("sends a drop between the last two rounds to the retro, naming statements only", () => {
    expect(
      steps("psych-safety", { psychSafetyLogs: log([spring, autumn()]), retroBoards: [] })
    ).toEqual([
      {
        id: "psych-safety-send-drop",
        label: "Send the drop to the retro",
        detail:
          "“It is safe to take a risk on this team.” fell by more than 0.5 since Spring check-in. Use “Send to…” → “Retro topic (no names)” under Results: the topic names the statements, never who answered what.",
        href: "/psych-safety",
      },
    ]);
    const two = autumn({ counts: counts({ q4: [0, 0, 6, 0, 0], q2: [0, 0, 3, 3, 0] }) });
    expect(
      steps("psych-safety", { psychSafetyLogs: log([spring, two]), retroBoards: [] })[0].detail
    ).toMatch(
      /^2 statements, “It is safe to take a risk on this team\.” most, fell by more than 0\.5 since Spring check-in\./
    );
  });

  it("points at the retro once the drop is a topic there, and is quiet after that retro", () => {
    const sent = autumn({ sentTo: toRetro("t-ps") });
    const ws = (boards: RetroBoard[]) => ({
      psychSafetyLogs: log([spring, sent]),
      retroBoards: boards,
    });
    expect(steps("psych-safety", ws([board("retro:current", [card("t-ps")])]))).toEqual([
      {
        id: "psych-safety-drop",
        label: "Talk about the drop at the retro",
        detail:
          "“It is safe to take a risk on this team.” fell by more than 0.5 since Spring check-in. It's on the current retro board as a topic.",
        href: "/retro",
      },
    ]);
    expect(ids("psych-safety", ws([board("retro:old", [card("t-ps")], ARCHIVED)]))).toEqual([]);
    expect(ids("psych-safety", ws([]))).toEqual(["psych-safety-send-drop"]);
  });

  it("takes a drop in the read-only earlier responses straight to the retro", () => {
    // Five answer sheets from before rounds: Q4 at 3, the rest at their safest.
    const sheet = (i: number): PsychSafetyResponse => ({
      id: `resp-${i}`,
      ts: "2026-10-01T10:00:00.000Z",
      scores: { q1: 1, q2: 5, q3: 1, q4: 3, q5: 1, q6: 5, q7: 5 },
    });
    const out = steps("psych-safety", {
      psychSafetyLogs: log([spring], [0, 1, 2, 3, 4].map(sheet)),
      retroBoards: [],
    });
    expect(out).toEqual([
      expect.objectContaining({
        id: "psych-safety-drop",
        href: "/retro",
        detail:
          "“It is safe to take a risk on this team.” fell by more than 0.5 since Spring check-in. Talk it through as a team, without asking who answered what.",
      }),
    ]);
  });

  it("raises the lowest statement when it scores under 3", () => {
    // Q1 is worded negatively: 4.5 raw agreement scores 1.5.
    const low = round("r2", "Autumn check-in", "2026-10-20", { counts: counts({ q1: SAFE }) });
    expect(steps("psych-safety", { psychSafetyLogs: log([low]), retroBoards: [] })).toEqual([
      {
        id: "psych-safety-lowest",
        label: "Talk through the lowest-scoring statement at the retro",
        detail:
          "“If I make a mistake on this team, it is held against me.” scored 1.5 out of 5 (reverse-scored) in Autumn check-in. Ask what would make it safer, never who answered what.",
        href: "/retro",
      },
    ]);
    // A statement at the midpoint isn't raised.
    expect(ids("psych-safety", { psychSafetyLogs: log([autumn()]), retroBoards: [] })).toEqual([]);
  });

  it("says nothing for a round below five responses or an example round", () => {
    const thin = autumn({ responses: 4 });
    expect(ids("psych-safety", { psychSafetyLogs: log([spring, thin]), retroBoards: [] })).toEqual(
      []
    );
    const example = autumn({ id: "example-r2", counts: counts({ q1: SAFE }) });
    expect(
      ids("psych-safety", { psychSafetyLogs: log([spring, example]), retroBoards: [] })
    ).toEqual([]);
    expect(ids("psych-safety", { psychSafetyLogs: [], retroBoards: [] })).toEqual([]);
  });

  it("leaves out example answer sheets, and reads a malformed log without throwing", () => {
    const sheet = (id: string): PsychSafetyResponse => ({
      id,
      ts: "2026-10-01T10:00:00.000Z",
      scores: { q1: 1, q2: 5, q3: 1, q4: 3, q5: 1, q6: 5, q7: 5 },
    });
    // Five example sheets would fold into a round with a drop; left out, there's none.
    const examples = [0, 1, 2, 3, 4].map((i) => sheet(`example-resp-${i}`));
    expect(
      ids("psych-safety", { psychSafetyLogs: log([spring], examples), retroBoards: [] })
    ).toEqual([]);
    // A null among the rounds or the sheets, or a field that isn't a list, is skipped.
    const broken = (rounds: unknown, responses: unknown) =>
      [{ id: "psychSafety:current", rounds, responses }] as unknown as Workspace["psychSafetyLogs"];
    expect(
      ids("psych-safety", {
        psychSafetyLogs: broken([null, spring, autumn()], [null]),
        retroBoards: [],
      })
    ).toEqual(["psych-safety-send-drop"]);
    expect(ids("psych-safety", { psychSafetyLogs: broken({}, {}), retroBoards: [] })).toEqual([]);
    expect(ids("psych-safety", { psychSafetyLogs: broken("x", null), retroBoards: [] })).toEqual(
      []
    );
  });
});

describe("mood tracker", () => {
  const pulse = (id: string, date: string, low = 3, high = 0): MoodPulse => ({
    id,
    date,
    counts: { 1: 0, 2: low, 3: 0, 4: high, 5: 0 },
    source: "room",
    createdAt: `${date}T12:00:00.000Z`,
  });
  // Three low check-in days (the weekend skipped), three answers each.
  const LOW = [pulse("p1", "2026-10-22"), pulse("p2", "2026-10-23"), pulse("p3", "2026-10-26")];
  const settings = (sentTo?: HandoffLink[]) => [
    {
      id: "moodTracker:current",
      mode: "anonymous" as const,
      streaks: [{ start: "2026-10-22", end: "2026-10-26", ...(sentTo ? { sentTo } : {}) }],
    },
  ];

  it("raises a low-mood streak at the retro without names, then Sprint Comparison", () => {
    const out = steps("mood-tracker", {
      moodEntries: [],
      moodPulses: LOW,
      moodTrackerDocs: [],
      retroBoards: [],
      sprints: [sprint()],
    });
    expect(out).toEqual([
      {
        id: "mood-send-streak",
        label: "Raise the low-mood streak at the retro",
        detail:
          "The team averaged 2 out of 5 over 3 check-in days in a row (22–26 Oct). Use “Send to…” → “Retro topic (no names)” on the low-mood callout: the topic names no one.",
        href: "/mood-tracker",
      },
      {
        id: "mood-sprint-compare",
        label: "See Team Happiness in Sprint Comparison",
        detail:
          "9 check-ins during Sprint 2 average 2 out of 5: Sprint Comparison suggests its Team Happiness from them.",
        href: "/sprint-compare?sprint=s2",
      },
    ]);
  });

  it("points at the retro board once the streak is a topic, and is quiet after that retro", () => {
    const ws = (boards: RetroBoard[]) => ({
      moodEntries: [],
      moodPulses: LOW,
      moodTrackerDocs: settings(toRetro("t-mood")),
      retroBoards: boards,
      sprints: [],
    });
    expect(steps("mood-tracker", ws([board("retro:current", [card("t-mood")])]))).toEqual([
      {
        id: "mood-discuss-streak",
        label: "Discuss the low-mood streak at the retro",
        detail:
          "The team averaged 2 out of 5 over 3 check-in days in a row (22–26 Oct). It's on the current retro board as a topic.",
        href: "/retro",
      },
    ]);
    expect(ids("mood-tracker", ws([board("retro:old", [card("t-mood")], ARCHIVED)]))).toEqual([]);
    expect(ids("mood-tracker", ws([]))).toEqual(["mood-send-streak"]);
  });

  it("never reads a streak from fewer than three check-ins a day, or from examples", () => {
    // Two people low by name every day: never a team streak, so no one is singled out.
    const named = ["2026-10-22", "2026-10-23", "2026-10-26"].flatMap((date, i) => [
      { id: `a${i}`, memberId: "m1", date, score: 1 as const },
      { id: `b${i}`, memberId: "m2", date, score: 2 as const },
    ]);
    const ws = { moodPulses: [], moodTrackerDocs: [], retroBoards: [], sprints: [] };
    expect(ids("mood-tracker", { ...ws, moodEntries: named })).toEqual([]);
    const examples = LOW.map((p) => ({ ...p, id: `example-${p.id}` }));
    expect(
      ids("mood-tracker", { ...ws, moodEntries: [], moodPulses: examples, sprints: [sprint()] })
    ).toEqual([]);
  });

  it("needs a sprint with real dates and three check-ins for Sprint Comparison", () => {
    const happy = [pulse("p1", "2026-10-22", 0, 3)];
    const ws = (sprints: Sprint[]) => ({
      moodEntries: [],
      moodPulses: happy,
      moodTrackerDocs: [],
      retroBoards: [],
      sprints,
    });
    expect(steps("mood-tracker", ws([sprint()]))[0].detail).toBe(
      "3 check-ins during Sprint 2 average 4 out of 5: Sprint Comparison suggests its Team Happiness from them."
    );
    const synthetic = sprint({ startDate: "2020-01-06", endDate: "2020-01-17" });
    expect(ids("mood-tracker", ws([synthetic]))).toEqual([]);
    expect(
      ids("mood-tracker", { ...ws([sprint()]), moodPulses: [pulse("p1", "2026-10-22", 2)] })
    ).toEqual([]);
  });
});

describe("kudos", () => {
  const kudos = (id: string, sentAt: string, over: Partial<Kudos> = {}): Kudos => ({
    id,
    theme: "thank-you",
    toName: "Bo",
    fromName: "Ana",
    message: "Thanks",
    sentAt,
    ...over,
  });
  const wall = [
    kudos("k1", "2026-10-20T12:00:00"),
    kudos("k2", "2026-10-21T12:00:00"),
    kudos("reply", "2026-10-21T13:00:00", { replyTo: "k2" }),
    kudos("example-k", "2026-10-22T12:00:00"),
    kudos("old", "2026-10-10T12:00:00"),
  ];
  const fromKudos = (id: string) => card(`c-${id}`, { sourceRef: { tool: "kudos", id } });

  it("brings the sprint's kudos not on a retro board yet to the retro", () => {
    const out = steps("kudos", {
      kudos: wall,
      retroBoards: [board("retro:current", [fromKudos("k2")], { sprintId: "s2" })],
      sprints: [sprint()],
      teamMembers: TEAM,
    });
    expect(out).toEqual([
      {
        id: "kudos-retro",
        label: "Bring 1 kudos from Sprint 2 to the retro",
        detail:
          "They go in the appreciations column: add them from “Kudos from Sprint 2” on the board.",
        href: "/retro",
      },
    ]);
  });

  it("reads the sprint the retro board looks back on, and counts archived boards as added", () => {
    const s1 = sprint({
      id: "s1",
      name: "Sprint 1",
      startDate: "2026-10-05",
      endDate: "2026-10-16",
      status: "completed",
    });
    const ws = {
      kudos: [...wall, kudos("k0", "2026-10-08T12:00:00"), kudos("k00", "2026-10-09T12:00:00")],
      retroBoards: [
        board("retro:current", [], { sprintId: "s1" }),
        board("retro:old", [fromKudos("k00")], { archivedAt: "2026-10-16T16:00:00.000Z" }),
      ],
      sprints: [s1, sprint()],
      teamMembers: TEAM,
    };
    // k0 and "old" fall in Sprint 1; k00 is on an archived board already.
    expect(steps("kudos", ws)[0].label).toBe("Bring 2 kudos from Sprint 1 to the retro");
    // No sprint on the board: the newest sprint that has begun, and how to pick it.
    const unnamed = steps("kudos", { ...ws, retroBoards: [board("retro:current", [])] });
    expect(unnamed[0]).toMatchObject({
      label: "Bring 2 kudos from Sprint 2 to the retro",
      detail: "Pick Sprint 2 on the retro board to add them to the appreciations column.",
    });
  });

  it("past the Write phase, points at each kudos' Add to retro", () => {
    // The board lists the sprint's kudos in its Write phase only.
    const ws = (over: Partial<RetroBoard>) => ({
      kudos: wall,
      retroBoards: [board("retro:current", [], over)],
      sprints: [sprint()],
      teamMembers: TEAM,
    });
    expect(steps("kudos", ws({ sprintId: "s2", phase: "vote" }))).toEqual([
      {
        id: "kudos-retro",
        label: "Bring 2 kudos from Sprint 2 to the retro",
        detail:
          "The retro is past its Write phase: step back to Write for “Kudos from Sprint 2”, or use “Add to retro” on each kudos.",
        href: "/retro",
      },
    ]);
    expect(steps("kudos", ws({ phase: "actions" }))[0].detail).toBe(
      "The retro is past its Write phase: use “Add to retro” on each kudos."
    );
    expect(steps("kudos", ws({ sprintId: "s2", phase: "write" }))[0].detail).toBe(
      "They go in the appreciations column: add them from “Kudos from Sprint 2” on the board."
    );
  });

  it("ignores replies and example kudos, and asks for the team without a roster", () => {
    const ws = {
      kudos: [wall[2], wall[3]],
      retroBoards: [],
      sprints: [sprint()],
      teamMembers: [member("example-m", "Sam")],
    };
    expect(steps("kudos", ws)).toEqual([
      expect.objectContaining({ id: "kudos-team", href: "/team" }),
    ]);
    expect(ids("kudos", { ...ws, teamMembers: TEAM })).toEqual([]);
  });
});

describe("one-on-one", () => {
  const mood = (id: string, date: string, score: MoodEntry["score"]): MoodEntry => ({
    id,
    memberId: "m1",
    date,
    score,
  });

  it("points a low week of mood at the Mood Tracker before the 1:1s", () => {
    const out = steps("one-on-one", {
      teamMembers: TEAM,
      moodEntries: [
        mood("a", "2026-10-21", 2),
        mood("b", "2026-10-23", 2),
        mood("c", "2026-10-26", 3),
        mood("last-week", "2026-10-19", 1),
      ],
    });
    expect(out).toEqual([
      {
        id: "one-on-one-mood",
        label: "Look at this week's low mood before your 1:1s",
        detail: "3 mood check-ins this week average 2.3 out of 5.",
        href: "/mood-tracker",
      },
    ]);
  });

  it("counts anonymous pulse answers as check-ins, as the Mood Tracker does", () => {
    const pulse: MoodPulse = {
      id: "p1",
      date: "2026-10-23",
      counts: { 1: 1, 2: 2, 3: 0, 4: 0, 5: 0 },
      source: "room",
      createdAt: "2026-10-23T12:00:00.000Z",
    };
    expect(
      steps("one-on-one", { teamMembers: TEAM, moodEntries: [], moodPulses: [pulse] })
    ).toEqual([
      expect.objectContaining({
        id: "one-on-one-mood",
        detail: "3 mood check-ins this week average 1.7 out of 5.",
      }),
    ]);
  });

  it("needs three real check-ins, and asks for the team without a roster", () => {
    const few = [mood("a", "2026-10-21", 1), mood("b", "2026-10-23", 1)];
    expect(ids("one-on-one", { teamMembers: TEAM, moodEntries: few })).toEqual([]);
    const examples = ["x", "y", "z"].map((k) => mood(`example-${k}`, "2026-10-24", 1));
    expect(ids("one-on-one", { teamMembers: [], moodEntries: examples })).toEqual([
      "one-on-one-team",
    ]);
  });
});

describe("onboarding tracker", () => {
  it("asks for the team without a roster (example members left out)", () => {
    const out = steps("onboarding-tracker", {
      teamMembers: [member("example-m", "Sam")],
      sprints: [sprint()],
    });
    expect(out.map((s) => [s.id, s.href])).toEqual([["onboarding-team", "/team"]]);
  });

  it("never claims a new joiner from an open sprint alone", () => {
    // Who is new is in the tool's blob: an open sprint says nothing about it.
    expect(ids("onboarding-tracker", { teamMembers: TEAM, sprints: [sprint()] })).toEqual([]);
    expect(
      ids("onboarding-tracker", {
        teamMembers: TEAM,
        sprints: [sprint({ status: "planned" }), sprint({ id: "s1", status: "completed" })],
      })
    ).toEqual([]);
  });
});

describe("stakeholder map", () => {
  it("invites stakeholders to the active sprint's review within the week", () => {
    const [step] = steps("stakeholder-map", { sprints: [sprint()], ceremonyCadences: [] });
    expect(step).toMatchObject({
      id: "stakeholder-review",
      label: "Invite your key stakeholders to the Sprint 2 review",
      href: "/sprint-review?sprint=s2",
    });
    // The default cadence holds the review on the last day at 14:00.
    expect(step.detail).toMatch(/^It's Fri 30 Oct 14:00\./);
  });

  it("waits while the review is more than a week away, or no sprint is running", () => {
    const later = sprint({ id: "s3", name: "Sprint 3", startDate: TODAY, endDate: "2026-11-06" });
    expect(ids("stakeholder-map", { sprints: [later], ceremonyCadences: [] })).toEqual([]);
    expect(
      ids("stakeholder-map", { sprints: [sprint({ status: "planned" })], ceremonyCadences: [] })
    ).toEqual([]);
  });
});

describe("working agreement", () => {
  const rule = (id: string, text: string, over: Partial<CharterRule> = {}): CharterRule => ({
    id,
    category: "work",
    text,
    agreedBy: [],
    ...over,
  });
  const agreement = (over: Partial<WorkingAgreement> = {}): WorkingAgreement => ({
    id: "workingAgreement:current",
    rules: [rule("r1", "Cameras on"), rule("r2", "Reviews within a day"), rule("r3", "Core hours")],
    meta: { version: 0 },
    ...over,
  });

  it("takes the rules the last check-in found not working to the retro, the longest run first", () => {
    const out = steps("working-agreement", {
      teamMembers: [],
      workingAgreements: [
        agreement({
          checkIns: [
            { id: "c1", date: "2026-10-01", version: 0, results: { r1: "not_working" } },
            {
              id: "c2",
              date: "2026-10-15",
              version: 0,
              results: { r1: "not_working", r2: "not_working", r3: "working", gone: "not_working" },
            },
          ],
        }),
      ],
    });
    expect(out).toEqual([
      {
        id: "working-agreement-retro",
        label: "Talk through the 2 rules not working at the retro",
        detail:
          "The 15 Oct check-in found “Cameras on” not working (2 check-ins in a row), and 1 other rule.",
        href: "/retro",
      },
    ]);
  });

  it("counts only the rounds in a row that found a rule not working, not partly", () => {
    const checkIn = (id: string, date: string, result: "partly" | "not_working") => ({
      id,
      date,
      version: 0,
      results: { r1: result },
    });
    const ws = (checkIns: ReturnType<typeof checkIn>[]) => ({
      teamMembers: [],
      workingAgreements: [agreement({ checkIns })],
    });
    // Partly, then not working: one round found it not working.
    expect(
      steps(
        "working-agreement",
        ws([checkIn("c1", "2026-10-01", "partly"), checkIn("c2", "2026-10-15", "not_working")])
      )[0].detail
    ).toBe("The 15 Oct check-in found “Cameras on” not working.");
    // Not working twice after a partly round: the two count.
    expect(
      steps(
        "working-agreement",
        ws([
          checkIn("c0", "2026-09-15", "partly"),
          checkIn("c1", "2026-10-01", "not_working"),
          checkIn("c2", "2026-10-15", "not_working"),
        ])
      )[0].detail
    ).toBe("The 15 Oct check-in found “Cameras on” not working (2 check-ins in a row).");
  });

  it("asks the teammates who haven't answered every rule for consent", () => {
    const sam = { name: "Ana", vote: "consent" as const, at: "2026-10-01" };
    const out = steps("working-agreement", {
      teamMembers: [member("m1", "Ana"), member("m2", "Bo"), member("example-m", "Sam")],
      workingAgreements: [
        agreement({ rules: [rule("r1", "Cameras on", { consent: [sam], agreedBy: ["Ana"] })] }),
      ],
    });
    expect(out).toEqual([
      {
        id: "working-agreement-consent",
        label: "Ask 1 teammate for consent to the working agreement",
        detail: "Bo hasn't answered every rule yet.",
        href: "/working-agreement",
      },
    ]);
  });

  it("asks for a check-in a month after the first publish or the last round", () => {
    const published = agreement({
      meta: { version: 1, publishedAt: "2026-09-01T10:00:00.000Z" },
      versions: [{ version: 1, publishedAt: "2026-09-01T10:00:00.000Z", rules: [] }],
    });
    expect(steps("working-agreement", { workingAgreements: [published], teamMembers: [] })).toEqual(
      [
        expect.objectContaining({
          id: "working-agreement-check-in",
          detail:
            "It was published 55 days ago and hasn't had a check-in yet. Is each rule working?",
        }),
      ]
    );
    const checked = {
      ...published,
      checkIns: [{ id: "c1", date: "2026-10-15", version: 1, results: { r1: "working" as const } }],
    };
    expect(ids("working-agreement", { workingAgreements: [checked], teamMembers: [] })).toEqual([]);
    // Never published: nothing to check in on.
    expect(ids("working-agreement", { workingAgreements: [agreement()], teamMembers: [] })).toEqual(
      []
    );
  });

  it("ignores example rules and check-ins", () => {
    const example = agreement({
      rules: [rule("example-r1", "Cameras on")],
      checkIns: [
        {
          id: "example-c",
          date: "2026-10-15",
          version: 0,
          results: { "example-r1": "not_working" },
        },
      ],
    });
    expect(ids("working-agreement", { workingAgreements: [example], teamMembers: TEAM })).toEqual(
      []
    );
  });
});

describe("Definition of Done", () => {
  const dod = (required: boolean[] = [true, true]): DefinitionOfDone => ({
    id: "definitionOfDone:current",
    items: required.map((r, i) => ({
      id: `d${i + 1}`,
      label: ["Tests pass", "Reviewed", "Docs updated"][i],
      category: "code",
      required: r,
    })),
    history: [],
  });
  const ticked = (...checked: string[]) => ({ dodChecks: { checked, updatedAt: TODAY } });

  it("sends the done stories that miss the DoD to the sprint board", () => {
    const out = steps("dod-builder", {
      definitionsOfDone: [dod([true, true, false])],
      sprints: [sprint()],
      stories: [
        story("met", { status: "done", ...ticked("d1", "d2") }),
        story("Pay by card", { status: "done", ...ticked("d1") }),
        story("Refunds", { status: "done" }),
        story("example-st", { status: "done" }),
        story("open"),
      ],
    });
    expect(out).toEqual([
      {
        id: "dod-missing",
        label: "Check the 2 done stories that miss the DoD",
        detail:
          "In Sprint 2, “Pay by card” still needs Reviewed, and 1 other story needs ticks too.",
        href: "/kanban?sprint=s2",
      },
    ]);
  });

  it("asks for required criteria once stories are done, and is quiet before", () => {
    const done = [story("a", { status: "done" })];
    expect(
      steps("dod-builder", { definitionsOfDone: [], sprints: [sprint()], stories: done })
    ).toEqual([
      {
        id: "dod-required",
        label: "Write your Definition of Done",
        detail: "1 story in Sprint 2 is done with nothing required to check it against.",
        href: "/dod-builder",
      },
    ]);
    expect(
      steps("dod-builder", {
        definitionsOfDone: [dod([false])],
        sprints: [sprint()],
        stories: done,
      })[0].label
    ).toBe("Mark the criteria every story must meet");
    expect(
      ids("dod-builder", { definitionsOfDone: [], sprints: [sprint()], stories: [story("a")] })
    ).toEqual([]);
    expect(
      ids("dod-builder", {
        definitionsOfDone: [dod()],
        sprints: [sprint()],
        stories: [story("a", { status: "done", ...ticked("d1", "d2") })],
      })
    ).toEqual([]);
  });

  it("the Sprint board asks for a DoD when its done stories have nothing to meet", () => {
    const ws = {
      sprints: [sprint()],
      stories: [story("a", { status: "done" }), story("b", { status: "in_progress" })],
    };
    expect(steps("kanban", { ...ws, definitionsOfDone: [] })).toEqual([
      {
        id: "kanban-dod",
        label: "Write a Definition of Done for the board's cards",
        detail:
          "1 story on Sprint 2's board is done with no required criteria to check it against.",
        href: "/dod-builder",
      },
    ]);
    // A DoD with criteria, none of them required: mark them, don't write one.
    expect(steps("kanban", { ...ws, definitionsOfDone: [dod([false, false])] })).toEqual([
      expect.objectContaining({
        id: "kanban-dod",
        label: "Mark the DoD criteria every story must meet",
      }),
    ]);
    expect(ids("kanban", { ...ws, definitionsOfDone: [dod()] })).toEqual([]);
  });

  it("release readiness checks the DoD gate against the workspace DoD and the linked stories", () => {
    const release: Release = {
      id: "r1",
      name: "v3.3",
      plannedDate: "2026-10-28",
      status: "planning",
      gates: {},
      storyIds: ["a"],
    };
    const ws = (stories: Story[], dods: DefinitionOfDone[]) => ({
      releaseReadinesses: [
        { id: "releaseReadiness:current", releases: [release], gates: [DOD_GATE] },
      ],
      featureFlags: [],
      definitionsOfDone: dods,
      stories,
    });
    const met = [story("a", { status: "done", ...ticked("d1", "d2") })];
    // The linked story meets the DoD: the gate passes, so no premortem.
    expect(ids("release-readiness", ws(met, [dod()]))).toEqual([]);
    // Without a DoD the gate takes its (unticked) tick; a miss fails it.
    expect(ids("release-readiness", ws(met, []))).toEqual(["release-premortem"]);
    expect(
      ids("release-readiness", ws([story("a", { status: "done", ...ticked("d1") })], [dod()]))
    ).toEqual(["release-premortem"]);
  });
});

describe("RACI", () => {
  const matrix = (over: Partial<RaciMatrix> = {}): RaciMatrix => ({
    id: "raciMatrix:current",
    roles: [
      { id: "po", name: "Priya", memberId: "m1" },
      { id: "dev", name: "Dev Team" },
    ],
    activities: ["Roadmap", "Backlog", "Release", "Incidents"].map((name, i) => ({
      id: `a${i + 1}`,
      name,
    })),
    cells: {
      a1: { po: ["A", "R"] },
      a2: { po: ["A"], dev: ["R"] },
      a3: { po: ["A"], dev: ["R"] },
      a4: { dev: ["R"] },
    },
    ...over,
  });

  it("asks for one Accountable per activity, then to share out a heavy load", () => {
    const out = steps("raci", { raciMatrices: [matrix()] });
    expect(out).toEqual([
      {
        id: "raci-issues",
        label: "Give 1 activity one Accountable and someone Responsible",
        detail: "“Incidents” has no Accountable (A): pick the one person who answers for it.",
        href: "/raci",
      },
      {
        id: "raci-accountable-load",
        label: "Share out some of Priya's accountability",
        detail: "Priya is Accountable for 3 of 4 activities (“Roadmap”, “Backlog” and “Release”).",
        href: "/raci",
      },
    ]);
  });

  it("stays quiet for a sound matrix and for example rows", () => {
    const sound = matrix({
      activities: [{ id: "a1", name: "Roadmap" }],
      cells: { a1: { po: ["A"], dev: ["R"] } },
    });
    expect(ids("raci", { raciMatrices: [sound] })).toEqual([]);
    const example = matrix({
      roles: [{ id: "example-po", name: "Priya" }],
      activities: [{ id: "example-a1", name: "Roadmap" }],
      cells: { "example-a1": { "example-po": ["C"] } },
    });
    expect(ids("raci", { raciMatrices: [example] })).toEqual([]);
  });
});

describe("skills matrix", () => {
  const matrix = (over: Partial<SkillsMatrix> = {}): SkillsMatrix => ({
    id: "skillsMatrix:current",
    members: [],
    skills: [
      { id: "k8s", name: "Kubernetes" },
      { id: "ts", name: "TypeScript" },
      { id: "pay", name: "Payments" },
    ],
    grid: { k8s: { m1: 1, m2: 3, m3: 0 }, ts: { m1: 3, m2: 2 } },
    version: 2,
    ...over,
  });
  const pair = (id: string, skillId: string) => ({
    id,
    skillId,
    learnerId: "m1",
    mentorId: "m2",
    toLevel: 2 as const,
    createdAt: TODAY,
  });

  it("plans pairing on a skill that hangs on one person into the next sprint", () => {
    const out = steps("skills-matrix", {
      skillsMatrices: [matrix()],
      teamMembers: TEAM,
      sprints: [sprint(), sprint({ id: "s3", name: "Sprint 3", status: "planned" })],
    });
    expect(out).toEqual([
      {
        id: "skills-pairing",
        label: "Plan pairing on Kubernetes into the next sprint",
        detail: "Kubernetes depends on Bo alone. A pair spreads it before it becomes a blocker.",
        href: "/sprint-planning?sprint=s3",
      },
    ]);
  });

  it("leaves a paired skill to the 1:1s, and ignores example pairs", () => {
    const ws = { teamMembers: TEAM, sprints: [] };
    const out = steps("skills-matrix", {
      ...ws,
      skillsMatrices: [matrix({ training: [pair("p1", "k8s")] })],
    });
    expect(out.map((s) => [s.id, s.label, s.href])).toEqual([
      ["skills-one-on-one", "Check progress on 1 cross-training pair in 1:1s", "/one-on-one"],
    ]);
    expect(
      ids("skills-matrix", {
        ...ws,
        skillsMatrices: [matrix({ training: [pair("example-p", "k8s")] })],
      })
    ).toEqual(["skills-pairing"]);
  });

  it("asks for the team first, and never pairs a team of one", () => {
    expect(
      ids("skills-matrix", {
        skillsMatrices: [matrix()],
        teamMembers: [member("example-m", "Sam")],
        sprints: [],
      })
    ).toEqual(["skills-team"]);
    expect(
      ids("skills-matrix", { skillsMatrices: [matrix()], teamMembers: [TEAM[1]], sprints: [] })
    ).toEqual([]);
  });
});

describe("maturity", () => {
  const entry = (over: Partial<MaturityAssessmentEntry> = {}): MaturityAssessmentEntry => ({
    id: "e1",
    assessedAt: "2026-09-01",
    scores: {
      "scrum-practices": 3,
      "team-collaboration": 3,
      "technical-excellence": 2,
      "product-management": 3,
      "metrics-transparency": 3,
      "continuous-improvement": 2,
      "stakeholder-engagement": 3,
      "agile-culture": 3,
    },
    ...over,
  });
  const doc = (history: MaturityAssessmentEntry[]) => [
    { id: "maturity:current", scores: {}, targetLevel: 4, history },
  ];
  const sent = (key: string, done: boolean) =>
    card(`card-${key}`, { isActionItem: true, done, sourceRef: { tool: "maturity", id: key } });

  it("works on the weakest dimension in its tool", () => {
    expect(steps("maturity", { maturityAssessments: doc([entry()]), retroBoards: [] })).toEqual([
      {
        id: "maturity-weakest",
        label: "Work on Technical Excellence (level 2)",
        detail:
          "It's the weakest dimension in the latest assessment. Raise the bar every story has to meet in the Definition of Done.",
        href: "/dod-builder",
      },
    ]);
  });

  it("follows up roadmap steps sent to Retro Actions, then the weakest one not sent", () => {
    const out = steps("maturity", {
      maturityAssessments: doc([entry()]),
      retroBoards: [board("retro:current", [sent("technical-excellence:3", false)])],
    });
    expect(out.map((s) => [s.id, s.href])).toEqual([
      ["maturity-follow-up", "/retro-actions"],
      ["maturity-weakest", "/retro-actions"],
    ]);
    expect(out[0].detail).toBe(
      "Sent from the roadmap and not done yet, starting with “Maturity: Technical Excellence to level 3”."
    );
    expect(out[1].label).toBe("Work on Continuous Improvement (level 2)");
    // Tied with the one sent: still the weakest.
    expect(out[1].detail).toMatch(/^It's the weakest dimension in the latest assessment\./);
    // A done step isn't followed up again.
    expect(
      ids("maturity", {
        maturityAssessments: doc([entry()]),
        retroBoards: [board("retro:current", [sent("technical-excellence:3", true)])],
      })
    ).toEqual(["maturity-weakest"]);
  });

  it("doesn't call a stronger dimension the weakest while a weaker one waits on a re-assessment", () => {
    // Technical Excellence at 1 was sent and its card is done; the team hasn't re-assessed.
    const scores = { ...entry().scores, "technical-excellence": 1 };
    const out = steps("maturity", {
      maturityAssessments: doc([entry({ scores })]),
      retroBoards: [board("retro:current", [sent("technical-excellence:2", true)])],
    });
    expect(out).toEqual([
      {
        id: "maturity-weakest",
        label: "Work on Continuous Improvement (level 2)",
        detail:
          "It's the weakest dimension not sent to the retro yet. Follow the retro's actions through in Retro Actions.",
        href: "/retro-actions",
      },
    ]);
  });

  it("says nothing for an unassessed team or an example assessment", () => {
    expect(ids("maturity", { maturityAssessments: doc([]), retroBoards: [] })).toEqual([]);
    expect(
      ids("maturity", { maturityAssessments: doc([entry({ id: "example-e" })]), retroBoards: [] })
    ).toEqual([]);
  });
});

describe("ADKAR", () => {
  const initiative = (over: Partial<AdkarInitiative> = {}): AdkarInitiative => ({
    id: "i1",
    name: "Trunk-based development",
    startDate: "2026-09-01",
    currentStage: "ability",
    stageHistory: [
      { stage: "awareness", enteredAt: "2026-09-01" },
      { stage: "desire", enteredAt: "2026-09-20" },
      { stage: "knowledge", enteredAt: "2026-10-10" },
      { stage: "ability", enteredAt: "2026-10-20" },
    ],
    groups: [
      { id: "g1", name: "Devs", scores: { awareness: 5, desire: 5, knowledge: 3 } },
      { id: "g2", name: "Support", scores: { awareness: 4, desire: 2 } },
    ],
    ...over,
  });
  const adkar = (initiatives: AdkarInitiative[]) => ({
    adkarDocs: [{ id: "adkar:current", initiatives }],
  });

  it("works on the earliest barrier: the case for the change", () => {
    expect(steps("adkar", adkar([initiative()]))).toEqual([
      {
        id: "adkar-barrier-case",
        label: "Plan who explains why “Trunk-based development” matters",
        detail: "Support scored Desire 2/5: the case for the change hasn't landed with them yet.",
        href: "/stakeholder-map",
      },
    ]);
  });

  it("coaches a Knowledge or Ability barrier and recognises a Reinforcement one", () => {
    const coach = steps(
      "adkar",
      adkar([
        initiative({
          groups: [{ id: "g1", name: "Devs", scores: { awareness: 5, desire: 4, knowledge: 2 } }],
        }),
      ])
    );
    expect(coach.map((s) => [s.id, s.label, s.href])).toEqual([
      ["adkar-barrier-coach", "Coach Devs one-on-one on “Trunk-based development”", "/one-on-one"],
    ]);
    const all = { awareness: 5, desire: 5, knowledge: 5, ability: 4 } as const;
    const recognise = steps(
      "adkar",
      adkar([
        initiative({ groups: [{ id: "g1", name: "Devs", scores: { ...all, reinforcement: 3 } }] }),
      ])
    );
    expect(recognise.map((s) => [s.id, s.href])).toEqual([["adkar-barrier-recognise", "/kudos"]]);
  });

  it("takes a change stuck for a month with no barrier to the retro", () => {
    const stuck = initiative({
      id: "i2",
      name: "New incident process",
      currentStage: "knowledge",
      stageHistory: [
        { stage: "awareness", enteredAt: "2026-08-01" },
        { stage: "knowledge", enteredAt: "2026-09-01" },
      ],
      groups: [],
    });
    expect(steps("adkar", adkar([stuck]))).toEqual([
      {
        id: "adkar-stuck",
        label: "Talk about “New incident process” at the retro",
        detail: "It has been at Knowledge for 55 days. Ask what's holding it.",
        href: "/retro",
      },
    ]);
    // Reinforcement has no exit: a sustained change is never stuck.
    expect(ids("adkar", adkar([{ ...stuck, currentStage: "reinforcement" }]))).toEqual([]);
  });

  it("ignores example initiatives", () => {
    expect(ids("adkar", adkar([initiative({ id: "example-i" })]))).toEqual([]);
  });
});

describe("team-mixer", () => {
  const FOUR = [...TEAM, member("m4", "Dee")];

  it("asks for the team when the Team page has nobody real on it", () => {
    expect(steps("team-mixer", { teamMembers: [] })).toEqual([
      {
        id: "team-mixer-team",
        label: "Add your team to the Team page",
        detail: "Then Team Mixer can put everyone in the mix at once, with their roles and skills.",
        href: "/team",
      },
    ]);
    expect(ids("team-mixer", { teamMembers: [member("example-m", "Sam")] })).toEqual([
      "team-mixer-team",
    ]);
  });

  it("asks for roles or skills when nobody on the team has any", () => {
    expect(steps("team-mixer", { teamMembers: FOUR })).toEqual([
      {
        id: "team-mixer-roles",
        label: "Add roles or skills on the Team page",
        detail:
          "Nobody on the team has a role or skills yet, so Team Mixer can't balance groups by them.",
        href: "/team",
      },
    ]);
  });

  it("counts who still has neither once some do, never naming them", () => {
    const some = [
      { ...FOUR[0], role: "Developer" },
      { ...FOUR[1], skills: ["React"] },
      { ...FOUR[2], role: "  " },
      FOUR[3],
    ];
    const [step] = steps("team-mixer", { teamMembers: some });
    expect(step.detail).toBe(
      "2 people on the team have no role or skills yet, so balanced groups place them at random."
    );
    expect(step.detail).not.toMatch(/Cy|Dee/);
  });

  it("stays quiet when everyone has a role or skills, or the team is too small to balance", () => {
    const all = FOUR.map((m, i) => (i % 2 ? { ...m, role: "Tester" } : { ...m, skills: ["SQL"] }));
    expect(ids("team-mixer", { teamMembers: all })).toEqual([]);
    expect(ids("team-mixer", { teamMembers: TEAM })).toEqual([]);
  });
});

describe("meeting audit", () => {
  const meeting = (over: Partial<MeetingAudit> = {}): MeetingAudit => ({
    id: "m1",
    meeting: "Weekly status sync",
    cadence: "weekly",
    minutes: 60,
    attendees: 12,
    purpose: "Everyone reports what they did.",
    ratings: {},
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...over,
  });

  it("asks to rate, then for verdicts, then takes the changes to the retro", () => {
    expect(ids("meeting-audit", { meetingAudits: [] })).toEqual([]);
    expect(ids("meeting-audit", { meetingAudits: [meeting()] })).toEqual(["meeting-audit-rate"]);
    expect(
      ids("meeting-audit", {
        meetingAudits: [
          meeting({ ratings: { outcome: 1 } }),
          meeting({ id: "m2", ratings: { purpose: 4 }, verdict: "drop" }),
        ],
      })
    ).toEqual(["meeting-audit-verdict", "meeting-audit-retro"]);
  });

  it("stops asking for the retro once one is held after the verdicts", () => {
    const planned = meeting({ ratings: { purpose: 2 }, verdict: "change" });
    // The current board and a retro held before the verdict don't count.
    expect(
      ids("meeting-audit", {
        meetingAudits: [planned],
        retroBoards: [
          board("retro-current", []),
          board("retro:old", [], { archivedAt: "2026-10-16T16:00:00.000Z" }),
        ],
      })
    ).toEqual(["meeting-audit-retro"]);
    expect(
      ids("meeting-audit", {
        meetingAudits: [planned],
        retroBoards: [board("retro:new", [], ARCHIVED)],
      })
    ).toEqual([]);
  });

  it("asks for the audit again after a quarter, and ignores example meetings", () => {
    expect(
      ids("meeting-audit", {
        meetingAudits: [
          meeting({
            ratings: { purpose: 4 },
            verdict: "keep",
            updatedAt: "2026-07-01T09:00:00.000Z",
          }),
        ],
      })
    ).toEqual(["meeting-audit-again"]);
    expect(ids("meeting-audit", { meetingAudits: [meeting({ id: "example-m1" })] })).toEqual([]);
  });
});

describe("Scrum Master Notebook", () => {
  const note = (id: string, date: string, over: Partial<NotebookEntry> = {}): NotebookEntry => ({
    id,
    date,
    body: `Note ${id}`,
    tags: [],
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...over,
  });

  it("points a theme from three notes in two weeks to the tool for it", () => {
    expect(
      steps("sm-notebook", {
        notebookEntries: [
          note("a", "2026-10-26", { tags: ["blockers"] }),
          note("b", "2026-10-20", { body: "Blocked on the sandbox again." }),
          note("c", "2026-10-13", { tags: ["Blocker"] }),
        ],
      })
    ).toEqual([
      {
        id: "sm-notebook-theme",
        label: "Try Impediment Tracker for “blockers”",
        detail: "“blockers” came up in 3 of your notes in the last two weeks.",
        href: "/impediments",
      },
    ]);
  });

  it("takes a theme no tool covers to the retro", () => {
    const notebookEntries = ["a", "b", "c"].map((id) =>
      note(id, "2026-10-22", { tags: ["pairing rota"] })
    );
    expect(steps("sm-notebook", { notebookEntries })).toEqual([
      {
        id: "sm-notebook-retro",
        label: "Take “pairing rota” to the retro",
        detail: "“pairing rota” came up in 3 of your notes in the last two weeks.",
        href: "/retro",
      },
    ]);
  });

  it("stays quiet for example notes, kept summaries, older notes and fewer than three", () => {
    expect(
      ids("sm-notebook", {
        notebookEntries: [
          note("example-a", "2026-10-26", { tags: ["blockers"] }),
          note("b", "2026-10-26", { tags: ["blockers", "weekly-summary"] }),
          note("c", "2026-10-12", { tags: ["blockers"] }),
          note("d", "2026-10-25", { tags: ["blockers"] }),
          note("e", "2026-10-24", { tags: ["blockers"] }),
        ],
      })
    ).toEqual([]);
    expect(ids("sm-notebook", {})).toEqual([]);
  });
});
