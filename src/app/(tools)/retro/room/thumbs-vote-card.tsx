"use client";

/**
 * A participant's view of the host's thumbs vote (Lean Coffee): "Keep going
 * or move on?" about the topic being discussed. Thumb up or down while it's
 * open, and change it if you change your mind; once the host closes it,
 * the totals and what they say. Never who voted what.
 */

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { thumbsDecision } from "@/lib/retro/lean-coffee";
import type { RoomPoll, ThumbChoice } from "./protocol";

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
      ) : (
        <p role="status" className="text-sm text-text">
          <span className="font-semibold">
            Keep going {poll.keep ?? 0} · Move on {poll.move ?? 0}.
          </span>{" "}
          {thumbsVerdict({ keep: poll.keep ?? 0, move: poll.move ?? 0 })}
        </p>
      )}
    </section>
  );
}
