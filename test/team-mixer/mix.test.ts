// @vitest-environment node
/**
 * Team Mixer's mixing (lib/team-mixer): the group sizes, the search, the
 * rules (kept first, and named plainly when they can't be), fresh pairs
 * round after round, balance by role or skill, the sit-out seat and the
 * time limit. Seeded, so every case is the same on every run.
 */

import { describe, expect, it } from "vitest";
import {
  groupLabel,
  groupSizes,
  listNames,
  nameKey,
  ordinal,
  pairKey,
  pairSizes,
  uniquePeople,
  type MixPerson,
  type PastRound,
} from "@/lib/team-mixer/model";
import { assignmentCost, searchPartition } from "@/lib/team-mixer/search";
import { mixGroups, mixProblem, searchNote } from "@/lib/team-mixer/mix";
import { metHistory, pairList, placeRules, ruleText } from "@/lib/team-mixer/weights";
import { createRng } from "@/lib/utils/random";

const people = (...names: string[]): MixPerson[] => names.map((name) => ({ name }));
const TEN = people("Ana", "Bo", "Cy", "Dee", "Eve", "Fay", "Gus", "Hal", "Ivy", "Jo");
const SIX = people("Ana", "Bo", "Cy", "Dee", "Eve", "Fay");

/** Every pair that shares a group in `groups`. */
function pairsOf(groups: readonly (readonly string[])[]): Set<string> {
  const out = new Set<string>();
  for (const g of groups) {
    for (let x = 0; x < g.length; x++) {
      for (let y = x + 1; y < g.length; y++) out.add(pairKey(g[x], g[y]));
    }
  }
  return out;
}

const groupWith = (groups: readonly (readonly string[])[], name: string) =>
  groups.findIndex((g) => g.includes(name));

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

describe("group sizes", () => {
  it("by size stays near the size and never leaves someone alone", () => {
    expect(groupSizes(10, { by: "size", n: 3 })).toEqual([4, 3, 3]);
    expect(groupSizes(11, { by: "size", n: 3 })).toEqual([3, 3, 3, 2]);
    expect(groupSizes(12, { by: "size", n: 4 })).toEqual([4, 4, 4]);
    expect(groupSizes(5, { by: "size", n: 2 })).toEqual([3, 2]);
    expect(groupSizes(3, { by: "size", n: 2 })).toEqual([3]);
    expect(groupSizes(0, { by: "size", n: 4 })).toEqual([]);
  });

  it("by count makes that many groups, one apart in size at most", () => {
    expect(groupSizes(10, { by: "count", n: 3 })).toEqual([4, 3, 3]);
    expect(groupSizes(4, { by: "count", n: 6 })).toEqual([1, 1, 1, 1]);
    expect(groupSizes(7, { by: "count", n: 1 })).toEqual([7]);
  });

  it("pairs: twos, then a trio or one sitting out", () => {
    expect(pairSizes(6, "trio")).toEqual({ sizes: [2, 2, 2], sitOut: 0 });
    expect(pairSizes(7, "trio")).toEqual({ sizes: [3, 2, 2], sitOut: 0 });
    expect(pairSizes(7, "sit-out")).toEqual({ sizes: [2, 2, 2], sitOut: 1 });
    expect(pairSizes(1, "trio")).toEqual({ sizes: [1], sitOut: 0 });
  });
});

describe("words", () => {
  it("lists names, ordinals, labels and pairs plainly", () => {
    expect(listNames(["Ana"])).toBe("Ana");
    expect(listNames(["Ana", "Bo", "Cy"])).toBe("Ana, Bo and Cy");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
    ]);
    expect(groupLabel("pairs", 0)).toBe("Pair 1");
    expect(groupLabel("cafe", 2)).toBe("Table 3");
    expect(pairList([["Ana", "Bo"]])).toBe("Ana with Bo");
    expect(
      pairList([
        ["A", "B"],
        ["C", "D"],
        ["E", "F"],
        ["G", "H"],
        ["I", "J"],
      ])
    ).toBe("A with B, C with D, E with F and 2 more pairs");
    expect(ruleText({ kind: "apart", a: " Ana ", b: "Bo" })).toBe("Keep Ana and Bo apart");
    expect(searchNote(250)).toMatch(/0\.3 seconds/);
  });

  it("matches people by name whatever the case, the first spelling winning", () => {
    expect(uniquePeople(people("Ana", " ana ", "", "Bo")).map((p) => p.name)).toEqual([
      "Ana",
      "Bo",
    ]);
    expect(pairKey("Bo", "ana")).toBe(pairKey("Ana", "bo"));
    expect(nameKey("  Ana ")).toBe("ana");
  });
});

describe("the search", () => {
  it("finds the cheapest split of a small problem, and reports its cost", () => {
    // 4 people in 2 pairs: 0-1 and 2-3 cost a lot together.
    const n = 4;
    const pair = new Float64Array(n * n);
    const set = (i: number, j: number, w: number) => {
      pair[i * n + j] = w;
      pair[j * n + i] = w;
    };
    set(0, 1, 100);
    set(2, 3, 100);
    const r = searchPartition(
      { n, sizes: [2, 2], pair },
      { rng: createRng(1), timeLimitMs: 10_000 }
    );
    expect(r.cost).toBe(0);
    expect(r.assign[0]).not.toBe(r.assign[1]);
    expect(r.assign[2]).not.toBe(r.assign[3]);
    expect(assignmentCost({ n, sizes: [2, 2], pair }, r.assign)).toBe(0);
    expect(r.timedOut).toBe(false);
  });

  it("matches an exhaustive search on small random problems, unary costs and moves included", () => {
    const rng = createRng("brute");
    for (let trial = 0; trial < 25; trial++) {
      const n = 6 + (trial % 2);
      const sizes = n === 6 ? [2, 2, 2] : [3, 2, 2];
      const m = sizes.length;
      const pair = new Float64Array(n * n);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const w = Math.floor(rng() * 21) - 5;
          pair[i * n + j] = w;
          pair[j * n + i] = w;
        }
      }
      const unary = new Float64Array(n * m).map(() => Math.floor(rng() * 7));
      const p = { n, sizes, pair, unary };
      // Every assignment of people to groups with these sizes (as a multiset).
      let best = Infinity;
      const assign = new Array<number>(n).fill(0);
      const count = new Array<number>(m).fill(0);
      const want = [...sizes].sort().join();
      const walk = (i: number) => {
        if (i === n) {
          if ([...count].sort().join() === want) best = Math.min(best, assignmentCost(p, assign));
          return;
        }
        for (let g = 0; g < m; g++) {
          if (count[g] >= Math.max(...sizes)) continue;
          assign[i] = g;
          count[g]++;
          walk(i + 1);
          count[g]--;
        }
      };
      walk(0);
      const found = searchPartition(p, { rng: createRng(trial), timeLimitMs: 10_000 });
      expect(found.cost, `trial ${trial}`).toBe(best);
      expect(assignmentCost(p, found.assign)).toBe(found.cost);
    }
  });

  it("keeps the sizes it was given", () => {
    const n = 7;
    const r = searchPartition(
      { n, sizes: [3, 2, 2], pair: new Float64Array(n * n) },
      { rng: createRng(2), timeLimitMs: 10_000 }
    );
    const counts = [0, 0, 0];
    r.assign.forEach((g) => counts[g]++);
    expect(counts.sort()).toEqual([2, 2, 3]);
  });

  it("stops at the time limit with the best it has, never a partial answer", () => {
    let t = 0;
    const n = 12;
    const r = searchPartition(
      { n, sizes: [4, 4, 4], pair: new Float64Array(n * n).fill(1) },
      { rng: createRng(3), timeLimitMs: 5, now: () => (t += 10) }
    );
    expect(r.timedOut).toBe(true);
    expect(r.assign).toHaveLength(12);
  });

  it("is the same for the same seed", () => {
    const run = () => ok(mixGroups({ people: TEN, mode: "groups", seed: 42, timeLimitMs: 10_000 }));
    expect(run().groups).toEqual(run().groups);
    const other = ok(mixGroups({ people: TEN, mode: "groups", seed: 43, timeLimitMs: 10_000 }));
    expect(other.groups.flat().sort()).toEqual(run().groups.flat().sort());
  });
});

describe("mixing groups", () => {
  it("puts everyone in exactly one group of the asked size", () => {
    const r = ok(mixGroups({ people: TEN, mode: "groups", split: { by: "size", n: 3 }, seed: 1 }));
    expect(r.groups.map((g) => g.length).sort()).toEqual([3, 3, 4]);
    expect(r.groups.flat().sort()).toEqual(TEN.map((p) => p.name).sort());
    expect(r.issues).toEqual([]);
    expect(r.broken).toBe(0);
  });

  it("refuses too few people, or a split that makes one group, in plain words", () => {
    expect(mixGroups({ people: people("Ana"), mode: "groups", seed: 1 })).toEqual({
      ok: false,
      error: "Add at least 2 people to mix.",
    });
    expect(mixProblem(4, "groups", { by: "size", n: 4 })).toMatch(/only one group/);
    expect(mixProblem(4, "groups", { by: "count", n: 1 })).toBe("Ask for at least 2 groups.");
    expect(mixProblem(121, "pairs")).toMatch(/up to 120 people/);
  });

  it("keeps people apart and together as the rules say", () => {
    const r = ok(
      mixGroups({
        people: TEN,
        mode: "groups",
        split: { by: "count", n: 2 },
        rules: [
          { kind: "apart", a: "Ana", b: "Bo" },
          { kind: "together", a: "Cy", b: "Dee" },
          { kind: "together", a: "Dee", b: "Eve" },
        ],
        seed: 7,
      })
    );
    expect(groupWith(r.groups, "Ana")).not.toBe(groupWith(r.groups, "Bo"));
    expect(groupWith(r.groups, "Cy")).toBe(groupWith(r.groups, "Dee"));
    expect(groupWith(r.groups, "Dee")).toBe(groupWith(r.groups, "Eve"));
    expect(r.broken).toBe(0);
  });

  it("says plainly when a rule can't be kept", () => {
    // Three people who must all be apart, in two groups.
    const r = ok(
      mixGroups({
        people: people("Ana", "Bo", "Cy", "Dee"),
        mode: "groups",
        split: { by: "count", n: 2 },
        rules: [
          { kind: "apart", a: "Ana", b: "Bo" },
          { kind: "apart", a: "Bo", b: "Cy" },
          { kind: "apart", a: "Ana", b: "Cy" },
        ],
        seed: 3,
      })
    );
    expect(r.broken).toBe(1);
    expect(r.issues[0].kind).toBe("apart");
    expect(r.issues[0].text).toMatch(
      /^\w+ and \w+ are both in Group [12], though they should be kept apart\.$/
    );
  });

  it("names a keep-together group too big for any group", () => {
    const r = ok(
      mixGroups({
        people: SIX,
        mode: "pairs",
        rules: [
          { kind: "together", a: "Ana", b: "Bo" },
          { kind: "together", a: "Bo", b: "Cy" },
        ],
        seed: 5,
      })
    );
    expect(r.issues[0]).toEqual({
      kind: "together",
      text: "Ana, Bo and Cy should all be together, but the pairs hold 2 people at most.",
    });
    expect(r.broken).toBe(1);
  });

  it("leaves out a rule for someone not in the mix, and says so", () => {
    const r = ok(
      mixGroups({
        people: SIX,
        mode: "groups",
        split: { by: "count", n: 2 },
        rules: [
          { kind: "apart", a: "Ana", b: "Zed" },
          { kind: "apart", a: "Xi", b: "Zed" },
        ],
        seed: 5,
      })
    );
    expect(r.issues).toEqual([
      { kind: "skipped", text: "Keep Ana and Zed apart was left out: Zed isn't in the mix." },
    ]);
  });

  it("uses each pair's first rule only", () => {
    const { placed } = placeRules(SIX, [
      { kind: "apart", a: "Ana", b: "Bo" },
      { kind: "together", a: "bo", b: "ana" },
      { kind: "apart", a: "Ana", b: "ana" },
    ]);
    expect(placed).toHaveLength(1);
    expect(placed[0].kind).toBe("apart");
  });
});

describe("rounds with no repeat pairings", () => {
  it("rotates pairs so nobody pairs twice in n - 1 rounds", () => {
    const history: PastRound[] = [];
    const seen = new Set<string>();
    for (let round = 0; round < 5; round++) {
      const r = ok(
        mixGroups({ people: SIX, mode: "pairs", history, seed: 100 + round, rotationSeed: 9 })
      );
      expect(r.repeats).toBe(0);
      for (const key of Array.from(pairsOf(r.groups))) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      history.push({ groups: r.groups });
    }
    // 6 people, 15 pairs, all met.
    expect(seen.size).toBe(15);
  });

  it("says when every pair has met, and repeats the oldest pairs first", () => {
    const history: PastRound[] = [];
    for (let round = 0; round < 5; round++) {
      const r = ok(
        mixGroups({ people: SIX, mode: "pairs", history, seed: round, rotationSeed: 4 })
      );
      history.push({ groups: r.groups });
    }
    const sixth = ok(mixGroups({ people: SIX, mode: "pairs", history, seed: 9, rotationSeed: 4 }));
    const last = pairsOf(history[4].groups);
    // None of the pairs from the round just before.
    for (const key of Array.from(pairsOf(sixth.groups))) expect(last.has(key)).toBe(false);
    const repeat = sixth.issues.find((i) => i.kind === "repeat")!;
    expect(repeat.text).toMatch(
      /^With 6 people there are 5 rounds of new pairs, and this is the 6th round, so some meet again: /
    );
  });

  it("says it in good English for two people", () => {
    const two = people("Ana", "Bo");
    const r = ok(
      mixGroups({ people: two, mode: "pairs", history: [{ groups: [["Ana", "Bo"]] }], seed: 1 })
    );
    expect(r.issues).toEqual([
      {
        kind: "repeat",
        text: "With 2 people there is 1 round of new pairs, and this is the 2nd round, so some meet again: Ana with Bo.",
      },
    ]);
  });

  it("mixes groups that avoid who met in earlier rounds", () => {
    const history: PastRound[] = [
      {
        groups: [
          ["Ana", "Bo", "Cy"],
          ["Dee", "Eve", "Fay"],
        ],
      },
    ];
    const r = ok(
      mixGroups({ people: SIX, mode: "groups", split: { by: "count", n: 3 }, history, seed: 2 })
    );
    expect(r.repeats).toBe(0);
    for (const key of Array.from(pairsOf(r.groups))) {
      expect(pairsOf(history[0].groups).has(key)).toBe(false);
    }
  });

  it("counts how often and how lately each pair met", () => {
    const h = metHistory([
      {
        groups: [
          ["Ana", "Bo"],
          ["Cy", "Dee"],
        ],
        sitOut: ["Eve"],
      },
      { groups: [["Ana", "bo"]] },
    ]);
    expect(h.count.get(pairKey("Ana", "Bo"))).toBe(2);
    expect(h.last.has(pairKey("Ana", "Bo"))).toBe(true);
    expect(h.last.has(pairKey("Cy", "Dee"))).toBe(false);
    expect(h.satOut.get("eve")).toBe(1);
  });
});

describe("odd numbers", () => {
  it("makes one trio", () => {
    const r = ok(mixGroups({ people: SIX.slice(0, 5), mode: "pairs", seed: 1 }));
    expect(r.groups.map((g) => g.length).sort()).toEqual([2, 3]);
    expect(r.sitOut).toEqual([]);
  });

  it("or sits one person out, someone new each round, and says who", () => {
    const five = SIX.slice(0, 5);
    const history: PastRound[] = [];
    const out: string[] = [];
    for (let round = 0; round < 5; round++) {
      const r = ok(
        mixGroups({
          people: five,
          mode: "pairs",
          odd: "sit-out",
          history,
          seed: round,
          rotationSeed: 3,
        })
      );
      expect(r.sitOut).toHaveLength(1);
      expect(
        r.issues.some(
          (i) => i.kind === "sit-out" && i.text === `${r.sitOut[0]} sits out this round.`
        )
      ).toBe(true);
      out.push(r.sitOut[0]);
      history.push({ groups: r.groups, sitOut: r.sitOut });
    }
    expect(new Set(out).size).toBe(5);
    const sixth = ok(
      mixGroups({ people: five, mode: "pairs", odd: "sit-out", history, seed: 9, rotationSeed: 3 })
    );
    expect(sixth.issues.find((i) => i.kind === "sit-out")!.text).toMatch(/for the 2nd time\.$/);
  });
});

describe("balance", () => {
  const team: MixPerson[] = [
    { name: "Ana", role: "Developer" },
    { name: "Bo", role: "Developer" },
    { name: "Cy", role: "developer" },
    { name: "Dee", role: "Tester" },
    { name: "Eve", role: "Tester" },
    { name: "Fay", role: "Tester" },
  ];

  it("by role puts a developer and a tester in every pair", () => {
    const r = ok(mixGroups({ people: team, mode: "pairs", balance: "role", seed: 11 }));
    for (const g of r.groups) {
      const roles = g.map((n) => team.find((p) => p.name === n)!.role!.toLowerCase());
      expect(new Set(roles).size).toBe(2);
    }
    expect(r.issues).toEqual([]);
  });

  it("by skill spreads each skill across the groups", () => {
    const skilled: MixPerson[] = [
      { name: "Ana", skills: ["React"] },
      { name: "Bo", skills: ["React", "Design"] },
      { name: "Cy", skills: ["Go"] },
      { name: "Dee", skills: ["Go", "SQL"] },
    ];
    const r = ok(
      mixGroups({
        people: skilled,
        mode: "groups",
        split: { by: "count", n: 2 },
        balance: "skill",
        seed: 2,
      })
    );
    expect(groupWith(r.groups, "Ana")).not.toBe(groupWith(r.groups, "Bo"));
    expect(groupWith(r.groups, "Cy")).not.toBe(groupWith(r.groups, "Dee"));
  });

  it("names a role it couldn't spread, and says when nobody has one", () => {
    const crowded: MixPerson[] = [
      { name: "Ana", role: "Developer" },
      { name: "Bo", role: "Developer" },
      { name: "Cy", role: "Developer" },
      { name: "Dee" },
    ];
    // Keep-together rules force the three developers into one group of three.
    const r = ok(
      mixGroups({
        people: [...crowded, { name: "Eve" }, { name: "Fay" }],
        mode: "groups",
        split: { by: "count", n: 2 },
        balance: "role",
        rules: [
          { kind: "together", a: "Ana", b: "Bo" },
          { kind: "together", a: "Bo", b: "Cy" },
        ],
        seed: 1,
      })
    );
    expect(r.issues.find((i) => i.kind === "balance")!.text).toMatch(
      /^Developer isn't spread evenly: Group [12] has 3 of the 3\.$/
    );
    const none = ok(
      mixGroups({
        people: SIX,
        mode: "groups",
        balance: "role",
        seed: 1,
        split: { by: "count", n: 2 },
      })
    );
    expect(none.issues).toEqual([
      {
        kind: "balance",
        text: "Nobody in the mix has a role on the Team page, so roles couldn't be balanced.",
      },
    ]);
  });

  it("puts the rules before balance", () => {
    const r = ok(
      mixGroups({
        people: team,
        mode: "pairs",
        balance: "role",
        rules: [{ kind: "together", a: "Ana", b: "Bo" }],
        seed: 4,
      })
    );
    expect(groupWith(r.groups, "Ana")).toBe(groupWith(r.groups, "Bo"));
  });
});

describe("a big room", () => {
  it("mixes 120 people inside the time limit, keeping every rule", () => {
    const crowd = Array.from({ length: 120 }, (_, i) => ({
      name: `Person ${i + 1}`,
      role: ["Dev", "QA", "PO", "UX"][i % 4],
    }));
    const rules = Array.from({ length: 20 }, (_, i) => ({
      kind: "apart" as const,
      a: `Person ${i * 2 + 1}`,
      b: `Person ${i * 2 + 2}`,
    }));
    const started = Date.now();
    const r = ok(
      mixGroups({
        people: crowd,
        mode: "groups",
        split: { by: "size", n: 6 },
        balance: "role",
        rules,
        seed: 8,
        timeLimitMs: 400,
      })
    );
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.groups).toHaveLength(20);
    expect(r.broken).toBe(0);
  });
});
