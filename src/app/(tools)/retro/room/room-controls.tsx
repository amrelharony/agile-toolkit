"use client";

/**
 * Small pieces shared by the host's live strip (on the Board) and the
 * participant view: the member list with Remove, the idle prompt, the
 * host's "Hide cards while writing" switch, the read-only phase steps and
 * the countdown readout.
 *
 * The member list and the idle prompt live in `components/collab` (every
 * visitor room uses them) and are re-exported here, the prompt with the
 * Retro board's reassurance.
 *
 * Names come from presence or the host's snapshot, already checked for
 * control and bidi characters, and render as React text only.
 */

import { useEffect, useId, useState } from "react";
import { Timer } from "lucide-react";
import {
  IdlePromptDialog as SharedIdlePromptDialog,
  type IdlePromptDialogProps,
} from "@/components/collab/room-controls";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PHASES, type BoardPhase } from "../types";
import { formatTimer } from "../helpers";
import { timerRemaining, type RoomTimerView } from "./use-retro-room";

export { RoomMemberList, type RoomMemberListProps } from "@/components/collab/room-controls";

/** The shared idle prompt: ending the room keeps the host's board. */
export function IdlePromptDialog(props: Omit<IdlePromptDialogProps, "note">) {
  return <SharedIdlePromptDialog {...props} note="Your board stays here either way." />;
}

/**
 * The host's "Hide cards while writing" switch. On (the default), each
 * person sees only their own cards until the host moves to Vote, and the
 * host's screen hides the others' cards too.
 */
export function HideCardsSetting({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex max-w-sm items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={hintId}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm text-text">
          Hide cards while writing
        </Label>
        <p id={hintId} className="text-xs text-sub">
          Until you move to Vote, each person sees only their own cards. This screen hides them too.
        </p>
      </div>
    </div>
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
