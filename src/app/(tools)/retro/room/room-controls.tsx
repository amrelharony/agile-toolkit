"use client";

/**
 * Small pieces shared by the host's live strip (on the Board) and the
 * participant view: the member list with Remove, the idle prompt, the
 * read-only phase steps and the countdown readout.
 *
 * Names come from presence or the host's snapshot, already checked for
 * control and bidi characters, and render as React text only.
 */

import { useEffect, useId, useState } from "react";
import { Timer, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PHASES, type BoardPhase } from "../types";
import { formatTimer } from "../helpers";
import { timerRemaining, type RoomTimerView } from "./use-retro-room";

export interface RoomMemberListProps {
  members: readonly { id: string; name: string }[];
  selfId: string;
  hostId: string | null;
  removedIds?: ReadonlySet<string>;
  /** Host only: offer Remove next to everyone else. */
  onRemove?: (id: string, name: string) => void;
  className?: string;
}

export function RoomMemberList({
  members,
  selfId,
  hostId,
  removedIds,
  onRemove,
  className,
}: RoomMemberListProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("space-y-1", className)}>
      <h2 id={headingId} className="text-xs font-semibold text-sub">
        In the room
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const removed = removedIds?.has(m.id) ?? false;
          const tags = [
            m.id === selfId ? "you" : null,
            m.id === hostId ? "host" : null,
            removed ? "removed" : null,
          ].filter(Boolean);
          return (
            <li
              key={m.id}
              className={cn(
                "flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs text-text",
                removed && "opacity-60"
              )}
            >
              <span className="max-w-[12rem] truncate">{m.name}</span>
              {tags.length > 0 && <span className="text-sub">({tags.join(", ")})</span>}
              {onRemove && m.id !== selfId && !removed && (
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  className="h-6 min-h-0 px-1"
                  aria-label={`Remove ${m.name} from the room`}
                  onClick={() => onRemove(m.id, m.name)}
                >
                  <UserMinus className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function IdlePromptDialog({
  open,
  onKeepOpen,
  onEnd,
}: {
  open: boolean;
  onKeepOpen: () => void;
  onEnd: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeepOpen()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keep the live room open?</DialogTitle>
          <DialogDescription>
            Nothing has happened in the room for 30 minutes. It ends in 2 minutes unless you keep it
            open. Your board stays here either way.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onEnd}>
            End room
          </Button>
          <Button type="button" variant="toolkit" onClick={onKeepOpen} autoFocus>
            Keep it open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Write → Vote → Discuss → Actions, read-only. */
export function RoomPhaseSteps({ current }: { current: BoardPhase }) {
  const idx = PHASES.findIndex((p) => p.key === current);
  return (
    <ol aria-label="Retro phases" className="flex flex-wrap items-center gap-1">
      {PHASES.map((phase, i) => (
        <li
          key={phase.key}
          aria-current={i === idx ? "step" : undefined}
          className={cn(
            "px-2.5 py-1 rounded-full text-xs font-semibold border",
            i === idx
              ? "bg-accent-cyan/20 text-accent border-accent-cyan"
              : i < idx
                ? "bg-accent-green/10 text-accent-green border-accent-green/30"
                : "bg-cardH text-sub border-border"
          )}
        >
          {i + 1}. {phase.label}
        </li>
      ))}
    </ol>
  );
}

/** Seconds left on `timer`, re-rendering every second while it runs. */
export function useRoomCountdown(timer: RoomTimerView | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const running = timer?.running ?? false;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, timer]);
  return timer ? timerRemaining(timer, Math.max(now, timer.anchoredAt)) : null;
}

/** The host's countdown, as a participant sees it. */
export function RoomTimerReadout({ timer }: { timer: RoomTimerView | null }) {
  const remaining = useRoomCountdown(timer);
  if (!timer || remaining === null) return null;
  const running = timer.running && remaining > 0;
  return (
    <p className="flex items-center gap-2 text-sm">
      <Timer className="w-4 h-4 text-sub" aria-hidden="true" />
      <span className="sr-only">Time left: </span>
      <span
        className={cn(
          "font-mono text-base font-bold tabular-nums",
          running && remaining <= 60 ? "text-status-red" : running ? "text-accent" : "text-sub"
        )}
      >
        {formatTimer(remaining)}
      </span>
      {!running && (
        <span className="text-xs text-sub">{remaining === 0 ? "Time's up" : "Paused"}</span>
      )}
    </p>
  );
}
