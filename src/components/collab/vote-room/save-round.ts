"use client";

/**
 * "Save round", shared by the live room and the count entry: the tool gets
 * a round's totals once. If the tool hands back an undo, the kit offers
 * Undo in its toast, and after Undo the round can be saved again (a button
 * stuck on "Round saved" would make an undone round unsaveable, and the
 * room may already be gone).
 */

import { useCallback, useRef, useState } from "react";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { undoable } from "@/lib/utils/undoable";

/** A tool's save: store the totals, and optionally return how to take them out again. */
export type SaveVoteRound = (result: VoteRoundResult) => void | (() => void);

export interface SaveRoundState {
  /** Save `result` unless that round is already saved. */
  save: (result: VoteRoundResult | null) => void;
  /** Whether the round with this id is saved (and not undone). */
  isSaved: (roundId: string | null | undefined) => boolean;
}

export function useSaveRound(onSave: SaveVoteRound): SaveRoundState {
  const [savedRound, setSavedRound] = useState<string | null>(null);
  // A second click in the same tick sees the ref, not yet the state.
  const savedRef = useRef<string | null>(null);

  const save = useCallback(
    (result: VoteRoundResult | null) => {
      if (!result || savedRef.current === result.roundId) return;
      const id = result.roundId;
      const mark = (next: string | null) => {
        savedRef.current = next;
        setSavedRound(next);
      };
      const undo = onSave(result);
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
