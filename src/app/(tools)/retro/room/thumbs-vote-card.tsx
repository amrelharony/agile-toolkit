"use client";

/**
 * A participant's view of the host's thumbs vote (Lean Coffee): "Keep going
 * or move on?" about the topic being discussed. Thumb up or down while it's
 * open, and change it if you change your mind; once the host closes it,
 * the totals and what they say, or, with fewer than THUMBS_MIN_VOTERS
 * voters, a line that the totals stay hidden. The screen never shows who
 * voted what (the thumb itself isn't sealed on the wire: see thumbs.ts).
 */

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { thumbsDecision } from "@/lib/retro/lean-coffee";
import type { RoomPoll, ThumbChoice } from "./protocol";
import { thumbsTotalsShown } from "./thumbs";

/**
 * What a vote closed with fewer than THUMBS_MIN_VOTERS voters shows instead
 * of its totals. `canAsk`: the host, who can ask the room again; the phones
 * and the big screen leave that out.
 */
export function thumbsHiddenLine(voters: number, canAsk: boolean): string {
  const why =
    voters === 0
      ? "Nobody voted, so there are no totals."
      : `Only ${voters} ${voters === 1 ? "person" : "people"} voted, so the totals stay hidden.`;
  return `${why} ${canAsk ? "Decide together, or ask again." : "Decide together."}`;
}

/** A closed vote's totals, or null when too few voted for them to show. */
export function shownTotals(poll: {
  open: boolean;
  voters: number;
  keep?: number;
  move?: number;
}): { keep: number; move: number } | null {
  if (poll.open || !thumbsTotalsShown(poll.voters)) return null;
  if (poll.keep === undefined || poll.move === undefined) return null;
  return { keep: poll.keep, move: poll.move };
}

/** What the totals say, in a line. */
export function thumbsVerdict(tally: { keep: number; move: number }): string {
  switch (thumbsDecision(tally)) {
    case "keep":
      return "Most want to keep going.";
    case "move":
      return "Most want to move on.";
    case "tie":
      return "It's a tie: the facilitator decides.";
    default:
      return "Nobody voted.";
  }
}

export function ThumbsVoteCard({
  poll,
  myThumb,
  canVote,
  onThumb,
}: {
  poll: RoomPoll;
  myThumb: ThumbChoice | null;
  canVote: boolean;
  onThumb: (choice: ThumbChoice) => void;
}) {
  const voted = `${poll.voters} ${poll.voters === 1 ? "person has" : "people have"} voted.`;
  const totals = shownTotals(poll);
  return (
    <section
      aria-label="Keep going or move on?"
      className="space-y-2 rounded-lg border border-accent/40 bg-card px-4 py-3"
    >
      <h2 className="text-sm font-bold text-text">Keep going or move on?</h2>
      <p className="break-words text-sm text-sub">{poll.topic}</p>
      {poll.open ? (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Your thumb">
            <Button
              type="button"
              variant={myThumb === "keep" ? "default" : "outline"}
              aria-pressed={myThumb === "keep"}
              disabled={!canVote}
              onClick={() => onThumb("keep")}
              className="gap-1.5"
            >
              <ThumbsUp className="h-4 w-4" aria-hidden="true" />
              Keep going
            </Button>
            <Button
              type="button"
              variant={myThumb === "move" ? "default" : "outline"}
              aria-pressed={myThumb === "move"}
              disabled={!canVote}
              onClick={() => onThumb("move")}
              className="gap-1.5"
            >
              <ThumbsDown className="h-4 w-4" aria-hidden="true" />
              Move on
            </Button>
          </div>
          <p role="status" className="text-xs text-sub">
            {myThumb
              ? `You said ${myThumb === "keep" ? "keep going" : "move on"}. You can change it until the host closes the vote. ${voted}`
              : voted}
          </p>
        </>
      ) : totals ? (
        <p role="status" className="text-sm text-text">
          <span className="font-semibold">
            Keep going {totals.keep} · Move on {totals.move}.
          </span>{" "}
          {thumbsVerdict(totals)}
        </p>
      ) : (
        <p role="status" className="text-sm text-text">
          {thumbsHiddenLine(poll.voters, false)}
        </p>
      )}
    </section>
  );
}
