/**
 * Retro visitor room: the host's intent reducer.
 *
 * A participant never edits the board. It asks the host to add a card or
 * cast a vote, and `applyIntent` decides. Pure: it returns the next board
 * and ledger and never mutates its inputs, so the host can run it against
 * its latest board and then hand the (idempotent) patch to its store.
 *
 * Rules, in order:
 *  1. the envelope must be well formed (`readIntentEnv`);
 *  2. the sender must not have been removed, and must hold a seat (in
 *     presence, under the member cap);
 *  3. the same sender's intent id is applied once (ring of 256);
 *  4. cards only in Write, votes only in Vote;
 *  5. a card's column must exist; its text is cleaned to 1–500 characters
 *     with no control or bidi characters; at most 30 cards per member and
 *     200 on the board;
 *  6. a vote needs an existing card and a vote left in the sender's
 *     `MAX_VOTES` budget (`ledger.votesUsed`).
 */

import { cleanText } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { MAX_VOTES, type BoardState, type RetroCard } from "../types";
import { BOARD_CARD_CAP, INTENT_ID_RING, MEMBER_CARD_CAP, readIntentEnv } from "./protocol";

export interface IntentLedger {
  /** Votes each member has spent through the room. */
  votesUsed: Record<string, number>;
  /** Cards each member has added through the room. */
  cardsBy: Record<string, number>;
  /** Recent `<sender>:<iid>` keys, oldest first, at most `INTENT_ID_RING`. */
  recent: string[];
}

export interface IntentContext {
  /** Members the host seats right now (in presence, under the cap). */
  admitted: ReadonlySet<string>;
  /** Members the host removed. Checked before `admitted`. */
  removed: ReadonlySet<string>;
  /** A fresh id for an accepted card. Ids are always the host's, never the sender's. */
  newCardId: () => string;
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
  | "unknown-card"
  | "vote-budget";

/** What an accepted intent changes. Applying it twice to the same board is safe. */
export type IntentPatch = { t: "card:add"; card: RetroCard } | { t: "vote"; cardId: string };

export type IntentResult =
  | { ok: true; board: BoardState; ledger: IntentLedger; patch: IntentPatch }
  | { ok: false; reason: IntentRejection };

export function createIntentLedger(
  seed: { votesUsed?: Record<string, number> } = {}
): IntentLedger {
  const votesUsed: Record<string, number> = {};
  for (const [id, n] of Object.entries(seed.votesUsed ?? {})) {
    if (Number.isInteger(n) && n > 0) votesUsed[id] = Math.min(n, MAX_VOTES);
  }
  return { votesUsed, cardsBy: {}, recent: [] };
}

function countOf(record: Record<string, number>, id: string): number {
  return Object.prototype.hasOwnProperty.call(record, id) ? record[id] : 0;
}

function remember(recent: readonly string[], key: string): string[] {
  const next = [...recent, key];
  return next.length > INTENT_ID_RING ? next.slice(next.length - INTENT_ID_RING) : next;
}

/**
 * The board with `patch` applied. Idempotent and defensive: a card already
 * on the board, a column that has gone, a full board or a phase that has
 * moved on leave the board as it is.
 */
export function applyPatch(board: BoardState, patch: IntentPatch): BoardState {
  if (patch.t === "card:add") {
    const { card } = patch;
    if (board.cards.some((c) => c.id === card.id)) return board;
    if (!board.format.columns.some((c) => c.key === card.columnKey)) return board;
    if (board.cards.length >= BOARD_CARD_CAP) return board;
    return { ...board, cards: [...board.cards, card] };
  }
  if (board.phase !== "vote") return board;
  if (!board.cards.some((c) => c.id === patch.cardId)) return board;
  return {
    ...board,
    cards: board.cards.map((c) => (c.id === patch.cardId ? { ...c, votes: c.votes + 1 } : c)),
  };
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

  if (intent.t === "card:add") {
    if (board.phase !== "write") return { ok: false, reason: "wrong-phase" };
    if (!board.format.columns.some((c) => c.key === intent.columnKey)) {
      return { ok: false, reason: "unknown-column" };
    }
    const text = cleanText(intent.text, VISITOR_LIMITS.maxTextChars);
    if (text === null) return { ok: false, reason: "bad-text" };
    const added = countOf(ledger.cardsBy, by);
    if (added >= MEMBER_CARD_CAP) return { ok: false, reason: "member-card-cap" };
    if (board.cards.length >= BOARD_CARD_CAP) return { ok: false, reason: "board-card-cap" };
    const card: RetroCard = {
      id: ctx.newCardId(),
      columnKey: intent.columnKey,
      text,
      votes: 0,
      groupedWith: null,
      isActionItem: false,
      assignee: "",
      discussing: false,
    };
    const patch: IntentPatch = { t: "card:add", card };
    return {
      ok: true,
      board: applyPatch(board, patch),
      ledger: {
        ...ledger,
        cardsBy: { ...ledger.cardsBy, [by]: added + 1 },
        recent: remember(ledger.recent, key),
      },
      patch,
    };
  }

  if (board.phase !== "vote") return { ok: false, reason: "wrong-phase" };
  if (!board.cards.some((c) => c.id === intent.cardId))
    return { ok: false, reason: "unknown-card" };
  const used = countOf(ledger.votesUsed, by);
  if (used >= MAX_VOTES) return { ok: false, reason: "vote-budget" };
  const patch: IntentPatch = { t: "vote", cardId: intent.cardId };
  return {
    ok: true,
    board: applyPatch(board, patch),
    ledger: {
      ...ledger,
      votesUsed: { ...ledger.votesUsed, [by]: used + 1 },
      recent: remember(ledger.recent, key),
    },
    patch,
  };
}
