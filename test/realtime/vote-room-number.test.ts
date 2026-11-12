import { describe, expect, it } from "vitest";
import { emptyLedger, type FoldContext } from "@/lib/realtime/vote-room/aggregate";
import {
  emptyNumberTally,
  encodeNumber,
  foldNumber,
  numberBucketOf,
  numberBucketRange,
  numberCiphertextChars,
  numberDraftProblem,
  numberRoundMarkdown,
  numberSheetProblem,
  numberSpan,
  numberWidth,
  quantile,
  readNumberState,
  readNumberString,
  revealNumber,
  toNumberResult,
  toWireNumberSheet,
  type NumberSheet,
  type NumberTally,
} from "@/lib/realtime/vote-room/number";
import { NUMBER_SHEET, numberStateBody } from "./vote-room-kind-fixtures";

/**
 * Number rounds: one number per person in the host's range. The host keeps
 * a sorted list (no senders, no arrival order) until Reveal; the median
 * shows from minN, the spread (lowest, quartiles, highest, histogram) only
 * from 5; the saved result keeps the statistics, never the list.
 */

const ROUND = "round_000001";
const KEYS = { publicKeys: { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` } };
const HOST = "host_00000000000";
const SIG = "s".repeat(86);
const PEOPLE = Array.from({ length: 8 }, (_, i) => `member_${String(i).padStart(9, "0")}`);
const ctx: FoldContext = {
  open: true,
  roundId: ROUND,
  admitted: new Set(PEOPLE),
  removed: new Set(),
};
const wire = (body: object) => JSON.parse(JSON.stringify({ ...body, sig: SIG }));

function fold(values: number[], sheet: NumberSheet = NUMBER_SHEET): NumberTally {
  let t = emptyNumberTally(ROUND);
  let ledger = emptyLedger();
  values.forEach((v, i) => {
    const steps = readNumberString(encodeNumber({ value: v }, sheet)!, sheet)!;
    const res = foldNumber(t, ledger, PEOPLE[i], steps, sheet, ctx);
    if (!res.ok) throw new Error(res.reason);
    t = res.tally;
    ledger = res.ledger;
  });
  return t;
}

const HALVES: NumberSheet = {
  id: "quick:days",
  title: "How many days?",
  min: 0.5,
  max: 10,
  decimals: 1,
  unit: "days",
};

describe("number sheets", () => {
  it("shares a sheet on its step grid", () => {
    expect(toWireNumberSheet(NUMBER_SHEET)).toEqual(NUMBER_SHEET);
    expect(numberSpan(NUMBER_SHEET)).toBe(100);
    expect(numberWidth(NUMBER_SHEET)).toBe(3);
    expect(numberSpan(HALVES)).toBe(95);
    expect(toWireNumberSheet({ ...HALVES, max: 0.1 + 0.2 + 9.7 })?.max).toBe(10);
  });

  it.each<[string, Partial<NumberSheet>, RegExp]>([
    ["max at min", { max: 0 }, /above the lowest/],
    ["max under min", { min: 10, max: 5 }, /above the lowest/],
    ["3 decimals", { decimals: 3 as never }, /0 to 2 decimal/],
    ["a decimal on a whole-number range", { max: 99.5 }, /at most 0 decimal/],
    ["a range past a million", { max: 2_000_000 }, /from -1,000,000/],
    ["too many steps", { min: -1_000_000, max: 1_000_000, decimals: 2 }, /too wide/],
    ["a long unit", { unit: "kilometres" }, /at most 8/],
    ["a blank question", { title: " " }, /needs a question/],
  ])("refuses %s", (_label, over, problem) => {
    expect(numberSheetProblem({ ...NUMBER_SHEET, ...over })).toMatch(problem);
  });
});

describe("number ballots", () => {
  it("travels as steps above the lowest, zero-padded to the range's digits", () => {
    expect(encodeNumber({ value: 42 }, NUMBER_SHEET)).toBe("042");
    expect(encodeNumber({ value: 0 }, NUMBER_SHEET)).toBe("000");
    expect(encodeNumber({ value: 2.5 }, HALVES)).toBe("20");
    expect(numberCiphertextChars(NUMBER_SHEET)).toBe(numberCiphertextChars({ ...NUMBER_SHEET }));
  });

  it.each<[string, NumberSheet, Record<string, number | null>, string]>([
    ["nothing", NUMBER_SHEET, {}, "missing"],
    ["blank", NUMBER_SHEET, { value: null }, "missing"],
    ["over the range", NUMBER_SHEET, { value: 101 }, "out-of-range"],
    ["under the range", HALVES, { value: 0 }, "out-of-range"],
    ["a decimal on whole numbers", NUMBER_SHEET, { value: 4.5 }, "too-precise"],
    ["two decimals on one", HALVES, { value: 2.25 }, "too-precise"],
  ])("refuses %s", (_label, sheet, draft, problem) => {
    expect(numberDraftProblem(draft, sheet)).toBe(problem);
    expect(encodeNumber(draft, sheet)).toBeNull();
  });

  it("reads back only a well-formed answer in range", () => {
    expect(readNumberString("042", NUMBER_SHEET)).toBe(42);
    expect(readNumberString("42", NUMBER_SHEET)).toBeNull();
    expect(readNumberString("101", NUMBER_SHEET)).toBeNull();
    expect(readNumberString("-01", NUMBER_SHEET)).toBeNull();
    expect(readNumberString("4.2", NUMBER_SHEET)).toBeNull();
  });
});

describe("number counting and reveal", () => {
  it("refuses a second ballot, an answer off the step grid, and a closed or other round", () => {
    const first = foldNumber(
      emptyNumberTally(ROUND),
      emptyLedger(),
      PEOPLE[0],
      40,
      NUMBER_SHEET,
      ctx
    );
    if (!first.ok) throw new Error(first.reason);
    const { tally, ledger } = first;
    const before = JSON.stringify(tally);
    const refused = (by: string, steps: number, c: FoldContext = ctx, t: NumberTally = tally) =>
      foldNumber(t, ledger, by, steps, NUMBER_SHEET, c);

    expect(refused(PEOPLE[0], 70)).toEqual({ ok: false, reason: "duplicate" });
    expect(refused(PEOPLE[1], numberSpan(NUMBER_SHEET) + 1)).toEqual({
      ok: false,
      reason: "bad-answers",
    });
    expect(refused(PEOPLE[1], 1.5)).toEqual({ ok: false, reason: "bad-answers" });
    expect(refused(PEOPLE[1], -1)).toEqual({ ok: false, reason: "bad-answers" });
    expect(refused(PEOPLE[1], Number.NaN)).toEqual({ ok: false, reason: "bad-answers" });
    expect(refused(PEOPLE[1], 10, { ...ctx, open: false })).toEqual({
      ok: false,
      reason: "closed",
    });
    expect(refused(PEOPLE[1], 10, { ...ctx, roundId: "round_000002" })).toEqual({
      ok: false,
      reason: "wrong-round",
    });
    expect(refused(PEOPLE[1], 10, ctx, emptyNumberTally("round_000002"))).toEqual({
      ok: false,
      reason: "wrong-round",
    });
    expect(refused("outsider_0000000", 10)).toEqual({ ok: false, reason: "not-admitted" });
    expect(refused(PEOPLE[1], 10, { ...ctx, removed: new Set([PEOPLE[1]]) })).toEqual({
      ok: false,
      reason: "removed",
    });
    // Nothing refused changed the count or the answers.
    expect(JSON.stringify(tally)).toBe(before);
    expect(tally).toEqual({ roundId: ROUND, steps: [40], ballots: 1 });
    expect(Array.from(ledger.voted)).toEqual([PEOPLE[0]]);
  });

  it("keeps the answers sorted, so the order they came in is gone", () => {
    const t = fold([70, 10, 40]);
    expect(t).toEqual({ roundId: ROUND, steps: [10, 40, 70], ballots: 3 });
    expect(Object.keys(t).sort()).toEqual(["ballots", "roundId", "steps"]);
  });

  it("shows nothing under minN, the median alone from 3, and the spread from 5", () => {
    expect(revealNumber(fold([10, 20]), NUMBER_SHEET, 3)).toBeNull();
    expect(revealNumber(fold([10, 20, 90]), NUMBER_SHEET, 3)).toEqual({
      count: 3,
      median: 20,
      spread: null,
    });
    expect(revealNumber(fold([10, 20, 90, 40]), NUMBER_SHEET, 3)).toEqual({
      count: 4,
      median: 30,
      spread: null,
    });
    expect(revealNumber(fold([50, 10, 40, 20, 30]), NUMBER_SHEET, 3)).toEqual({
      count: 5,
      median: 30,
      spread: {
        min: 10,
        q1: 20,
        q3: 40,
        max: 50,
        histogram: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
      },
    });
  });

  it("interpolates quartiles between neighbours, and buckets the whole range in ten", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(numberBucketOf(0, 100)).toBe(0);
    expect(numberBucketOf(100, 100)).toBe(9);
    expect(numberBucketRange(0, NUMBER_SHEET)).toEqual([0, 10]);
    expect(numberBucketRange(9, NUMBER_SHEET)).toEqual([91, 100]);
    // A range of fewer than ten answers leaves some buckets empty.
    const small: NumberSheet = { ...NUMBER_SHEET, min: 1, max: 5 };
    const ranges = Array.from({ length: 10 }, (_, k) => numberBucketRange(k, small));
    expect(ranges.filter(Boolean)).toHaveLength(5);
  });

  it("saves the statistics only, never the list, and applies the spread rule again", () => {
    const t = fold([50, 10, 40, 20, 30]);
    const revealed = revealNumber(t, NUMBER_SHEET, 3)!;
    const meta = {
      tool: "quick-vote" as const,
      roundId: ROUND,
      closedAt: "2026-11-12T10:00:00.000Z",
      minN: 3,
      ballots: 5,
      source: "live" as const,
    };
    const result = toNumberResult(NUMBER_SHEET, revealed, meta)!;
    expect(result).toMatchObject({ kind: "number", median: 30, ballots: 5 });
    expect(Object.keys(result)).not.toContain("steps");
    expect(JSON.stringify(result)).not.toMatch(/member_/);
    expect(numberRoundMarkdown(result)).toContain("Median: 30%.");
    // A caller can't save a spread with fewer than 5.
    expect(
      toNumberResult(NUMBER_SHEET, { ...revealed, count: 4 }, { ...meta, ballots: 4 })!.spread
    ).toBeNull();
    expect(toNumberResult(NUMBER_SHEET, revealed, { ...meta, ballots: 2 })).toBeNull();
  });
});

describe("readNumberState", () => {
  const spread = { min: 10, q1: 20, q3: 40, max: 50, histogram: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] };

  it("accepts exactly what the host builds", () => {
    const rev = numberStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 5,
      revealed: { count: 5, median: 30, spread },
    });
    expect(readNumberState(wire(rev), "quick-vote")).toEqual({ ...rev, sig: SIG });
    const early = numberStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 3,
      revealed: { count: 3, median: 20, spread: null },
    });
    expect(readNumberState(wire(early), "quick-vote")).toEqual({ ...early, sig: SIG });
  });

  it.each<[string, object]>([
    ["a spread from 4 answers", { ballots: 4, revealed: { count: 4, median: 30, spread } }],
    ["no spread from 5", { ballots: 5, revealed: { count: 5, median: 30, spread: null } }],
    ["a median out of range", { ballots: 3, revealed: { count: 3, median: 101, spread: null } }],
    ["a count that isn't the ballots", { ballots: 5, revealed: { count: 4, median: 30, spread } }],
    [
      "quartiles out of order",
      { ballots: 5, revealed: { count: 5, median: 30, spread: { ...spread, q1: 35 } } },
    ],
    [
      "a histogram that doesn't add up",
      {
        ballots: 5,
        revealed: {
          count: 5,
          median: 30,
          spread: { ...spread, histogram: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0] },
        },
      },
    ],
    [
      "a lowest answer off the grid",
      { ballots: 5, revealed: { count: 5, median: 30, spread: { ...spread, min: 10.5 } } },
    ],
    [
      "a lowest answer past the first full bucket",
      { ballots: 5, revealed: { count: 5, median: 30, spread: { ...spread, min: 15 } } },
    ],
  ])("refuses %s", (_label, over) => {
    const body = { ...numberStateBody(HOST, KEYS, { phase: "revealed" }), ...over };
    expect(readNumberState(wire(body), "quick-vote")).toBeNull();
  });
});
