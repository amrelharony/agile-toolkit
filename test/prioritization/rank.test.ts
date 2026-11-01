import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { DISAGREE_SPREAD as PAGE_SPREAD } from "@/app/(tools)/prioritizer/verdict";
import {
  DISAGREE_SPREAD,
  bordaConsensus,
  consensusMethods,
  decidedOrder,
  rankByMethod,
  rankMethodRows,
  ranksFromOrder,
} from "@/lib/prioritization/rank";

/**
 * Ranking: one method's normalised rank with tied places averaged, the
 * Borda consensus across methods (ties, unscored items, coverage and
 * spread), the backlog's decided order, and a method tool's ranked rows.
 */

const STAMP = "2026-10-26T09:00:00.000Z";
const item = (id: string, patch: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  name: id.toUpperCase(),
  updatedAt: STAMP,
  ...patch,
});
const wsjf = (bv: number, size: number) => ({
  businessValue: bv,
  timeCriticality: 1,
  riskReduction: 1,
  jobSize: size,
});
const rice = (reach: number) => ({ reach, impact: 1, confidence: 100, effort: 1 });

describe("rankByMethod", () => {
  it("normalises 1 for the top to 0 for the bottom, ties sharing the average place", () => {
    const items = [
      item("a", wsjf(8, 1)), // 10
      item("b", wsjf(3, 1)), // 5
      item("c", wsjf(3, 1)), // 5 (tie)
      item("d", wsjf(1, 1)), // 3
      item("e"), // not scored
    ];
    const r = rankByMethod(items, [], "wsjf")!;
    expect(r.n).toBe(4);
    expect(Object.fromEntries(r.position)).toEqual({ a: 1, b: 2.5, c: 2.5, d: 4 });
    expect(r.normalized.get("a")).toBe(1);
    expect(r.normalized.get("b")).toBe(0.5);
    expect(r.normalized.get("d")).toBe(0);
    expect(r.normalized.has("e")).toBe(false);
  });

  it("ranks nothing below 2 scored items", () => {
    expect(rankByMethod([item("a", wsjf(8, 1)), item("b")], [], "wsjf")).toBeNull();
    const { used, skipped } = consensusMethods([item("a", wsjf(8, 1)), item("b")], []);
    expect(used).toEqual([]);
    expect(skipped.find((s) => s.method === "wsjf")).toEqual({ method: "wsjf", n: 1 });
    expect(skipped.find((s) => s.method === "rice")).toEqual({ method: "rice", n: 0 });
  });

  it("ranks a categorical method by its buckets, ties averaged", () => {
    const items = [
      item("a", { moscow: "should" }),
      item("b", { moscow: "must" }),
      item("c", { moscow: "should" }),
    ];
    const r = rankByMethod(items, [], "moscow")!;
    expect(Object.fromEntries(r.position)).toEqual({ b: 1, a: 2.5, c: 2.5 });
  });

  it("ranks a method the backlog doesn't hold from the latest linked row", () => {
    const rows: PrioritizationItem[] = [
      {
        id: "i1",
        framework: "ice",
        title: "a",
        fields: { impact: 9, confidence: 9, ease: 9 },
        backlogItemId: "a",
        updatedAt: STAMP,
      },
      {
        id: "i2",
        framework: "ice",
        title: "b",
        fields: { impact: 2, confidence: 2, ease: 2 },
        backlogItemId: "b",
        updatedAt: STAMP,
      },
    ];
    const r = rankByMethod([item("a"), item("b")], rows, "ice")!;
    expect(Object.fromEntries(r.position)).toEqual({ a: 1, b: 2 });
  });
});

describe("bordaConsensus", () => {
  const items = [
    item("a", { ...wsjf(8, 1), ...rice(100) }), // WSJF 1st, RICE 3rd
    item("b", { ...wsjf(3, 1), ...rice(900) }), // WSJF 2nd, RICE 1st
    item("c", { ...wsjf(1, 1), ...rice(500) }), // WSJF 3rd, RICE 2nd
    item("d", { ...rice(500) }), // RICE only (ties c for 2nd)
    item("e"), // unscored
    item("f"), // unscored
  ];

  it("averages each item's normalised ranks over the methods that scored it", () => {
    const rows = bordaConsensus(items, [], ["wsjf", "rice"]);
    const by = Object.fromEntries(rows.map((r) => [r.itemId, r]));
    // RICE: b 1, c/d 2.5, a 4 → normalised 1, 0.5, 0.5, 0; WSJF: a 1, b 0.5, c 0.
    expect(by.a).toMatchObject({ borda: 0.5, coverage: 2, spread: 1 });
    expect(by.b).toMatchObject({ borda: 0.75, coverage: 2, spread: 0.5 });
    expect(by.c).toMatchObject({ borda: 0.25, coverage: 2, spread: 0.5 });
    expect(by.d).toMatchObject({ borda: 0.5, coverage: 1, spread: null });
    expect(by.b.perMethod).toEqual({ wsjf: 2, rice: 1 });
    expect(by.e).toEqual({ itemId: "e", borda: null, coverage: 0, spread: null, perMethod: {} });
  });

  it("orders by consensus, then coverage, then the current rank, then name; unscored last in stored order", () => {
    const rows = bordaConsensus(items, [], ["wsjf", "rice"]);
    // a and d tie at 0.5: a was scored by both methods, so it goes first.
    expect(rows.map((r) => r.itemId)).toEqual(["b", "a", "d", "c", "e", "f"]);
    const ranked = [
      item("x", { ...rice(100), rank: 2 }),
      item("y", { ...rice(100), rank: 1 }),
      item("z", rice(50)),
    ];
    expect(bordaConsensus(ranked, [], ["rice"]).map((r) => r.itemId)).toEqual(["y", "x", "z"]);
  });

  it("uses every hub method with 2 or more scored items by default", () => {
    const rows = bordaConsensus(items, []);
    expect(rows[0].itemId).toBe("b");
    expect(rows.slice(-2).map((r) => r.itemId)).toEqual(["e", "f"]);
  });
});

describe("the decided order", () => {
  it("puts ranked items first by rank, then the rest in stored order", () => {
    const list = [
      item("n1"),
      item("r3", { rank: 3 }),
      item("n2"),
      item("r1", { rank: 1 }),
      item("bad", { rank: 0 }),
    ];
    expect(decidedOrder(list).map((i) => i.id)).toEqual(["r1", "r3", "n1", "n2", "bad"]);
  });

  it("numbers an order 1..N, a repeated id keeping its first place", () => {
    expect(Object.fromEntries(ranksFromOrder(["b", "a", "b", "c"]))).toEqual({ b: 1, a: 2, c: 3 });
    expect(ranksFromOrder([]).size).toBe(0);
  });
});

describe("rankMethodRows", () => {
  const row = (
    id: string,
    fields: Record<string, number | string>,
    extra: Partial<PrioritizationItem> = {}
  ) =>
    ({
      id,
      framework: "rice",
      title: id,
      fields,
      updatedAt: STAMP,
      ...extra,
    }) as PrioritizationItem;

  it("dense-ranks scored rows, ties sharing a rank, unscored last in stored order", () => {
    const rows = [
      row("none", {}),
      row("low", { reach: 10, impact: 1, confidence: 100, effort: 1 }),
      row("top", { reach: 90, impact: 1, confidence: 100, effort: 1 }),
      row("tie", { reach: 90, impact: 1, confidencePct: 100, effort: 1 }),
      row("zero-effort", { reach: 90, impact: 1, confidence: 100, effort: 0 }),
    ];
    const ranked = rankMethodRows("rice", rows);
    expect(ranked.map((r) => [r.row.id, r.rank])).toEqual([
      ["top", 1],
      ["tie", 1],
      ["low", 2],
      ["none", null],
      ["zero-effort", null],
    ]);
  });

  it("reads a linked row through to its item", () => {
    const rows = [
      row("linked", { reach: 1, impact: 1, confidence: 100, effort: 1 }, { backlogItemId: "b" }),
    ];
    const ranked = rankMethodRows("rice", rows, [item("b", rice(700))]);
    expect(ranked[0]).toMatchObject({ live: true, result: { score: 700 } });
    expect(rankMethodRows("rice", rows, [])[0]).toMatchObject({
      live: false,
      result: { score: 1 },
    });
  });
});

describe("DISAGREE_SPREAD", () => {
  const source = (file: string) => readFileSync(path.resolve(__dirname, "../../src", file), "utf8");

  it("is defined once, in rank: the hub's verdict and the agent read the same threshold", () => {
    expect(DISAGREE_SPREAD).toBe(0.5);
    expect(PAGE_SPREAD).toBe(DISAGREE_SPREAD);
    for (const file of ["app/(tools)/prioritizer/verdict.ts", "lib/actions/tools/prioritizer.ts"]) {
      expect(source(file)).not.toMatch(/DISAGREE_SPREAD\s*=/);
      expect(source(file)).toMatch(/DISAGREE_SPREAD,[^;]*from "@\/lib\/prioritization\/rank"/);
    }
  });
});
