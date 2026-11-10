import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRO_VOTES,
  RETRO_VOTE_OPTIONS,
  blankRetroBoard,
  hasOwnCards,
  isRetroVotes,
  newestArchivedRetro,
  nextRetroSprint,
  retroFor,
  retroSprintFor,
  retroVotes,
} from "@/lib/retro/board";
import {
  actionCard,
  collectRetroActions,
  followThroughByRetro,
  quickAddBoard,
  withAddedAction,
} from "@/lib/retro/actions";
import { burndownShape, retroFacts } from "@/lib/retro/facts";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { RetroBoard, RetroCard, Sprint, Story } from "@/lib/stores/workspace-types";

/** Retros per sprint, follow-through, and the facts a retro opens with. */

const sprint = (
  id: string,
  startDate: string,
  endDate: string,
  over: Partial<Sprint> = {}
): Sprint => ({
  id,
  name: id.toUpperCase(),
  startDate,
  endDate,
  pointsPlanned: 10,
  status: "completed",
  ...over,
});
const S1 = sprint("s1", "2026-09-28", "2026-10-09");
const S2 = sprint("s2", "2026-10-12", "2026-10-23", { status: "active" });
const SPRINTS = [S1, S2];

const card = (id: string, over: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text: `Card ${id}`,
  votes: 0,
  groupedWith: null,
  isActionItem: false,
  assignee: "",
  discussing: false,
  ...over,
});
const action = (id: string, over: Partial<RetroCard> = {}) =>
  card(id, { isActionItem: true, ...over });
const board = (id: string, cards: RetroCard[], over: Partial<RetroBoard> = {}): RetroBoard => ({
  ...blankRetroBoard(retroFormats[0]),
  id,
  cards,
  ...over,
});

describe("which sprint a retro belongs to", () => {
  it("picks the sprint whose window holds the day, nearest end first, ended preferred", () => {
    expect(retroSprintFor("2026-10-09", SPRINTS)?.id).toBe("s1");
    // Two days into S2, S1's retro window is still open and S1 ended nearest.
    expect(retroSprintFor("2026-10-13", SPRINTS)?.id).toBe("s1");
    expect(retroSprintFor("2026-10-22", SPRINTS)?.id).toBe("s2");
    expect(retroSprintFor("2026-12-01", SPRINTS)).toBeUndefined();
    expect(retroSprintFor("2026-10-09", [{ ...S1, status: "cancelled" }])).toBeUndefined();
  });

  it("starts the next board on a sprint whose retro isn't archived yet", () => {
    expect(nextRetroSprint([], SPRINTS, "2026-10-13")?.id).toBe("s1");
    // S1's retro is under Past retros: two days into S2, the next board is S2's.
    const held = board("retro:a", [card("c")], {
      archivedAt: "2026-10-12T15:00:00Z",
      sprintId: "s1",
    });
    expect(nextRetroSprint([held], SPRINTS, "2026-10-13")?.id).toBe("s2");
    expect(nextRetroSprint([held], [S1], "2026-10-13")).toBeUndefined();
  });

  it("uses the board's sprint when it names one, the dates otherwise", () => {
    const tagged = board("retro:current", [card("c")], { sprintId: "s1" });
    expect(retroFor([tagged], S1, SPRINTS, "2026-10-20").current).toBe(tagged);
    expect(retroFor([tagged], S2, SPRINTS, "2026-10-20").current).toBeUndefined();
    const untagged = board("retro:current", [card("c")]);
    expect(retroFor([untagged], S2, SPRINTS, "2026-10-20").current).toBe(untagged);
    const archived = board("retro:a", [card("c")], { archivedAt: "2026-10-09T15:00:00Z" });
    expect(retroFor([archived], S1, SPRINTS, "2026-10-20").archived).toBe(archived);
    expect(retroFor([archived], S2, SPRINTS, "2026-10-20").archived).toBeUndefined();
  });

  it("doesn't count a board holding only example cards", () => {
    const examples = board("retro:current", [card("example-retro-1")]);
    expect(hasOwnCards(examples)).toBe(false);
    expect(retroFor([examples], S2, SPRINTS, "2026-10-20").current).toBeUndefined();
  });

  it("starts boards one way, following the newest archive", () => {
    const older = board("retro:a", [], { archivedAt: "2026-09-01T00:00:00Z" });
    const newer = board("retro:b", [], { archivedAt: "2026-10-01T00:00:00Z" });
    expect(newestArchivedRetro([older, newer])?.id).toBe("retro:b");
    expect(
      blankRetroBoard(retroFormats[0], { previousRetroId: "retro:b", sprintId: "s2" })
    ).toMatchObject({
      id: "retro:current",
      phase: "write",
      cards: [],
      previousRetroId: "retro:b",
      sprintId: "s2",
    });
    expect("sprintId" in blankRetroBoard(retroFormats[0])).toBe(false);
  });
});

describe("votes each", () => {
  it("offers 3, 5 or 8, and reads 3 from a board that doesn't say", () => {
    expect(RETRO_VOTE_OPTIONS).toEqual([3, 5, 8]);
    expect(DEFAULT_RETRO_VOTES).toBe(3);
    expect(retroVotes(blankRetroBoard(retroFormats[0]))).toBe(3);
    expect(retroVotes(null)).toBe(3);
    expect(retroVotes({ votesPerPerson: 5 })).toBe(5);
    expect(retroVotes({ votesPerPerson: 8 })).toBe(8);
    // A synced or hand-edited value outside the choices reads as the default.
    for (const v of [4, 0, -3, 99, 5.5, "5", null]) {
      expect(isRetroVotes(v)).toBe(false);
      expect(retroVotes({ votesPerPerson: v })).toBe(3);
    }
  });

  it("starts a board with the votes asked for, and leaves the field off otherwise", () => {
    expect(blankRetroBoard(retroFormats[0], { votesPerPerson: 8 }).votesPerPerson).toBe(8);
    expect("votesPerPerson" in blankRetroBoard(retroFormats[0])).toBe(false);
    expect(
      "votesPerPerson" in
        blankRetroBoard(retroFormats[0], { votesPerPerson: 4 as unknown as 3 | 5 | 8 })
    ).toBe(false);
  });
});

describe("follow-through", () => {
  // A agreed 3 actions: a1 done, a2 carried to B and done there, a3 carried to B and still open.
  const A = board(
    "retro:a",
    [action("a1", { done: true }), action("a2"), action("a3"), action("example-x")],
    {
      archivedAt: "2026-09-25T10:00:00Z",
    }
  );
  const B = board(
    "retro:b",
    [
      action("b2", { carriedFrom: "a2", done: true }),
      action("b3", { carriedFrom: "a3" }),
      action("b4"),
    ],
    { archivedAt: "2026-10-09T10:00:00Z" }
  );

  it("counts done, carried and open per retro, following carried copies", () => {
    expect(
      followThroughByRetro([A, B]).map((f) => [f.boardId, f.agreed, f.done, f.carried, f.open])
    ).toEqual([
      ["retro:a", 3, 2, 1, 0],
      ["retro:b", 3, 1, 0, 2],
    ]);
    expect(followThroughByRetro([A, B])[0].rate).toBeCloseTo(2 / 3);
    expect(
      followThroughByRetro([board("retro:z", [card("c")], { archivedAt: "2026-01-01" })])[0].rate
    ).toBeNull();
  });

  it("counts an action done when its hand-off target is", () => {
    const sent = board(
      "retro:s",
      [action("s1", { sentTo: [{ route: "impediment", targetId: "imp1", at: "x" }] })],
      {
        archivedAt: "2026-10-09T10:00:00Z",
      }
    );
    expect(followThroughByRetro([sent], { targetDone: (l) => l.targetId === "imp1" })[0].done).toBe(
      1
    );
  });

  it("lists each action once (the newest carried copy) and skips example cards on real boards", () => {
    const ids = collectRetroActions([A, B], { today: "2026-10-20" }).map((a) => a.id);
    expect(ids).toEqual(["b2", "b3", "b4", "a1"]);
    // An example board (a tool's preview) is read as it is.
    const preview = board("example-retro-4", [action("example-a1")], {
      archivedAt: "2026-10-09T10:00:00Z",
    });
    expect(collectRetroActions([preview], { today: "2026-10-20" }).map((a) => a.id)).toEqual([
      "example-a1",
    ]);
  });

  it("quick-adds onto the current retro, else the newest archive", () => {
    const current = board("retro:current", []);
    expect(quickAddBoard([A, B, current])?.id).toBe("retro:current");
    expect(quickAddBoard([A, B])?.id).toBe("retro:b");
    expect(quickAddBoard([])).toBeUndefined();
    const c = actionCard(
      { text: "  Pair on it  ", assignee: " Sam ", dueDate: "2026-11-01" },
      "start",
      "n1"
    );
    expect(c).toMatchObject({
      id: "n1",
      text: "Pair on it",
      assignee: "Sam",
      dueDate: "2026-11-01",
      isActionItem: true,
    });
    expect(withAddedAction(current, c).cards).toEqual([c]);
  });
});

describe("retro facts", () => {
  const story = (id: string, points: number, doneAt?: string): Story => ({
    id,
    title: id,
    points,
    sprintId: "s2",
    status: doneAt ? "done" : "in_progress",
    ...(doneAt ? { doneAt } : {}),
  });

  it("reads the burndown's shape from when stories were done", () => {
    expect(
      burndownShape(S2, [
        story("a", 3, "2026-10-21"),
        story("b", 5, "2026-10-22"),
        story("c", 2, "2026-10-14"),
      ])
    ).toMatchObject({
      shape: "late",
      lateShare: 0.8,
    });
    expect(
      burndownShape(S2, [story("a", 3, "2026-10-13"), story("b", 5, "2026-10-15")])?.shape
    ).toBe("steady");
    expect(burndownShape(S2, [story("a", 3)])?.shape).toBe("none");
    expect(burndownShape(S2, [{ ...story("a", 0), points: undefined }])).toBeNull();
  });

  it("gathers the goal, impediments, mood, kudos and the last retro's follow-through", () => {
    const previous = board("retro:prev", [action("p1", { done: true }), action("p2")], {
      archivedAt: "2026-10-09T15:00:00Z",
    });
    const facts = retroFacts({
      sprint: S2,
      sprints: SPRINTS,
      stories: [story("a", 3, "2026-10-21"), story("b", 5)],
      goals: [
        {
          id: "sprint-goal:sprint:s2",
          sprintId: "s2",
          businessObjective: "",
          goal: "Pay by card",
          criteria: [],
          keyResults: [],
          outcome: { met: "partly", decidedAt: "2026-10-23" },
        },
      ],
      impediments: [
        {
          id: "i1",
          title: "VPN",
          severity: "high",
          raisedAt: "2026-10-13",
          resolvedAt: "2026-10-15",
        },
        {
          id: "i2",
          title: "Keys",
          severity: "medium",
          raisedAt: "2026-10-20",
          escalatedAt: "2026-10-21",
        },
        { id: "i3", title: "Old", severity: "low", raisedAt: "2026-09-01" },
        { id: "example-i", title: "Ex", severity: "low", raisedAt: "2026-10-14" },
      ],
      moodEntries: [
        { id: "m1", memberId: "a", date: "2026-10-13", score: 4 },
        { id: "m2", memberId: "b", date: "2026-10-14", score: 3 },
        { id: "m3", memberId: "a", date: "2026-10-20", score: 2 },
        { id: "m4", memberId: "b", date: "2026-10-20", score: 5, isPlaceholder: true },
      ],
      retroBoards: [previous],
      kudos: [
        {
          id: "k1",
          theme: "teamwork",
          toName: "Bo",
          fromName: "Al",
          message: "Thanks",
          sentAt: "2026-10-16T09:00:00Z",
        } as never,
        {
          id: "k2",
          theme: "teamwork",
          toName: "Bo",
          fromName: "Al",
          message: "Old",
          sentAt: "2026-09-01T09:00:00Z",
        } as never,
      ],
      today: "2026-10-24",
    });
    expect(facts).toMatchObject({
      sprintId: "s2",
      dated: true,
      goal: "Pay by card",
      goalOutcome: { met: "partly" },
      committed: 8,
      completed: 3,
      fromStories: true,
      impediments: { raised: 2, resolvedInSprint: 1, stillOpen: 1, escalated: 1 },
      mood: { average: 3, checkIns: 3, people: 2 },
      followThrough: { boardId: "retro:prev", agreed: 2, done: 1, open: 1 },
    });
    expect(facts.kudos.map((k) => k.id)).toEqual(["k1"]);
    expect(facts.burndown?.shape).toBe("late");
  });

  it("leaves kudos replies and example kudos out of the sprint's kudos", () => {
    const kudos = (id: string, over: Record<string, unknown> = {}) =>
      ({
        id,
        theme: "thank-you",
        toName: "Bo",
        fromName: "Al",
        message: id,
        sentAt: "2026-10-16T09:00:00Z",
        ...over,
      }) as never;
    const facts = retroFacts({
      sprint: S2,
      sprints: SPRINTS,
      stories: [],
      kudos: [
        kudos("k1"),
        // A reply copies its parent's recipient: it isn't a second kudos for Bo.
        kudos("k1-reply", { replyTo: "k1", fromName: "Cy", sentAt: "2026-10-17T09:00:00Z" }),
        kudos("example-k2"),
        kudos("k3", { toName: "Cy", sentAt: "2026-10-18T09:00:00Z" }),
      ],
      today: "2026-10-24",
    });
    expect(facts.kudos.map((k) => k.id)).toEqual(["k1", "k3"]);
  });

  it("quotes no average mood below the minimum sample", () => {
    const facts = retroFacts({
      sprint: S2,
      sprints: SPRINTS,
      stories: [],
      moodEntries: [{ id: "m1", memberId: "a", date: "2026-10-13", score: 4 }],
      today: "2026-10-24",
    });
    expect(facts.mood).toEqual({ average: null, checkIns: 1, people: 1 });
    expect(facts.followThrough).toBeNull();
  });
});
