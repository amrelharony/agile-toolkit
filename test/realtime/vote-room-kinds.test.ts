import { describe, expect, it } from "vitest";
import {
  VOTE_ROOM_EVENTS,
  readVoteState,
  signingInput,
  type VoteStateBody,
} from "@/lib/realtime/vote-room/protocol";
import { emptyLedger, type FoldContext } from "@/lib/realtime/vote-room/aggregate";
import {
  canRevealCounts,
  emptyCounts,
  encodeDraft,
  isAllocationResult,
  isPairResult,
  isScaleResult,
  openPlain,
  readRoundState,
  resultKind,
  revealCounts,
  revealedOfState,
  roundKindOf,
  roundResult,
  specCiphertextChars,
  specOfState,
  specTitle,
  stateBodyFor,
  wireSpec,
  type RoundSpec,
  type RoundStateHead,
} from "@/lib/realtime/vote-room/kinds";
import { pairDraftKey } from "@/lib/realtime/vote-room/pair";
import {
  ALLOCATION_SHEET,
  PAIR_SHEET,
  QUESTIONNAIRE,
  ROUND,
  allocationString,
  pairString,
  stateBody,
} from "./vote-room-fixtures";

/** Unpadded base64url length of `bytes` bytes. */
const b64urlChars = (bytes: number) =>
  Math.floor(bytes / 3) * 4 + (bytes % 3 === 0 ? 0 : (bytes % 3) + 1);

/**
 * The kind dispatch the room hook runs on: a tool's kind is fixed, nothing
 * mixes kinds, and a Phase 6 scale round's state is the v1 body it always
 * was, field for field, in the same order, signed the same way.
 */

const HOST = "host_00000000000";
const KEYS = { publicKeys: { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` } };
const SIG = "s".repeat(86);

const head = (
  tool: RoundStateHead["tool"],
  over: Partial<RoundStateHead> = {}
): RoundStateHead => ({
  by: HOST,
  seq: 1,
  tool,
  roundId: ROUND,
  endsAt: 1_800_000_000_000,
  minN: 3,
  keys: KEYS.publicKeys,
  phase: "open",
  ballots: 0,
  acks: [],
  ...over,
});

const ctx: FoldContext = {
  open: true,
  roundId: ROUND,
  admitted: new Set(["a", "b", "c", HOST]),
  removed: new Set(),
};

const SCALE: RoundSpec = { kind: "scale", questionnaire: QUESTIONNAIRE };
const PAIR: RoundSpec = { kind: "pair", sheet: PAIR_SHEET };
const ALLOC: RoundSpec = { kind: "allocation", sheet: ALLOCATION_SHEET };

describe("a tool's kind", () => {
  it("comes from the tool, and is null outside the kit", () => {
    expect(roundKindOf("health-check")).toBe("scale");
    expect(roundKindOf("kano-model")).toBe("pair");
    expect(roundKindOf("buy-a-feature")).toBe("allocation");
    expect(roundKindOf("hundred-dollar-test")).toBe("allocation");
    expect(roundKindOf("retro")).toBeNull();
    expect(roundKindOf(undefined)).toBeNull();
  });

  it("wireSpec checks the input as its kind and refuses another kind", () => {
    expect(wireSpec("scale", QUESTIONNAIRE)).toEqual({ ok: true, spec: SCALE });
    expect(wireSpec("pair", PAIR_SHEET)).toEqual({ ok: true, spec: PAIR });
    expect(wireSpec("allocation", ALLOCATION_SHEET)).toEqual({ ok: true, spec: ALLOC });
    for (const [kind, input] of [
      ["scale", ALLOCATION_SHEET],
      ["allocation", QUESTIONNAIRE],
      ["pair", ALLOCATION_SHEET],
      ["allocation", PAIR_SHEET],
    ] as const) {
      expect(wireSpec(kind, input)).toEqual({
        ok: false,
        problem: "This tool runs another kind of round.",
      });
    }
    expect(wireSpec("allocation", { ...ALLOCATION_SHEET, budget: 5 })).toMatchObject({ ok: false });
    expect(wireSpec("scale", null)).toMatchObject({ ok: false });
    expect(specTitle(ALLOC)).toBe(ALLOCATION_SHEET.title);
  });
});

describe("v1 compatibility: a Phase 6 scale round", () => {
  it("builds exactly the Phase 6 state body, key for key and in the same order", () => {
    const body = stateBodyFor(
      SCALE,
      head("health-check", { ballots: 2, acks: ["bid_00000001"] }),
      null
    );
    const phase6: VoteStateBody = {
      v: 1,
      by: HOST,
      seq: 1,
      tool: "health-check",
      roundId: ROUND,
      endsAt: 1_800_000_000_000,
      minN: 3,
      questionnaire: QUESTIONNAIRE,
      keys: KEYS.publicKeys,
      phase: "open",
      ballots: 2,
      acks: ["bid_00000001"],
      revealed: null,
    };
    expect(JSON.stringify(body)).toBe(JSON.stringify(phase6));
    expect(signingInput(VOTE_ROOM_EVENTS.state, body!)).toBe(
      signingInput(VOTE_ROOM_EVENTS.state, phase6)
    );
  });

  it("signs exactly as Phase 6 did", () => {
    const body = stateBody(HOST, KEYS as never);
    // The v1 signed text, written out as Phase 6's signingInput built it.
    const expected = JSON.stringify([
      "agile-toolkit:vote-room:v1",
      "vote:state",
      1,
      HOST,
      body.seq,
      body.tool,
      body.roundId,
      body.endsAt,
      body.minN,
      [
        QUESTIONNAIRE.id,
        QUESTIONNAIRE.title,
        QUESTIONNAIRE.scale.id,
        QUESTIONNAIRE.scale.points.map((p) => [p.value, p.label]),
        QUESTIONNAIRE.questions.map((x) => [x.id, x.text, x.hint ?? null, x.optional === true]),
      ],
      KEYS.publicKeys.sig,
      KEYS.publicKeys.ecdh,
      "open",
      0,
      [],
      null,
    ]);
    expect(signingInput(VOTE_ROOM_EVENTS.state, body)).toBe(expected);
    expect(signingInput(VOTE_ROOM_EVENTS.kick, { v: 1, by: HOST, id: "x" })).toBe(
      JSON.stringify(["agile-toolkit:vote-room:v1", "vote:kick", 1, HOST, "x"])
    );
  });

  it("reads identically through readRoundState and readVoteState", () => {
    const raw = JSON.parse(
      JSON.stringify({
        ...stateBody(HOST, KEYS as never, {
          phase: "revealed",
          ballots: 3,
          revealed: [
            { responses: 3, distribution: [1, 1, 1] },
            { responses: 3, distribution: [0, 0, 3] },
            { responses: 1, distribution: null },
          ],
        }),
        sig: SIG,
      })
    );
    const direct = readVoteState(raw, "health-check");
    expect(direct).not.toBeNull();
    expect(readRoundState(raw, "health-check")).toEqual(direct);
    expect(specOfState(direct!)).toEqual(SCALE);
    expect(revealedOfState(direct!)).toEqual({ kind: "scale", rows: direct!.revealed });
  });

  it("refuses to build or read across kinds", () => {
    expect(stateBodyFor(SCALE, head("kano-model"), null)).toBeNull();
    expect(stateBodyFor(ALLOC, head("health-check"), null)).toBeNull();
    expect(stateBodyFor(PAIR, head("buy-a-feature"), null)).toBeNull();
    const pairBody = stateBodyFor(PAIR, head("kano-model"), null)!;
    const raw = JSON.parse(JSON.stringify({ ...pairBody, sig: SIG }));
    expect(readRoundState(raw, "kano-model")).not.toBeNull();
    expect(readRoundState(raw, "health-check")).toBeNull();
    expect(readRoundState(raw, "hundred-dollar-test")).toBeNull();
    expect(readRoundState(raw, "retro" as never)).toBeNull();
  });
});

describe("a round of each kind, end to end through the dispatch", () => {
  it.each<[string, RoundSpec, Record<string, number | null>[], string[]]>([
    [
      "scale",
      SCALE,
      [
        { fun: 2, speed: 0, learning: 1 },
        { fun: 1, speed: 0, learning: null },
        { fun: 2, speed: 1, learning: null },
      ],
      ["021", "12-", "01-"],
    ],
    [
      "pair",
      PAIR,
      [0, 1, 2].map((k) => ({
        [pairDraftKey("dark", "first")]: 0,
        [pairDraftKey("dark", "second")]: 4,
        [pairDraftKey("export", "first")]: k,
        [pairDraftKey("export", "second")]: k,
        [pairDraftKey("emoji", "first")]: null,
        [pairDraftKey("emoji", "second")]: null,
      })),
      [pairString([4, 0, -1]), pairString([4, 6, -1]), pairString([4, 12, -1])],
    ],
    [
      "allocation",
      ALLOC,
      [
        { search: 40, export: 30, sso: 20, themes: 10 },
        { search: 100 },
        { search: 25, export: 25, sso: 25, themes: 25 },
      ],
      [
        allocationString([40, 30, 20, 10], 3),
        allocationString([100, 0, 0, 0], 3),
        allocationString([25, 25, 25, 25], 3),
      ],
    ],
  ])("%s: encode, open, fold, reveal and save", (_label, spec, drafts, plains) => {
    let counts = emptyCounts(ROUND, spec);
    let ledger = emptyLedger();
    drafts.forEach((d, i) => {
      const plain = encodeDraft(spec, d);
      expect(plain).toBe(plains[i]);
      // The sealed size depends only on the round, never on the answers.
      expect(specCiphertextChars(spec)).toBe(b64urlChars(plain!.length + 16));
      const res = openPlain(spec, counts, ledger, ["a", "b", "c"][i], plain!, ctx)!;
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      counts = res.counts;
      ledger = res.ledger;
    });
    // A plaintext that isn't an answer for this round is dropped (null), not refused.
    expect(openPlain(spec, counts, emptyLedger(), HOST, "zz", ctx)).toBeNull();
    // Counts of another kind never fold.
    const other = emptyCounts(ROUND, spec.kind === "scale" ? ALLOC : SCALE);
    expect(openPlain(spec, other, emptyLedger(), HOST, plains[0], ctx)).toBeNull();

    expect(canRevealCounts(counts, 3)).toBe(true);
    expect(canRevealCounts(counts, 4)).toBe(false);
    expect(revealCounts(counts, 4)).toBeNull();
    const revealed = revealCounts(counts, 3)!;
    expect(revealed.kind).toBe(spec.kind);
    const tool =
      spec.kind === "scale"
        ? "health-check"
        : spec.kind === "pair"
          ? "kano-model"
          : "hundred-dollar-test";
    const result = roundResult(spec, revealed, {
      tool,
      roundId: ROUND,
      closedAt: "2026-10-26T10:00:00.000Z",
      minN: 3,
      ballots: 3,
      source: "live",
    })!;
    expect(resultKind(result)).toBe(spec.kind);
    expect([isScaleResult(result), isPairResult(result), isAllocationResult(result)]).toEqual([
      spec.kind === "scale",
      spec.kind === "pair",
      spec.kind === "allocation",
    ]);
    // Another kind's tool gets nothing.
    expect(
      roundResult(spec, revealed, {
        tool: spec.kind === "scale" ? "kano-model" : "health-check",
        roundId: ROUND,
        closedAt: "2026-10-26T10:00:00.000Z",
        minN: 3,
        ballots: 3,
        source: "live",
      })
    ).toBeNull();

    // The revealed state carries the results and reads back as the same spec.
    const body = stateBodyFor(spec, head(tool, { phase: "revealed", ballots: 3 }), revealed)!;
    const raw = JSON.parse(JSON.stringify({ ...body, sig: SIG }));
    const read = readRoundState(raw, tool)!;
    expect(read).not.toBeNull();
    expect(specOfState(read)).toEqual(spec);
    expect(revealedOfState(read)).toEqual(revealed);
    // While open, no results ride along.
    const open = stateBodyFor(spec, head(tool), revealed)!;
    expect(open.revealed).toBeNull();
  });
});
