import { describe, expect, it } from "vitest";
import {
  bagRemaining,
  createBag,
  createRng,
  drawFromBag,
  flipCoin,
  hashSeed,
  pick,
  randomInt,
  rollDie,
  shuffle,
  weightedPick,
  type Bag,
  type Rng,
} from "@/lib/utils/random";

/**
 * The shared randomness for the facilitation tools (lib/utils/random.ts):
 * seeded and repeatable, pure, and fair. The fairness checks run a fixed seed
 * many times and allow a few percent either way, so they never flake.
 */

const N = 60_000;

/** How often each value came up. */
function counts<T>(n: number, draw: () => T): Map<T, number> {
  const out = new Map<T, number>();
  for (let i = 0; i < n; i++) {
    const v = draw();
    out.set(v, (out.get(v) ?? 0) + 1);
  }
  return out;
}

/** Each count within `tolerance` (a share) of its expected count. */
function expectNear(actual: number, expected: number, tolerance = 0.05) {
  expect(Math.abs(actual - expected) / expected).toBeLessThan(tolerance);
}

/** A generator that returns these numbers in turn, for edge cases. */
const fixed =
  (...values: number[]): Rng =>
  () =>
    values.length > 1 ? values.shift()! : values[0];

describe("createRng", () => {
  it("repeats its sequence for the same seed, number or string", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a());
    expect(Array.from({ length: 20 }, () => b())).toEqual(seqA);
    const s1 = createRng("sprint 42");
    const s2 = createRng("sprint 42");
    expect(Array.from({ length: 10 }, () => s1())).toEqual(Array.from({ length: 10 }, () => s2()));
  });

  it("gives different seeds different sequences", () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
    expect(createRng("retro")()).not.toBe(createRng("Retro")());
  });

  it("stays in [0, 1) and spreads evenly over it", () => {
    const rng = createRng(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < N; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)] += 1;
    }
    for (const b of buckets) expectNear(b, N / 10);
  });

  it("starts a new sequence each time when given no seed", () => {
    const a = Array.from({ length: 4 }, createRng());
    const b = Array.from({ length: 4 }, createRng());
    expect(a).not.toEqual(b);
  });

  it("hashes strings to 32-bit seeds", () => {
    for (const s of ["", "a", "sprint 42", "x".repeat(500)]) {
      const h = hashSeed(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
      expect(hashSeed(s)).toBe(h);
    }
    expect(hashSeed("ab")).not.toBe(hashSeed("ba"));
  });
});

describe("randomInt", () => {
  it("includes both ends, each value about as often", () => {
    const rng = createRng(11);
    const seen = counts(N, () => randomInt(3, 8, rng));
    expect(Array.from(seen.keys()).sort()).toEqual([3, 4, 5, 6, 7, 8]);
    for (const c of Array.from(seen.values())) expectNear(c, N / 6);
  });

  it("reaches the top value at the edge of the generator", () => {
    expect(randomInt(1, 10, fixed(0))).toBe(1);
    expect(randomInt(1, 10, fixed(0.999999))).toBe(10);
    expect(randomInt(5, 5, fixed(0.5))).toBe(5);
  });

  it("refuses a range with no whole number in it", () => {
    expect(() => randomInt(5, 4)).toThrow(RangeError);
    expect(() => randomInt(1.2, 1.8)).toThrow(RangeError);
    expect(() => randomInt(0, Number.NaN)).toThrow(RangeError);
  });
});

describe("shuffle", () => {
  it("returns a new array with the same items, the input untouched", () => {
    const input = Object.freeze(["a", "b", "c", "d", "e"]);
    const out = shuffle(input, createRng(3));
    expect(out).not.toBe(input);
    expect([...out].sort()).toEqual([...input]);
    expect(input).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("makes every order equally likely", () => {
    const rng = createRng(5);
    const seen = counts(N, () => shuffle([1, 2, 3], rng).join(""));
    expect(seen.size).toBe(6);
    for (const c of Array.from(seen.values())) expectNear(c, N / 6);
  });

  it("puts each item in each place about as often", () => {
    const rng = createRng(13);
    const items = ["a", "b", "c", "d"];
    const first = counts(N, () => shuffle(items, rng)[0]);
    for (const c of Array.from(first.values())) expectNear(c, N / 4);
  });

  it("is repeatable with a seed, and handles empty and single lists", () => {
    expect(shuffle([1, 2, 3, 4, 5], createRng("x"))).toEqual(
      shuffle([1, 2, 3, 4, 5], createRng("x"))
    );
    expect(shuffle([])).toEqual([]);
    expect(shuffle(["solo"])).toEqual(["solo"]);
  });
});

describe("pick", () => {
  it("picks each item about as often", () => {
    const rng = createRng(17);
    const seen = counts(N, () => pick(["a", "b", "c"], { rng }));
    for (const c of Array.from(seen.values())) expectNear(c, N / 3);
  });

  it("never picks an excluded item, by list or by test", () => {
    const rng = createRng(19);
    for (let i = 0; i < 2000; i++) {
      expect(pick(["a", "b", "c"], { rng, exclude: ["b"] })).not.toBe("b");
      expect([1, 3]).toContain(pick([1, 2, 3, 4], { rng, exclude: (n) => n % 2 === 0 }));
    }
    const seen = counts(N, () => pick(["a", "b", "c"], { rng, exclude: ["a"] }));
    expect(Array.from(seen.keys()).sort()).toEqual(["b", "c"]);
    for (const c of Array.from(seen.values())) expectNear(c, N / 2);
  });

  it("returns undefined when nothing is left", () => {
    expect(pick([])).toBeUndefined();
    expect(pick(["a"], { exclude: ["a"] })).toBeUndefined();
  });
});

describe("weightedPick", () => {
  it("picks in proportion to the weights", () => {
    const rng = createRng(23);
    const seen = counts(N, () => weightedPick(["a", "b", "c"], [1, 2, 3], rng));
    expectNear(seen.get("a")!, N / 6);
    expectNear(seen.get("b")!, N / 3);
    expectNear(seen.get("c")!, N / 2);
  });

  it("takes the weight from a function", () => {
    const rng = createRng(29);
    const people = [
      { name: "Ana", weight: 1 },
      { name: "Bo", weight: 3 },
    ];
    const seen = counts(N, () => weightedPick(people, (p) => p.weight, rng)?.name);
    expectNear(seen.get("Bo")!, (N * 3) / 4);
  });

  it("never picks a zero, negative or non-number weight", () => {
    const rng = createRng(31);
    for (let i = 0; i < 3000; i++) {
      expect(weightedPick(["a", "b", "c", "d"], [0, -2, Number.NaN, 1], rng)).toBe("d");
    }
  });

  it("returns undefined when no weight is above zero", () => {
    expect(weightedPick(["a", "b"], [0, 0])).toBeUndefined();
    expect(weightedPick([], [])).toBeUndefined();
  });

  it("lands on an item at either edge of the generator", () => {
    expect(weightedPick(["a", "b", "c"], [1, 1, 1], fixed(0))).toBe("a");
    expect(weightedPick(["a", "b", "c"], [1, 1, 0], fixed(0.9999999))).toBe("b");
  });
});

describe("the everyone-once bag", () => {
  it("draws each item once per round, then refills", () => {
    const rng = createRng(37);
    let bag: Bag<string> = createBag(["Ana", "Bo", "Cy", "Di"]);
    for (let round = 1; round <= 5; round++) {
      const drawn: string[] = [];
      for (let i = 0; i < 4; i++) {
        const out = drawFromBag(bag, rng);
        drawn.push(out.item!);
        bag = out.bag;
      }
      expect([...drawn].sort()).toEqual(["Ana", "Bo", "Cy", "Di"]);
      expect(bag.round).toBe(round);
      expect(bagRemaining(bag)).toEqual([]);
    }
  });

  it("never starts a round with the item that ended the last one", () => {
    const rng = createRng(41);
    let bag = createBag(["a", "b", "c"]);
    let last: string | undefined;
    for (let i = 0; i < 3000; i++) {
      const roundStarts = bag.remaining.length === 0;
      const out = drawFromBag(bag, rng);
      if (roundStarts) expect(out.item).not.toBe(last);
      last = out.item;
      bag = out.bag;
    }
  });

  it("is plain JSON, and draws on after a round trip", () => {
    const rng = createRng(43);
    let bag = createBag([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
    bag = drawFromBag(bag, rng).bag;
    const copy = JSON.parse(JSON.stringify(bag)) as typeof bag;
    expect(copy).toEqual(bag);
    const a = drawFromBag(copy, rng);
    const b = drawFromBag(a.bag, rng);
    const ids = [a.item!.id, b.item!.id, bag.items[bag.last!].id].sort();
    expect(ids).toEqual(["m1", "m2", "m3"]);
  });

  it("leaves the bag passed in as it was", () => {
    const bag = createBag(["a", "b"]);
    const before = JSON.stringify(bag);
    drawFromBag(bag, createRng(1));
    expect(JSON.stringify(bag)).toBe(before);
  });

  it("gives each item an even share of first draws", () => {
    const rng = createRng(47);
    const seen = counts(N, () => drawFromBag(createBag(["a", "b", "c"]), rng).item);
    for (const c of Array.from(seen.values())) expectNear(c, N / 3);
  });

  it("handles an empty bag, a single item and stale indexes", () => {
    expect(drawFromBag(createBag([])).item).toBeUndefined();
    let solo = createBag(["only"]);
    for (let i = 0; i < 3; i++) {
      const out = drawFromBag(solo, createRng(i));
      expect(out.item).toBe("only");
      solo = out.bag;
    }
    const stale: Bag<string> = { items: ["a", "b"], remaining: [5, -1, 1], round: 1 };
    expect(drawFromBag(stale, createRng(2)).item).toBe("b");
  });
});

describe("dice and coins", () => {
  it("rolls each face of a d6 about as often", () => {
    const rng = createRng(53);
    const seen = counts(N, () => rollDie(6, rng));
    expect(Array.from(seen.keys()).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const c of Array.from(seen.values())) expectNear(c, N / 6);
  });

  it("rolls other dice in range", () => {
    const rng = createRng(59);
    for (let i = 0; i < 2000; i++) {
      const v = rollDie(20, rng);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
    }
    expect(rollDie(undefined, fixed(0.99999))).toBe(6);
  });

  it("refuses a die with fewer than two sides or a fraction", () => {
    expect(() => rollDie(1)).toThrow(RangeError);
    expect(() => rollDie(2.5)).toThrow(RangeError);
  });

  it("flips heads and tails about half the time each", () => {
    const rng = createRng(61);
    const seen = counts(N, () => flipCoin(rng));
    expectNear(seen.get("heads")!, N / 2, 0.03);
    expectNear(seen.get("tails")!, N / 2, 0.03);
  });
});
