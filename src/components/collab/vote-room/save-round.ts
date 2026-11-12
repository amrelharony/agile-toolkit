"use client";

/**
 * "Save round", shared by the live room and the count entry: the tool gets
 * a round's totals once. If the tool hands back an undo, the kit offers
 * Undo in its toast, and after Undo the round can be saved again (a button
 * stuck on "Round saved" would make an undone round unsaveable, and the
 * room may already be gone). If the tool hands back `false`, it stored
 * nothing (every question withheld, say) and says why itself: the round
 * stays unsaved, so Save round stays available.
 *
 * Generic over the result: every kind of round (scale, pair, allocation)
 * saves the same way, and only `roundId` is read here.
 */

import { useCallback, useRef, useState } from "react";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import type { AllocationRoundResult } from "@/lib/realtime/vote-room/allocation";
import type { ChoiceRoundResult } from "@/lib/realtime/vote-room/choice";
import type { NumberRoundResult } from "@/lib/realtime/vote-room/number";
import type { PairRoundResult } from "@/lib/realtime/vote-room/pair";
import type { RankRoundResult } from "@/lib/realtime/vote-room/rank";
import { undoable } from "@/lib/utils/undoable";

/**
 * A tool's save: store the totals, and optionally return how to take them
 * out again. `false` means nothing was stored, and the tool has said why.
 */
export type SaveRound<R extends { roundId: string }> = (result: R) => void | false | (() => void);

/** Scale rounds (Health Check, Psych Safety, Mood Tracker). */
export type SaveVoteRound = SaveRound<VoteRoundResult>;
/** Pair rounds (Kano). */
export type SavePairRound = SaveRound<PairRoundResult>;
/** Allocation rounds (Buy-a-Feature, the $100 Test). */
export type SaveAllocationRound = SaveRound<AllocationRoundResult>;
/** Choice rounds (Quick Vote). */
export type SaveChoiceRound = SaveRound<ChoiceRoundResult>;
/** Rank rounds (Quick Vote). */
export type SaveRankRound = SaveRound<RankRoundResult>;
/** Number rounds (Quick Vote). */
export type SaveNumberRound = SaveRound<NumberRoundResult>;

export interface SaveRoundState<R extends { roundId: string } = VoteRoundResult> {
  /** Save `result` unless that round is already saved. */
  save: (result: R | null) => void;
  /** Whether the round with this id is saved (and not undone). */
  isSaved: (roundId: string | null | undefined) => boolean;
}

export function useSaveRound<R extends { roundId: string } = VoteRoundResult>(
  onSave: SaveRound<R>
): SaveRoundState<R> {
  const [savedRound, setSavedRound] = useState<string | null>(null);
  // A second click in the same tick sees the ref, not yet the state.
  const savedRef = useRef<string | null>(null);

  const save = useCallback(
    (result: R | null) => {
      if (!result || savedRef.current === result.roundId) return;
      const id = result.roundId;
      const mark = (next: string | null) => {
        savedRef.current = next;
        setSavedRound(next);
      };
      const undo = onSave(result);
      // Refused: nothing is marked, so the round can be saved later.
      if (undo === false) return;
      if (typeof undo !== "function") {
        mark(id);
        return;
      }
      undoable({
        label: "Saved the round",
        apply: () => mark(id),
        revert: () => {
          undo();
          if (savedRef.current === id) mark(null);
        },
      });
    },
    [onSave]
  );

  const isSaved = useCallback(
    (roundId: string | null | undefined) => roundId != null && savedRound === roundId,
    [savedRound]
  );

  return { save, isSaved };
}
