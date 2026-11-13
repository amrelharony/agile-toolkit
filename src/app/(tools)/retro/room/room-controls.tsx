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

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Timer } from "lucide-react";
import {
  IdlePromptDialog as SharedIdlePromptDialog,
  type IdlePromptDialogProps,
} from "@/components/collab/room-controls";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { RoomCountdown, useHostTimerNotes } from "@/components/collab/room-countdown";
import { ChimeToggle } from "@/components/timer/chime-toggle";
import { timesUp } from "@/lib/celebrate/chime";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { RoomTimer } from "@/lib/realtime/room-timer";
import { PHASES, type BoardPhase } from "../types";
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

/**
 * The room's countdown as a room timer (`lib/realtime/room-timer`), for the
 * shared `RoomCountdown`: running, it ends `remaining` seconds after it was
 * anchored. Once it reaches zero this device remembers when, so the
 * overtime counts up from there; a device that only ever saw it at zero
 * shows time's up without a count.
 */
export function useRetroRoomTimer(timer: RoomTimerView | null): RoomTimer | null {
  const endRef = useRef<number | null>(null);
  const running = timer?.running ?? false;
  const remaining = timer?.remaining ?? 0;
  const anchoredAt = timer?.anchoredAt ?? 0;
  const present = timer !== null;
  return useMemo(() => {
    if (!present) {
      endRef.current = null;
      return null;
    }
    const base = { totalSeconds: Math.max(1, remaining), label: "", autoReveal: false };
    if (running) {
      endRef.current = anchoredAt + remaining * 1000;
      return { ...base, endsAt: endRef.current, pausedSeconds: remaining };
    }
    if (remaining === 0 && endRef.current !== null) {
      return { ...base, endsAt: endRef.current, pausedSeconds: 0 };
    }
    endRef.current = null;
    return { ...base, endsAt: null, pausedSeconds: remaining };
  }, [present, running, remaining, anchoredAt]);
}

/**
 * A promoted host runs the room's timer with the Board's own widget
 * (`TimerWidget`), which only shows. This rings the shared alarm once when
 * that countdown crosses zero on this screen (not for one already at zero
 * when this person took over), says so, and returns when, for the widget's
 * overtime count. Null while it runs, or before it ran out here.
 */
export function useRoomTimerAlarm(
  timer: RoomTimerView | null,
  countdown: number | null
): number | null {
  const announce = useAnnounce();
  const [overSince, setOverSince] = useState<number | null>(null);
  const running = Boolean(timer?.running) && (countdown ?? 0) > 0;
  const wasRunningRef = useRef(running);
  useEffect(() => {
    const was = wasRunningRef.current;
    wasRunningRef.current = running;
    if (was && !running && countdown === 0) {
      announce("Time's up.", "assertive");
      timesUp();
      setOverSince(Date.now());
    } else if (timer === null || running || (countdown ?? 0) > 0) {
      setOverSince(null);
    }
  }, [timer, running, countdown, announce]);
  return overSince;
}

/**
 * The host's countdown, as a participant sees it: the shared countdown,
 * which rings the time's-up alarm here and counts the overtime up, and
 * says politely when the host pauses, restarts or adds to it.
 */
export function RoomTimerReadout({ timer }: { timer: RoomTimerView | null }) {
  const roomTimer = useRetroRoomTimer(timer);
  useHostTimerNotes(roomTimer);
  if (!roomTimer) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Timer className="w-4 h-4 text-sub" aria-hidden="true" />
      <RoomCountdown timer={roomTimer} alarm size="sm" />
      <ChimeToggle />
    </div>
  );
}
