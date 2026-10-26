/**
 * A Kano survey through the vote-room kit's PAIR round: each person
 * answers the two questions about every feature on their own phone (or on
 * paper, counted into the kit's 5×5 grid per feature), and the round keeps
 * only each feature's 5×5 joint count of answer pairs, nothing per person.
 * Saving folds a feature's joint into its class counts A/O/M/I/R/Q through
 * the method registry (countsFromJoint) and stores those on the row: they
 * REPLACE its earlier counts unless "Add to earlier answers" is on
 * (kanoRoundFields, the fold tool.kano_model.record_round uses too). Pure.
 */

import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { countsFromJoint, kanoRoundFields, readKano } from "@/lib/prioritization/methods/kano";
import { KANO, scoreCache } from "@/lib/prioritization/methods";
import { isExampleId } from "@/lib/utils/example-id";
import {
  KANO_PAIR_ANSWERS,
  KANO_PAIR_PROMPTS,
  type PairRoundResult,
  type PairSheet,
} from "@/lib/realtime/vote-room/pair";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { ID_RE } from "@/lib/realtime/vote-room/wire";
import { FRAMEWORK } from "./model";

/** The survey's id (one sheet: the features on the list now). */
export const KANO_SHEET_ID = "kano-survey";

export interface KanoSurvey {
  /** Null when there's nothing to ask (no features of the user's own). */
  sheet: PairSheet | null;
  /** Features left out: over the live cap, or with an id the room can't carry. */
  left: number;
}

/**
 * The paired question for each of the user's features (examples left
 * out), at most VOTE_LIMITS.maxPairItems: over that, unanswered features
 * are the ones asked. The sheet keeps list order either way. The count
 * grid starts over when the sheet's order changes, so an order that put
 * unanswered features first would reshuffle as soon as a round was saved,
 * or counts were typed in a row editor, and wipe the boxes being filled.
 * Every feature is optional, so a customer can skip one they don't know.
 */
export function kanoSurvey(rows: readonly PrioritizationItem[]): KanoSurvey {
  const own = rows.filter(
    (r) => r.framework === FRAMEWORK && !isExampleId(r.id) && r.title.trim() !== ""
  );
  const usable = own.filter((r) => ID_RE.test(r.id));
  const answered = (r: PrioritizationItem) => readKano(r.fields).counts !== null;
  const chosen = new Set(
    [...usable.filter((r) => !answered(r)), ...usable.filter(answered)]
      .slice(0, VOTE_LIMITS.maxPairItems)
      .map((r) => r.id)
  );
  const asked = usable.filter((r) => chosen.has(r.id));
  return {
    sheet:
      asked.length === 0
        ? null
        : {
            id: KANO_SHEET_ID,
            title: "Kano survey",
            prompts: { ...KANO_PAIR_PROMPTS },
            answers: [...KANO_PAIR_ANSWERS],
            items: asked.map((r) => ({
              id: r.id,
              text: r.title.trim().slice(0, VOTE_LIMITS.maxQuestionChars),
              optional: true,
            })),
          },
    left: own.length - asked.length,
  };
}

/**
 * True when the row already holds this round's counts (the round was
 * saved, and nobody has typed over them since: a hand edit drops the
 * round id). Folding the round in again would count it twice with "Add to
 * earlier answers" on.
 */
export function holdsRound(row: PrioritizationItem, result: Pick<PairRoundResult, "roundId">) {
  return row.fields?.kanoRoundId === result.roundId;
}

/**
 * The rows a saved round changes: each feature the round revealed (a
 * joint, so at least 3 answers) that is still on the list, with its counts
 * replaced, or added to its earlier answers when `add` is on. Features
 * withheld (fewer than 3 answers), gone, or already holding this round are
 * skipped, so applying a round twice changes nothing the second time.
 */
export function applyKanoRound(
  rows: readonly PrioritizationItem[],
  result: PairRoundResult,
  opts: { add: boolean; now?: string }
): PrioritizationItem[] {
  const now = opts.now ?? new Date().toISOString();
  const byId = new Map(rows.filter((r) => r.framework === FRAMEWORK).map((r) => [r.id, r]));
  const out: PrioritizationItem[] = [];
  for (const item of result.items) {
    const row = byId.get(item.id);
    const fresh = item.joint ? countsFromJoint(item.joint) : null;
    if (!row || !fresh || holdsRound(row, result)) continue;
    const fields = kanoRoundFields(row.fields, fresh, {
      add: opts.add,
      source: result.source === "live" ? "room" : "tally",
      roundId: result.roundId,
      at: result.closedAt,
    });
    // The row's score cache follows the new counts (a later lifecycle status stays).
    const cache = scoreCache(KANO.evaluate(KANO.read(fields)), row.status);
    const next: PrioritizationItem = { ...row, fields, status: cache.status, updatedAt: now };
    if (cache.score === undefined) delete next.score;
    else next.score = cache.score;
    out.push(next);
  }
  return out;
}
