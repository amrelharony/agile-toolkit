import { describe, expect, it } from "vitest";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { emptyLedger, type FoldContext } from "@/lib/realtime/vote-room/aggregate";
import {
  choiceCiphertextChars,
  choiceDraftProblem,
  choiceRoundMarkdown,
  choiceSheetProblem,
  emptyChoiceTally,
  encodeChoice,
  foldChoice,
  readChoiceState,
  readChoiceString,
  revealChoice,
  toChoiceResult,
  toWireChoiceSheet,
  type ChoiceSheet,
  type ChoiceTally,
} from "@/lib/realtime/vote-room/choice";
import { DOTS_SHEET, MULTI_SHEET, POLL_SHEET, choiceStateBody } from "./vote-room-kind-fixtures";

/**
 * Choice rounds: single picks, multi-picks and dot voting. Every ballot is
 * one character per option; totals from minN; a dot round's backers only
 * from 5; nothing kept per person.
 */

const ROUND = "round_000001";
const KEYS = { publicKeys: { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` } };
const HOST = "host_00000000000";
const SIG = "s".repeat(86);
const PEOPLE = Array.from({ length: 8 }, (_, i) => `member_${String(i).padStart(9, "0")}`);
const ctx = (over: Partial<FoldContext> = {}): FoldContext => ({
  open: true,
  roundId: ROUND,
  admitted: new Set(PEOPLE),
  removed: new Set(),
  ...over,
});

function fold(sheet: ChoiceSheet, ballots: number[][]): ChoiceTally {
  let t = emptyChoiceTally(ROUND, sheet);
  let ledger = emptyLedger();
  ballots.forEach((counts, i) => {
    const res = foldChoice(t, ledger, PEOPLE[i], counts, sheet, ctx());
    if (!res.ok) throw new Error(res.reason);
    t = res.tally;
    ledger = res.ledger;
  });
  return t;
}

const wire = (body: object) => JSON.parse(JSON.stringify({ ...body, sig: SIG }));

describe("choice sheets", () => {
  it("shares a sheet rebuilt field by field, a single round's limit forced to 1", () => {
    expect(toWireChoiceSheet(POLL_SHEET)).toEqual(POLL_SHEET);
    expect(toWireChoiceSheet({ ...POLL_SHEET, limit: 3 })?.limit).toBe(1);
    expect(toWireChoiceSheet({ ...POLL_SHEET, title: "  Lunch‮  ?" } as ChoiceSheet)?.title).toBe(
      "Lunch ?"
    );
  });

  it.each<[string, Partial<ChoiceSheet>, RegExp]>([
    ["one option", { options: [{ id: "a", text: "A" }] }, /2 to 12 options/],
    [
      "13 options",
      { options: Array.from({ length: 13 }, (_, i) => ({ id: `o${i}`, text: `O${i}` })) },
      /2 to 12 options/,
    ],
    [
      "a duplicate id",
      {
        options: [
          { id: "a", text: "A" },
          { id: "a", text: "B" },
        ],
      },
      /same id/,
    ],
    [
      "a blank option",
      {
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "  " },
        ],
      },
      /needs text/,
    ],
    ["a bad mode", { mode: "many" as never }, /pick one option/],
    ["a blank question", { title: "" }, /needs a question/],
  ])("refuses %s", (_label, over, problem) => {
    expect(choiceSheetProblem({ ...POLL_SHEET, ...over })).toMatch(problem);
    expect(toWireChoiceSheet({ ...POLL_SHEET, ...over })).toBeNull();
  });

  it("caps a multi round's picks at the options, and a dot round at 10 dots", () => {
    expect(choiceSheetProblem({ ...MULTI_SHEET, limit: 5 })).toMatch(/from 1 to 4/);
    expect(choiceSheetProblem({ ...DOTS_SHEET, limit: 11 })).toMatch(/from 1 to 10/);
    expect(choiceSheetProblem({ ...DOTS_SHEET, limit: 10 })).toBeNull();
    expect(choiceSheetProblem({ ...DOTS_SHEET, limit: 0 })).not.toBeNull();
  });
});

describe("choice ballots", () => {
  it("encodes one character per option, the same size for every ballot of a round", () => {
    expect(encodeChoice({ cafe: 1 }, POLL_SHEET)).toBe("010");
    expect(encodeChoice({ a: 1, d: 1 }, MULTI_SHEET)).toBe("1001");
    expect(encodeChoice({ a: 2, c: 1 }, DOTS_SHEET)).toBe("2010");
    expect(choiceCiphertextChars(POLL_SHEET)).toBe(choiceCiphertextChars({ ...POLL_SHEET }));
  });

  it.each<[string, ChoiceSheet, Record<string, number | null>, string]>([
    ["nothing picked", POLL_SHEET, {}, "empty"],
    ["two picks in a single round", POLL_SHEET, { room: 1, cafe: 1 }, "too-many"],
    ["three picks of two", MULTI_SHEET, { a: 1, b: 1, c: 1 }, "too-many"],
    ["a 2 in a multi round", MULTI_SHEET, { a: 2 }, "not-whole"],
    ["four dots of three", DOTS_SHEET, { a: 2, b: 2 }, "too-many"],
    ["a negative count", DOTS_SHEET, { a: -1 }, "not-whole"],
    ["half a dot", DOTS_SHEET, { a: 0.5 }, "not-whole"],
  ])("refuses %s", (_label, sheet, draft, problem) => {
    expect(choiceDraftProblem(draft, sheet)?.problem).toBe(problem);
    expect(encodeChoice(draft, sheet)).toBeNull();
  });

  it("reads back only a ballot the sheet allows", () => {
    expect(readChoiceString("010", POLL_SHEET)).toEqual([0, 1, 0]);
    expect(readChoiceString("110", POLL_SHEET)).toBeNull();
    expect(readChoiceString("000", POLL_SHEET)).toBeNull();
    expect(readChoiceString("01", POLL_SHEET)).toBeNull();
    expect(readChoiceString("0x0", POLL_SHEET)).toBeNull();
    expect(readChoiceString("3000", DOTS_SHEET)).toEqual([3, 0, 0, 0]);
    expect(readChoiceString("4000", DOTS_SHEET)).toBeNull();
    expect(readChoiceString("1110", MULTI_SHEET)).toBeNull();
  });
});

describe("choice counting and reveal", () => {
  it("counts per-option totals, keeps nothing per person, and refuses a second ballot", () => {
    const t = fold(POLL_SHEET, [
      [1, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ]);
    expect(t).toEqual({ roundId: ROUND, totals: [2, 1, 0], backers: [2, 1, 0], ballots: 3 });
    expect(Object.keys(t).sort()).toEqual(["backers", "ballots", "roundId", "totals"]);
    let ledger = emptyLedger();
    const first = foldChoice(
      emptyChoiceTally(ROUND, POLL_SHEET),
      ledger,
      PEOPLE[0],
      [1, 0, 0],
      POLL_SHEET,
      ctx()
    );
    expect(first.ok).toBe(true);
    if (first.ok) ledger = first.ledger;
    const again = foldChoice(
      first.ok ? first.tally : t,
      ledger,
      PEOPLE[0],
      [0, 1, 0],
      POLL_SHEET,
      ctx()
    );
    expect(again).toEqual({ ok: false, reason: "duplicate" });
    expect(foldChoice(t, emptyLedger(), PEOPLE[5], [1, 1, 0], POLL_SHEET, ctx())).toEqual({
      ok: false,
      reason: "bad-answers",
    });
    expect(
      foldChoice(t, emptyLedger(), PEOPLE[5], [1, 0, 0], POLL_SHEET, ctx({ open: false }))
    ).toEqual({ ok: false, reason: "closed" });
  });

  it("reveals totals only from minN, and the result applies the rule again", () => {
    const two = fold(POLL_SHEET, [
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(revealChoice(two, POLL_SHEET, 3)).toBeNull();
    const three = fold(POLL_SHEET, [
      [1, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ]);
    const revealed = revealChoice(three, POLL_SHEET, 3)!;
    expect(revealed).toEqual([
      { total: 2, backers: null },
      { total: 1, backers: null },
      { total: 0, backers: null },
    ]);
    const meta = {
      tool: "quick-vote" as const,
      roundId: ROUND,
      closedAt: "2026-11-12T10:00:00.000Z",
      minN: 3,
      ballots: 3,
      source: "live" as const,
    };
    const result = toChoiceResult(POLL_SHEET, revealed, meta)!;
    expect(result).toMatchObject({ kind: "choice", ballots: 3, mode: "single" });
    expect(JSON.stringify(result)).not.toMatch(/member_/);
    expect(toChoiceResult(POLL_SHEET, revealed, { ...meta, ballots: 2 })).toBeNull();
    expect(choiceRoundMarkdown(result)).toContain("| Meeting room | 2 | 67% |");
  });

  it("shows a dot round's backers only from 5 answers", () => {
    const four = fold(DOTS_SHEET, [
      [3, 0, 0, 0],
      [1, 1, 1, 0],
      [0, 0, 2, 1],
      [2, 0, 0, 0],
    ]);
    expect(revealChoice(four, DOTS_SHEET, 3)!.every((r) => r.backers === null)).toBe(true);
    const five = fold(DOTS_SHEET, [
      [3, 0, 0, 0],
      [1, 1, 1, 0],
      [0, 0, 2, 1],
      [2, 0, 0, 0],
      [0, 3, 0, 0],
    ]);
    expect(revealChoice(five, DOTS_SHEET, 3)).toEqual([
      { total: 6, backers: 3 },
      { total: 4, backers: 2 },
      { total: 3, backers: 2 },
      { total: 1, backers: 1 },
    ]);
    // Even a caller-made "revealed" with backers under 5 saves none.
    const result = toChoiceResult(
      DOTS_SHEET,
      [
        { total: 6, backers: 3 },
        { total: 4, backers: 2 },
        { total: 1, backers: 1 },
        { total: 1, backers: 1 },
      ],
      {
        tool: "quick-vote",
        roundId: ROUND,
        closedAt: "2026-11-12T10:00:00.000Z",
        minN: 3,
        ballots: 4,
        source: "live",
      }
    );
    expect(result!.options.every((o) => o.backers === null)).toBe(true);
    expect(VOTE_LIMITS.minNSpread).toBe(5);
  });
});

describe("readChoiceState", () => {
  it("accepts exactly what the host builds", () => {
    const body = choiceStateBody(HOST, KEYS);
    expect(readChoiceState(wire(body), "quick-vote")).toEqual({ ...body, sig: SIG });
    const rev = choiceStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 3,
      revealed: [
        { total: 2, backers: null },
        { total: 1, backers: null },
        { total: 0, backers: null },
      ],
    });
    expect(readChoiceState(wire(rev), "quick-vote")).toEqual({ ...rev, sig: SIG });
  });

  it.each<[string, object]>([
    [
      "totals under minN",
      {
        phase: "revealed",
        ballots: 2,
        revealed: [
          { total: 1, backers: null },
          { total: 1, backers: null },
          { total: 0, backers: null },
        ],
      },
    ],
    [
      "single totals that don't add up to the people",
      {
        phase: "revealed",
        ballots: 3,
        revealed: [
          { total: 3, backers: null },
          { total: 1, backers: null },
          { total: 0, backers: null },
        ],
      },
    ],
    [
      "backers in a single round",
      {
        phase: "revealed",
        ballots: 3,
        revealed: [
          { total: 2, backers: 2 },
          { total: 1, backers: 1 },
          { total: 0, backers: 0 },
        ],
      },
    ],
  ])("refuses %s", (_label, over) => {
    expect(
      readChoiceState(wire({ ...choiceStateBody(HOST, KEYS), ...over }), "quick-vote")
    ).toBeNull();
  });

  it("refuses a dot round's backers under 5, and accepts them from 5", () => {
    const under = choiceStateBody(HOST, KEYS, {
      sheet: DOTS_SHEET,
      phase: "revealed",
      ballots: 4,
      revealed: [
        { total: 6, backers: 3 },
        { total: 1, backers: 1 },
        { total: 3, backers: 2 },
        { total: 1, backers: 1 },
      ],
    });
    expect(readChoiceState(wire(under), "quick-vote")).toBeNull();
    const ok = choiceStateBody(HOST, KEYS, {
      sheet: DOTS_SHEET,
      phase: "revealed",
      ballots: 5,
      revealed: [
        { total: 6, backers: 3 },
        { total: 4, backers: 2 },
        { total: 3, backers: 2 },
        { total: 1, backers: 1 },
      ],
    });
    expect(readChoiceState(wire(ok), "quick-vote")).not.toBeNull();
  });

  it("refuses another tool's choice state, and a tool that doesn't run choice rounds", () => {
    const body = choiceStateBody(HOST, KEYS);
    expect(readChoiceState(wire({ ...body, tool: "health-check" }), "quick-vote")).toBeNull();
    expect(readChoiceState(wire(body), "health-check" as never)).toBeNull();
  });
});
