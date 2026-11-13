// @vitest-environment node
/**
 * Team Mixer's saved state and its changes (lib/team-mixer/state + ops):
 * everything read back is checked field by field, the example clears
 * exactly its own rows, people are added once each with the roster's
 * spelling, rules are validated, a mix saves a round (or a café plan) that
 * the next round avoids, and a moved person stays moved. Plus the built-in
 * group names.
 */

import { describe, expect, it } from "vitest";
import type { TeamMember } from "@/lib/stores/workspace-types";
import {
  MIXER_INITIAL,
  hasExampleRows,
  normalizeMixerState,
  withExample,
  withoutExample,
  type MixerState,
} from "@/lib/team-mixer/state";
import {
  addPeople,
  addRule,
  latestRound,
  mixNow,
  mixPeople,
  movePerson,
  nameGroups,
  pairingCount,
  parseNames,
  removePeople,
  rotationNote,
  settingsPreview,
  settingsProblem,
  showCafeRound,
  validateRule,
} from "@/lib/team-mixer/ops";
import { MIXER_LIMITS, pairKey } from "@/lib/team-mixer/model";
import { NAME_THEMES, suggestGroupNames, themeFor } from "@/lib/team-mixer/names";
import { createRng } from "@/lib/utils/random";

const ROSTER: TeamMember[] = [
  { id: "m1", name: "Ana", role: "Developer", skills: ["React"] },
  { id: "m2", name: "Bo", role: "Tester" },
];

let n = 0;
const id = () => `id-${++n}`;

function withPeople(names: string[], over: Partial<MixerState> = {}): MixerState {
  return { ...addPeople({ ...MIXER_INITIAL, ...over }, names, [], id).state };
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

describe("normalizeMixerState", () => {
  it("starts from the defaults for anything missing or wrong", () => {
    expect(normalizeMixerState(null)).toEqual(MIXER_INITIAL);
    expect(normalizeMixerState("x")).toEqual(MIXER_INITIAL);
    const s = normalizeMixerState({
      mode: "speed-dating",
      size: 1,
      count: 999,
      tables: 1,
      cafeRounds: 0,
      balance: "age",
      odd: "drop",
      title: "  Retro   breakouts ",
      seriesSeed: -1,
    });
    expect(s.mode).toBe("groups");
    expect(s.size).toBe(4);
    expect(s.count).toBe(3);
    expect(s.tables).toBe(4);
    expect(s.cafeRounds).toBe(3);
    expect(s.balance).toBe("none");
    expect(s.odd).toBe("trio");
    expect(s.title).toBe("Retro breakouts");
    expect(s.seriesSeed).toBe(0);
  });

  it("keeps each person, rule and round once, and drops broken ones", () => {
    const s = normalizeMixerState({
      people: [
        { id: "p1", name: "Ana" },
        { id: "p2", name: " ana " },
        { id: "p1", name: "Bo" },
        { id: "", name: "Cy" },
        { id: "p3", name: "x".repeat(200) },
        "Dee",
      ],
      rules: [
        { id: "r1", kind: "apart", a: "Ana", b: "Bo" },
        { id: "r2", kind: "together", a: "bo", b: "ana" },
        { id: "r3", kind: "apart", a: "Ana", b: "ana" },
        { id: "r4", kind: "weird", a: "Cy", b: "Dee" },
      ],
      rounds: [
        {
          id: "x1",
          at: "2026-11-10T10:00:00.000Z",
          mode: "pairs",
          groups: [{ people: ["Ana", "Bo"] }],
        },
        { id: "x1", at: "2026-11-11T10:00:00.000Z", groups: [{ people: ["Ana"] }] },
        { id: "x2", groups: [] },
        { id: "x0", at: "2026-11-09T10:00:00.000Z", groups: [{ name: "Oak", people: ["Cy"] }] },
      ],
    });
    expect(s.people.map((p) => p.name)).toEqual(["Ana", "x".repeat(MIXER_LIMITS.name)]);
    expect(s.rules.map((r) => r.id)).toEqual(["r1", "r4"]);
    expect(s.rules[1].kind).toBe("apart");
    expect(s.rounds.map((r) => r.id)).toEqual(["x0", "x1"]);
    expect(s.rounds[0].groups[0].name).toBe("Oak");
    expect(s.rounds[1].mode).toBe("pairs");
  });

  it("keeps a café plan only when every round has two tables or more with hosts", () => {
    const good = {
      id: "c1",
      at: "2026-11-10T10:00:00.000Z",
      rounds: [
        [
          { host: "Ana", guests: ["Bo"] },
          { host: "Cy", guests: ["Dee"] },
        ],
      ],
      current: 5,
    };
    expect(normalizeMixerState({ cafe: good }).cafe?.current).toBe(0);
    expect(
      normalizeMixerState({ cafe: { ...good, rounds: [[{ host: "Ana", guests: [] }]] } }).cafe
    ).toBeNull();
    expect(
      normalizeMixerState({
        cafe: {
          ...good,
          rounds: [
            [
              { host: "", guests: [] },
              { host: "Cy", guests: [] },
            ],
          ],
        },
      }).cafe
    ).toBeNull();
  });

  it("numbers the rounds in time order, and keeps the series count ahead of them", () => {
    const s = normalizeMixerState({
      seriesRound: 2,
      rounds: [
        { id: "b", number: 7, at: "2026-11-11T10:00:00.000Z", groups: [{ people: ["Ana"] }] },
        { id: "a", at: "2026-11-10T10:00:00.000Z", groups: [{ people: ["Ana"] }] },
        { id: "c", number: 3, at: "2026-11-12T10:00:00.000Z", groups: [{ people: ["Ana"] }] },
      ],
    });
    expect(s.rounds.map((r) => [r.id, r.number])).toEqual([
      ["a", 1],
      ["b", 7],
      ["c", 8],
    ]);
    expect(s.seriesRound).toBe(8);
    expect(normalizeMixerState({ seriesRound: 50 }).seriesRound).toBe(50);
    expect(normalizeMixerState({ seriesRound: -1 }).seriesRound).toBe(0);
  });

  it("caps the saved rounds, the oldest going first", () => {
    const rounds = Array.from({ length: MIXER_LIMITS.rounds + 5 }, (_, i) => ({
      id: `r${i}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      groups: [{ people: ["Ana", "Bo"] }],
    }));
    const s = normalizeMixerState({ rounds });
    expect(s.rounds).toHaveLength(MIXER_LIMITS.rounds);
    expect(s.rounds[0].id).toBe("r5");
  });
});

describe("the example", () => {
  it("is told apart and cleared without touching the person's own rows", () => {
    const s = normalizeMixerState({
      people: [
        { id: "example-p1", name: "Ana" },
        { id: "p2", name: "Bo" },
      ],
      rules: [{ id: "example-r1", kind: "apart", a: "Ana", b: "Bo" }],
      rounds: [{ id: "r1", at: "2026-11-10T10:00:00.000Z", groups: [{ people: ["Bo"] }] }],
    });
    expect(hasExampleRows(s)).toBe(true);
    const clean = withoutExample(s);
    expect(clean.people.map((p) => p.name)).toEqual(["Bo"]);
    expect(clean.rules).toEqual([]);
    expect(clean.rounds).toHaveLength(1);
    expect(hasExampleRows(clean)).toBe(false);
  });

  it("takes the series count back by the example's rounds after the person's own", () => {
    const round = (id: string, number: number, h: number) => ({
      id,
      number,
      at: new Date(Date.UTC(2026, 10, 12, h)).toISOString(),
      groups: [{ people: ["Bo", "Cy"] }],
    });
    const after = normalizeMixerState({
      rounds: [round("r1", 1, 8), round("r2", 2, 9), round("example-round-1", 3, 10)],
    });
    expect(after.seriesRound).toBe(3);
    expect(withoutExample(after).seriesRound).toBe(2);
    const before = normalizeMixerState({
      rounds: [round("example-round-1", 1, 8), round("r2", 2, 9)],
    });
    expect(withoutExample(before).seriesRound).toBe(2);
    expect(
      withoutExample(normalizeMixerState({ rounds: [round("example-round-1", 1, 8)] })).seriesRound
    ).toBe(0);
  });
});

describe("adding the example", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 12, h)).toISOString();
  const ex = normalizeMixerState({
    mode: "groups",
    split: "size",
    size: 3,
    title: "Example title",
    seriesSeed: 9,
    people: [
      { id: "example-p1", name: "Amira" },
      { id: "example-p2", name: "Ben" },
    ],
    rules: [
      { id: "example-r1", kind: "apart", a: "Amira", b: "Ben" },
      { id: "example-r2", kind: "together", a: "Chen", b: "Dana" },
    ],
    rounds: [{ id: "example-round-1", number: 1, at: at(12), groups: [{ people: ["Amira"] }] }],
  });

  it("puts the example's round after the person's own, so it's the one shown", () => {
    const own = normalizeMixerState({
      mode: "pairs",
      seriesSeed: 4,
      rounds: [{ id: "r1", number: 1, at: at(8), groups: [{ people: ["Zed", "Yan"] }] }],
    });
    const s = normalizeMixerState(withExample(own, ex));
    expect(s.mode).toBe("groups");
    expect(s.title).toBe("Example title");
    expect(s.seriesSeed).toBe(4);
    expect(s.rounds.map((r) => [r.id, r.number])).toEqual([
      ["r1", 1],
      ["example-round-1", 2],
    ]);
    expect(latestRound(s)?.id).toBe("example-round-1");
    // Clear example puts the series back where it was.
    expect(withoutExample(s).rounds.map((r) => r.id)).toEqual(["r1"]);
    expect(withoutExample(s).seriesRound).toBe(1);
  });

  it("never pushes out the person's own rules or rounds at the caps", () => {
    const rules = Array.from({ length: MIXER_LIMITS.rules - 1 }, (_, i) => ({
      id: `r${i}`,
      kind: "apart",
      a: `A${i}`,
      b: `B${i}`,
    }));
    const rounds = Array.from({ length: MIXER_LIMITS.rounds }, (_, i) => ({
      id: `round${i}`,
      number: i + 1,
      at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
      groups: [{ people: ["Zed", "Yan"] }],
    }));
    const own = normalizeMixerState({ rules, rounds });
    const s = normalizeMixerState(withExample(own, ex));
    // Room for one example rule, and none for its round.
    expect(s.rules).toHaveLength(MIXER_LIMITS.rules);
    expect(s.rules.slice(0, -1)).toEqual(own.rules);
    expect(s.rules[s.rules.length - 1].id).toBe("example-r1");
    expect(s.rounds).toEqual(own.rounds);
    const back = withoutExample(s);
    expect(back.rules).toEqual(own.rules);
    expect(back.rounds).toEqual(own.rounds);
  });
});

describe("people", () => {
  it("adds each name once, with the roster's spelling", () => {
    const r = addPeople(MIXER_INITIAL, ["ana", "Ana", " Cy ", "", "Bo"], ROSTER, id);
    expect(r.state.people.map((p) => p.name)).toEqual(["Ana", "Cy", "Bo"]);
    expect(r.added).toEqual(["Ana", "Cy", "Bo"]);
    expect(r.full).toBe(false);
  });

  it("stops at the limit and says so", () => {
    const names = Array.from({ length: MIXER_LIMITS.people + 3 }, (_, i) => `P${i}`);
    const r = addPeople(MIXER_INITIAL, names, [], id);
    expect(r.state.people).toHaveLength(MIXER_LIMITS.people);
    expect(r.full).toBe(true);
  });

  it("reads a pasted list: lines, commas, bullets and numbers", () => {
    expect(parseNames("1. Ana\n- Bo\n• Cy, Dee; Eve\r\n\n")).toEqual([
      "Ana",
      "Bo",
      "Cy",
      "Dee",
      "Eve",
    ]);
  });

  it("takes people out by id", () => {
    const s = withPeople(["Ana", "Bo"]);
    expect(removePeople(s, [s.people[0].id]).people.map((p) => p.name)).toEqual(["Bo"]);
  });

  it("brings roles and skills from the roster", () => {
    const s = withPeople(["Ana", "Zed"]);
    expect(mixPeople(s, ROSTER)).toEqual([
      { name: "Ana", role: "Developer", skills: ["React"] },
      { name: "Zed" },
    ]);
  });
});

describe("rules", () => {
  it("need two different people and a pair with no rule yet", () => {
    expect(validateRule({ kind: "apart", a: "", b: "" }, [])).toEqual({
      ok: false,
      errors: { a: "Name the first person.", b: "Name the second person." },
    });
    expect(validateRule({ kind: "apart", a: "Ana", b: " ana" }, [])).toEqual({
      ok: false,
      errors: { b: "Pick two different people." },
    });
    const existing = [{ id: "r1", kind: "apart" as const, a: "Ana", b: "Bo" }];
    expect(validateRule({ kind: "together", a: "bo", b: "Ana" }, existing)).toEqual({
      ok: false,
      errors: { b: "There's already a rule for Ana and Bo." },
    });
    expect(validateRule({ kind: "together", a: " Ana ", b: "Cy" }, existing)).toEqual({
      ok: true,
      values: { kind: "together", a: "Ana", b: "Cy" },
    });
  });

  it("are added with an id, or refused in plain words", () => {
    const added = ok(addRule(MIXER_INITIAL, { kind: "apart", a: "Ana", b: "Bo" }, "r1"));
    expect(added.state.rules).toEqual([{ id: "r1", kind: "apart", a: "Ana", b: "Bo" }]);
    expect(addRule(added.state, { kind: "apart", a: "Bo", b: "Ana" })).toEqual({
      ok: false,
      error: "There's already a rule for Ana and Bo.",
    });
  });
});

describe("mixing and saving", () => {
  const six = () => withPeople(["Ana", "Bo", "Cy", "Dee", "Eve", "Fay"]);

  it("says what the settings will make, and what stops them", () => {
    expect(settingsPreview(six())).toBe("2 groups of 3.");
    expect(settingsPreview({ ...six(), mode: "pairs" })).toBe("3 pairs.");
    expect(settingsPreview({ ...withPeople(["A", "B"]), mode: "pairs" })).toBe("1 pair.");
    expect(settingsPreview({ ...withPeople(["A", "B", "C", "D", "E"]), mode: "pairs" })).toBe(
      "1 pair and a group of 3."
    );
    expect(
      settingsPreview({ ...withPeople(["A", "B", "C", "D", "E"]), mode: "pairs", odd: "sit-out" })
    ).toBe("2 pairs, and 1 person sits out each round.");
    expect(settingsPreview({ ...six(), mode: "cafe", tables: 2, cafeRounds: 2 })).toBe(
      "2 tables, each with a host and 2 guests, over 2 rounds."
    );
    expect(settingsProblem(withPeople(["Ana"]))).toBe("Add at least 2 people to mix.");
    expect(settingsProblem({ ...six(), mode: "cafe", tables: 4 })).toMatch(/at least 8 people/);
    expect(settingsPreview(withPeople(["Ana"]))).toBeNull();
  });

  it("saves a round, and the next one avoids its pairs", () => {
    const first = ok(mixNow({ ...six(), mode: "pairs" }, [], { seed: 1, id: "r1" }));
    expect(first.state.rounds).toHaveLength(1);
    expect(first.round!.mode).toBe("pairs");
    expect(first.state.seriesSeed).toBe(1);
    const second = ok(mixNow(first.state, [], { seed: 2, id: "r2" }));
    expect(second.state.rounds.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(second.state.seriesSeed).toBe(1);
    const before = new Set(first.round!.groups.flatMap((g) => [pairKey(g.people[0], g.people[1])]));
    for (const g of second.round!.groups)
      expect(before.has(pairKey(g.people[0], g.people[1]))).toBe(false);
    expect(latestRound(second.state)?.id).toBe("r2");
    expect(pairingCount(second.state)).toBe(6);
  });

  it("keeps the pair rotation and the round numbers going past the rounds it keeps", () => {
    const names = Array.from({ length: 44 }, (_, i) => `P${i + 1}`);
    let s: MixerState = { ...withPeople(names), mode: "pairs" };
    const seen = new Set<string>();
    for (let k = 1; k <= 43; k++) {
      const step = ok(
        mixNow(s, [], { seed: k, maxKicks: 5, now: new Date(Date.UTC(2026, 10, 1, 0, k)) })
      );
      expect(step.round!.number).toBe(k);
      for (const g of step.round!.groups) {
        const key = pairKey(g.people[0], g.people[1]);
        expect(seen.has(key), `round ${k} pairs ${g.people.join(" and ")} again`).toBe(false);
        seen.add(key);
      }
      s = step.state;
    }
    // 44 people meet all 946 pairs in 43 rounds, though only 40 rounds are kept.
    expect(seen.size).toBe(946);
    expect(s.rounds).toHaveLength(MIXER_LIMITS.rounds);
    expect(s.seriesRound).toBe(43);
    expect(s.rounds.map((r) => r.number)).toEqual(Array.from({ length: 40 }, (_, i) => i + 4));
    expect(normalizeMixerState(s)).toEqual(s);
  });

  it("says what the pair rotation can promise", () => {
    const even = { ...six(), mode: "pairs" as const };
    const five = withPeople(["Ana", "Bo", "Cy", "Dee", "Eve"], { mode: "pairs" });
    const promise =
      "Each round pairs people who haven't paired yet: everyone meets everyone before anyone pairs twice.";
    expect(rotationNote(even)).toBe(promise);
    expect(rotationNote({ ...five, odd: "sit-out" })).toBe(promise);
    expect(rotationNote(five)).toBe(
      "Each round pairs people who haven't paired yet as far as it can, but with the group of 3, some meet again sooner."
    );
    const rule = (b: string) => [{ id: "x1", kind: "apart" as const, a: "Ana", b }];
    expect(rotationNote({ ...even, rules: rule("Bo") })).toMatch(/, but with the rules, /);
    expect(rotationNote({ ...five, rules: rule("Bo") })).toMatch(
      /, but with the group of 3 and the rules, /
    );
    // A rule for someone who isn't in the mix takes nothing away.
    expect(rotationNote({ ...even, rules: rule("Zed") })).toBe(promise);
  });

  it("keeps the title with the round", () => {
    const r = ok(mixNow({ ...six(), title: "Retro breakouts" }, [], { seed: 1 }));
    expect(r.round!.title).toBe("Retro breakouts");
  });

  it("plans a World Café and steps through its rounds", () => {
    const r = ok(
      mixNow({ ...six(), mode: "cafe", tables: 2, cafeRounds: 2 }, [], { seed: 3, id: "c1" })
    );
    expect(r.cafe!.id).toBe("c1");
    expect(r.cafe!.rounds).toHaveLength(2);
    expect(r.state.rounds).toEqual([]);
    expect(showCafeRound(r.state, 1).cafe?.current).toBe(1);
    expect(showCafeRound(r.state, 9).cafe?.current).toBe(1);
    expect(showCafeRound(r.state, -3).cafe?.current).toBe(0);
  });

  it("refuses to mix what can't be mixed", () => {
    expect(mixNow(withPeople(["Ana"]), [])).toEqual({
      ok: false,
      error: "Add at least 2 people to mix.",
    });
  });

  it("moves a person to another group, and drops a group left empty", () => {
    const r = ok(mixNow({ ...six(), split: "count", count: 3 }, [], { seed: 4, id: "r1" }));
    const [first, second] = r.round!.groups;
    const who = first.people[0];
    const moved = movePerson(r.state, "r1", who, 1);
    const round = moved.rounds[0];
    expect(round.groups[1].people).toContain(who);
    expect(round.groups[0].people).not.toContain(who);
    expect(movePerson(moved, "r1", who, 1)).toBe(moved);
    expect(movePerson(moved, "nope", who, 0)).toBe(moved);
    expect(movePerson(moved, "r1", who, 7)).toBe(moved);
    // Move the last person out of a group: it goes.
    const left = round.groups[0].people[0];
    const emptied = movePerson(moved, "r1", left, 2);
    expect(emptied.rounds[0].groups).toHaveLength(2);
    void second;
  });

  it("works the report out again after a move: a rule now broken, nobody left sitting out", () => {
    const s: MixerState = {
      ...withPeople(["Ana", "Bo", "Cy", "Dee", "Eve"], { mode: "pairs", odd: "sit-out" }),
      rules: [{ id: "x1", kind: "apart", a: "Ana", b: "Bo" }],
      rounds: [
        {
          id: "r1",
          number: 1,
          at: "2026-11-12T10:00:00.000Z",
          mode: "pairs",
          seed: 1,
          balance: "none",
          groups: [{ people: ["Dee", "Eve"] }, { people: ["Bo", "Cy"] }],
          sitOut: ["Ana"],
          issues: [{ kind: "sit-out", text: "Ana sits out this round." }],
        },
      ],
    };
    const moved = movePerson(s, "r1", "Ana", 1).rounds[0];
    expect(moved.groups.map((g) => g.people)).toEqual([
      ["Dee", "Eve"],
      ["Bo", "Cy", "Ana"],
    ]);
    expect(moved.sitOut).toEqual([]);
    expect(moved.issues).toEqual([
      { kind: "apart", text: "Ana and Bo are both in Pair 2, though they should be kept apart." },
    ]);
  });

  it("names the groups by their new places once a move empties one, and counts the rounds before", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 12, h)).toISOString();
    const base = withPeople(["Ana", "Bo", "Cy", "Dee", "Eve"], { split: "count", count: 3 });
    const s: MixerState = {
      ...base,
      balance: "role",
      rules: [{ id: "x1", kind: "apart", a: "Dee", b: "Eve" }],
      rounds: [
        {
          id: "r0",
          number: 1,
          at: at(9),
          mode: "groups",
          seed: 1,
          balance: "none",
          groups: [{ people: ["Ana", "Bo"] }, { people: ["Cy", "Dee", "Eve"] }],
          sitOut: [],
          issues: [],
        },
        {
          id: "r1",
          number: 2,
          at: at(10),
          mode: "groups",
          seed: 2,
          balance: "role",
          groups: [{ people: ["Ana"] }, { people: ["Bo", "Cy"] }, { people: ["Dee", "Eve"] }],
          sitOut: [],
          issues: [
            {
              kind: "apart",
              text: "Dee and Eve are both in Group 3, though they should be kept apart.",
            },
          ],
        },
      ],
    };
    const roster: TeamMember[] = [
      { id: "m1", name: "Ana", role: "Developer" },
      { id: "m2", name: "Bo", role: "Developer" },
    ];
    const moved = movePerson(s, "r1", "Ana", 1, roster).rounds[1];
    expect(moved.groups.map((g) => g.people)).toEqual([
      ["Bo", "Cy", "Ana"],
      ["Dee", "Eve"],
    ]);
    expect(moved.issues.map((i) => i.text)).toEqual([
      "Dee and Eve are both in Group 2, though they should be kept apart.",
      "2 pairs have been together before: Bo with Ana and Dee with Eve.",
      "Developer isn't spread evenly: Group 1 has 2 of the 2.",
    ]);
    // The round before is left as it was.
    expect(movePerson(s, "r1", "Ana", 1, roster).rounds[0]).toBe(s.rounds[0]);
  });

  it("names groups in order, and clears a blank name", () => {
    const r = ok(mixNow(six(), [], { seed: 5, id: "r1" }));
    const named = nameGroups(r.state, "r1", ["Oak", "Elm"]);
    expect(named.rounds[0].groups.map((g) => g.name)).toEqual(["Oak", "Elm"]);
    const cleared = nameGroups(named, "r1", [""]);
    expect(cleared.rounds[0].groups[0].name).toBeUndefined();
    expect(cleared.rounds[0].groups[1].name).toBe("Elm");
    // null leaves a group's name as it is.
    const one = nameGroups(named, "r1", [null, "Ash"]);
    expect(one.rounds[0].groups.map((g) => g.name)).toEqual(["Oak", "Ash"]);
  });
});

describe("built-in group names", () => {
  it("follow a theme that is typed, or pick one", () => {
    expect(themeFor("Planets")?.id).toBe("planets");
    expect(themeFor("deep forest")?.id).toBe("trees");
    expect(themeFor("")).toBeNull();
    // The start of a word counts from 3 letters; one letter matches nothing.
    expect(themeFor("riv")?.id).toBe("rivers");
    expect(themeFor("a")).toBeNull();
    const { theme, names } = suggestGroupNames("rivers", 4, createRng(1));
    expect(theme.id).toBe("rivers");
    expect(new Set(names).size).toBe(4);
    for (const name of names) expect(theme.names).toContain(name);
    const any = suggestGroupNames("quantum lemurs", 3, createRng(2));
    expect(NAME_THEMES).toContain(any.theme);
  });

  it("number the names past a list's end, never repeating one", () => {
    const { names } = suggestGroupNames("trees", 14, createRng(3));
    expect(new Set(names).size).toBe(14);
    expect(names.filter((n) => / 2$/.test(n))).toHaveLength(2);
  });

  it("are all short and our own: twelve per theme", () => {
    for (const t of NAME_THEMES) {
      expect(t.names).toHaveLength(12);
      for (const name of t.names) expect(name.length).toBeLessThanOrEqual(MIXER_LIMITS.groupName);
    }
  });
});
