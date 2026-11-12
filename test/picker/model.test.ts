// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLES,
  PICKER_INITIAL,
  PICKER_LIMITS,
  TEAM_SOURCE,
  addEntries,
  awayToday,
  clampWeight,
  findList,
  freshProgress,
  localDay,
  nextForRole,
  normalizePickerState,
  planRoles,
  poolLabel,
  progressFor,
  rolePeople,
  roleSourceLabel,
  roleStandings,
  sourceEntries,
  spinWheel,
  timeAgo,
  wheelView,
  withProgress,
  withRecent,
  withRoleTurn,
  type PickerEntry,
  type PickerRoleTurn,
} from "@/lib/picker/model";
import { parseNames, rosterNames } from "@/lib/picker/people";
import { createRng } from "@/lib/utils/random";

/**
 * Picker's rules, shared by the page and Amr: what the wheel shows, a spin
 * with weights, everyone once and names that leave once picked, the fair
 * role rotation, and every saved field read back safely.
 */

const e = (name: string, weight = 1): PickerEntry => ({ name, weight });
const FIVE = ["Amina", "Ben", "Chloé", "Dev", "Elif"].map((n) => e(n));
const ONCE = { everyoneOnce: true, removePicked: false };
const ANY = { everyoneOnce: false, removePicked: false };

describe("people", () => {
  it("reads the roster once per name, trimmed, in order", () => {
    expect(
      rosterNames([{ name: " Sam " }, { name: "sam" }, { name: "" }, { name: "Alex" }])
    ).toEqual(["Sam", "Alex"]);
    expect(rosterNames(Array.from({ length: 50 }, (_, i) => ({ name: `P${i}` })))).toHaveLength(40);
  });

  it("parses a typed list: lines or commas, markers dropped, repeats and the cap counted", () => {
    expect(parseNames("- Sam\n2. Alex\n\nsam\n  Jo  ")).toEqual({
      names: ["Sam", "Alex", "Jo"],
      repeats: 1,
      dropped: 0,
      cut: 0,
    });
    expect(parseNames("Sam, Alex ,Jo").names).toEqual(["Sam", "Alex", "Jo"]);
    expect(parseNames(Array.from({ length: 45 }, (_, i) => `N${i}`).join("\n")).dropped).toBe(5);
    expect(parseNames("x".repeat(50)).cut).toBe(1);
  });
});

describe("normalizePickerState", () => {
  it("starts from the defaults: team, everyone once, the three roles", () => {
    const s = normalizePickerState(undefined);
    expect(s).toEqual(PICKER_INITIAL);
    expect(s.roles.map((r) => r.name)).toEqual(["Facilitator", "Scribe", "Timekeeper"]);
  });

  it("rebuilds every field and drops what it can't read", () => {
    const s = normalizePickerState({
      lists: [
        { id: "l1", name: " Topics ", entries: [{ name: "A", weight: 9 }, "B", { name: "a" }, 3] },
        { id: "bad id!", name: "X", entries: [] },
        { id: "l1", name: "Dup", entries: [] },
      ],
      source: "l1",
      teamWeights: { " Sam ": 3, Alex: 1, __proto__: 4 },
      everyoneOnce: false,
      progress: { source: "l1", drawn: ["a", "A", 5], removed: ["b"], round: 2, last: "a" },
      roleTurns: [
        { id: "t1", roleId: "role-scribe", person: "Sam", at: "2026-11-01T10:00:00Z" },
        { id: "t2", roleId: "nope", person: "X", at: "2026-11-01T10:00:00Z" },
      ],
      recent: [
        { id: "r1", kind: "coin", result: "Heads", at: "2026-11-01T10:00:00Z" },
        { id: "r2", kind: "spell", result: "x", at: "2026-11-01T10:00:00Z" },
      ],
      shortlist: ["Nile", "nile", " Amazon "],
      away: { day: "2026-11-12", keys: ["Sam"] },
    });
    expect(s.lists).toEqual([
      {
        id: "l1",
        name: "Topics",
        entries: [e("A", 5), e("B")],
        updatedAt: new Date(0).toISOString(),
      },
    ]);
    expect(s.source).toBe("l1");
    expect(s.teamWeights).toEqual({ sam: 3 });
    expect(s.everyoneOnce).toBe(false);
    expect(s.progress).toEqual({ source: "l1", drawn: ["a"], removed: ["b"], round: 2, last: "a" });
    expect(s.roleTurns.map((t) => t.id)).toEqual(["t1"]);
    // A turn saved without its day reads it back from its time.
    expect(s.roleTurns[0].day).toMatch(/^2026-11-0[12]$/);
    expect(s.recent.map((r) => r.id)).toEqual(["r1"]);
    expect(s.shortlist).toEqual(["Nile", "Amazon"]);
    expect(s.away).toEqual({ day: "2026-11-12", keys: ["sam"] });
  });

  it("falls back to the team when the wheel's list is gone, and starts its progress afresh", () => {
    const s = normalizePickerState({
      source: "gone",
      roleSource: "gone",
      progress: { source: "gone", drawn: ["a"] },
      parked: [{ source: "gone", drawn: ["b"] }],
    });
    expect(s.source).toBe(TEAM_SOURCE);
    expect(s.roleSource).toBe(TEAM_SOURCE);
    expect(s.progress).toEqual(freshProgress(TEAM_SOURCE));
    expect(s.parked).toEqual([]);
  });

  it("keeps a UTC offset only when it is one", () => {
    expect(normalizePickerState({ utcOffset: 120 }).utcOffset).toBe(120);
    expect(normalizePickerState({ utcOffset: -330 }).utcOffset).toBe(-330);
    expect(normalizePickerState({ utcOffset: 2000 }).utcOffset).toBeNull();
    expect(normalizePickerState({ utcOffset: "60" }).utcOffset).toBeNull();
  });

  it("caps the history, the recent picks and the lists", () => {
    const turns = Array.from({ length: 320 }, (_, i) => ({
      id: `t${i}`,
      roleId: "role-scribe",
      person: "Sam",
      at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    }));
    const s = normalizePickerState({ roleTurns: turns });
    expect(s.roleTurns).toHaveLength(PICKER_LIMITS.maxRoleTurns);
    expect(s.roleTurns[0].id).toBe("t20");
    expect(clampWeight(0)).toBe(1);
    expect(clampWeight(2.6)).toBe(3);
    expect(clampWeight("4")).toBe(1);
  });
});

describe("the wheel's names", () => {
  it("spins the team with its weights, or a saved list", () => {
    const state = normalizePickerState({
      teamWeights: { ben: 2 },
      lists: [{ id: "l1", name: "Topics", entries: ["X", "Y"] }],
    });
    expect(sourceEntries(state, [{ name: "Amina" }, { name: "Ben" }])).toEqual([
      e("Amina"),
      e("Ben", 2),
    ]);
    expect(sourceEntries({ ...state, source: "l1" }, [{ name: "Amina" }])).toEqual([
      e("X"),
      e("Y"),
    ]);
    expect(findList(state.lists, "topics")?.id).toBe("l1");
    expect(poolLabel("Team", 1, true)).toBe("Team (1 person)");
    expect(poolLabel("Topics", 2, false)).toBe("Topics (2 names)");
  });

  it("keeps drawn names on the wheel but not in the next spin; removed ones leave it", () => {
    const progress = { ...freshProgress("team"), drawn: ["amina", "ben"], removed: ["chloé"] };
    const v = wheelView(FIVE, progress, true);
    expect(v.shown.map((x) => x.name)).toEqual(["Amina", "Ben", "Dev", "Elif"]);
    expect(v.eligible).toEqual([2, 3]);
    expect(v.removed).toEqual(["Chloé"]);
    expect(v.left).toBe(2);
    expect(wheelView(FIVE, progress, false).eligible).toEqual([0, 1, 2, 3]);
  });
});

describe("each source keeps its own progress", () => {
  const LISTS = [
    { id: "l1", name: "Topics", entries: ["X", "Y"], updatedAt: "2026-11-01T00:00:00Z" },
  ];
  const teamRound = {
    source: TEAM_SOURCE,
    drawn: ["amina", "ben"],
    removed: ["ben"],
    round: 2,
    last: "ben",
  };

  it("parks the team's round when a write moves the wheel to a list, and brings it back", () => {
    const start = normalizePickerState({ lists: LISTS, progress: teamRound });
    // What add_names, saving a new list, Spin this and Spin the shortlist write.
    const onList = normalizePickerState({ ...start, source: "l1" });
    expect(onList.progress).toEqual(freshProgress("l1"));
    expect(onList.parked).toEqual([teamRound]);
    const back = normalizePickerState({ ...onList, source: TEAM_SOURCE });
    expect(back.progress).toEqual(teamRound);
  });

  it("saves a spin's progress for the source it spun, wherever the wheel is now", () => {
    const onList = normalizePickerState({ lists: LISTS, source: "l1", parked: [teamRound] });
    const listRound = { ...freshProgress("l1"), drawn: ["x"], last: "x" };
    const a = normalizePickerState(withProgress(onList, listRound));
    expect(a.progress).toEqual(listRound);
    expect(progressFor(a, TEAM_SOURCE)).toEqual(teamRound);
    // A team spin that lands after the wheel moved to the list is parked.
    const later = { ...teamRound, drawn: ["amina", "ben", "chloé"], last: "chloé" };
    const b = normalizePickerState(withProgress(a, later));
    expect(b.progress).toEqual(listRound);
    expect(progressFor(b, TEAM_SOURCE)).toEqual(later);
  });

  it("forgets a deleted list's progress, and keeps nothing for a fresh one", () => {
    const s = normalizePickerState({
      lists: LISTS,
      progress: freshProgress(TEAM_SOURCE),
      parked: [
        { source: "l1", drawn: ["x"] },
        { source: "l2", drawn: ["z"] },
      ],
    });
    expect(s.parked.map((p) => p.source)).toEqual(["l1"]);
    expect(normalizePickerState({ ...s, lists: [] }).parked).toEqual([]);
    expect(normalizePickerState({ lists: LISTS, source: "l1" }).parked).toEqual([]);
  });
});

describe("spinWheel", () => {
  it("never repeats a name until everyone has come up (everyone once)", () => {
    const rng = createRng(7);
    let progress = freshProgress("team");
    const firstRound: string[] = [];
    for (let i = 0; i < FIVE.length; i++) {
      const out = spinWheel(FIVE, progress, ONCE, rng)!;
      firstRound.push(out.entry.name);
      progress = out.progress;
      expect(out.roundDone).toBe(i === FIVE.length - 1);
    }
    expect([...firstRound].sort()).toEqual(FIVE.map((x) => x.name).sort());
    // Round two refills, and doesn't open with the name that closed round one.
    const next = spinWheel(FIVE, progress, ONCE, rng)!;
    expect(next.newRound).toBe(true);
    expect(next.progress.round).toBe(2);
    expect(next.entry.name).not.toBe(firstRound[4]);
    expect(next.progress.drawn).toHaveLength(1);
  });

  it("follows the weights: a weight of 5 comes up about five times as often", () => {
    const rng = createRng("weights");
    const entries = [e("Heavy", 5), e("Light", 1)];
    let heavy = 0;
    for (let i = 0; i < 3000; i++) {
      if (spinWheel(entries, freshProgress("x"), ANY, rng)!.entry.name === "Heavy") heavy++;
    }
    expect(heavy / 3000).toBeGreaterThan(0.79);
    expect(heavy / 3000).toBeLessThan(0.88);
  });

  it("takes a name off after it's picked, and has nothing to spin once all are off", () => {
    const rules = { everyoneOnce: false, removePicked: true };
    let progress = freshProgress("x");
    const two = [e("A"), e("B")];
    const first = spinWheel(two, progress, rules, createRng(1))!;
    progress = first.progress;
    expect(progress.removed).toEqual([first.entry.name.toLowerCase()]);
    const second = spinWheel(two, progress, rules, createRng(2))!;
    expect(second.entry.name).not.toBe(first.entry.name);
    expect(spinWheel(two, second.progress, rules)).toBeNull();
    expect(spinWheel([], freshProgress("x"), rules)).toBeNull();
  });

  it("leaves the progress passed in as it was, and is the same for the same seed", () => {
    const progress = freshProgress("team");
    const a = spinWheel(FIVE, progress, ONCE, createRng(42))!;
    const b = spinWheel(FIVE, progress, ONCE, createRng(42))!;
    expect(a.entry).toEqual(b.entry);
    expect(progress).toEqual(freshProgress("team"));
  });
});

describe("roles", () => {
  const turn = (
    id: string,
    roleId: string,
    person: string,
    at: string,
    day = at.slice(0, 10)
  ): PickerRoleTurn => ({ id, roleId, person, at, day });
  const people = ["Amina", "Ben", "Chloé", "Dev"];
  const turns = [
    turn("1", "role-facilitator", "Amina", "2026-10-20T09:00:00Z"),
    turn("2", "role-facilitator", "Ben", "2026-10-27T09:00:00Z"),
    turn("3", "role-facilitator", "Amina", "2026-11-03T09:00:00Z"),
    turn("4", "role-scribe", "Dev", "2026-11-03T09:00:00Z"),
  ];

  it("puts the fewest turns first, then the longest ago, then the order given", () => {
    const rows = roleStandings(people, turns, "role-facilitator");
    expect(rows.map((r) => [r.name, r.turns])).toEqual([
      ["Chloé", 0],
      ["Dev", 0],
      ["Ben", 1],
      ["Amina", 2],
    ]);
    expect(rows[3].lastAt).toBe("2026-11-03T09:00:00Z");
    expect(nextForRole(people, turns, "role-facilitator")).toBe("Chloé");
  });

  it("skips someone away today without losing their place, and nobody when all are away", () => {
    expect(nextForRole(people, turns, "role-facilitator", { away: ["chloé"] })).toBe("Dev");
    const rows = roleStandings(people, turns, "role-facilitator", { away: ["chloé"] });
    expect(rows[rows.length - 1]).toMatchObject({ name: "Chloé", away: true, turns: 0 });
    expect(nextForRole(["Sam"], [], "role-scribe", { away: ["sam"] })).toBeNull();
  });

  it("gives three roles over four people to three different people", () => {
    const today = "2026-11-12";
    const given: PickerRoleTurn[] = [];
    for (const roleId of ["role-facilitator", "role-scribe", "role-timekeeper"]) {
      const person = nextForRole(people, given, roleId, { today })!;
      given.push(turn(`t-${roleId}`, roleId, person, `${today}T09:00:00Z`, today));
    }
    expect(given.map((t) => t.person)).toEqual(["Amina", "Ben", "Chloé"]);
    // Holding a role today is shown, and sorts after everyone free.
    const rows = roleStandings(people, given, "role-timekeeper", { today });
    expect(rows.find((r) => r.name === "Amina")?.busyWith).toBe("role-facilitator");
    // Tomorrow, the Scribe rotation looks at Scribe turns only.
    expect(nextForRole(people, given, "role-scribe", { today: "2026-11-13" })).toBe("Amina");
  });

  it("gives a second role only when everyone here already has one", () => {
    const today = "2026-11-12";
    const two = ["Amina", "Ben"];
    const given = [
      turn("a", "role-facilitator", "Amina", `${today}T09:00:00Z`, today),
      turn("b", "role-scribe", "Ben", `${today}T09:01:00Z`, today),
    ];
    expect(nextForRole(two, given, "role-timekeeper", { today })).toBe("Amina");
    expect(nextForRole(two, given, "role-timekeeper", { today, away: ["amina"] })).toBe("Ben");
  });

  it("plans every role not given today, each to someone else", () => {
    const roles = [...DEFAULT_ROLES];
    const today = "2026-11-12";
    expect(planRoles(roles, people, [], { today }).map((p) => [p.role.name, p.person])).toEqual([
      ["Facilitator", "Amina"],
      ["Scribe", "Ben"],
      ["Timekeeper", "Chloé"],
    ]);
    const facilitated = [turn("a", "role-facilitator", "Dev", `${today}T09:00:00Z`, today)];
    expect(planRoles(roles, people, facilitated, { today }).map((p) => p.person)).toEqual([
      "Amina",
      "Ben",
    ]);
    expect(planRoles(roles, ["Sam"], [], { today, away: ["sam"] })[0].person).toBeNull();
  });

  it("rotates among the team, or the list chosen for roles, never the wheel's names", () => {
    const lists = [
      { id: "l1", name: "Squad", entries: ["Gus", "Hana"], updatedAt: "2026-11-01T00:00:00Z" },
      { id: "l2", name: "Topics", entries: ["Nile", "Volga"], updatedAt: "2026-11-01T00:00:00Z" },
    ];
    const team = [{ name: "Amina" }, { name: "Ben" }];
    const onTopics = normalizePickerState({ lists, source: "l2" });
    expect(rolePeople(onTopics, team)).toEqual(["Amina", "Ben"]);
    expect(roleSourceLabel(onTopics)).toBe("Team");
    const squad = normalizePickerState({ lists, source: "l2", roleSource: "l1" });
    expect(rolePeople(squad, team)).toEqual(["Gus", "Hana"]);
    expect(roleSourceLabel(squad)).toBe("Squad");
  });

  it("works out the user's day from the offset the page saved", () => {
    const now = new Date("2026-11-12T23:30:00Z");
    expect(localDay(120, now)).toBe("2026-11-13");
    expect(localDay(-300, now)).toBe("2026-11-12");
    expect(localDay(0, new Date("2026-11-12T00:10:00Z"))).toBe("2026-11-12");
  });

  it("forgets who was away once the day is over", () => {
    expect(awayToday({ day: "2026-11-12", keys: ["sam"] }, "2026-11-12")).toEqual(["sam"]);
    expect(awayToday({ day: "2026-11-11", keys: ["sam"] }, "2026-11-12")).toEqual([]);
  });

  it("keeps the turn history newest last and capped", () => {
    const many = Array.from({ length: PICKER_LIMITS.maxRoleTurns }, (_, i) =>
      turn(`t${i}`, "role-scribe", "Sam", "2026-01-01T00:00:00Z")
    );
    const out = withRoleTurn(many, turn("new", "role-scribe", "Alex", "2026-02-01T00:00:00Z"));
    expect(out).toHaveLength(PICKER_LIMITS.maxRoleTurns);
    expect(out[out.length - 1].id).toBe("new");
    expect(DEFAULT_ROLES).toHaveLength(3);
  });
});

describe("lists and recent picks", () => {
  it("adds each name once, up to the cap, and says what it skipped", () => {
    const r = addEntries([e("Sam")], ["sam", " Alex ", "", "Jo"]);
    expect(r).toEqual({ entries: [e("Sam"), e("Alex"), e("Jo")], added: 2, skipped: 1 });
    const full = Array.from({ length: 40 }, (_, i) => e(`N${i}`));
    expect(addEntries(full, ["Extra"])).toMatchObject({ added: 0, skipped: 1 });
  });

  it("keeps the newest thirty picks", () => {
    let recent = withRecent([], {
      id: "a",
      kind: "coin",
      result: "Heads",
      detail: "",
      at: "2026-11-01T00:00:00Z",
    });
    for (let i = 0; i < 40; i++) {
      recent = withRecent(recent, {
        id: `p${i}`,
        kind: "dice",
        result: "3",
        detail: "1d6",
        at: "2026-11-01T00:00:00Z",
      });
    }
    expect(recent).toHaveLength(PICKER_LIMITS.maxRecent);
    expect(recent[0].id).toBe("p39");
  });

  it("says how long ago in plain words", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(timeAgo("2026-11-12T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-11-12T11:55:00Z", now)).toBe("5 minutes ago");
    expect(timeAgo("2026-11-12T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-11-11T09:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-11-05T12:00:00Z", now)).toBe("7 days ago");
    expect(timeAgo("2026-10-22T12:00:00Z", now)).toBe("3 weeks ago");
    expect(timeAgo("2026-08-01T12:00:00Z", now)).toBe("3 months ago");
  });
});
