// @vitest-environment node
/**
 * World Café plans (lib/team-mixer/cafe): hosts stay, guests move to tables
 * they haven't visited and sit with people they haven't sat with, the rules
 * hold (hosts included), and every round says who goes where. Plain words
 * for what can't be done.
 */

import { describe, expect, it } from "vitest";
import { cafeMoves, cafeProblem, planCafe } from "@/lib/team-mixer/cafe";
import { pairKey, type MixPerson } from "@/lib/team-mixer/model";

const people = (n: number): MixPerson[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}` }));

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

describe("World Café", () => {
  it("needs two tables, a host and a guest at each, and a sensible number of rounds", () => {
    expect(cafeProblem(8, 1, 3)).toBe("A World Café needs at least 2 tables.");
    expect(cafeProblem(5, 3, 3)).toBe(
      "3 tables need at least 6 people: a host and a guest at each."
    );
    expect(cafeProblem(20, 4, 9)).toBe("Plan between 1 and 8 rounds.");
    expect(cafeProblem(20, 21, 3)).toMatch(/up to 20 tables/);
    expect(cafeProblem(20, 4, 3)).toBeNull();
    expect(planCafe({ people: people(5), tables: 3, rounds: 2, seed: 1 }).ok).toBe(false);
  });

  it("keeps each host at their table and seats every guest once a round", () => {
    const plan = ok(planCafe({ people: people(16), tables: 4, rounds: 3, seed: 7 }));
    expect(plan.hosts).toHaveLength(4);
    expect(plan.rounds).toHaveLength(3);
    for (const round of plan.rounds) {
      expect(round.map((t) => t.host)).toEqual(plan.hosts);
      const guests = round.flatMap((t) => t.guests);
      expect(guests).toHaveLength(12);
      expect(new Set(guests).size).toBe(12);
      for (const t of round) expect(t.guests.length).toBe(3);
    }
  });

  it("sends nobody back to a table while there are new ones, and says so", () => {
    const plan = ok(planCafe({ people: people(16), tables: 4, rounds: 4, seed: 3 }));
    const moves = cafeMoves(plan);
    for (const [name, tables] of Array.from(moves.entries())) {
      if (plan.hosts.includes(name)) continue;
      expect(new Set(tables).size).toBe(4);
    }
    expect(plan.issues.filter((i) => i.kind === "revisit")).toEqual([]);
  });

  const metCounts = (plan: { rounds: { guests: string[] }[][] }) => {
    const met = new Map<string, number>();
    for (const round of plan.rounds) {
      for (const t of round) {
        for (let x = 0; x < t.guests.length; x++) {
          for (let y = x + 1; y < t.guests.length; y++) {
            const k = pairKey(t.guests[x], t.guests[y]);
            met.set(k, (met.get(k) ?? 0) + 1);
          }
        }
      }
    }
    return met;
  };

  it("mixes the guests so nobody sits with the same guest twice when it can", () => {
    // 4 tables, 2 guests at each: new tables and new company every round.
    const plan = ok(planCafe({ people: people(12), tables: 4, rounds: 3, seed: 5 }));
    expect(Math.max(...Array.from(metCounts(plan).values()))).toBe(1);
    expect(plan.issues).toEqual([]);
  });

  it("puts a new table before new company, and names the guests who meet again", () => {
    // 4 guests at each of 4 tables: a round-2 table of four strangers would
    // send one of them back to a table, so some guests meet twice instead.
    const plan = ok(planCafe({ people: people(20), tables: 4, rounds: 3, seed: 5 }));
    expect(plan.issues.filter((i) => i.kind === "revisit")).toEqual([]);
    const repeat = plan.issues.find((i) => i.kind === "repeat")!;
    expect(repeat.text).toMatch(
      /^\d+ pairs? of guests shares? a table in more than one round: P\d+ with P\d+/
    );
    expect(Math.max(...Array.from(metCounts(plan).values()))).toBe(2);
  });

  it("says plainly when there are more rounds than tables", () => {
    const plan = ok(planCafe({ people: people(9), tables: 3, rounds: 4, seed: 2 }));
    expect(plan.issues).toContainEqual({
      kind: "revisit",
      text: "With 3 tables and 4 rounds, everyone visits a table more than once.",
    });
  });

  it("uses the hosts it is given, and picks the rest at random", () => {
    const plan = ok(
      planCafe({
        people: people(12),
        tables: 3,
        rounds: 2,
        hosts: ["p2", "", "Zed"],
        seed: 4,
      })
    );
    expect(plan.hosts[0]).toBe("P2");
    expect(plan.hosts[1]).not.toBe("P2");
    expect(plan.issues).toContainEqual({
      kind: "skipped",
      text: "Zed isn't in the mix, so Table 3 got a host at random.",
    });
    const twice = ok(
      planCafe({ people: people(12), tables: 3, rounds: 2, hosts: ["P2", "P2"], seed: 4 })
    );
    expect(twice.issues).toContainEqual({
      kind: "skipped",
      text: "P2 already hosts a table, so Table 2 got a host at random.",
    });
  });

  it("keeps the rules, a host's included", () => {
    const plan = ok(
      planCafe({
        people: people(12),
        tables: 3,
        rounds: 3,
        hosts: ["P1", "P2", "P3"],
        rules: [
          { kind: "apart", a: "P1", b: "P4" },
          { kind: "apart", a: "P5", b: "P6" },
        ],
        seed: 9,
      })
    );
    for (const round of plan.rounds) {
      const p4 = round.findIndex((t) => t.guests.includes("P4"));
      expect(p4).not.toBe(0);
      const p5 = round.findIndex((t) => t.guests.includes("P5"));
      const p6 = round.findIndex((t) => t.guests.includes("P6"));
      expect(p5).not.toBe(p6);
    }
    expect(plan.issues.filter((i) => i.kind === "apart")).toEqual([]);
  });

  it("says when two hosts are to be kept together", () => {
    const plan = ok(
      planCafe({
        people: people(8),
        tables: 2,
        rounds: 1,
        hosts: ["P1", "P2"],
        rules: [{ kind: "together", a: "P1", b: "P2" }],
        seed: 1,
      })
    );
    expect(plan.issues).toContainEqual({
      kind: "together",
      text: "P1 and P2 both host a table, so they can't sit together.",
    });
  });

  it("is the same plan for the same seed", () => {
    const a = ok(planCafe({ people: people(15), tables: 3, rounds: 3, seed: 21 }));
    const b = ok(planCafe({ people: people(15), tables: 3, rounds: 3, seed: 21 }));
    expect(a.rounds).toEqual(b.rounds);
  });

  it("says who goes where, round by round", () => {
    const plan = ok(planCafe({ people: people(6), tables: 2, rounds: 2, seed: 1 }));
    const moves = cafeMoves(plan);
    expect(moves.size).toBe(6);
    for (const [, tables] of Array.from(moves.entries())) {
      expect(tables).toHaveLength(2);
      expect(tables.every((t) => t === 0 || t === 1)).toBe(true);
    }
  });
});
