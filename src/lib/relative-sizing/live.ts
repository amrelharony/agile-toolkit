/**
 * Relative Sizing's live round: every phone places the stories privately,
 * as a vote room's scale round (no new room kind). The stories are the
 * questions, the buckets the scale's points (value = bucket index + 1,
 * label = the bucket's label), and the room shows only totals per story,
 * from the round's minN. The anchor story travels in the round's title, so
 * every phone sizes against the same known story.
 *
 * Saving a round turns its totals into placements: the counts are read as
 * votes on the buckets (`votesFromCounts`), then as Planning Poker reads a
 * table: agree or close moves the card to the suggested bucket, spread
 * sends it to Talk about it with the room's counts. Only totals are kept.
 * Pure; the page alone loads it (it reads the vote kit's protocol).
 */

import { consensusOf, type ConsensusLevel } from "@/lib/estimation/consensus";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { VOTE_LIMITS, type Questionnaire } from "@/lib/realtime/vote-room/protocol";
import type { SavedSizingRound, SizingBoard, SizingItem } from "./state";

/** Stories one round takes by default: a phone form of 20 stories stays short enough. */
export const LIVE_BATCH_DEFAULT = 20;
/** The most a round can carry. */
export const LIVE_BATCH_MAX = VOTE_LIMITS.maxQuestions;

const cut = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/** The cards a round can ask about: unplaced and contested ones, the anchor left out. */
export function liveCandidates(board: SizingBoard): SizingItem[] {
  return board.items.filter((i) => i.id !== board.anchorItemId && (i.contested || !i.bucketId));
}

/** The round's default batch: the first 20 candidates. */
export function liveBatch(board: SizingBoard): string[] {
  return liveCandidates(board)
    .slice(0, LIVE_BATCH_DEFAULT)
    .map((i) => i.id);
}

/**
 * The round's title: "<board> · “<anchor>” is a <label>", at most 120
 * characters, the anchor's title cut first; the board's title alone with
 * no anchor placed.
 */
export function sizingTitle(board: SizingBoard): string {
  const max = VOTE_LIMITS.maxTitleChars;
  const anchor = board.items.find((i) => i.id === board.anchorItemId);
  const bucket = anchor?.bucketId ? board.buckets.find((b) => b.id === anchor.bucketId) : undefined;
  const title = board.title.replace(/\s+/g, " ").trim();
  if (!anchor || !bucket) return cut(title, max);
  const tail = (a: string) => ` · “${a}” is a ${bucket.label}`;
  const fixed = tail("").length;
  // The anchor's title is cut first; the board's only when it leaves the anchor under 24.
  const boardPart = max - fixed - title.length >= 24 ? title : cut(title, max - fixed - 24);
  return cut(`${boardPart}${tail(cut(anchor.title, max - fixed - boardPart.length))}`, max);
}

/**
 * The questionnaire for `ids` (in the board's order): one optional question
 * per story when people may skip the ones they don't know, the buckets as
 * the scale. Ids past the round's limit, or not on the board, are left out.
 * The vote panel checks the questionnaire itself and says why a round
 * can't be carried.
 */
export function sizingQuestionnaire(
  board: SizingBoard,
  ids: readonly string[],
  optional = true
): Questionnaire {
  const wanted = new Set(ids);
  return {
    id: `sizing:${board.id}`.slice(0, VOTE_LIMITS.maxIdChars),
    title: sizingTitle(board),
    scale: {
      id: "buckets",
      points: board.buckets.map((b, i) => ({ value: i + 1, label: b.label })),
    },
    questions: board.items
      .filter((i) => wanted.has(i.id))
      .slice(0, LIVE_BATCH_MAX)
      .map((i) => ({
        id: i.id,
        text: cut(i.title, VOTE_LIMITS.maxQuestionChars),
        ...(optional ? { optional: true } : {}),
      })),
  };
}

/** Counts per bucket as the votes they stand for: [0, 2, 1] on 3, 5, 8 is 5, 5, 8. */
export function votesFromCounts(counts: readonly number[], labels: readonly string[]): string[] {
  const out: string[] = [];
  counts.forEach((n, i) => {
    const label = labels[i];
    if (label === undefined) return;
    for (let k = 0; k < Math.max(0, Math.floor(n)); k++) out.push(label);
  });
  return out;
}

export type StoryVerdict =
  | { itemId: string; kind: "placed"; level: ConsensusLevel; bucketId: string; label: string }
  | { itemId: string; kind: "outlier"; low: string | null; high: string | null }
  | { itemId: string; kind: "withheld" };

/** What a revealed round says per story, against the board's buckets as they are now. */
export function roundVerdicts(result: VoteRoundResult, board: SizingBoard): StoryVerdict[] {
  const labels = result.scale.points.map((p) => p.label);
  return result.questions.map((q) => {
    if (!q.distribution) return { itemId: q.id, kind: "withheld" as const };
    const c = consensusOf(votesFromCounts(q.distribution, labels), labels);
    if (c.level === null) return { itemId: q.id, kind: "withheld" as const };
    if (c.level === "spread") {
      return { itemId: q.id, kind: "outlier" as const, low: c.low, high: c.high };
    }
    const bucket = board.buckets.find((b) => b.label === c.suggested);
    if (!bucket) return { itemId: q.id, kind: "withheld" as const };
    return {
      itemId: q.id,
      kind: "placed" as const,
      level: c.level,
      bucketId: bucket.id,
      label: bucket.label,
    };
  });
}

export interface RoundPlacements {
  board: SizingBoard;
  saved: SavedSizingRound;
  placed: number;
  outliers: number;
  withheld: number;
}

/**
 * A revealed round applied to the board: agree and close place the card in
 * the suggested bucket (settled: not contested, no move counted, and a card
 * from Talk about it starts its moves again), spread
 * sends it to Talk about it; both keep the room's totals on the card. A
 * withheld story (fewer than minN placed it) stays where it was. Returns
 * the round as it is kept: totals only, no member ids.
 */
export function placementsFromRound(
  result: VoteRoundResult,
  board: SizingBoard,
  now: string
): RoundPlacements {
  const verdicts = new Map(roundVerdicts(result, board).map((v) => [v.itemId, v]));
  const dist = new Map(result.questions.map((q) => [q.id, q]));
  let placed = 0;
  let outliers = 0;
  let withheld = 0;
  const items = board.items.map((item) => {
    const v = verdicts.get(item.id);
    const q = dist.get(item.id);
    if (!v || !q) return item;
    if (v.kind === "withheld" || !q.distribution) {
      withheld += 1;
      return item;
    }
    const counts = board.buckets.map((_, i) => q.distribution?.[i] ?? 0);
    if (v.kind === "outlier") {
      outliers += 1;
      return {
        ...item,
        contested: true,
        room: { counts, responses: q.responses, level: "spread" as const },
      };
    }
    placed += 1;
    const out: SizingItem = {
      ...item,
      bucketId: v.bucketId,
      room: { counts, responses: q.responses, level: v.level },
    };
    // Settled from Talk about it, as moveItem settles one: its moves start again.
    if (item.contested) out.moves = 0;
    delete out.contested;
    return out;
  });
  return {
    board: { ...board, items, updatedAt: now },
    saved: {
      roundId: result.roundId,
      boardId: board.id,
      closedAt: result.closedAt,
      source: result.source,
      ballots: result.ballots,
      minN: result.minN,
      stories: result.questions.map((q) => ({
        itemId: q.id,
        title: q.text,
        counts: q.distribution ? [...q.distribution] : null,
        responses: q.responses,
      })),
    },
    placed,
    outliers,
    withheld,
  };
}
