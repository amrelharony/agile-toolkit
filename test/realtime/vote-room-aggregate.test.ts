// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canReveal,
  distributionMean,
  distributionMedian,
  effectiveMinN,
  emptyLedger,
  emptyTally,
  foldBallot,
  foldCounts,
  pointShare,
  precheckBallot,
  revealTally,
  toRoundResult,
  voteRoundMarkdown,
  type FoldContext,
  type Tally,
} from "@/lib/realtime/vote-room/aggregate";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { QUESTIONNAIRE, ROUND } from "./vote-room-fixtures";

/**
 * Counting a vote round: one ballot per presence key, nothing kept next to
 * a person, reveal only from minN, and a saved result with totals only.
 */

const A = "alice_0000000000";
const B = "bobby_0000000000";
const C = "carol_0000000000";
const D = "dave0_0000000000";

function ctx(over: Partial<FoldContext> = {}): FoldContext {
  return {
    open: true,
    roundId: ROUND,
    admitted: new Set([A, B, C, D]),
    removed: new Set(),
    ...over,
  };
}

function fold(t: Tally, ledger = emptyLedger(), by = A, answers = [0, 1, 2], c = ctx()) {
  return foldBallot(t, ledger, by, answers, c);
}

describe("folding ballots", () => {
  it("counts one ballot per presence key", () => {
    const t0 = emptyTally(ROUND, QUESTIONNAIRE);
    const r1 = fold(t0);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.tally.ballots).toBe(1);
    expect(r1.tally.counts).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(r1.tally.responses).toEqual([1, 1, 1]);
    const again = fold(r1.tally, r1.ledger, A, [1, 1, 1]);
    expect(again).toEqual({ ok: false, reason: "duplicate" });
  });

  it("counts a skipped question as no response", () => {
    const r = fold(emptyTally(ROUND, QUESTIONNAIRE), emptyLedger(), B, [2, 2, -1]);
    expect(r.ok && r.tally.responses).toEqual([1, 1, 0]);
    expect(r.ok && r.tally.counts[2]).toEqual([0, 0, 0]);
  });

  it.each([
    ["closed", ctx({ open: false })],
    ["removed", ctx({ removed: new Set([A]) })],
    ["not-admitted", ctx({ admitted: new Set([B]) })],
    ["wrong-round", ctx({ roundId: "round_000002" })],
  ])("refuses a %s ballot", (reason, c) => {
    expect(fold(emptyTally(ROUND, QUESTIONNAIRE), emptyLedger(), A, [0, 0, 0], c)).toEqual({
      ok: false,
      reason,
    });
  });

  it("refuses a ballot once the round is full", () => {
    const full = { ...emptyTally(ROUND, QUESTIONNAIRE), ballots: VOTE_LIMITS.maxBallotsPerRound };
    expect(fold(full)).toEqual({ ok: false, reason: "round-full" });
  });

  it("refuses answers of the wrong length, off the scale, or with nothing answered", () => {
    const t = emptyTally(ROUND, QUESTIONNAIRE);
    for (const answers of [
      [0, 1],
      [0, 1, 2, 0],
      [0, 3, 0],
      [0, 1.5, 0],
      [-1, -1, -1],
      [-2, 0, 0],
    ]) {
      expect(fold(t, emptyLedger(), A, answers)).toEqual({ ok: false, reason: "bad-answers" });
    }
  });

  it("never mutates its inputs", () => {
    const t = emptyTally(ROUND, QUESTIONNAIRE);
    const ledger = emptyLedger();
    const before = JSON.stringify(t);
    const r = fold(t, ledger);
    expect(JSON.stringify(t)).toBe(before);
    expect(ledger.voted.size).toBe(0);
    expect(r.ok && r.tally).not.toBe(t);
  });

  it("keeps only presence keys in the ledger", () => {
    let t = emptyTally(ROUND, QUESTIONNAIRE);
    let ledger = emptyLedger();
    for (const by of [A, B, C]) {
      const r = fold(t, ledger, by, [0, 2, 1]);
      if (!r.ok) throw new Error(r.reason);
      t = r.tally;
      ledger = r.ledger;
    }
    expect(Object.keys(ledger)).toEqual(["voted"]);
    expect(Array.from(ledger.voted).sort()).toEqual([A, B, C].sort());
  });

  it("prechecks an envelope before anything is decrypted", () => {
    const t = emptyTally(ROUND, QUESTIONNAIRE);
    expect(precheckBallot({ by: A, roundId: ROUND }, emptyLedger(), t, ctx())).toBeNull();
    expect(precheckBallot({ by: A, roundId: "round_000002" }, emptyLedger(), t, ctx())).toBe(
      "wrong-round"
    );
    expect(
      precheckBallot({ by: "stranger_0000000", roundId: ROUND }, emptyLedger(), t, ctx())
    ).toBe("not-admitted");
  });
});

describe("reveal rules", () => {
  function tallyOf(rows: number[][]): Tally {
    let t = emptyTally(ROUND, QUESTIONNAIRE);
    let ledger = emptyLedger();
    const admitted = new Set(rows.map((_, i) => `member${String(i).padStart(10, "0")}`));
    rows.forEach((answers, i) => {
      const r = foldBallot(
        t,
        ledger,
        `member${String(i).padStart(10, "0")}`,
        answers,
        ctx({ admitted })
      );
      if (!r.ok) throw new Error(r.reason);
      t = r.tally;
      ledger = r.ledger;
    });
    return t;
  }

  it("clamps minN: 3 by default, never under 3 or over 20", () => {
    expect(effectiveMinN()).toBe(3);
    expect(effectiveMinN(0)).toBe(3);
    expect(effectiveMinN(-4)).toBe(3);
    expect(effectiveMinN(50)).toBe(20);
    expect(effectiveMinN(VOTE_LIMITS.minNPsychSafety)).toBe(5);
    expect(effectiveMinN(4.2)).toBe(5);
    expect(effectiveMinN(Number.NaN)).toBe(3);
  });

  it("never goes under Psych Safety's 5, whatever the caller passes", () => {
    expect(effectiveMinN(undefined, "psych-safety")).toBe(5);
    expect(effectiveMinN(3, "psych-safety")).toBe(5);
    expect(effectiveMinN(Number.NaN, "psych-safety")).toBe(5);
    expect(effectiveMinN(7, "psych-safety")).toBe(7);
    expect(effectiveMinN(3, "health-check")).toBe(3);
    expect(effectiveMinN(undefined, "mood-tracker")).toBe(3);
  });

  it("toRoundResult applies the tool's floor too", () => {
    const r = toRoundResult(
      QUESTIONNAIRE,
      revealTally(
        tallyOf([
          [0, 0, 0],
          [1, 1, 1],
          [2, 2, 2],
          [0, 1, 2],
        ]),
        3
      ),
      {
        tool: "psych-safety",
        roundId: ROUND,
        closedAt: "2026-10-26T10:00:00.000Z",
        minN: 3,
        ballots: 4,
        source: "live",
      }
    );
    expect(r.minN).toBe(5);
    expect(r.questions.map((q) => q.distribution)).toEqual([null, null, null]);
  });

  it("canReveal needs minN ballots", () => {
    const two = tallyOf([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    expect(canReveal(two, 3)).toBe(false);
    const three = tallyOf([
      [0, 0, 0],
      [1, 1, 1],
      [2, 2, 2],
    ]);
    expect(canReveal(three, 3)).toBe(true);
    expect(canReveal(three, 5)).toBe(false);
    // A minN under the floor still needs 3.
    expect(canReveal(two, 1)).toBe(false);
  });

  it("withholds a question under minN and reveals one at exactly minN", () => {
    const t = tallyOf([
      [0, 0, 0],
      [0, 1, -1],
      [1, 2, -1],
      [2, 2, 1],
    ]);
    expect(revealTally(t, 3)).toEqual([
      { responses: 4, distribution: [2, 1, 1] },
      { responses: 4, distribution: [1, 1, 2] },
      { responses: 2, distribution: null },
    ]);
    const atMin = tallyOf([
      [0, 0, 0],
      [0, 1, 1],
      [1, 2, 2],
    ]);
    expect(revealTally(atMin, 3)[2]).toEqual({ responses: 3, distribution: [1, 1, 1] });
  });
});

describe("facilitator counts", () => {
  it("folds counts into a tally", () => {
    const t = foldCounts(
      emptyTally(ROUND, QUESTIONNAIRE),
      [
        [3, 1, 0],
        [0, 2, 2],
        [1, 0, 0],
      ],
      4
    );
    expect(t).toMatchObject({ ballots: 4, responses: [4, 4, 1] });
    expect(t?.counts[1]).toEqual([0, 2, 2]);
  });

  it("refuses the wrong shape, fractions, negatives and more answers than people", () => {
    const t = emptyTally(ROUND, QUESTIONNAIRE);
    expect(foldCounts(t, [[1, 0, 0]], 1)).toBeNull();
    expect(
      foldCounts(
        t,
        [
          [1, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        1
      )
    ).toBeNull();
    expect(
      foldCounts(
        t,
        [
          [1.5, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        2
      )
    ).toBeNull();
    expect(
      foldCounts(
        t,
        [
          [-1, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        2
      )
    ).toBeNull();
    expect(
      foldCounts(
        t,
        [
          [2, 1, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        2
      )
    ).toBeNull();
    expect(
      foldCounts(
        t,
        [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        -1
      )
    ).toBeNull();
    expect(
      foldCounts(
        t,
        [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        VOTE_LIMITS.maxTallyBallots + 1
      )
    ).toBeNull();
  });
});

describe("statistics", () => {
  const scale = QUESTIONNAIRE.scale; // Green 2, Yellow 1, Red 0

  it("mean, median and share use the scale's values", () => {
    expect(distributionMean([2, 1, 1], scale)).toBeCloseTo(1.25);
    expect(distributionMedian([2, 1, 1], scale)).toBe(1.5);
    expect(distributionMedian([3, 0, 0], scale)).toBe(2);
    expect(distributionMedian([0, 1, 2], scale)).toBe(0);
    expect(pointShare([2, 1, 1], 0)).toBe(0.5);
  });

  it("give null for no answers", () => {
    expect(distributionMean([0, 0, 0], scale)).toBeNull();
    expect(distributionMedian([0, 0, 0], scale)).toBeNull();
    expect(pointShare([0, 0, 0], 1)).toBeNull();
  });
});

describe("the saved result", () => {
  const revealed = [
    { responses: 4, distribution: [2, 1, 1] },
    { responses: 4, distribution: [1, 1, 2] },
    { responses: 2, distribution: null },
  ];
  const meta = {
    tool: "health-check" as const,
    roundId: ROUND,
    closedAt: "2026-10-26T10:30:00.000Z",
    minN: 3,
    ballots: 4,
    source: "live" as const,
  };

  it("holds totals only: no member ids, no names", () => {
    const r = toRoundResult(QUESTIONNAIRE, revealed, meta);
    expect(r).toEqual({
      roundId: ROUND,
      tool: "health-check",
      questionnaireId: QUESTIONNAIRE.id,
      title: QUESTIONNAIRE.title,
      scale: QUESTIONNAIRE.scale,
      closedAt: meta.closedAt,
      minN: 3,
      ballots: 4,
      source: "live",
      questions: [
        { id: "fun", text: "Fun", responses: 4, distribution: [2, 1, 1] },
        { id: "speed", text: "Speed", responses: 4, distribution: [1, 1, 2] },
        { id: "learning", text: "Learning", responses: 2, distribution: null },
      ],
    });
    const json = JSON.stringify(r);
    for (const id of [A, B, C, D, "alice", "Alice"]) expect(json).not.toContain(id);
    expect(json).not.toMatch(/voted|acks|ledger|members|by"/);
  });

  it("applies the minN rule again, whatever it is given", () => {
    const leaky = [{ responses: 2, distribution: [1, 1, 0] }, ...revealed.slice(1)];
    expect(toRoundResult(QUESTIONNAIRE, leaky, meta).questions[0].distribution).toBeNull();
    expect(
      toRoundResult(QUESTIONNAIRE, revealed, { ...meta, minN: 5 }).questions[0].distribution
    ).toBeNull();
  });

  it("reads as Markdown, withheld questions said plainly", () => {
    const md = voteRoundMarkdown(toRoundResult(QUESTIONNAIRE, revealed, meta));
    expect(md).toContain("# Squad health");
    expect(md).toContain("4 people answered anonymously in a live round, 2026-10-26.");
    expect(md).toContain("| Question | Green | Yellow | Red | Answers | Mean |");
    expect(md).toContain("| Fun | 2 | 1 | 1 | 4 | 1.3 |");
    expect(md).toContain("| Learning | — | — | — | 2 | Withheld (fewer than 3 answers) |");
  });

  it("escapes pipes in Markdown cells", () => {
    const q = { ...QUESTIONNAIRE, questions: [{ id: "x", text: "A | B" }] };
    const md = voteRoundMarkdown(
      toRoundResult(q, [{ responses: 3, distribution: [3, 0, 0] }], { ...meta, ballots: 3 })
    );
    expect(md).toContain("| A \\| B | 3 | 0 | 0 | 3 | 2 |");
  });
});
