"use client";

/**
 * The room timer on screen (`lib/realtime/room-timer.ts`): the countdown
 * every visitor room shows on everyone's phone, the host's controls for it,
 * and the clock hook both use.
 *
 *   <RoomTimerControls timer={extras.timer} onChange={extras.setTimer} />   // host
 *   <RoomCountdown timer={extras.timer} alarm />                           // a phone
 *
 * Each screen counts down from the end time by itself. At zero the screen
 * that has `alarm` says time's up (assertively, once), rings the shared
 * alarm (`timesUp`), and the count turns into overtime counting up. Only
 * one countdown per device should have `alarm` (the big screen has none).
 * A participant also hears, politely, when the host starts, pauses,
 * extends or stops the timer (`useHostTimerNotes`); the ticking itself is
 * never read out.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Pause, Play, Plus, Square, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ChimeToggle } from "@/components/timer/chime-toggle";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { overtimeText, timesUp } from "@/lib/celebrate/chime";
import {
  ROOM_TIMER_PRESETS,
  addRoomTimerSeconds,
  formatRoomClock,
  isRoomTimerUp,
  pauseRoomTimer,
  resumeRoomTimer,
  roomTimerLeft,
  roomTimerOvertime,
  spokenDuration,
  startRoomTimer,
  type RoomTimer,
} from "@/lib/realtime/room-timer";
import { cn } from "@/lib/utils";

/**
 * This device's clock, re-read every second while `timer` runs (and while it
 * counts overtime), and right at its end even in a background tab.
 */
export function useTimerNow(timer: RoomTimer | null): number {
  const [now, setNow] = useState(() => Date.now());
  const running = timer !== null && timer.endsAt !== null;
  useVisibilityTick(running, 1000, () => setNow(Date.now()));
  const endsAt = timer?.endsAt ?? null;
  const paused = timer?.pausedSeconds ?? null;
  // A change shows at once, not on the next tick. (Keyed on the values, so
  // a caller that rebuilds an equal timer each render costs nothing.)
  useEffect(() => setNow(Date.now()), [endsAt, paused]);
  useEffect(() => {
    if (endsAt === null) return;
    const wait = endsAt - Date.now();
    if (wait < 0) return;
    const t = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(t);
  }, [endsAt]);
  return now;
}

export type RoomCountdownSize = "sm" | "md" | "lg" | "xl";

const DIGITS: Record<RoomCountdownSize, string> = {
  sm: "text-base",
  md: "text-3xl",
  lg: "text-5xl",
  xl: "text-7xl sm:text-8xl",
};

export interface RoomCountdownProps {
  timer: RoomTimer | null;
  /** Say and ring time's up on this screen. One countdown per device. */
  alarm?: boolean;
  size?: RoomCountdownSize;
  className?: string;
}

/** The countdown, its label, and once it runs out, time's up and the overtime. */
export function RoomCountdown({
  timer,
  alarm = false,
  size = "md",
  className,
}: RoomCountdownProps) {
  const now = useTimerNow(timer);
  const announce = useAnnounce();
  const running = timer !== null && timer.endsAt !== null;
  const up = timer !== null && isRoomTimerUp(timer, now);
  const label = timer?.label ?? "";

  // Ring once, on the tick that crosses zero (not for a timer already over
  // when this screen first saw it, such as on joining late).
  const seenRef = useRef<{ running: boolean; up: boolean } | null>(null);
  useEffect(() => {
    const prev = seenRef.current;
    seenRef.current = timer === null ? null : { running, up };
    if (!alarm || !up || !prev || prev.up || !prev.running) return;
    const what = label ? `${label}: time's up` : "Time's up";
    announce(what, "assertive");
    timesUp({ title: what });
  }, [alarm, timer, running, up, label, announce]);

  if (!timer) return null;
  const left = roomTimerLeft(timer, now);
  const over = roomTimerOvertime(timer, now);
  const paused = timer.endsAt === null;
  // Paused at zero: a timer that ended where nobody saw when (no overtime to count).
  const ended = paused && left === 0;
  const spoken =
    up || ended
      ? up
        ? `time's up, ${spokenDuration(over)} over`
        : "time's up"
      : paused
        ? `paused, ${spokenDuration(left)} left`
        : `${spokenDuration(left)} left`;

  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      {timer.label && (
        <span className="flex items-center gap-1.5 text-sm text-sub">
          <Timer className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{timer.label}</span>
        </span>
      )}
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          role="timer"
          aria-label={`${timer.label ? `${timer.label}: ` : ""}${spoken}`}
          className={cn(
            "font-mono font-bold tabular-nums leading-none",
            DIGITS[size],
            up || ended
              ? "text-warning"
              : paused
                ? "text-sub"
                : left <= 10
                  ? "text-status-red"
                  : "text-text"
          )}
        >
          {up || ended ? "Time's up" : formatRoomClock(left)}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "text-sm font-semibold",
            size === "xl" && "text-2xl",
            up ? "text-warning" : "text-sub"
          )}
        >
          {up ? overtimeText(over) : paused && !ended ? "Paused" : null}
        </span>
      </span>
    </div>
  );
}

/**
 * Say politely what the host did to the timer, for someone who can't see
 * it change: started, paused, running again, time added, stopped. A timer
 * already running when this screen first saw it (joining late) is said once
 * as it stands. Keepalives that re-anchor the same timer say nothing.
 */
export function useHostTimerNotes(timer: RoomTimer | null): void {
  const announce = useAnnounce();
  const prevRef = useRef<RoomTimer | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = timer;
    const now = Date.now();
    const left = timer ? spokenDuration(roomTimerLeft(timer, now)) : "";
    let note: string | null = null;
    if (!timer) {
      if (prev) note = "The timer stopped.";
    } else if (isRoomTimerUp(timer, now)) {
      // Time's up is said by the countdown's alarm (or was, before this screen saw it).
      note = null;
    } else if (prev === undefined) {
      // Joining late: say a running timer as it stands (a paused one waits for its next change).
      if (timer.endsAt !== null) note = `The host's timer: ${left} left.`;
    } else if (prev === null) {
      note = `The host started the timer: ${left} left.`;
    } else if (prev.endsAt !== null && timer.endsAt === null) {
      note = `The host paused the timer: ${left} left.`;
    } else if (prev.endsAt === null && timer.endsAt !== null) {
      note = `The timer is running again: ${left} left.`;
    } else if (timer.totalSeconds > prev.totalSeconds || isRoomTimerUp(prev, now)) {
      note = `The host added time: ${left} left.`;
    }
    if (note) announce(note);
  }, [timer, announce]);
}

export interface RoomTimerControlsProps {
  timer: RoomTimer | null;
  onChange: (next: RoomTimer | null) => void;
  /** Planning Poker: offer "Reveal the cards at zero". */
  autoRevealOption?: boolean;
  disabled?: boolean;
  className?: string;
}

const presetLabel = (s: number) => `${s / 60} min`;

/**
 * The host's timer for the whole room: a length to start (1 to 10 minutes),
 * then Pause or Resume, a minute more, and Stop. Everyone's phone shows the
 * same countdown; this screen rings at zero.
 *
 * Focus stays in the controls as they swap: a length sends it to Pause,
 * Stop sends it to the first length, and at zero Pause becomes "1 more
 * minute" in place (the separate "1 minute more" folds into it).
 */
export function RoomTimerControls({
  timer,
  onChange,
  autoRevealOption = false,
  disabled = false,
  className,
}: RoomTimerControlsProps) {
  const headingId = useId();
  const revealId = useId();
  const now = useTimerNow(timer);
  // The choice for the next timer, before one is set.
  const [autoReveal, setAutoReveal] = useState(false);
  const reveal = timer ? timer.autoReveal : autoReveal;
  const up = timer !== null && isRoomTimerUp(timer, now);
  const paused = timer !== null && timer.endsAt === null;
  const hasTimer = timer !== null;

  const primaryRef = useRef<HTMLButtonElement>(null);
  const firstPresetRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the row swaps (the pressed button is gone).
  const focusNextRef = useRef<"controls" | "presets" | null>(null);
  useEffect(() => {
    const want = focusNextRef.current;
    focusNextRef.current = null;
    if (want === "controls" && hasTimer) primaryRef.current?.focus();
    else if (want === "presets" && !hasTimer) firstPresetRef.current?.focus();
  }, [hasTimer]);
  // At zero "1 minute more" folds into the first button: if it had focus, follow it there.
  const moreFocusedRef = useRef(false);
  useEffect(() => {
    if (!up || !moreFocusedRef.current) return;
    moreFocusedRef.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) primaryRef.current?.focus();
  }, [up]);

  return (
    <section aria-labelledby={headingId} className={cn("space-y-2", className)}>
      <h2 id={headingId} className="text-xs font-semibold text-sub">
        Room timer
      </h2>
      {timer && <RoomCountdown timer={timer} alarm size="md" />}
      <div className="flex flex-wrap items-center gap-1.5">
        {!timer ? (
          <div
            role="group"
            aria-label="Start a timer for everyone"
            className="flex flex-wrap gap-1.5"
          >
            {ROOM_TIMER_PRESETS.map((s, i) => (
              // The group's name says what these do; each button's name is its
              // visible text, so "click 1 min" works by voice.
              <Button
                key={s}
                ref={i === 0 ? firstPresetRef : undefined}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  focusNextRef.current = "controls";
                  onChange(startRoomTimer(s, Date.now(), { autoReveal }));
                }}
              >
                {presetLabel(s)}
              </Button>
            ))}
          </div>
        ) : (
          <>
            {/* One button, two jobs: Pause or Resume, and once time is up,
                a minute more. It stays in place, so focus does too. */}
            <Button
              ref={primaryRef}
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={disabled}
              onClick={() =>
                onChange(
                  up
                    ? addRoomTimerSeconds(timer, 60, Date.now())
                    : paused
                      ? resumeRoomTimer(timer, Date.now())
                      : pauseRoomTimer(timer, Date.now())
                )
              }
            >
              {up ? (
                <Plus aria-hidden="true" />
              ) : paused ? (
                <Play aria-hidden="true" />
              ) : (
                <Pause aria-hidden="true" />
              )}
              {up ? "1 more minute" : paused ? "Resume" : "Pause"}
            </Button>
            {!up && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={disabled}
                onFocus={() => {
                  moreFocusedRef.current = true;
                }}
                onBlur={() => {
                  moreFocusedRef.current = false;
                }}
                onClick={() => onChange(addRoomTimerSeconds(timer, 60, Date.now()))}
              >
                <Plus aria-hidden="true" />1 minute more
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              disabled={disabled}
              onClick={() => {
                focusNextRef.current = "presets";
                onChange(null);
              }}
            >
              <Square aria-hidden="true" />
              Stop timer
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {autoRevealOption && (
          <div className="flex items-center gap-2">
            <Switch
              id={revealId}
              checked={reveal}
              disabled={disabled}
              onCheckedChange={(on) =>
                timer ? onChange({ ...timer, autoReveal: on }) : setAutoReveal(on)
              }
            />
            <Label htmlFor={revealId} className="text-sm text-sub">
              Reveal the cards at zero
            </Label>
          </div>
        )}
        <ChimeToggle />
      </div>
    </section>
  );
}

/**
 * A participant's view of the host's timer: nothing until the host starts
 * one, then the countdown (which rings here at zero) and the chime switch.
 */
export function RoomCountdownCard({
  timer,
  className,
}: {
  timer: RoomTimer | null;
  className?: string;
}) {
  useHostTimerNotes(timer);
  if (!timer) return null;
  return (
    <section
      aria-label="The host's timer"
      className={cn("space-y-2 rounded-lg border border-border bg-card p-3", className)}
    >
      <RoomCountdown timer={timer} alarm size="lg" />
      <ChimeToggle />
    </section>
  );
}
