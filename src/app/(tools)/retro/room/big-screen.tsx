"use client";

/**
 * What the Retro host's big screen shows (`RoomBigScreen`): the phase, how
 * many cards each column holds, and from Discuss on the top-voted cards.
 * While cards are hidden in Write, only the counts show, as on everyone's
 * phone. Card text renders as React text only.
 */

import { useMemo, useRef } from "react";
import type { RoomTimer } from "@/lib/realtime/room-timer";
import { PHASES, type BoardState, type RetroCard } from "../types";

/** Top cards the big screen lists from Discuss on. */
const TOP_CARDS = 6;

/**
 * The Board's own timer as a room timer, for the big screen: shown while it
 * runs and once it has run out (counting the overtime from that moment),
 * not while it sits paused.
 */
export function useBoardTimer(board: Pick<BoardState, "timerSeconds" | "timerRunning">) {
  const { timerSeconds: seconds, timerRunning: running } = board;
  const zeroAtRef = useRef<number | null>(null);
  const wasRunningRef = useRef(running);
  return useMemo<RoomTimer | null>(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = running;
    const base = { totalSeconds: Math.max(1, seconds), label: "", autoReveal: false };
    if (running) {
      zeroAtRef.current = null;
      return { ...base, endsAt: Date.now() + seconds * 1000, pausedSeconds: seconds };
    }
    if (seconds === 0) {
      if (wasRunning && zeroAtRef.current === null) zeroAtRef.current = Date.now();
      return zeroAtRef.current === null
        ? null
        : { ...base, endsAt: zeroAtRef.current, pausedSeconds: 0 };
    }
    zeroAtRef.current = null;
    return null;
  }, [running, seconds]);
}

export function RetroBigScreenRound({
  board,
  hidesCard,
}: {
  board: BoardState;
  /** The room's check for the others' cards hidden on this screen (Write), or null. */
  hidesCard: ((cardId: string) => boolean) | null;
}) {
  const phase = PHASES.find((p) => p.key === board.phase);
  const counts = board.format.columns.map((col) => ({
    key: col.key,
    label: col.label,
    n: board.cards.filter((c) => c.columnKey === col.key && c.groupedWith === null).length,
  }));
  const later = board.phase === "discuss" || board.phase === "actions";
  const top: RetroCard[] = later
    ? board.cards
        .filter((c) => c.groupedWith === null && !(hidesCard?.(c.id) ?? false))
        .sort((a, b) => b.votes - a.votes)
        .slice(0, TOP_CARDS)
    : [];
  return (
    <div className="space-y-5">
      <h2 className="text-3xl font-bold">{phase ? `${phase.label} phase` : "Retro"}</h2>
      {phase && <p className="text-2xl text-sub">{phase.description}</p>}
      {later && top.length > 0 ? (
        <ol aria-label="Top cards" className="space-y-2">
          {top.map((c) => (
            <li
              key={c.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3"
            >
              <span className="min-w-0 break-words text-2xl">{c.text}</span>
              <span className="shrink-0 font-data text-2xl text-sub">
                {c.votes} {c.votes === 1 ? "vote" : "votes"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ul aria-label="Cards per column" className="flex flex-wrap gap-4">
          {counts.map((c) => (
            <li
              key={c.key}
              className="flex min-w-36 flex-col gap-1 rounded-lg border border-border bg-card px-5 py-4"
            >
              <span className="text-xl text-sub">{c.label}</span>
              <span className="font-data text-5xl font-bold">{c.n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
