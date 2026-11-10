/**
 * Retro visitor room: the host's intent reducer.
 *
 * A participant never edits the board. It asks the host to add or delete its
 * own card, or to cast or take back a vote, and `applyIntent` decides. Pure:
 * it returns the next board and ledger and never mutates its inputs, so the
 * host can run it against its latest board and then hand the patch to its
 * store.
 *
 * Rules, in order:
 *  1. the envelope must be well formed (`readIntentEnv`);
 *  2. the sender must not have been removed, and must hold a seat (in
 *     presence, under the member cap);
 *  3. the same sender's intent id is applied once (ring of 256);
 *  4. cards are added and deleted only in Write, votes cast and taken back
 *     only in Vote;
 *  5. a new card's column must exist; its text is cleaned to 1–500
 *     characters with no control or bidi characters; at most 30 cards per
 *     member and 200 on the board; its id (the add request's id) must not be
 *     on the board or belong to a card that left it;
 *  6. a card may be deleted only by the member who added it;
 *  7. a vote needs an existing card and a vote left in the sender's budget
 *     (`ledger.votesUsed`); a vote is taken back only from a card the sender
 *     voted on, at most 30 times per member.
 *
 * Who owns what (`ownerOf`, `votesOn`) lives in the ledger, in the host's
 * memory only: no snapshot carries it and no board saves it.
 */

import { cleanText } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { MAX_VOTES, type BoardState, type RetroCard } from "../types";
import {
  BOARD_CARD_CAP,
  INTENT_ID_RING,
  MEMBER_CARD_CAP,
  MEMBER_UNDO_CAP,
  RETIRED_ID_RING,
  readIntentEnv,
} from "./protocol";

export interface IntentLedger {
  /** Votes each member has spent through the room. */
  votesUsed: Record<string, number>;
  /** Cards each member has added through the room. */
  cardsBy: Record<string, number>;
  /** Votes each member has taken back through the room. */
  undosBy: Record<string, number>;
  /** Recent `<sender>:<iid>` keys, oldest first, at most `INTENT_ID_RING`. */
  recent: string[];
  /** Who added each card that came through the room: card id → member id. */
  ownerOf: Record<string, string>;
  /** Each member's votes per card: member id → card id → votes. */
  votesOn: Record<string, Record<string, number>>;
  /** Ids of cards that left the board, oldest first, at most `RETIRED_ID_RING`. */
  retired: string[];
}

export interface IntentContext {
  /** Members the host seats right now (in presence, under the cap). */
  admitted: ReadonlySet<string>;
  /** Members the host removed. Checked before `admitted`. */
  removed: ReadonlySet<string>;
  /** Votes each person has. Defaults to `MAX_VOTES`. */
  votesPerPerson?: number;
}

export type IntentRejection =
  | "bad-shape"
  | "removed"
  | "not-admitted"
  | "duplicate"
  | "wrong-phase"
  | "unknown-column"
  | "bad-text"
  | "member-card-cap"
  | "board-card-cap"
  | "id-taken"
  | "unknown-card"
  | "not-yours"
  | "vote-budget"
  | "undo-cap";

/** What an accepted intent changes. */
export type IntentPatch =
  | { t: "card:add"; card: RetroCard }
  | { t: "card:delete"; cardId: string }
  | { t: "vote"; cardId: string }
  | { t: "vote:undo"; cardId: string };

export type IntentResult =
  | { ok: true; board: BoardState; ledger: IntentLedger; patch: IntentPatch }
  | { ok: false; reason: IntentRejection };

export function createIntentLedger(
  seed: { votesUsed?: Record<string, number>; votesPerPerson?: number } = {}
): IntentLedger {
  const budget = seed.votesPerPerson ?? MAX_VOTES;
  const votesUsed: Record<string, number> = {};
  for (const [id, n] of Object.entries(seed.votesUsed ?? {})) {
    if (Number.isInteger(n) && n > 0) votesUsed[id] = Math.min(n, budget);
  }
  return {
    votesUsed,
    cardsBy: {},
    undosBy: {},
    recent: [],
    ownerOf: {},
    votesOn: {},
    retired: [],
  };
}

const has = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

function countOf(record: Record<string, number>, id: string): number {
  return has(record, id) ? record[id] : 0;
}

/** Votes `member` has on `cardId`, by the ledger. */
export function votesOnCard(ledger: IntentLedger, member: string, cardId: string): number {
  const mine = has(ledger.votesOn, member) ? ledger.votesOn[member] : undefined;
  return mine ? countOf(mine, cardId) : 0;
}

/** Who added `cardId` through the room, or null. */
export function ownerOfCard(ledger: IntentLedger, cardId: string): string | null {
  return has(ledger.ownerOf, cardId) ? ledger.ownerOf[cardId] : null;
}

function remember(recent: readonly string[], key: string, cap: number): string[] {
  const next = [...recent, key];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** The ledger with `ids` remembered as cards that left the board. */
export function retireIds(ledger: IntentLedger, ids: readonly string[]): IntentLedger {
  let retired = ledger.retired;
  for (const id of ids) {
    if (!retired.includes(id)) retired = remember(retired, id, RETIRED_ID_RING);
  }
  return retired === ledger.retired ? ledger : { ...ledger, retired };
}

/**
 * The ledger for a board that was cleared: everyone's votes, take-backs and
 * card allowance start again. Who added which card is kept (an Undo of the
 * clear brings the cards back), as are the duplicate and retired rings.
 */
export function resetAllowances(ledger: IntentLedger): IntentLedger {
  return { ...ledger, votesUsed: {}, cardsBy: {}, undosBy: {}, votesOn: {} };
}

function withVotesOn(
  ledger: IntentLedger,
  member: string,
  cardId: string,
  n: number
): IntentLedger["votesOn"] {
  // Built from entries, so any card id (even "__proto__") is an own key.
  const entries = Object.entries(has(ledger.votesOn, member) ? ledger.votesOn[member] : {}).filter(
    ([id]) => id !== cardId
  );
  if (n > 0) entries.push([cardId, n]);
  const mine: Record<string, number> = Object.fromEntries(entries);
  const next = { ...ledger.votesOn };
  if (Object.keys(mine).length > 0) next[member] = mine;
  else delete next[member];
  return next;
}

/**
 * The board with `patch` applied. Defensive: a card already on the board
 * (or already gone), a column that has gone, a full board or a phase that
 * has moved on leave the board as it is. Deleting a card leaves the cards
 * grouped under it standing on their own.
 */
export function applyPatch(board: BoardState, patch: IntentPatch): BoardState {
  switch (patch.t) {
    case "card:add": {
      const { card } = patch;
      if (board.cards.some((c) => c.id === card.id)) return board;
      if (!board.format.columns.some((c) => c.key === card.columnKey)) return board;
      if (board.cards.length >= BOARD_CARD_CAP) return board;
      return { ...board, cards: [...board.cards, card] };
    }
    case "card:delete": {
      if (board.phase !== "write") return board;
      if (!board.cards.some((c) => c.id === patch.cardId)) return board;
      return {
        ...board,
        cards: board.cards
          .filter((c) => c.id !== patch.cardId)
          .map((c) => (c.groupedWith === patch.cardId ? { ...c, groupedWith: null } : c)),
      };
    }
    case "vote":
    case "vote:undo": {
      if (board.phase !== "vote") return board;
      const step = patch.t === "vote" ? 1 : -1;
      const card = board.cards.find((c) => c.id === patch.cardId);
      if (!card || card.votes + step < 0) return board;
      return {
        ...board,
        cards: board.cards.map((c) =>
          c.id === patch.cardId ? { ...c, votes: c.votes + step } : c
        ),
      };
    }
  }
}

export function applyIntent(
  board: BoardState,
  ledger: IntentLedger,
  rawEnv: unknown,
  ctx: IntentContext
): IntentResult {
  const env = readIntentEnv(rawEnv);
  if (!env) return { ok: false, reason: "bad-shape" };
  const { by, intent } = env;
  if (ctx.removed.has(by)) return { ok: false, reason: "removed" };
  if (!ctx.admitted.has(by)) return { ok: false, reason: "not-admitted" };
  const key = `${by}:${intent.iid}`;
  if (ledger.recent.includes(key)) return { ok: false, reason: "duplicate" };
  const recent = remember(ledger.recent, key, INTENT_ID_RING);
  const accept = (patch: IntentPatch, next: Omit<IntentLedger, "recent">): IntentResult => ({
    ok: true,
    board: applyPatch(board, patch),
    ledger: { ...next, recent },
    patch,
  });

  switch (intent.t) {
    case "card:add": {
      if (board.phase !== "write") return { ok: false, reason: "wrong-phase" };
      if (!board.format.columns.some((c) => c.key === intent.columnKey)) {
        return { ok: false, reason: "unknown-column" };
      }
      const text = cleanText(intent.text, VISITOR_LIMITS.maxTextChars);
      if (text === null) return { ok: false, reason: "bad-text" };
      const added = countOf(ledger.cardsBy, by);
      if (added >= MEMBER_CARD_CAP) return { ok: false, reason: "member-card-cap" };
      if (board.cards.length >= BOARD_CARD_CAP) return { ok: false, reason: "board-card-cap" };
      // The add request's id becomes the card's: never one on the board, or one
      // that left it (an Undo on the host's side could bring that card back).
      const id = intent.iid;
      if (board.cards.some((c) => c.id === id) || ledger.retired.includes(id)) {
        return { ok: false, reason: "id-taken" };
      }
      const card: RetroCard = {
        id,
        columnKey: intent.columnKey,
        text,
        votes: 0,
        groupedWith: null,
        isActionItem: false,
        assignee: "",
        discussing: false,
      };
      return accept(
        { t: "card:add", card },
        {
          ...ledger,
          cardsBy: { ...ledger.cardsBy, [by]: added + 1 },
          ownerOf: { ...ledger.ownerOf, [id]: by },
        }
      );
    }

    case "card:delete": {
      if (board.phase !== "write") return { ok: false, reason: "wrong-phase" };
      if (!board.cards.some((c) => c.id === intent.cardId)) {
        return { ok: false, reason: "unknown-card" };
      }
      if (ownerOfCard(ledger, intent.cardId) !== by) return { ok: false, reason: "not-yours" };
      const ownerOf = { ...ledger.ownerOf };
      delete ownerOf[intent.cardId];
      const retired = retireIds(ledger, [intent.cardId]).retired;
      return accept({ t: "card:delete", cardId: intent.cardId }, { ...ledger, ownerOf, retired });
    }

    case "vote": {
      if (board.phase !== "vote") return { ok: false, reason: "wrong-phase" };
      if (!board.cards.some((c) => c.id === intent.cardId)) {
        return { ok: false, reason: "unknown-card" };
      }
      const used = countOf(ledger.votesUsed, by);
      if (used >= (ctx.votesPerPerson ?? MAX_VOTES)) return { ok: false, reason: "vote-budget" };
      return accept(
        { t: "vote", cardId: intent.cardId },
        {
          ...ledger,
          votesUsed: { ...ledger.votesUsed, [by]: used + 1 },
          votesOn: withVotesOn(
            ledger,
            by,
            intent.cardId,
            votesOnCard(ledger, by, intent.cardId) + 1
          ),
        }
      );
    }

    case "vote:undo": {
      if (board.phase !== "vote") return { ok: false, reason: "wrong-phase" };
      if (!board.cards.some((c) => c.id === intent.cardId)) {
        return { ok: false, reason: "unknown-card" };
      }
      const mine = votesOnCard(ledger, by, intent.cardId);
      if (mine <= 0) return { ok: false, reason: "not-yours" };
      const undos = countOf(ledger.undosBy, by);
      if (undos >= MEMBER_UNDO_CAP) return { ok: false, reason: "undo-cap" };
      return accept(
        { t: "vote:undo", cardId: intent.cardId },
        {
          ...ledger,
          votesUsed: { ...ledger.votesUsed, [by]: Math.max(0, countOf(ledger.votesUsed, by) - 1) },
          undosBy: { ...ledger.undosBy, [by]: undos + 1 },
          votesOn: withVotesOn(ledger, by, intent.cardId, mine - 1),
        }
      );
    }
  }
}
