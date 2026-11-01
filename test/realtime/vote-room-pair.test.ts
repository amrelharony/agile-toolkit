import { describe, expect, it } from "vitest";
import {
  VOTE_LIMITS,
  VOTE_ROOM_EVENTS,
  ballotCiphertextChars,
  readVoteState,
  signingInput,
} from "@/lib/realtime/vote-room/protocol";
import { emptyLedger, type FoldContext } from "@/lib/realtime/vote-room/aggregate";
import {
  KANO_PAIR_ANSWERS,
  KANO_PAIR_PROMPTS,
  PAIR_ALPHABET,
  canRevealPairs,
  commonPairs,
  emptyPairTally,
  encodePairs,
  foldPair,
  foldPairCounts,
  jointIndex,
  pairCiphertextChars,
  pairCount,
  pairDraftKey,
  pairDraftProblem,
  pairItemProblem,
  pairMarginals,
  pairRoundMarkdown,
  pairSheetProblem,
  readPairState,
  readPairString,
  revealPairs,
  toPairResult,
  toWirePairSheet,
  type PairDraft,
  type PairSheet,
  type PairStateBody,
  type PairTally,
} from "@/lib/realtime/vote-room/pair";
import { PAIR_SHEET, ROUND, pairStateBody, pairString, stateBody } from "./vote-room-fixtures";

/**
 * Pair rounds (Kano): two answers per item that travel and count as one
 * joint index, so the host keeps only the P × P joint count per item. The
 * sheet checks, the encoding, the state reader, signing, folding, the
 * per-item reveal rule and the saved result.
 */

const HOST = "host_00000000000";
const KEYS = { publicKeys: { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` } };
const SIG = "s".repeat(86);
const P = KANO_PAIR_ANSWERS.length;

function wire(body: PairStateBody, extra: Record<string, unknown> = {}) {
  return JSON.parse(JSON.stringify({ ...body, sig: SIG, ...extra })) as Record<string, unknown>;
}

function ctx(over: Partial<FoldContext> = {}): FoldContext {
  return {
    open: true,
    roundId: ROUND,
    admitted: new Set(["a", "b", "c", "d", HOST]),
    removed: new Set(),
    ...over,
  };
}

/** A draft from [first, second] per item id (null for blank). */
function draft(pairs: Record<string, [number | null, number | null]>): PairDraft {
  const out: PairDraft = {};
  for (const [id, [f, s]] of Object.entries(pairs)) {
    out[pairDraftKey(id, "first")] = f;
    out[pairDraftKey(id, "second")] = s;
  }
  return out;
}

function tallyOf(rows: number[][]): PairTally {
  let t = emptyPairTally(ROUND, PAIR_SHEET);
  let ledger = emptyLedger();
  rows.forEach((joints, i) => {
    const res = foldPair(t, ledger, ["a", "b", "c", "d"][i], joints, ctx());
    if (!res.ok) throw new Error(res.reason);
    t = res.tally;
    ledger = res.ledger;
  });
  return t;
}

describe("Kano's wording", () => {
  it("has the five answers in the evaluation table's order and the two questions", () => {
    expect(KANO_PAIR_ANSWERS).toEqual([
      "I like it",
      "I expect it",
      "I'm neutral",
      "I can live with it",
      "I dislike it",
    ]);
    expect(KANO_PAIR_PROMPTS).toEqual({
      first: "If it has this, how do you feel?",
      second: "If it doesn't have this, how do you feel?",
    });
    expect(PAIR_ALPHABET).toHaveLength(VOTE_LIMITS.maxPairPoints ** 2);
    expect(new Set(PAIR_ALPHABET).size).toBe(PAIR_ALPHABET.length);
    expect(PAIR_ALPHABET).not.toContain("-");
  });
});

describe("the sheet", () => {
  it("rebuilds a sheet field by field", () => {
    expect(toWirePairSheet(PAIR_SHEET)).toEqual(PAIR_SHEET);
    const out = toWirePairSheet({
      ...PAIR_SHEET,
      title: "  Feature\u202e  survey ",
      items: [{ id: "a", text: " Dark \n mode ", hint: " ", optional: false }],
    })!;
    expect(out.title).toBe("Feature survey");
    expect(out.items).toEqual([{ id: "a", text: "Dark mode" }]);
  });

  it.each<[string, Partial<PairSheet>, RegExp]>([
    ["no title", { title: " " }, /needs a title/],
    ["a blank question", { prompts: { first: "If it has this?", second: " " } }, /Both questions/],
    ["one answer", { answers: ["Yes"] }, /2 to 5 answers/],
    ["six answers", { answers: ["a", "b", "c", "d", "e", "f"] }, /2 to 5 answers/],
    ["a blank answer", { answers: ["Yes", " "] }, /needs a label/],
    ["two answers alike", { answers: ["Yes", "Yes"] }, /its own label/],
    ["no items", { items: [] }, /at least one item/],
    [
      "33 items",
      { items: Array.from({ length: 33 }, (_, i) => ({ id: `f${i}`, text: `F${i}` })) },
      /at most 32 items/,
    ],
    [
      "a duplicate id",
      {
        items: [
          { id: "a", text: "A" },
          { id: "a", text: "B" },
        ],
      },
      /same id/,
    ],
    ["a blank item", { items: [{ id: "a", text: " " }] }, /Item 1 needs text/],
    ["a bad id", { items: [{ id: "a/first", text: "A" }] }, /Item 1's id/],
  ])("refuses %s, saying why", (_label, over, problem) => {
    const sheet = { ...PAIR_SHEET, ...over } as PairSheet;
    expect(toWirePairSheet(sheet)).toBeNull();
    expect(pairSheetProblem(sheet)).toMatch(problem);
  });
});

describe("answers on the wire", () => {
  it("are one joint character per item, first × P + second", () => {
    expect(jointIndex(0, 4, P)).toBe(4);
    expect(jointIndex(4, 0, P)).toBe(20);
    const d = draft({ dark: [0, 4], export: [1, 1], emoji: [null, null] });
    expect(encodePairs(d, PAIR_SHEET)).toBe(`${PAIR_ALPHABET[4]}${PAIR_ALPHABET[6]}-`);
    expect(readPairString(encodePairs(d, PAIR_SHEET)!, PAIR_SHEET)).toEqual([4, 6, -1]);
  });

  it("round-trips every pair of every item", () => {
    for (let f = 0; f < P; f++) {
      for (let s = 0; s < P; s++) {
        const d = draft({ dark: [f, s], export: [s, f], emoji: [f, f] });
        const read = readPairString(encodePairs(d, PAIR_SHEET)!, PAIR_SHEET);
        expect(read).toEqual([jointIndex(f, s, P), jointIndex(s, f, P), jointIndex(f, f, P)]);
      }
    }
  });

  it("needs both halves of an item, or neither for an optional one", () => {
    const item = PAIR_SHEET.items;
    expect(pairItemProblem(draft({ dark: [0, null] }), item[0], P)).toBe("half");
    expect(pairItemProblem(draft({ dark: [null, null] }), item[0], P)).toBe("missing");
    expect(pairItemProblem(draft({ emoji: [null, null] }), item[2], P)).toBeNull();
    expect(pairItemProblem(draft({ emoji: [null, 3] }), item[2], P)).toBe("half");
    expect(pairItemProblem(draft({ dark: [5, 0] }), item[0], P)).toBe("off-scale");
    expect(pairItemProblem(draft({ dark: [0.5, 0] }), item[0], P)).toBe("off-scale");
    expect(pairDraftProblem(draft({ dark: [0, 1], export: [1, null] }), PAIR_SHEET)).toEqual({
      itemId: "export",
      problem: "half",
    });
    expect(encodePairs(draft({ dark: [0, 1], export: [1, null] }), PAIR_SHEET)).toBeNull();
    expect(encodePairs(draft({ dark: [0, 1] }), PAIR_SHEET)).toBeNull();
    // Nothing at all answered.
    const allOptional = { ...PAIR_SHEET, items: [{ id: "x", text: "X", optional: true }] };
    expect(pairDraftProblem({}, allOptional)).toEqual({ problem: "empty" });
  });

  it.each<[string, string]>([
    ["the wrong length", pairString([4, 6])],
    ["a character past P²", `${PAIR_ALPHABET[4]}${"p"}-`],
    ["an unknown character", `${PAIR_ALPHABET[4]}!-`],
    ["a skipped required item", `-${PAIR_ALPHABET[6]}-`],
  ])("readPairString refuses %s", (_label, plain) => {
    expect(readPairString(plain, PAIR_SHEET)).toBeNull();
  });

  it("refuses joints past a smaller scale's P²", () => {
    const yesNo = { ...PAIR_SHEET, answers: ["Yes", "No"] };
    expect(readPairString(pairString([3, 3, -1]), yesNo)).toEqual([3, 3, -1]);
    expect(readPairString(pairString([4, 3, -1]), yesNo)).toBeNull();
  });

  it("seals to one byte per item, the size of a scale ballot with as many questions", () => {
    expect(pairCiphertextChars(PAIR_SHEET)).toBe(ballotCiphertextChars(3));
    const big = {
      ...PAIR_SHEET,
      items: Array.from({ length: 32 }, (_, i) => ({ id: `f${i}`, text: `F${i}` })),
    };
    expect(pairCiphertextChars(big)).toBeLessThanOrEqual(VOTE_LIMITS.maxCiphertextChars);
  });
});

describe("counting and revealing", () => {
  it("counts the joint per item, nothing per person, never mutating", () => {
    const t = emptyPairTally(ROUND, PAIR_SHEET);
    expect(t.points).toBe(25);
    const before = JSON.stringify(t);
    const res = foldPair(t, emptyLedger(), "a", [4, 6, -1], ctx());
    expect(JSON.stringify(t)).toBe(before);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tally.counts[0][4]).toBe(1);
    expect(res.tally.counts[1][6]).toBe(1);
    expect(res.tally.counts[2].every((n) => n === 0)).toBe(true);
    expect(res.tally.responses).toEqual([1, 1, 0]);
    expect(foldPair(res.tally, res.ledger, "a", [4, 6, -1], ctx())).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(foldPair(t, emptyLedger(), "a", [25, 6, -1], ctx())).toEqual({
      ok: false,
      reason: "bad-answers",
    });
    expect(foldPair(t, emptyLedger(), "a", [4, 6], ctx())).toEqual({
      ok: false,
      reason: "bad-answers",
    });
  });

  it("reveals from minN ballots, and each item's joint only from minN answers to it", () => {
    expect(
      canRevealPairs(
        tallyOf([
          [4, 6, 0],
          [4, 7, -1],
        ]),
        3
      )
    ).toBe(false);
    const t = tallyOf([
      [4, 6, 0],
      [4, 7, -1],
      [20, 6, -1],
    ]);
    expect(canRevealPairs(t, 3)).toBe(true);
    const rows = revealPairs(t, 3);
    expect(rows[0].responses).toBe(3);
    expect(rows[0].joint![4]).toBe(2);
    expect(rows[0].joint![20]).toBe(1);
    expect(rows[1].joint![6]).toBe(2);
    // The optional item had one answer: withheld.
    expect(rows[2]).toEqual({ responses: 1, joint: null });
  });

  it("foldPairCounts takes paper counts with the scale fold's rules", () => {
    const t = emptyPairTally(ROUND, PAIR_SHEET);
    const joints = PAIR_SHEET.items.map(() => new Array<number>(25).fill(0));
    joints[0][4] = 3;
    joints[1][6] = 2;
    joints[1][0] = 1;
    const ok = foldPairCounts(t, joints, 3)!;
    expect(ok.ballots).toBe(3);
    expect(ok.responses).toEqual([3, 3, 0]);
    // More answers on an item than people.
    expect(foldPairCounts(t, joints, 2)).toBeNull();
    // The wrong width.
    expect(foldPairCounts(t, [[1], [1], [1]], 1)).toBeNull();
  });

  it("toPairResult re-applies minN and holds no ids", () => {
    const t = tallyOf([
      [4, 6, 0],
      [4, 7, -1],
      [20, 6, -1],
    ]);
    const revealed = revealPairs(t, 3);
    const meta = {
      tool: "kano-model" as const,
      roundId: ROUND,
      closedAt: "2026-10-26T10:00:00.000Z",
      minN: 3,
      ballots: 3,
      source: "live" as const,
    };
    const r = toPairResult(PAIR_SHEET, revealed, meta);
    expect(r).toMatchObject({
      kind: "pair",
      tool: "kano-model",
      sheetId: "kano:round",
      answers: [...KANO_PAIR_ANSWERS],
      prompts: KANO_PAIR_PROMPTS,
      ballots: 3,
      minN: 3,
    });
    expect(r.items.map((x) => [x.id, x.responses, x.joint === null])).toEqual([
      ["dark", 3, false],
      ["export", 3, false],
      ["emoji", 1, true],
    ]);
    expect(JSON.stringify(r)).not.toMatch(/voted|ledger|acks|alice/);
    // A caller can't save a joint under minN: a higher minN withholds them all.
    const strict = toPairResult(PAIR_SHEET, revealed, { ...meta, minN: 4 });
    expect(strict.items.every((x) => x.joint === null)).toBe(true);
    // Nor a joint of the wrong size.
    const wrong = toPairResult(
      PAIR_SHEET,
      [{ responses: 3, joint: [3] }, revealed[1], revealed[2]],
      meta
    );
    expect(wrong.items[0].joint).toBeNull();
  });
});

describe("readPairState", () => {
  const revealedBody = () => {
    const t = tallyOf([
      [4, 6, 0],
      [4, 7, -1],
      [20, 6, -1],
    ]);
    return pairStateBody(HOST, KEYS, {
      phase: "revealed",
      ballots: 3,
      revealed: revealPairs(t, 3),
    });
  };

  it("accepts exactly what the host builds, open and revealed", () => {
    const open = pairStateBody(HOST, KEYS, { ballots: 1, acks: ["bid_00000001"] });
    expect(readPairState(wire(open), "kano-model")).toEqual({ ...open, sig: SIG });
    const body = revealedBody();
    expect(readPairState(wire(body), "kano-model")).toEqual({ ...body, sig: SIG });
  });

  it("refuses a scale state, a v1 body, another kind, and a scale tool", () => {
    const scale = JSON.parse(JSON.stringify({ ...stateBody(HOST, KEYS as never), sig: SIG }));
    expect(readPairState(scale, "kano-model")).toBeNull();
    const body = pairStateBody(HOST, KEYS);
    expect(readPairState(wire(body, { v: 1 }), "kano-model")).toBeNull();
    expect(readPairState(wire(body, { kind: "allocation" }), "kano-model")).toBeNull();
    expect(readPairState(wire(body, { tool: "health-check" }), "health-check" as never)).toBeNull();
    // A Phase 6 reader ignores a pair state.
    expect(readVoteState(wire(body), "kano-model")).toBeNull();
    expect(readVoteState(wire(body, { v: 1 }), "kano-model")).toBeNull();
  });

  it.each<[string, (r: Record<string, unknown>) => void]>([
    ["over 20,000 characters", (r) => (r.pad = "x".repeat(20_000))],
    ["six answers", (r) => (r.sheet as { answers: string[] }).answers.push("Other")],
    ["a duplicate answer", (r) => ((r.sheet as { answers: string[] }).answers[1] = "I like it")],
    ["no prompts", (r) => delete (r.sheet as Record<string, unknown>).prompts],
    [
      "a prompt with a bidi override",
      (r) => ((r.sheet as { prompts: Record<string, unknown> }).prompts.first = "If\u202e it has"),
    ],
    [
      "33 items",
      (r) => {
        (r.sheet as Record<string, unknown>).items = Array.from({ length: 33 }, (_, i) => ({
          id: `f${i}`,
          text: `F${i}`,
        }));
      },
    ],
    [
      "a non-boolean optional",
      (r) => ((r.sheet as { items: Record<string, unknown>[] }).items[0].optional = "yes"),
    ],
    ["results while open", (r) => (r.revealed = [])],
  ])("refuses %s", (_label, mutate) => {
    const raw = wire(pairStateBody(HOST, KEYS));
    mutate(raw);
    expect(readPairState(raw, "kano-model")).toBeNull();
  });

  it.each<[string, (rows: Record<string, unknown>[], r: Record<string, unknown>) => void]>([
    ["a joint under minN", (rows) => (rows[2].joint = [1, ...new Array(24).fill(0)])],
    ["a joint whose sum isn't its responses", (rows) => ((rows[0].joint as number[])[0] += 1)],
    ["a 5-cell joint", (rows) => (rows[0].joint = [3, 0, 0, 0, 0])],
    ["a required item answered by fewer than everyone", (rows) => (rows[0].responses = 2)],
    ["responses over the ballots", (rows) => (rows[2].responses = 4)],
    ["a missing item", (rows) => rows.pop()],
    ["a reveal under minN ballots", (_rows, r) => (r.ballots = 2)],
    ["acks after Reveal", (_rows, r) => (r.acks = ["bid_00000001"])],
  ])("refuses revealed results with %s", (_label, mutate) => {
    const raw = wire(revealedBody());
    mutate(raw.revealed as Record<string, unknown>[], raw);
    expect(readPairState(raw, "kano-model")).toBeNull();
  });
});

describe("signingInput for pair states", () => {
  it("is stable across key order, changes with the sheet, and signs under v2", () => {
    const body = pairStateBody(HOST, KEYS);
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(body).reverse()))
    ) as PairStateBody;
    const base = signingInput(VOTE_ROOM_EVENTS.state, body);
    expect(signingInput(VOTE_ROOM_EVENTS.state, reordered)).toBe(base);
    for (const v of [
      { ...body, sheet: { ...body.sheet, answers: body.sheet.answers.slice(0, 4) } },
      { ...body, sheet: { ...body.sheet, prompts: { ...body.sheet.prompts, second: "Other?" } } },
      { ...body, sheet: { ...body.sheet, items: body.sheet.items.slice(1) } },
      {
        ...body,
        sheet: {
          ...body.sheet,
          items: [{ ...body.sheet.items[0], optional: true }, ...body.sheet.items.slice(1)],
        },
      },
    ] as PairStateBody[]) {
      expect(signingInput(VOTE_ROOM_EVENTS.state, v)).not.toBe(base);
    }
    const parsed = JSON.parse(base) as unknown[];
    expect(parsed[0]).toBe("agile-toolkit:vote-room:v2");
    expect(parsed[9]).toBe("pair");
  });
});

describe("reading a joint", () => {
  const joint = new Array<number>(25).fill(0);
  joint[jointIndex(0, 4, P)] = 4; // like / dislike
  joint[jointIndex(1, 4, P)] = 2; // expect / dislike
  joint[jointIndex(2, 2, P)] = 1;

  it("pairCount, pairMarginals and commonPairs", () => {
    expect(pairCount(joint, P, 0, 4)).toBe(4);
    expect(pairMarginals(joint, P)).toEqual({ first: [4, 2, 1, 0, 0], second: [0, 0, 1, 0, 6] });
    expect(commonPairs(joint, P)).toEqual([{ first: 0, second: 4, count: 4 }]);
    const tie = joint.slice();
    tie[jointIndex(1, 4, P)] = 4;
    expect(commonPairs(tie, P)).toHaveLength(2);
    expect(commonPairs(new Array(25).fill(0), P)).toEqual([]);
  });

  it("pairRoundMarkdown has a grid per item and says when one is withheld", () => {
    const r = toPairResult(
      PAIR_SHEET,
      [
        { responses: 7, joint },
        { responses: 7, joint },
        { responses: 2, joint: null },
      ],
      {
        tool: "kano-model",
        roundId: ROUND,
        closedAt: "2026-10-26T10:00:00.000Z",
        minN: 3,
        ballots: 7,
        source: "facilitator",
      }
    );
    const md = pairRoundMarkdown(r);
    expect(md).toContain("# Feature survey");
    expect(md).toContain(
      "7 people entered by hand, 2026-10-26. An item shows its results from 3 answers."
    );
    expect(md).toContain("## 1. Dark mode");
    expect(md).toContain("| I like it | 0 | 0 | 0 | 0 | 4 |");
    expect(md).toContain("## 3. Emoji reactions");
    expect(md).toContain("Withheld: 2 answers, fewer than 3.");
  });
});
