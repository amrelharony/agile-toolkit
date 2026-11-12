import { describe, expect, it } from "vitest";
import { emptyLedger, type FoldContext } from "@/lib/realtime/vote-room/aggregate";
import {
  averagePlace,
  bordaPoints,
  emptyRankTally,
  encodeRank,
  foldRank,
  rankCiphertextChars,
  rankRoundMarkdown,
  rankSheetProblem,
  rankStanding,
  readRankState,
  readRankString,
  revealRank,
  toRankResult,
  type RankTally,
} from "@/lib/realtime/vote-room/rank";
import { RANK_SHEET, rankStateBody } from "./vote-room-kind-fixtures";

/**
 * Rank rounds: a full order per person, turned into Borda points at once.
 * No order is kept; totals from minN.
 */

const ROUND = "round_000001";
const KEYS = { publicKeys: { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` } };
const HOST = "host_00000000000";
const SIG = "s".repeat(86);
const PEOPLE = Array.from({ length: 6 }, (_, i) => `member_${String(i).padStart(9, "0")}`);
const ctx: FoldContext = {
  open: true,
  roundId: ROUND,
  admitted: new Set(PEOPLE),
  removed: new Set(),
};
const wire = (body: object) => JSON.parse(JSON.stringify({ ...body, sig: SIG }));

function fold(orders: number[][]): RankTally {
  let t = emptyRankTally(ROUND, RANK_SHEET);
  let ledger = emptyLedger();
  orders.forEach((order, i) => {
    const res = foldRank(t, ledger, PEOPLE[i], order, RANK_SHEET, ctx);
    if (!res.ok) throw new Error(res.reason);
    t = res.tally;
    ledger = res.ledger;
  });
  return t;
}

describe("rank sheets and ballots", () => {
  it("takes 2 to 10 options with their own ids", () => {
    expect(rankSheetProblem(RANK_SHEET)).toBeNull();
    expect(rankSheetProblem({ ...RANK_SHEET, options: RANK_SHEET.options.slice(0, 1) })).toMatch(
      /2 to 10/
    );
    expect(
      rankSheetProblem({
        ...RANK_SHEET,
        options: Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, text: `O${i}` })),
      })
    ).toMatch(/2 to 10/);
  });

  it("encodes the options from first place to last, one digit each", () => {
    // Fewer bugs first, then happier team, ship faster, lower cost.
    expect(encodeRank({ quality: 0, joy: 1, speed: 2, cost: 3 }, RANK_SHEET)).toBe("1203");
    expect(rankCiphertextChars(RANK_SHEET)).toBe(rankCiphertextChars({ ...RANK_SHEET }));
  });

  it.each<[string, Record<string, number | null>]>([
    ["an option left out", { quality: 0, joy: 1, speed: 2 }],
    ["two options in one place", { quality: 0, joy: 0, speed: 2, cost: 3 }],
    ["a place past the last", { quality: 0, joy: 1, speed: 2, cost: 4 }],
    ["half a place", { quality: 0.5, joy: 1, speed: 2, cost: 3 }],
  ])("refuses %s", (_label, draft) => {
    expect(encodeRank(draft, RANK_SHEET)).toBeNull();
  });

  it("reads back only a full order", () => {
    expect(readRankString("1203", RANK_SHEET)).toEqual([1, 2, 0, 3]);
    expect(readRankString("1103", RANK_SHEET)).toBeNull();
    expect(readRankString("120", RANK_SHEET)).toBeNull();
    expect(readRankString("1204", RANK_SHEET)).toBeNull();
    expect(readRankString("12a3", RANK_SHEET)).toBeNull();
  });
});

describe("rank counting and reveal", () => {
  it("adds Borda points (n-1 for first down to 0) and keeps no order", () => {
    expect([0, 1, 2, 3].map((p) => bordaPoints(p, 4))).toEqual([3, 2, 1, 0]);
    const t = fold([
      [0, 1, 2, 3],
      [1, 0, 2, 3],
      [0, 2, 1, 3],
    ]);
    expect(t).toEqual({ roundId: ROUND, points: [8, 6, 4, 0], ballots: 3 });
    expect(Object.keys(t).sort()).toEqual(["ballots", "points", "roundId"]);
    // Every order hands out the same number of points.
    expect(t.points.reduce((a, b) => a + b, 0)).toBe(3 * 6);
  });

  it("refuses a broken order and a second ballot", () => {
    const res = foldRank(
      emptyRankTally(ROUND, RANK_SHEET),
      emptyLedger(),
      PEOPLE[0],
      [0, 0, 1, 2],
      RANK_SHEET,
      ctx
    );
    expect(res).toEqual({ ok: false, reason: "bad-answers" });
    const first = foldRank(
      emptyRankTally(ROUND, RANK_SHEET),
      emptyLedger(),
      PEOPLE[0],
      [0, 1, 2, 3],
      RANK_SHEET,
      ctx
    );
    if (!first.ok) throw new Error("expected ok");
    expect(foldRank(first.tally, first.ledger, PEOPLE[0], [3, 2, 1, 0], RANK_SHEET, ctx)).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("reveals points only from minN, with the average place", () => {
    expect(
      revealRank(
        fold([
          [0, 1, 2, 3],
          [1, 0, 2, 3],
        ]),
        3
      )
    ).toBeNull();
    const t = fold([
      [0, 1, 2, 3],
      [1, 0, 2, 3],
      [0, 2, 1, 3],
    ]);
    const revealed = revealRank(t, 3)!;
    expect(revealed).toEqual([{ points: 8 }, { points: 6 }, { points: 4 }, { points: 0 }]);
    expect(averagePlace(8, 3, 4)).toBeCloseTo(4 - 8 / 3);
    expect(averagePlace(0, 3, 4)).toBe(4);
    const result = toRankResult(RANK_SHEET, revealed, {
      tool: "quick-vote",
      roundId: ROUND,
      closedAt: "2026-11-12T10:00:00.000Z",
      minN: 3,
      ballots: 3,
      source: "live",
    })!;
    expect(result.options.map((o) => o.points)).toEqual([8, 6, 4, 0]);
    expect(rankStanding(result.options)[0].text).toBe("Ship faster");
    expect(rankRoundMarkdown(result)).toContain("| 1 | Ship faster | 8 | 1.3 |");
    expect(JSON.stringify(result)).not.toMatch(/member_/);
  });
});

describe("readRankState", () => {
  it("accepts exactly what the host builds", () => {
    const rev = rankStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 3,
      revealed: [{ points: 8 }, { points: 6 }, { points: 4 }, { points: 0 }],
    });
    expect(readRankState(wire(rev), "quick-vote")).toEqual({ ...rev, sig: SIG });
  });

  it("refuses points no set of orders could give, and points under minN", () => {
    const bad = rankStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 3,
      revealed: [{ points: 9 }, { points: 6 }, { points: 4 }, { points: 0 }],
    });
    expect(readRankState(wire(bad), "quick-vote")).toBeNull();
    const early = rankStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 2,
      revealed: [{ points: 6 }, { points: 4 }, { points: 2 }, { points: 0 }],
    });
    expect(readRankState(wire(early), "quick-vote")).toBeNull();
    const tooMany = rankStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 3,
      revealed: [{ points: 10 }, { points: 4 }, { points: 4 }, { points: 0 }],
    });
    expect(readRankState(wire(tooMany), "quick-vote")).toBeNull();
  });
});
