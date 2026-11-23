import { describe, expect, it } from "vitest";
import { retroFormats } from "@/lib/constants/retro-formats";
import { createAdmissionLedger, VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import {
  applyIntent,
  applyPatch,
  createIntentLedger,
  ownerOfCard,
  resetAllowances,
  retireIds,
  votesOnCard,
  type IntentContext,
  type IntentLedger,
} from "@/app/(tools)/retro/room/intents";
import {
  BOARD_CARD_CAP,
  INTENT_ID_RING,
  MEMBER_CARD_CAP,
  MEMBER_UNDO_CAP,
  RETIRED_ID_RING,
  RETRO_ROOM_PROTOCOL_VERSION,
  lockOf,
  type RetroIntent,
} from "@/app/(tools)/retro/room/protocol";
import { DEFAULT_RETRO_VOTES } from "@/lib/retro/board";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";

/**
 * The host's intent reducer for the Retro visitor room: every participant
 * message is untrusted, so the reducer alone decides what reaches the board.
 * Who added a card and who voted on it is the host's record, in the ledger
 * only: it never reaches the board. Every peer sees every request, so a
 * delete or a take-back must carry the key behind the lock its card or vote
 * came with.
 */

const ALICE = "alice_0000000000";
const BOB = "bob_000000000000";
const MALLORY = "mallory_00000000";
const V = RETRO_ROOM_PROTOCOL_VERSION;

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

function ctx(overrides: Partial<IntentContext> = {}): IntentContext {
  return {
    admitted: new Set([ALICE, BOB]),
    removed: new Set(),
    ...overrides,
  };
}

let iids = 0;
const nextIid = () => `iid${++iids}`;

/** The key a test sender holds for a card (by its id). */
const cardKey = (cardId: string) => `ck_${cardId}_0123456789`;
/** The key a test sender holds for its votes on a card (one per voter and card, for brevity). */
const voteKey = (by: string, cardId: string) => `vk_${by}-${cardId}`;

function add(by: string, columnKey: string, text: string, iid = nextIid()) {
  const intent: RetroIntent = { t: "card:add", iid, columnKey, text, lock: lockOf(cardKey(iid)) };
  return { v: V, by, intent };
}

function del(by: string, cardId: string, iid = nextIid(), key = cardKey(cardId)) {
  const intent: RetroIntent = { t: "card:delete", iid, cardId, key };
  return { v: V, by, intent };
}

function vote(by: string, cardId: string, iid = nextIid()) {
  const intent: RetroIntent = { t: "vote", iid, cardId, lock: lockOf(voteKey(by, cardId)) };
  return { v: V, by, intent };
}

function unvote(by: string, cardId: string, iid = nextIid(), key = voteKey(by, cardId)) {
  const intent: RetroIntent = { t: "vote:undo", iid, cardId, key };
  return { v: V, by, intent };
}

/** Apply a list of envelopes in order, threading board and ledger. */
function run(
  start: BoardState,
  envs: unknown[],
  c: IntentContext = ctx(),
  first: IntentLedger = createIntentLedger()
) {
  let b = start;
  let ledger = first;
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
  it("adds a cleaned card under its request's id, counts it and records the sender host-side", () => {
    const start = board();
    const res = applyIntent(
      start,
      createIntentLedger(),
      add(ALICE, "stop", "  Too   many\nmeetings  ", "aliceCard01"),
      ctx()
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const added = res.board.cards.at(-1);
    // No author on the card: who added it is the ledger's record only.
    expect(added).toEqual({
      id: "aliceCard01",
      columnKey: "stop",
      text: "Too many meetings",
      votes: 0,
      groupedWith: null,
      isActionItem: false,
      assignee: "",
      discussing: false,
    });
    expect(res.ledger.cardsBy[ALICE]).toBe(1);
    expect(ownerOfCard(res.ledger, "aliceCard01")).toBe(ALICE);
    expect(JSON.stringify(res.board)).not.toContain(ALICE);
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

  it("refuses an id already on the board, or one that left it", () => {
    const onBoard = applyIntent(
      board(),
      createIntentLedger(),
      add(ALICE, "start", "Hi", "c1"),
      ctx()
    );
    expect(onBoard).toEqual({ ok: false, reason: "id-taken" });
    const retired = retireIds(createIntentLedger(), ["gone1"]);
    const left = applyIntent(board(), retired, add(ALICE, "start", "Hi", "gone1"), ctx());
    expect(left).toEqual({ ok: false, reason: "id-taken" });
  });

  it(`caps the board at ${BOARD_CARD_CAP} cards, the host's own included`, () => {
    const full = board({ cards: Array.from({ length: BOARD_CARD_CAP }, (_, i) => card(`h${i}`)) });
    const res = applyIntent(full, createIntentLedger(), add(ALICE, "start", "One more"), ctx());
    expect(res).toEqual({ ok: false, reason: "board-card-cap" });
  });
});

describe("applyIntent: deleting my card", () => {
  it("deletes the sender's own card in Write, and no one else's", () => {
    const {
      board: b,
      ledger,
      reasons,
    } = run(board(), [
      add(ALICE, "start", "Mine", "aliceA"),
      add(BOB, "start", "Bob's", "bobB"),
      del(BOB, "aliceA"), // not Bob's
      del(ALICE, "c1"), // the host's own card: no one's through the room
      del(ALICE, "aliceA"),
      del(ALICE, "aliceA"), // gone already
    ]);
    expect(reasons).toEqual(["ok", "ok", "not-yours", "not-yours", "ok", "unknown-card"]);
    expect(b.cards.map((c) => c.id)).toEqual(["c1", "c2", "bobB"]);
    expect(ownerOfCard(ledger, "aliceA")).toBeNull();
    expect(ownerOfCard(ledger, "bobB")).toBe(BOB);
    // Deleting doesn't give the allowance back, and the id can't come back.
    expect(ledger.cardsBy[ALICE]).toBe(1);
    expect(ledger.retired).toContain("aliceA");
    const again = applyIntent(b, ledger, add(BOB, "start", "Again", "aliceA"), ctx());
    expect(again).toEqual({ ok: false, reason: "id-taken" });
  });

  it("only deletes in the Write phase", () => {
    const added = run(board(), [add(ALICE, "start", "Mine", "aliceW")]);
    for (const phase of ["vote", "discuss", "actions"] as const) {
      const res = applyIntent({ ...added.board, phase }, added.ledger, del(ALICE, "aliceW"), ctx());
      expect(res).toEqual({ ok: false, reason: "wrong-phase" });
    }
  });

  it("leaves the cards grouped under it standing on their own", () => {
    const added = run(board(), [add(ALICE, "start", "Parent", "parent1")]);
    const grouped = {
      ...added.board,
      cards: [...added.board.cards, card("child", { groupedWith: "parent1" })],
    };
    const res = applyIntent(grouped, added.ledger, del(ALICE, "parent1"), ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.board.cards.find((c) => c.id === "child")).toMatchObject({ groupedWith: null });
    expect(res.patch).toEqual({ t: "card:delete", cardId: "parent1" });
  });

  it("refuses a delete in the owner's name without the card's key", () => {
    const added = run(board(), [
      add(ALICE, "start", "Mine", "aliceK"),
      add(BOB, "start", "Bob's", "bobK"),
    ]);
    const lock = lockOf(cardKey("aliceK"));
    // Bob saw Alice's add go by, id and lock included, and claims to be her.
    const spoofs = [
      del(ALICE, "aliceK", nextIid(), "guessed_key_0000000"),
      del(ALICE, "aliceK", nextIid(), lock), // the lock is no key
      del(ALICE, "aliceK", nextIid(), cardKey("bobK")), // the key of another card
    ];
    const { board: b, reasons } = run(added.board, spoofs, ctx(), added.ledger);
    expect(reasons).toEqual(["not-yours", "not-yours", "not-yours"]);
    expect(b.cards.map((c) => c.id)).toContain("aliceK");
    // A delete with no key at all isn't even well formed.
    const bare = {
      v: V,
      by: ALICE,
      intent: { t: "card:delete", iid: nextIid(), cardId: "aliceK" },
    };
    expect(applyIntent(added.board, added.ledger, bare, ctx())).toEqual({
      ok: false,
      reason: "bad-shape",
    });
    // Alice, with her key, can.
    expect(applyIntent(added.board, added.ledger, del(ALICE, "aliceK"), ctx()).ok).toBe(true);
  });

  it("asks no key of the host's own request (a member promoted to host)", () => {
    const added = run(board(), [add(ALICE, "start", "Mine", "aliceL")]);
    const own = del(ALICE, "aliceL", nextIid(), "any_key_will_do_000");
    expect(applyIntent(added.board, added.ledger, own, ctx()).ok).toBe(false);
    expect(applyIntent(added.board, added.ledger, own, ctx({ local: true })).ok).toBe(true);
    // Still only its own card.
    const others = run(board(), [add(BOB, "start", "Bob's", "bobL")]);
    expect(
      applyIntent(others.board, others.ledger, del(ALICE, "bobL"), ctx({ local: true }))
    ).toEqual({ ok: false, reason: "not-yours" });
  });

  it("refuses a removed sender's delete", () => {
    const added = run(board(), [add(ALICE, "start", "Mine", "aliceR")]);
    const res = applyIntent(
      added.board,
      added.ledger,
      del(ALICE, "aliceR"),
      ctx({ removed: new Set([ALICE]) })
    );
    expect(res).toEqual({ ok: false, reason: "removed" });
  });
});

describe("applyIntent: votes", () => {
  it("only counts votes in the Vote phase", () => {
    for (const phase of ["write", "discuss", "actions"] as const) {
      const res = applyIntent(board({ phase }), createIntentLedger(), vote(ALICE, "c1"), ctx());
      expect(res).toEqual({ ok: false, reason: "wrong-phase" });
    }
  });

  it(`gives each member ${DEFAULT_RETRO_VOTES} votes, which may go on one card`, () => {
    const envs = [
      vote(ALICE, "c1"),
      vote(ALICE, "c1"),
      vote(ALICE, "c2"),
      vote(ALICE, "c2"),
      vote(BOB, "c2"),
    ];
    const { board: b, ledger, reasons } = run(board({ phase: "vote" }), envs);
    expect(reasons).toEqual(["ok", "ok", "ok", "vote-budget", "ok"]);
    expect(ledger.votesUsed).toEqual({ [ALICE]: DEFAULT_RETRO_VOTES, [BOB]: 1 });
    expect(b.cards.find((c) => c.id === "c1")?.votes).toBe(2);
    expect(b.cards.find((c) => c.id === "c2")?.votes).toBe(2);
    // Who voted where stays in the ledger, never on the board.
    expect(votesOnCard(ledger, ALICE, "c1")).toBe(2);
    expect(votesOnCard(ledger, ALICE, "c2")).toBe(1);
    expect(votesOnCard(ledger, BOB, "c2")).toBe(1);
    expect(JSON.stringify(b)).not.toContain(ALICE);
  });

  it("uses the board's votes per person when the host gives one", () => {
    const { reasons } = run(
      board({ phase: "vote" }),
      [vote(ALICE, "c1"), vote(ALICE, "c1")],
      ctx({ votesPerPerson: 1 })
    );
    expect(reasons).toEqual(["ok", "vote-budget"]);
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
    const ledger = createIntentLedger({ votesUsed: { [ALICE]: DEFAULT_RETRO_VOTES, [BOB]: 99 } });
    expect(ledger.votesUsed[BOB]).toBe(DEFAULT_RETRO_VOTES);
    const res = applyIntent(board({ phase: "vote" }), ledger, vote(ALICE, "c1"), ctx());
    expect(res).toEqual({ ok: false, reason: "vote-budget" });
  });
});

describe("applyIntent: taking a vote back", () => {
  it("takes back the sender's own vote and gives it back to spend again", () => {
    const {
      board: b,
      ledger,
      reasons,
    } = run(board({ phase: "vote" }), [
      vote(ALICE, "c1"),
      vote(ALICE, "c1"),
      vote(BOB, "c2"),
      unvote(ALICE, "c2"), // Alice has no vote there
      unvote(ALICE, "c1"),
      vote(ALICE, "c2"),
      vote(ALICE, "c2"), // back to her budget of 3
      vote(ALICE, "c2"),
    ]);
    expect(reasons).toEqual(["ok", "ok", "ok", "not-yours", "ok", "ok", "ok", "vote-budget"]);
    expect(b.cards.map((c) => c.votes)).toEqual([1, 3]);
    expect(ledger.votesUsed[ALICE]).toBe(DEFAULT_RETRO_VOTES);
    expect(votesOnCard(ledger, ALICE, "c1")).toBe(1);
    expect(votesOnCard(ledger, ALICE, "c2")).toBe(2);
    expect(votesOnCard(ledger, BOB, "c2")).toBe(1);
  });

  it("only takes votes back in the Vote phase, from a card on the board", () => {
    const voted = run(board({ phase: "vote" }), [vote(ALICE, "c1")]);
    const later = applyIntent(
      { ...voted.board, phase: "discuss" },
      voted.ledger,
      unvote(ALICE, "c1"),
      ctx()
    );
    expect(later).toEqual({ ok: false, reason: "wrong-phase" });
    const gone = applyIntent(voted.board, voted.ledger, unvote(ALICE, "nope"), ctx());
    expect(gone).toEqual({ ok: false, reason: "unknown-card" });
  });

  it("refuses a take-back in the voter's name without that vote's key", () => {
    const voted = run(board({ phase: "vote" }), [vote(ALICE, "c1"), vote(BOB, "c1")]);
    const spoofs = [
      unvote(ALICE, "c1", nextIid(), "guessed_key_0000000"),
      unvote(ALICE, "c1", nextIid(), lockOf(voteKey(ALICE, "c1"))), // the lock that went by
      unvote(ALICE, "c1", nextIid(), voteKey(BOB, "c1")), // Bob's own key, in Alice's name
    ];
    const { board: b, ledger, reasons } = run(voted.board, spoofs, ctx(), voted.ledger);
    expect(reasons).toEqual(["not-yours", "not-yours", "not-yours"]);
    expect(b.cards[0].votes).toBe(2);
    expect(votesOnCard(ledger, ALICE, "c1")).toBe(1);
    const bare = { v: V, by: ALICE, intent: { t: "vote:undo", iid: nextIid(), cardId: "c1" } };
    expect(applyIntent(voted.board, voted.ledger, bare, ctx())).toEqual({
      ok: false,
      reason: "bad-shape",
    });
    // Alice, with her key, can; then that key is spent.
    const back = run(voted.board, [unvote(ALICE, "c1"), unvote(ALICE, "c1")], ctx(), voted.ledger);
    expect(back.reasons).toEqual(["ok", "not-yours"]);
  });

  it("refuses a vote no one cast, e.g. one cast before a new host took over", () => {
    const ledger = createIntentLedger({ votesUsed: { [ALICE]: 2 } });
    const res = applyIntent(board({ phase: "vote" }), ledger, unvote(ALICE, "c1"), ctx());
    expect(res).toEqual({ ok: false, reason: "not-yours" });
  });

  it(`caps each member at ${MEMBER_UNDO_CAP} take-backs`, () => {
    const envs: unknown[] = [];
    for (let i = 0; i <= MEMBER_UNDO_CAP; i++) envs.push(vote(ALICE, "c1"), unvote(ALICE, "c1"));
    const { reasons, ledger } = run(board({ phase: "vote" }), envs);
    expect(reasons.filter((r) => r === "undo-cap")).toEqual(["undo-cap"]);
    expect(reasons.at(-1)).toBe("undo-cap");
    expect(ledger.undosBy[ALICE]).toBe(MEMBER_UNDO_CAP);
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
      // Not a duplicate for Bob, but the card id is Alice's now.
      add(BOB, "start", "Bob's", "same"),
    ]);
    expect(reasons).toEqual(["ok", "duplicate", "id-taken"]);
    expect(b.cards).toHaveLength(3);
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
    const key = cardKey("a1");
    const lock = lockOf(key);
    const bad: unknown[] = [
      null,
      "card",
      // Version 1 tabs, and anything newer than this one.
      { v: 1, by: ALICE, intent: { t: "vote", iid: "a", cardId: "c1", lock } },
      { v: 3, by: ALICE, intent: { t: "vote", iid: "a", cardId: "c1", lock } },
      { v: V, by: "short", intent: { t: "vote", iid: "a", cardId: "c1", lock } },
      { v: V, by: ALICE, intent: { t: "delete", iid: "a", cardId: "c1", key } },
      { v: V, by: ALICE, intent: { t: "unvote", iid: "a", cardId: "c1", key } },
      {
        v: V,
        by: ALICE,
        intent: { t: "card:add", iid: "has space", columnKey: "start", text: "x", lock },
      },
      { v: V, by: ALICE, intent: { t: "card:add", iid: "a", columnKey: "", text: "x", lock } },
      { v: V, by: ALICE, intent: { t: "card:add", iid: "a", columnKey: "start", text: 42, lock } },
      { v: V, by: ALICE, intent: { t: "vote", iid: "a", cardId: "x".repeat(65), lock } },
      { v: V, by: ALICE, intent: { t: "vote:undo", iid: "a", cardId: "", key } },
      // It would become a card id, and the ledger keys records by card id.
      {
        v: V,
        by: ALICE,
        intent: { t: "card:add", iid: "__proto__", columnKey: "start", text: "x", lock },
      },
      // Nor one the host's board would take for an example card (Clear example removes those).
      {
        v: V,
        by: ALICE,
        intent: { t: "card:add", iid: "example-1", columnKey: "start", text: "x", lock },
      },
      // A card added through the room has an intent id for its id.
      { v: V, by: ALICE, intent: { t: "card:delete", iid: "a", cardId: "not an id", key } },
      { v: V, by: ALICE, intent: { t: "card:delete", iid: "a", key } },
      // Adding and voting send a lock (a SHA-256, 43 characters); deleting and taking back a key.
      { v: V, by: ALICE, intent: { t: "card:add", iid: "a", columnKey: "start", text: "x" } },
      {
        v: V,
        by: ALICE,
        intent: { t: "card:add", iid: "a", columnKey: "start", text: "x", lock: "short" },
      },
      { v: V, by: ALICE, intent: { t: "vote", iid: "a", cardId: "c1" } },
      { v: V, by: ALICE, intent: { t: "vote", iid: "a", cardId: "c1", lock: `${lock}x` } },
      { v: V, by: ALICE, intent: { t: "card:delete", iid: "a", cardId: "a1", key: "tooShort" } },
      { v: V, by: ALICE, intent: { t: "vote:undo", iid: "a", cardId: "c1", key: "has space k" } },
      { v: V, by: ALICE, intent: { t: "vote:undo", iid: "a", cardId: "c1", key: 42 } },
    ];
    for (const env of bad) {
      expect(applyIntent(board({ phase: "vote" }), createIntentLedger(), env, ctx())).toEqual({
        ok: false,
        reason: "bad-shape",
      });
    }
  });
});

describe("the ledger", () => {
  it(`remembers the last ${RETIRED_ID_RING} cards that left the board, once each`, () => {
    let ledger = retireIds(createIntentLedger(), ["a", "a", "b"]);
    expect(ledger.retired).toEqual(["a", "b"]);
    ledger = retireIds(
      ledger,
      Array.from({ length: RETIRED_ID_RING }, (_, i) => `x${i}`)
    );
    expect(ledger.retired).toHaveLength(RETIRED_ID_RING);
    expect(ledger.retired).not.toContain("a");
    // Nothing new: the same ledger back.
    expect(retireIds(ledger, ["x5"])).toBe(ledger);
  });

  it("starts everyone's allowances again after a clear, and keeps who added what", () => {
    const { ledger } = run(board(), [add(ALICE, "start", "Mine", "keep1")]);
    const voted = run(
      board({ phase: "vote" }),
      [vote(BOB, "c1"), unvote(BOB, "c1")],
      ctx(),
      ledger
    );
    const cleared = resetAllowances(voted.ledger);
    expect(cleared).toMatchObject({ votesUsed: {}, cardsBy: {}, undosBy: {}, voteLocks: {} });
    expect(ownerOfCard(cleared, "keep1")).toBe(ALICE);
    expect(cleared.recent).toEqual(voted.ledger.recent);
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

    const d = { t: "card:delete" as const, cardId: "c1" };
    const deleted = applyPatch(board(), d);
    expect(deleted.cards.map((c) => c.id)).toEqual(["c2"]);
    expect(applyPatch(deleted, d)).toBe(deleted);
    expect(applyPatch(board({ phase: "vote" }), d).cards).toHaveLength(2);

    const u = { t: "vote:undo" as const, cardId: "c1" };
    const voted = board({ phase: "vote", cards: [card("c1", { votes: 1 })] });
    expect(applyPatch(voted, u).cards[0].votes).toBe(0);
    // Never below zero, and not outside Vote.
    expect(applyPatch(applyPatch(voted, u), u).cards[0].votes).toBe(0);
    expect(applyPatch({ ...voted, phase: "discuss" }, u).cards[0].votes).toBe(1);
  });
});
