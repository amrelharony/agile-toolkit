"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { RoomBigScreen, useBigScreen } from "@/components/collab/room-big-screen";
import { RoomCountdownCard, RoomTimerControls } from "@/components/collab/room-countdown";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import type { RoomExtras } from "@/lib/realtime/use-room-extras";
import { IDLE_GRACE_MS } from "./use-poker-session";
import { REDACTED_VOTE } from "./merge";
import type { Session } from "./types";

const IDLE_MINUTES = Math.round(VISITOR_LIMITS.idleMs / 60_000);
const GRACE_MINUTES = Math.round(IDLE_GRACE_MS / 60_000);

export interface PokerRoomBarProps {
  code: string;
  /** People in the room, this person included. */
  memberCount: number;
  isHost: boolean;
  /** Host: end the room for everyone (asks first). */
  onEnd?: () => void;
  /** Participant: leave the room. */
  onLeave?: () => void;
  /** Host: the room has been idle; show the "keep it open" prompt. */
  idleWarning?: boolean;
  onKeepOpen?: () => void;
  /** The host's session carries on locally after End (the tool page). */
  keepsSession?: boolean;
  /**
   * The room's countdown (`useRoomExtras`): the host gets the timer, with
   * "Reveal the cards at zero"; everyone else sees the countdown.
   */
  extras?: RoomExtras | null;
  /** Host: the session, for "Big screen" (the story and how the vote stands). */
  session?: Session | null;
}

/**
 * Above a Planning Poker visitor room: the room chip (code, copy link,
 * n/20, Big screen, End or Leave), the room timer, the host's idle prompt,
 * and the End confirmation. The reactions go under the session
 * (`RoomReactions`).
 */
export function PokerRoomBar({
  code,
  memberCount,
  isHost,
  onEnd,
  onLeave,
  idleWarning = false,
  onKeepOpen,
  keepsSession = false,
  extras = null,
  session = null,
}: PokerRoomBarProps) {
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const big = useBigScreen();
  // Before the first presence sync this person is still in the room.
  const members = Math.max(1, memberCount);
  return (
    <div className="mb-3 flex flex-col gap-3">
      <VisitorRoomChip
        tool="planning-poker"
        code={code}
        memberCount={members}
        isHost={isHost}
        onEnd={onEnd ? () => setConfirmEndOpen(true) : undefined}
        onLeave={onLeave}
        onBigScreen={isHost && session ? big.show : undefined}
        className="self-start"
      />
      {extras &&
        (isHost ? (
          <RoomTimerControls
            timer={extras.timer}
            onChange={extras.setTimer}
            autoRevealOption
            disabled={!extras.canSetTimer}
            className="rounded-lg border border-border bg-card p-3"
          />
        ) : (
          <RoomCountdownCard timer={extras.timer} />
        ))}
      {isHost && idleWarning && onKeepOpen && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text"
        >
          <span className="flex-1">
            Nothing has happened for {IDLE_MINUTES} minutes. The live room closes in {GRACE_MINUTES}{" "}
            minutes unless you keep it open.
          </span>
          <Button type="button" variant="toolkit" size="sm" onClick={onKeepOpen}>
            Keep it open
          </Button>
        </div>
      )}
      {isHost && onEnd && (
        <ConfirmDialog
          open={confirmEndOpen}
          onOpenChange={setConfirmEndOpen}
          title="End the live room?"
          description={
            keepsSession
              ? "Everyone else leaves the room and can save a copy. Your session carries on here, on this device."
              : "Everyone leaves the room and can save a copy of the session."
          }
          confirmLabel="End room"
          onConfirm={onEnd}
        />
      )}
      {isHost && session && (
        <RoomBigScreen
          {...big.props}
          tool="planning-poker"
          toolName="Planning Poker"
          code={code}
          memberCount={members}
          timer={extras?.timer ?? null}
          reactions={extras?.reactions ?? []}
        >
          <PokerBigScreenRound session={session} />
        </RoomBigScreen>
      )}
    </div>
  );
}

/**
 * The story being estimated, large: how many have voted, and once the cards
 * are revealed, how many chose each card (no names on the big screen).
 */
export function PokerBigScreenRound({ session }: { session: Session }) {
  const story = session.stories[session.currentStoryIdx] ?? null;
  const voted = session.participants.filter((p) => p.vote !== null).length;
  const total = session.participants.length;
  const counts = new Map<string, number>();
  if (session.revealed) {
    for (const p of session.participants) {
      if (p.vote === null || p.vote === REDACTED_VOTE) continue;
      counts.set(p.vote, (counts.get(p.vote) ?? 0) + 1);
    }
  }
  // In the deck's order, so the spread reads left to right.
  const order = session.scale.filter((v) => counts.has(v));
  const extra = Array.from(counts.keys()).filter((v) => !session.scale.includes(v));
  const cards = [...order, ...extra];
  return (
    <div className="space-y-4">
      {story ? (
        <h2 className="break-words text-3xl font-bold">{story.title}</h2>
      ) : (
        <h2 className="text-3xl font-bold">No story yet</h2>
      )}
      {!session.revealed ? (
        <p className="text-2xl text-sub" aria-live="polite">
          {voted} of {total} voted
        </p>
      ) : cards.length === 0 ? (
        <p className="text-2xl text-sub">Revealed: nobody voted.</p>
      ) : (
        <ul aria-label="Votes by card" className="flex flex-wrap gap-4">
          {cards.map((v) => (
            <li
              key={v}
              className="flex min-w-24 flex-col items-center gap-1 rounded-lg border border-border bg-card px-5 py-4"
            >
              <span className="font-data text-5xl font-bold">{v}</span>
              <span className="text-lg text-sub">
                {counts.get(v)} {counts.get(v) === 1 ? "vote" : "votes"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {story?.finalEstimate && (
        <p className="text-2xl text-accent-green">Estimate: {story.finalEstimate}</p>
      )}
    </div>
  );
}
