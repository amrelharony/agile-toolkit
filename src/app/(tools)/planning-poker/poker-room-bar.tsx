"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { IDLE_GRACE_MS } from "./use-poker-session";

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
}

/**
 * Above a Planning Poker visitor room: the room chip (code, copy link,
 * n/20, End or Leave), the host's idle prompt, and the End confirmation.
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
}: PokerRoomBarProps) {
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  return (
    <div className="mb-3 flex flex-col gap-3">
      <VisitorRoomChip
        tool="planning-poker"
        code={code}
        // Before the first presence sync this person is still in the room.
        memberCount={Math.max(1, memberCount)}
        isHost={isHost}
        onEnd={onEnd ? () => setConfirmEndOpen(true) : undefined}
        onLeave={onLeave}
        className="self-start"
      />
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
    </div>
  );
}
