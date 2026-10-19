import { describe, expect, it } from "vitest";
import { retroFormats } from "@/lib/constants/retro-formats";
import { createAdmissionLedger, VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import {
  applyIntent,
  applyPatch,
  createIntentLedger,
  type IntentContext,
  type IntentLedger,
} from "@/app/(tools)/retro/room/intents";
import {
  BOARD_CARD_CAP,
  INTENT_ID_RING,
  MEMBER_CARD_CAP,
  type RetroIntent,
} from "@/app/(tools)/retro/room/protocol";
import { MAX_VOTES, type BoardState, type RetroCard } from "@/app/(tools)/retro/types";

/**
 * The host's intent reducer for the Retro visitor room: every participant
 * message is untrusted, so the reducer alone decides what reaches the board.
 */

const ALICE = "alice_0000000000";
const BOB = "bob_000000000000";
const MALLORY = "mallory_00000000";

const format = retroFormats[0]; // Start / Stop / Continue

function card(id: string, overrides: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey: "start",
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...overrides,
  };
}

function board(overrides: Partial<BoardState> = {}): BoardState {
  return {
    format,
    phase: "write",
    cards: [card("c1"), card("c2", { columnKey: "stop" })],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...overrides,
  };
}

let ids = 0;
function ctx(overrides: Partial<IntentContext> = {}): IntentContext {
  return {
    admitted: new Set([ALICE, BOB]),
    removed: new Set(),
    newCardId: () => `host-card-${++ids}`,
    ...overrides,
  };
}

let iids = 0;
const nextIid = () => `iid${++iids}`;

function add(by: string, columnKey: string, text: string, iid = nextIid()) {
  const intent: RetroIntent = { t: "card:add", iid, columnKey, text };
  return { v: 1, by, intent };
}

function vote(by: string, cardId: string, iid = nextIid()) {
  const intent: RetroIntent = { t: "vote", iid, cardId };
  return { v: 1, by, intent };
}

/** Apply a list of envelopes in order, threading board and ledger. */
function run(start: BoardState, envs: unknown[], c: IntentContext = ctx()) {
  let b = start;
  let ledger: IntentLedger = createIntentLedger();
  const reasons: string[] = [];
  for (const env of envs) {
    const res = applyIntent(b, ledger, env, c);
    if (res.ok) {
      b = res.board;
      ledger = res.ledger;
      reasons.push("ok");
    } else {
      reasons.push(res.reason);
    }
  }
  return { board: b, ledger, reasons };
}

describe("applyIntent: adding cards", () => {
  it("adds a cleaned card with a host-made id and counts it for the sender", () => {
    const start = board();
    const res = applyIntent(
      start,
      createIntentLedger(),
      add(ALICE, "stop", "  Too   many\nmeetings  "),
      ctx({ newCardId: () => "host-id" })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const added = res.board.cards.at(-1);
    expect(added).toEqual({
      id: "host-id",
      columnKey: "stop",
      text: "Too many meetings",
      votes: 0,
      groupedWith: null,
      isActionItem: false,
      assignee: "",
      discussing: false,
    });
    expect(res.ledger.cardsBy[ALICE]).toBe(1);
    expect(res.patch).toEqual({ t: "card:add", card: added });
    // Pure: the inputs are untouched.
    expect(start.cards).toHaveLength(2);
  });

  it("only takes cards in the Write phase", () => {
    for (const phase of ["vote", "discuss", "actions"] as const) {
      const res = applyIntent(
        board({ phase }),
        createIntentLedger(),
        add(ALICE, "start", "Hi"),
        ctx()
      );
      expect(res).toEqual({ ok: false, reason: "wrong-phase" });
    }
  });

  it("refuses a column the board doesn't have", () => {
    const res = applyIntent(board(), createIntentLedger(), add(ALICE, "liked", "Hi"), ctx());
    expect(res).toEqual({ ok: false, reason: "unknown-column" });
  });

  it("cuts text to 500 characters and refuses empty, control or bidi text", () => {
    const long = applyIntent(
      board(),
      createIntentLedger(),
      add(ALICE, "start", "x".repeat(900)),
      ctx()
    );
    expect(long.ok && long.board.cards.at(-1)?.text.length).toBe(VISITOR_LIMITS.maxTextChars);

    const bad = [
      "",
      "   \n\t  ",
      "Pay ‮ecivni‬ now", // right-to-left override
      "safe⁦text", // isolate
      "bell\u0007", // C0 control
      "‏marked", // RLM
    ];
    for (const text of bad) {
      const res = applyIntent(board(), createIntentLedger(), add(ALICE, "start", text), ctx());
      expect(res).toEqual({ ok: false, reason: "bad-text" });
    }
  });

  it("refuses raw text far over the cap before cleaning it", () => {
    const res = applyIntent(
      board(),
      createIntentLedger(),
      add(ALICE, "start", "y".repeat(2_001)),
      ctx()
    );
    expect(res).toEqual({ ok: false, reason: "bad-shape" });
  });

  it(`caps each member at ${MEMBER_CARD_CAP} cards, without affecting anyone else`, () => {
    const envs = Array.from({ length: MEMBER_CARD_CAP + 1 }, (_, i) =>
      add(ALICE, "start", `A${i}`)
    );
    envs.push(add(BOB, "start", "Bob's first"));
    const { board: b, ledger, reasons } = run(board({ cards: [] }), envs);
    expect(reasons.slice(0, MEMBER_CARD_CAP).every((r) => r === "ok")).toBe(true);
    expect(reasons[MEMBER_CARD_CAP]).toBe("member-card-cap");
    expect(reasons.at(-1)).toBe("ok");
    expect(ledger.cardsBy[ALICE]).toBe(MEMBER_CARD_CAP);
    expect(b.cards).toHaveLength(MEMBER_CARD_CAP + 1);
  });

  it(`caps the board at ${BOARD_CARD_CAP} cards, the host's own included`, () => {
    const full = board({ cards: Array.from({ length: BOARD_CARD_CAP }, (_, i) => card(`h${i}`)) });
    const res = applyIntent(full, createIntentLedger(), add(ALICE, "start", "One more"), ctx());
    expect(res).toEqual({ ok: false, reason: "board-card-cap" });
  });
});

describe("applyIntent: votes", () => {
  it("only counts votes in the Vote phase", () => {
    for (const phase of ["write", "discuss", "actions"] as const) {
      const res = applyIntent(board({ phase }), createIntentLedger(), vote(ALICE, "c1"), ctx());
      expect(res).toEqual({ ok: false, reason: "wrong-phase" });
    }
  });

  it(`gives each member ${MAX_VOTES} votes, which may go on one card`, () => {
    const envs = [
      vote(ALICE, "c1"),
      vote(ALICE, "c1"),
      vote(ALICE, "c2"),
      vote(ALICE, "c2"),
      vote(BOB, "c2"),
    ];
    const { board: b, ledger, reasons } = run(board({ phase: "vote" }), envs);
    expect(reasons).toEqual(["ok", "ok", "ok", "vote-budget", "ok"]);
    expect(ledger.votesUsed).toEqual({ [ALICE]: MAX_VOTES, [BOB]: 1 });
    expect(b.cards.find((c) => c.id === "c1")?.votes).toBe(2);
    expect(b.cards.find((c) => c.id === "c2")?.votes).toBe(2);
  });

  it("refuses a vote for a card that isn't on the board", () => {
    const res = applyIntent(
      board({ phase: "vote" }),
      createIntentLedger(),
      vote(ALICE, "nope"),
      ctx()
    );
    expect(res).toEqual({ ok: false, reason: "unknown-card" });
  });

  it("respects votes already spent, e.g. by a host taking over from a snapshot", () => {
    const ledger = createIntentLedger({ votesUsed: { [ALICE]: MAX_VOTES, [BOB]: 99 } });
    expect(ledger.votesUsed[BOB]).toBe(MAX_VOTES);
    const res = applyIntent(board({ phase: "vote" }), ledger, vote(ALICE, "c1"), ctx());
    expect(res).toEqual({ ok: false, reason: "vote-budget" });
  });
});

describe("applyIntent: senders and duplicates", () => {
  it("drops a removed sender, even one still in presence", () => {
    const res = applyIntent(
      board(),
      createIntentLedger(),
      add(ALICE, "start", "Back again"),
      ctx({ removed: new Set([ALICE]) })
    );
    expect(res).toEqual({ ok: false, reason: "removed" });
  });

  it("drops a sender the host hasn't seated", () => {
    const res = applyIntent(board(), createIntentLedger(), add(MALLORY, "start", "Hi"), ctx());
    expect(res).toEqual({ ok: false, reason: "not-admitted" });
  });

  it("drops a sender over the member cap", () => {
    const seats = createAdmissionLedger(VISITOR_LIMITS.maxMembers);
    const present = Array.from(
      { length: VISITOR_LIMITS.maxMembers + 1 },
      (_, i) => `member_${String(i).padStart(9, "0")}`
    );
    seats.update(present.slice(0, VISITOR_LIMITS.maxMembers));
    const { admitted, overflow } = seats.update(present);
    expect(overflow).toEqual([present[VISITOR_LIMITS.maxMembers]]);

    const c = ctx({ admitted: new Set(admitted) });
    const late = applyIntent(board(), createIntentLedger(), add(overflow[0], "start", "Hi"), c);
    expect(late).toEqual({ ok: false, reason: "not-admitted" });
    const seated = applyIntent(board(), createIntentLedger(), add(admitted[0], "start", "Hi"), c);
    expect(seated.ok).toBe(true);
  });

  it("applies an intent id once per sender", () => {
    const { reasons, board: b } = run(board(), [
      add(ALICE, "start", "Once", "same"),
      add(ALICE, "start", "Once", "same"),
      add(BOB, "start", "Bob may reuse it", "same"),
    ]);
    expect(reasons).toEqual(["ok", "duplicate", "ok"]);
    expect(b.cards).toHaveLength(4);
  });

  it(`remembers the last ${INTENT_ID_RING} intent ids`, () => {
    // Only accepted intents enter the ring, so feed it cards and keep the
    // board and the sender under their caps between steps.
    let b = board({ cards: [] });
    let ledger = createIntentLedger();
    for (let i = 0; i <= INTENT_ID_RING; i++) {
      const res = applyIntent(b, ledger, add(ALICE, "start", `t${i}`, `ring${i}`), ctx());
      if (!res.ok) throw new Error(res.reason);
      b = { ...res.board, cards: [] };
      ledger = { ...res.ledger, cardsBy: {} };
    }
    expect(ledger.recent).toHaveLength(INTENT_ID_RING);
    // The oldest id has fallen out of the ring; the newest is still remembered.
    expect(applyIntent(b, ledger, add(ALICE, "start", "again", "ring0"), ctx()).ok).toBe(true);
    expect(
      applyIntent(b, ledger, add(ALICE, "start", "again", `ring${INTENT_ID_RING}`), ctx())
    ).toEqual({ ok: false, reason: "duplicate" });
  });

  it("refuses malformed envelopes", () => {
    const bad: unknown[] = [
      null,
      "card",
      { v: 2, by: ALICE, intent: { t: "vote", iid: "a", cardId: "c1" } },
      { v: 1, by: "short", intent: { t: "vote", iid: "a", cardId: "c1" } },
      { v: 1, by: ALICE, intent: { t: "delete", iid: "a", cardId: "c1" } },
      {
        v: 1,
        by: ALICE,
        intent: { t: "card:add", iid: "has space", columnKey: "start", text: "x" },
      },
      { v: 1, by: ALICE, intent: { t: "card:add", iid: "a", columnKey: "", text: "x" } },
      { v: 1, by: ALICE, intent: { t: "card:add", iid: "a", columnKey: "start", text: 42 } },
      { v: 1, by: ALICE, intent: { t: "vote", iid: "a", cardId: "x".repeat(65) } },
    ];
    for (const env of bad) {
      expect(applyIntent(board({ phase: "vote" }), createIntentLedger(), env, ctx())).toEqual({
        ok: false,
        reason: "bad-shape",
      });
    }
  });
});

describe("applyPatch", () => {
  it("is safe to apply twice and ignores a board that moved on", () => {
    const patch = { t: "card:add" as const, card: card("new", { columnKey: "continue" }) };
    const once = applyPatch(board(), patch);
    expect(applyPatch(once, patch)).toBe(once);
    expect(applyPatch(board({ format: retroFormats[1] }), patch).cards).toHaveLength(2);

    const v = { t: "vote" as const, cardId: "c1" };
    expect(applyPatch(board({ phase: "discuss" }), v).cards[0].votes).toBe(0);
    expect(applyPatch(board({ phase: "vote" }), v).cards[0].votes).toBe(1);
  });
});
