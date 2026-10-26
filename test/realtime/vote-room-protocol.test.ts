import { describe, expect, it } from "vitest";
import {
  ANSWER_ALPHABET,
  VOTE_LIMITS,
  VOTE_ROOM_EVENTS,
  VOTE_ROOM_TOOLS,
  ballotCiphertextChars,
  encodeAnswers,
  isVoteRoomTool,
  readAnswerString,
  readBallotEnvelope,
  readVoteEnd,
  readVoteKick,
  readVoteState,
  signingInput,
  toWireQuestionnaire,
  type Questionnaire,
  type VoteStateBody,
} from "@/lib/realtime/vote-room/protocol";
import { VISITOR_ROOM_KIND, VISITOR_TOOLS } from "@/lib/realtime/visitor-rooms";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { QUESTIONNAIRE, ROUND, stateBody } from "./vote-room-fixtures";

/**
 * The vote-round wire protocol: every reader accepts exactly what a host
 * builds and refuses everything else, field for field.
 */

const HOST = "host_00000000000";
const OTHER = "other_0000000000";
const KEYS = {
  publicKeys: { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` },
} as unknown as Parameters<typeof stateBody>[1];
const SIG = "s".repeat(86);

/** A state as the host builds it, plus a signature, through JSON like the wire. */
function wire(body: VoteStateBody, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ ...body, sig: SIG, ...extra })) as Record<string, unknown>;
}

function open(o: Parameters<typeof stateBody>[2] = {}) {
  return stateBody(HOST, KEYS, o);
}

function revealedState() {
  return open({
    phase: "revealed",
    ballots: 4,
    revealed: [
      { responses: 4, distribution: [2, 1, 1] },
      { responses: 3, distribution: [0, 0, 3] },
      { responses: 2, distribution: null },
    ],
  });
}

describe("vote tools", () => {
  it("are exactly the visitor tools whose room kind is vote", () => {
    expect([...VOTE_ROOM_TOOLS]).toEqual(
      VISITOR_TOOLS.filter((t) => VISITOR_ROOM_KIND[t] === "vote")
    );
    expect(isVoteRoomTool("health-check")).toBe(true);
    for (const t of ["retro", "planning-poker", "kudos", "", null, 3])
      expect(isVoteRoomTool(t)).toBe(false);
  });

  it("use minN 3 by default and 5 for Psych Safety, from MIN_SAMPLE", () => {
    expect(VOTE_LIMITS.minNFloor).toBe(MIN_SAMPLE.anonymous);
    expect(VOTE_LIMITS.minNFloor).toBe(3);
    expect(VOTE_LIMITS.minNPsychSafety).toBe(MIN_SAMPLE.psychSafety);
    expect(VOTE_LIMITS.minNPsychSafety).toBe(5);
    expect(VOTE_LIMITS.maxBallotsPerRound).toBe(60);
    expect(ANSWER_ALPHABET).toHaveLength(VOTE_LIMITS.maxPoints);
  });
});

describe("readVoteState", () => {
  it("accepts exactly what the host builds, field for field", () => {
    const body = open({ acks: ["bid_00000001"], ballots: 1 });
    expect(readVoteState(wire(body), "health-check")).toEqual({ ...body, sig: SIG });
    const rev = revealedState();
    expect(readVoteState(wire(rev), "health-check")).toEqual({ ...rev, sig: SIG });
  });

  it("drops unknown fields", () => {
    const msg = readVoteState(
      wire(open(), {
        extra: "x",
        questionnaire: { ...QUESTIONNAIRE, colour: "#f00" },
      }),
      "health-check"
    );
    expect(msg).not.toBeNull();
    expect(msg).not.toHaveProperty("extra");
    expect(msg?.questionnaire).not.toHaveProperty("colour");
  });

  it("refuses anything over 20,000 characters", () => {
    const body = open();
    const big = wire(body, { pad: "x".repeat(VOTE_LIMITS.maxPayloadChars) });
    expect(readVoteState(big, "health-check")).toBeNull();
  });

  it.each([
    ["a wrong version", { v: 2 }],
    ["another page's tool", { tool: "psych-safety" }],
    ["a non-visitor sender", { by: "short" }],
    ["a malformed round id", { roundId: "short" }],
    ["a negative seq", { seq: -1 }],
    ["a fractional seq", { seq: 1.5 }],
    ["minN under 3", { minN: 2 }],
    ["minN over 20", { minN: 21 }],
    ["a fractional minN", { minN: 3.5 }],
    ["a bad endsAt", { endsAt: 0 }],
    ["a short signing key", { keys: { sig: "A".repeat(86), ecdh: "C".repeat(87) } }],
    ["a long encryption key", { keys: { sig: "A".repeat(87), ecdh: "C".repeat(88) } }],
    ["a missing signature", { sig: undefined }],
    ["a short signature", { sig: "s".repeat(85) }],
    ["an unknown phase", { phase: "closed" }],
    ["too many ballots", { ballots: VOTE_LIMITS.maxBallotsPerRound + 1 }],
    ["too many acks", { acks: Array.from({ length: 65 }, () => "bid_00000001") }],
    ["a malformed ack", { acks: ["nope"] }],
    ["revealed results while open", { revealed: [] }],
  ])("refuses %s", (_label, patch) => {
    expect(readVoteState(wire(open(), patch), "health-check")).toBeNull();
  });

  it("refuses an array, null and strings", () => {
    for (const raw of [null, "x", [wire(open())], 5]) {
      expect(readVoteState(raw, "health-check")).toBeNull();
    }
  });

  describe("the questionnaire", () => {
    const withQ = (q: unknown) => wire(open(), { questionnaire: q });

    it("refuses more than 32 questions", () => {
      const questions = Array.from({ length: 33 }, (_, i) => ({ id: `q${i}`, text: `Q ${i}` }));
      expect(readVoteState(withQ({ ...QUESTIONNAIRE, questions }), "health-check")).toBeNull();
    });

    it("refuses no questions", () => {
      expect(readVoteState(withQ({ ...QUESTIONNAIRE, questions: [] }), "health-check")).toBeNull();
    });

    it("refuses more than 11 points, or fewer than 2", () => {
      const points = Array.from({ length: 12 }, (_, i) => ({ value: i, label: `P${i}` }));
      expect(
        readVoteState(withQ({ ...QUESTIONNAIRE, scale: { id: "s", points } }), "health-check")
      ).toBeNull();
      expect(
        readVoteState(
          withQ({ ...QUESTIONNAIRE, scale: { id: "s", points: [{ value: 1, label: "One" }] } }),
          "health-check"
        )
      ).toBeNull();
    });

    it("refuses duplicate question ids and duplicate point values", () => {
      const dupQ = [
        { id: "a", text: "A" },
        { id: "a", text: "B" },
      ];
      expect(
        readVoteState(withQ({ ...QUESTIONNAIRE, questions: dupQ }), "health-check")
      ).toBeNull();
      const dupV = [
        { value: 1, label: "One" },
        { value: 1, label: "Uno" },
      ];
      expect(
        readVoteState(withQ({ ...QUESTIONNAIRE, scale: { id: "s", points: dupV } }), "health-check")
      ).toBeNull();
    });

    it("refuses point values outside -100..100 or not whole", () => {
      for (const value of [101, -101, 1.5]) {
        const points = [
          { value, label: "Odd" },
          { value: 0, label: "Zero" },
        ];
        expect(
          readVoteState(withQ({ ...QUESTIONNAIRE, scale: { id: "s", points } }), "health-check")
        ).toBeNull();
      }
    });

    it.each([
      ["a title", (s: string) => ({ ...QUESTIONNAIRE, title: s })],
      ["a question", (s: string) => ({ ...QUESTIONNAIRE, questions: [{ id: "q", text: s }] })],
      [
        "a hint",
        (s: string) => ({ ...QUESTIONNAIRE, questions: [{ id: "q", text: "Q", hint: s }] }),
      ],
      [
        "a point label",
        (s: string) => ({
          ...QUESTIONNAIRE,
          scale: {
            id: "s",
            points: [
              { value: 1, label: s },
              { value: 0, label: "No" },
            ],
          },
        }),
      ],
    ])("refuses control or bidi characters in %s", (_label, make) => {
      for (const bad of ["Fine‮evil", "Tab\u0007bell", "⁦isolate⁩"]) {
        expect(readVoteState(withQ(make(bad)), "health-check")).toBeNull();
      }
    });

    it("refuses text longer than its cap, an empty hint, and a non-boolean optional", () => {
      expect(
        readVoteState(withQ({ ...QUESTIONNAIRE, title: "t".repeat(121) }), "health-check")
      ).toBeNull();
      expect(
        readVoteState(
          withQ({ ...QUESTIONNAIRE, questions: [{ id: "q", text: "Q", hint: "" }] }),
          "health-check"
        )
      ).toBeNull();
      expect(
        readVoteState(
          withQ({ ...QUESTIONNAIRE, questions: [{ id: "q", text: "Q", optional: "yes" }] }),
          "health-check"
        )
      ).toBeNull();
    });
  });

  describe("revealed results", () => {
    it("refuses a distribution under minN", () => {
      const rev = revealedState();
      const bad = {
        ...rev,
        revealed: [rev.revealed![0], rev.revealed![1], { responses: 2, distribution: [1, 1, 0] }],
      };
      expect(readVoteState(wire(bad), "health-check")).toBeNull();
    });

    it("refuses a distribution whose sum isn't its responses", () => {
      const rev = revealedState();
      const bad = {
        ...rev,
        revealed: [{ responses: 4, distribution: [2, 1, 0] }, ...rev.revealed!.slice(1)],
      };
      expect(readVoteState(wire(bad), "health-check")).toBeNull();
    });

    it("refuses the wrong number of questions or points, and responses over the ballots", () => {
      const rev = revealedState();
      expect(
        readVoteState(wire({ ...rev, revealed: rev.revealed!.slice(0, 2) }), "health-check")
      ).toBeNull();
      const wrongPoints = {
        ...rev,
        revealed: [{ responses: 4, distribution: [2, 1, 1, 0] }, ...rev.revealed!.slice(1)],
      };
      expect(readVoteState(wire(wrongPoints), "health-check")).toBeNull();
      const tooMany = {
        ...rev,
        revealed: [{ responses: 5, distribution: [3, 1, 1] }, ...rev.revealed!.slice(1)],
      };
      expect(readVoteState(wire(tooMany), "health-check")).toBeNull();
    });

    it("refuses a revealed round with fewer ballots than minN, with acks, or with no results", () => {
      const rev = revealedState();
      expect(readVoteState(wire({ ...rev, ballots: 2 }), "health-check")).toBeNull();
      expect(readVoteState(wire({ ...rev, acks: ["bid_00000001"] }), "health-check")).toBeNull();
      expect(readVoteState(wire({ ...rev, revealed: null }), "health-check")).toBeNull();
    });
  });
});

describe("readBallotEnvelope", () => {
  const env = {
    v: 1,
    by: OTHER,
    roundId: ROUND,
    bid: "bid_00000001",
    epk: "B".repeat(87),
    iv: "i".repeat(16),
    ct: "c".repeat(ballotCiphertextChars(3)),
  };

  it("accepts a well-formed envelope and drops extra fields", () => {
    expect(readBallotEnvelope({ ...env, answers: "012" })).toEqual(env);
  });

  it.each([
    ["a wrong version", { v: 0 }],
    ["a bad sender", { by: "x" }],
    ["a bad round id", { roundId: "r" }],
    ["a bad ballot id", { bid: "b".repeat(13) }],
    ["a short ephemeral key", { epk: "B".repeat(86) }],
    ["a long nonce", { iv: "i".repeat(17) }],
    ["a ciphertext too short to hold an answer", { ct: "c".repeat(ballotCiphertextChars(1) - 1) }],
    ["a ciphertext over 128 characters", { ct: "c".repeat(129) }],
    ["a ciphertext outside base64url", { ct: `${"c".repeat(30)}+/` }],
  ])("refuses %s", (_label, patch) => {
    expect(readBallotEnvelope({ ...env, ...patch })).toBeNull();
  });

  it("sizes ciphertexts as answers plus the 16-byte tag, in base64url", () => {
    expect(ballotCiphertextChars(1)).toBe(23); // 17 bytes
    expect(ballotCiphertextChars(2)).toBe(24); // 18 bytes
    expect(ballotCiphertextChars(32)).toBe(64); // 48 bytes
    expect(ballotCiphertextChars(VOTE_LIMITS.maxQuestions)).toBeLessThanOrEqual(
      VOTE_LIMITS.maxCiphertextChars
    );
  });
});

describe("readVoteKick and readVoteEnd", () => {
  it("accept signed host messages and refuse unsigned or malformed ones", () => {
    expect(readVoteKick({ v: 1, by: HOST, id: OTHER, sig: SIG, x: 1 })).toEqual({
      v: 1,
      by: HOST,
      id: OTHER,
      sig: SIG,
    });
    expect(readVoteKick({ v: 1, by: HOST, id: OTHER })).toBeNull();
    expect(readVoteKick({ by: HOST, id: OTHER, sig: SIG })).toBeNull();
    expect(readVoteKick({ v: 1, by: HOST, id: "x", sig: SIG })).toBeNull();
    expect(readVoteEnd({ v: 1, by: HOST, reason: "idle", sig: SIG })).toEqual({
      v: 1,
      by: HOST,
      reason: "idle",
      sig: SIG,
    });
    expect(readVoteEnd({ v: 1, by: HOST, reason: "bored", sig: SIG })).toBeNull();
    expect(readVoteEnd({ v: 1, by: HOST, reason: "host" })).toBeNull();
  });
});

describe("signingInput", () => {
  it("is stable whatever the key order", () => {
    const body = revealedState();
    const shuffled = Object.fromEntries(Object.entries(body).reverse()) as unknown as VoteStateBody;
    const q = body.questionnaire;
    const qShuffled = {
      questions: q.questions.map((x) => Object.fromEntries(Object.entries(x).reverse())),
      scale: {
        points: q.scale.points.map((p) => ({ label: p.label, value: p.value })),
        id: q.scale.id,
      },
      title: q.title,
      id: q.id,
    } as unknown as Questionnaire;
    expect(signingInput(VOTE_ROOM_EVENTS.state, { ...shuffled, questionnaire: qShuffled })).toBe(
      signingInput(VOTE_ROOM_EVENTS.state, body)
    );
  });

  it("changes with any field, and differs between events", () => {
    const body = open();
    const base = signingInput(VOTE_ROOM_EVENTS.state, body);
    expect(signingInput(VOTE_ROOM_EVENTS.state, { ...body, ballots: 1 })).not.toBe(base);
    expect(signingInput(VOTE_ROOM_EVENTS.state, { ...body, seq: 2 })).not.toBe(base);
    expect(
      signingInput(VOTE_ROOM_EVENTS.state, {
        ...body,
        questionnaire: { ...body.questionnaire, title: "Other" },
      })
    ).not.toBe(base);
    const kick = { v: 1 as const, by: HOST, id: OTHER };
    expect(signingInput(VOTE_ROOM_EVENTS.kick, kick)).not.toBe(
      signingInput(VOTE_ROOM_EVENTS.end, { v: 1, by: HOST, reason: "host" })
    );
    // A body under the wrong event signs as a mismatch.
    expect(signingInput(VOTE_ROOM_EVENTS.end, kick)).toContain("mismatch");
  });
});

describe("toWireQuestionnaire", () => {
  it("rebuilds the questionnaire field by field", () => {
    const wireQ = toWireQuestionnaire({
      ...QUESTIONNAIRE,
      extra: "dropped",
    } as unknown as Questionnaire);
    expect(wireQ).toEqual(QUESTIONNAIRE);
    // What the host shares, participants accept.
    expect(readVoteState(wire(open({ questionnaire: wireQ! })), "health-check")).not.toBeNull();
  });

  it("strips bidi and control characters from the host's own text and keeps one line", () => {
    const wireQ = toWireQuestionnaire({
      ...QUESTIONNAIRE,
      title: "Squad‮ health\n  check",
      questions: [{ id: "q", text: "Fun⁦ at\twork", hint: "‏hint" }],
    });
    expect(wireQ?.title).toBe("Squad health check");
    expect(wireQ?.questions[0]).toEqual({ id: "q", text: "Fun at work", hint: "hint" });
    expect(readVoteState(wire(open({ questionnaire: wireQ! })), "health-check")).not.toBeNull();
  });

  it("cuts long text to the caps", () => {
    const wireQ = toWireQuestionnaire({
      ...QUESTIONNAIRE,
      title: "t".repeat(500),
      questions: [{ id: "q", text: "q".repeat(500), hint: "h".repeat(500) }],
    });
    expect(wireQ?.title).toHaveLength(VOTE_LIMITS.maxTitleChars);
    expect(wireQ?.questions[0].text).toHaveLength(VOTE_LIMITS.maxQuestionChars);
    expect(wireQ?.questions[0].hint).toHaveLength(VOTE_LIMITS.maxHintChars);
  });

  it("is null for what can't be shared", () => {
    const bad: Questionnaire[] = [
      { ...QUESTIONNAIRE, id: "has spaces" },
      { ...QUESTIONNAIRE, title: "‮" },
      { ...QUESTIONNAIRE, questions: [] },
      { ...QUESTIONNAIRE, questions: [{ id: "q", text: "   " }] },
      { ...QUESTIONNAIRE, scale: { id: "s", points: [{ value: 1, label: "One" }] } },
      {
        ...QUESTIONNAIRE,
        scale: {
          id: "s",
          points: [
            { value: 1, label: "One" },
            { value: 1, label: "Uno" },
          ],
        },
      },
    ];
    for (const q of bad) expect(toWireQuestionnaire(q)).toBeNull();
  });
});

describe("answers", () => {
  it("encodeAnswers needs every required answer and refuses off-scale values", () => {
    expect(encodeAnswers({ fun: 2, speed: 0, learning: 1 }, QUESTIONNAIRE)).toBe("021");
    // The optional question may be skipped.
    expect(encodeAnswers({ fun: 1, speed: 1, learning: null }, QUESTIONNAIRE)).toBe("11-");
    expect(encodeAnswers({ fun: 1, speed: 1 }, QUESTIONNAIRE)).toBe("11-");
    expect(encodeAnswers({ fun: 1, speed: null, learning: 2 }, QUESTIONNAIRE)).toBeNull();
    expect(encodeAnswers({ fun: 7, speed: 1 }, QUESTIONNAIRE)).toBeNull();
    const allOptional = {
      ...QUESTIONNAIRE,
      questions: QUESTIONNAIRE.questions.map((q) => ({ ...q, optional: true })),
    };
    expect(encodeAnswers({}, allOptional)).toBeNull();
  });

  it("readAnswerString enforces the fixed length and the alphabet, with '-' only on optional questions", () => {
    expect(readAnswerString("021", QUESTIONNAIRE)).toEqual([0, 2, 1]);
    expect(readAnswerString("11-", QUESTIONNAIRE)).toEqual([1, 1, -1]);
    for (const bad of ["02", "0210", "-21", "0-1", "03a", "0 1", "---"]) {
      expect(readAnswerString(bad, QUESTIONNAIRE)).toBeNull();
    }
  });

  it("round-trips every draft through the answer string", () => {
    const draft = { fun: 0, speed: 2, learning: null };
    const encoded = encodeAnswers(draft, QUESTIONNAIRE)!;
    expect(encoded).toHaveLength(QUESTIONNAIRE.questions.length);
    expect(readAnswerString(encoded, QUESTIONNAIRE)).toEqual([2, 0, -1]);
  });
});
