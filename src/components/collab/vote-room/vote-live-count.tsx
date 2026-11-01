"use client";

/**
 * How many people have answered, the only number a round shows before
 * Reveal. Never per question: that would show who skipped what.
 *
 * Changes are announced politely through the app's live region, debounced
 * so a burst of answers is one announcement, not one per ballot.
 */

import { useEffect, useRef } from "react";
import { Users } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { RoundPhase } from "@/lib/realtime/vote-room/protocol";
import { cn } from "@/lib/utils";

/** Quiet time before a changed count is announced. */
export const LIVE_COUNT_ANNOUNCE_MS = 1_500;

export interface VoteLiveCountProps {
  ballots: number;
  /** People in the room now, the host included. */
  present: number;
  minN: number;
  phase: RoundPhase | null;
  className?: string;
}

function answersText(n: number): string {
  return `${n} ${n === 1 ? "person has" : "people have"} answered`;
}

/** The sentence the count shows (and announces). */
export function liveCountText({ ballots, present, minN, phase }: VoteLiveCountProps): string {
  if (phase === "revealed") return `Round closed: ${answersText(ballots)}.`;
  const room = `${present} ${present === 1 ? "person" : "people"} in the room.`;
  const more = Math.max(0, minN - ballots);
  const rule =
    more > 0
      ? ` Results can show once ${minN} have answered (${more} more).`
      : " Enough answers to reveal.";
  return `${answersText(ballots)}. ${room}${rule}`;
}

export function VoteLiveCount(props: VoteLiveCountProps) {
  const announce = useAnnounce();
  const text = liveCountText(props);
  // Only the answers are announced: the room chip already says who joins and leaves.
  const spoken =
    props.phase === "revealed"
      ? `Round closed: ${answersText(props.ballots)}.`
      : `${answersText(props.ballots)}.`;
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === null) {
      last.current = spoken;
      return;
    }
    if (last.current === spoken) return;
    const t = window.setTimeout(() => {
      last.current = spoken;
      announce(spoken);
    }, LIVE_COUNT_ANNOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [spoken, announce]);

  return (
    <p className={cn("flex items-start gap-2 text-sm text-text", props.className)}>
      <Users className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
