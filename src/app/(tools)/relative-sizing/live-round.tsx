"use client";

import { useMemo, useState } from "react";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import type { SaveVoteRound } from "@/components/collab/vote-room/save-round";
import { CONSENSUS_LABELS } from "@/lib/estimation/consensus";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import type { VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import {
  LIVE_BATCH_MAX,
  liveBatch,
  liveCandidates,
  roundVerdicts,
  sizingQuestionnaire,
} from "@/lib/relative-sizing/live";
import type { SizingBoard } from "@/lib/relative-sizing/state";
import { cn } from "@/lib/utils";

/**
 * "Ask the room": every phone places the picked stories privately, as a
 * vote room's scale round with the buckets as the scale. The room sees
 * totals only, from the round's minN; a story fewer people placed is
 * withheld. Save round applies the totals to the board (the page's
 * `onSave`, with Undo); "Enter counts" takes counted hands instead.
 */
export function LiveRound({
  board,
  onSave,
  onStart,
  crypto,
}: {
  board: SizingBoard;
  onSave: SaveVoteRound;
  /** A live room opened, asking about this many stories (for the history log). */
  onStart?: (stories: number) => void;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}) {
  const candidates = liveCandidates(board);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [optional, setOptional] = useState(true);
  // A room stays open until the host ends it, even once its save (or a
  // card dragged on the board) leaves no story to ask about: the panel
  // keeps the round the room opened with.
  const [hosting, setHosting] = useState(false);
  const chosen = (picked ?? liveBatch(board)).filter((id) => candidates.some((c) => c.id === id));
  const questionnaire = useMemo(
    () => (chosen.length > 0 ? sizingQuestionnaire(board, chosen, optional) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the stories asked and the buckets
    [board.id, board.title, board.anchorItemId, board.buckets, chosen.join(","), optional]
  );
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const base = p ?? liveBatch(board);
      return on ? [...base.filter((x) => x !== id), id] : base.filter((x) => x !== id);
    });

  const allPlaced = (
    <p className="text-sm text-sub">
      Every story is placed. A live round asks about the ones not placed or still to talk about.
    </p>
  );
  if (candidates.length === 0 && !hosting) return allPlaced;

  return (
    <div className="space-y-3">
      {candidates.length === 0 ? (
        allPlaced
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-text">
            Stories to ask about ({chosen.length} of {LIVE_BATCH_MAX} at most)
          </legend>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.map((c) => {
              const on = chosen.includes(c.id);
              return (
                <li key={c.id}>
                  <label className="inline-flex min-h-8 items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && chosen.length >= LIVE_BATCH_MAX}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {c.title}
                  </label>
                </li>
              );
            })}
          </ul>
          <label className="inline-flex min-h-8 items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={optional}
              onChange={(e) => setOptional(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Let people skip stories they don&apos;t know
          </label>
        </fieldset>
      )}
      <VoteRoundPanel
        tool="relative-sizing"
        toolName="Relative Sizing"
        questionnaire={questionnaire}
        onSave={onSave}
        onLiveChange={(room) => {
          setHosting(room !== null);
          if (room) onStart?.(questionnaire?.questions.length ?? 0);
        }}
        renderResults={(result) => <SizingResults result={result} board={board} />}
        {...(crypto !== undefined ? { crypto } : {})}
      />
    </div>
  );
}

/** Per story: how many people put it in each bucket, and what that says. */
export function SizingResults({ result, board }: { result: VoteRoundResult; board: SizingBoard }) {
  const verdicts = new Map(roundVerdicts(result, board).map((v) => [v.itemId, v]));
  return (
    <ul className="space-y-3" aria-label="Where the room placed each story">
      {result.questions.map((q) => {
        const v = verdicts.get(q.id);
        const total = (q.distribution ?? []).reduce((a, b) => a + b, 0);
        return (
          <li key={q.id} className="space-y-1">
            <p className="text-sm font-medium text-text">{q.text}</p>
            {!q.distribution || v?.kind === "withheld" ? (
              <p className="text-xs text-sub">Fewer than {result.minN} placed it.</p>
            ) : (
              <>
                <ol className="flex flex-wrap gap-1" aria-label={`Placements of “${q.text}”`}>
                  {result.scale.points.map((p, i) => {
                    const n = q.distribution?.[i] ?? 0;
                    return (
                      <li
                        key={p.value}
                        className={cn(
                          "min-w-10 rounded border px-1.5 py-0.5 text-center text-xs",
                          n > 0
                            ? "border-accent/40 bg-accent/10 text-text"
                            : "border-border text-sub"
                        )}
                        aria-label={`${p.label}: ${n} of ${total}`}
                      >
                        <span className="block font-semibold">{p.label}</span>
                        {n}
                      </li>
                    );
                  })}
                </ol>
                <p className="text-xs text-sub">
                  {v?.kind === "placed"
                    ? `${CONSENSUS_LABELS[v.level]}: it goes in ${v.label}.`
                    : v?.kind === "outlier"
                      ? `${CONSENSUS_LABELS.spread}: from ${v.low} to ${v.high}. It goes to Talk about it.`
                      : ""}
                </p>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
