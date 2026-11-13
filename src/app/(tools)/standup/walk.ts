/**
 * The live Daily Scrum's turn-taking: who is speaking, who has spoken, who
 * was skipped, and the clock for the current turn.
 *
 * Pure functions over a small state, plus an in-memory store so the walk
 * survives moving to another tool and back (the turn's clock is also
 * published to the app's docked timer, which shows on the other pages).
 * Nothing here is saved: a walk is today's meeting, not data.
 */

import { create } from "zustand";
import { useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";
import { personKey } from "./model";

export interface Walk {
  /** The day this walk is for; a walk from another day is ignored. */
  date: string;
  /** Who is speaking; null once everyone has had a turn. */
  current: string | null;
  /** Keys (personKey) of people who have had their turn. */
  spoken: string[];
  /**
   * Keys of people skipped (not here yet, on another call). They stay "not
   * yet" and get their turn after everyone else.
   */
  skipped: string[];
  /** Length of each turn, in seconds. */
  turnSeconds: number;
  /**
   * What the facilitator picked for each turn: a fixed length, or "auto"
   * (the Daily Scrum shared out among who's in). Kept with the walk so it
   * holds when they open the board and come back; absent, the walk keeps
   * its `turnSeconds`.
   */
  turnChoice?: number | "auto";
  /** Epoch ms the current turn ends while the clock runs; null while paused. */
  endsAt: number | null;
  /** Seconds left (negative once over) while paused. */
  pausedRemaining: number;
}

/** The Daily Scrum's timebox shared out, a minute to three each, in 15 s steps. */
export function autoTurnSeconds(speakers: number, dailyMinutes = 15): number {
  const each = (dailyMinutes * 60) / Math.max(1, speakers);
  return Math.min(180, Math.max(60, Math.round(each / 15) * 15));
}

/**
 * Who speaks next: the first person in `order` who hasn't spoken, putting
 * the skipped after everyone else. Never `current` itself.
 */
export function nextInLine(
  order: readonly string[],
  walk: Pick<Walk, "spoken" | "skipped">,
  current: string | null
): string | null {
  const cur = personKey(current);
  const waiting = order.filter((n) => !walk.spoken.includes(personKey(n)) && personKey(n) !== cur);
  return waiting.find((n) => !walk.skipped.includes(personKey(n))) ?? waiting[0] ?? null;
}

function withTurn(walk: Walk, current: string | null, now: number): Walk {
  return {
    ...walk,
    current,
    endsAt: current ? now + walk.turnSeconds * 1000 : null,
    pausedRemaining: current ? walk.turnSeconds : 0,
  };
}

/** A new walk, on the first person in line, clock running. */
export function startWalk(
  order: readonly string[],
  date: string,
  turnSeconds: number,
  now: number,
  turnChoice?: number | "auto"
): Walk {
  const base: Walk = {
    date,
    current: null,
    spoken: [],
    skipped: [],
    turnSeconds,
    ...(turnChoice !== undefined ? { turnChoice } : {}),
    endsAt: null,
    pausedRemaining: 0,
  };
  return withTurn(base, nextInLine(order, base, null), now);
}

/** The current speaker is done; on to the next (or the end). */
export function nextSpeaker(walk: Walk, order: readonly string[], now: number): Walk {
  if (!walk.current) return walk;
  const key = personKey(walk.current);
  const moved: Walk = {
    ...walk,
    spoken: walk.spoken.includes(key) ? walk.spoken : [...walk.spoken, key],
    skipped: walk.skipped.filter((k) => k !== key),
  };
  return withTurn(moved, nextInLine(order, moved, walk.current), now);
}

/**
 * Skip the current speaker for now: they stay "not yet" and come round
 * again after everyone else. With nobody else waiting, the turn stays.
 */
export function skipSpeaker(walk: Walk, order: readonly string[], now: number): Walk {
  if (!walk.current) return walk;
  const key = personKey(walk.current);
  const moved: Walk = {
    ...walk,
    skipped: walk.skipped.includes(key) ? walk.skipped : [...walk.skipped, key],
  };
  const next = nextInLine(order, moved, walk.current);
  return next ? withTurn(moved, next, now) : walk;
}

/**
 * The speaker turns out not to be in today's standup (on another call):
 * on to the next in line, without counting a turn for them.
 */
export function dropSpeaker(walk: Walk, order: readonly string[], now: number): Walk {
  if (!walk.current) return walk;
  const key = personKey(walk.current);
  const moved: Walk = {
    ...walk,
    spoken: walk.spoken.filter((k) => k !== key),
    skipped: walk.skipped.filter((k) => k !== key),
  };
  return withTurn(moved, nextInLine(order, moved, walk.current), now);
}

/** Give `name` the floor now (out of order, or a second turn). */
export function takeTurn(walk: Walk, name: string, now: number): Walk {
  const key = personKey(name);
  return withTurn(
    {
      ...walk,
      spoken: walk.spoken.filter((k) => k !== key),
      skipped: walk.skipped.filter((k) => k !== key),
    },
    name,
    now
  );
}

/** Seconds left in the current turn; negative once it runs over. */
export function turnRemaining(walk: Walk, now: number): number {
  if (walk.endsAt === null) return walk.pausedRemaining;
  return Math.ceil((walk.endsAt - now) / 1000);
}

export function pauseTurn(walk: Walk, now: number): Walk {
  if (walk.endsAt === null) return walk;
  return { ...walk, endsAt: null, pausedRemaining: turnRemaining(walk, now) };
}

export function resumeTurn(walk: Walk, now: number): Walk {
  if (walk.endsAt !== null || !walk.current) return walk;
  return { ...walk, endsAt: now + walk.pausedRemaining * 1000 };
}

export type TurnState = "speaking" | "spoke" | "skipped" | "waiting";

export function turnState(walk: Walk | null, name: string): TurnState {
  if (!walk) return "waiting";
  const key = personKey(name);
  if (personKey(walk.current) === key) return "speaking";
  if (walk.spoken.includes(key)) return "spoke";
  if (walk.skipped.includes(key)) return "skipped";
  return "waiting";
}

/** "2:05", or "+0:12" once over. */
export function turnClock(seconds: number): string {
  const over = seconds < 0;
  const s = Math.abs(Math.round(seconds));
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return over ? `+${clock}` : clock;
}

/** Today's walk, kept while the tab is open (not saved). */
export const useStandupWalk = create<{ walk: Walk | null; setWalk: (w: Walk | null) => void }>(
  (set) => ({ walk: null, setWalk: (walk) => set({ walk }) })
);

/** Test helper: forget the walk. */
export function resetStandupWalk(): void {
  useStandupWalk.setState({ walk: null });
}

/** The page that owns the standup's docked timer. */
export const STANDUP_PATH = "/standup";

/**
 * Mirror the turn's clock on the app's docked timer, so it keeps showing
 * while the facilitator opens the board or another tool. A timer another
 * page started (the Ceremony Timer's) is left alone: the walk then keeps
 * its own clock on this page only. A turn's time's up is never said by
 * sound (`chime: false`): the dock flashes the title only, even with the
 * shared "Chime when time is up" switch on.
 */
export function publishTurn(walk: Walk | null): void {
  const dock = useDockTimer.getState();
  if (dock.timer && dock.timer.href !== STANDUP_PATH) return;
  if (!walk?.current) {
    if (dock.timer) dock.stop();
    return;
  }
  dock.publish({
    label: `Standup: ${walk.current}`,
    href: STANDUP_PATH,
    totalSeconds: walk.turnSeconds,
    endsAt: walk.endsAt,
    pausedRemaining: Math.max(0, walk.pausedRemaining),
    chime: false,
  });
}

/**
 * The walk with the docked clock's state: pausing or resuming from the
 * dock on another page should hold when the facilitator comes back.
 *
 * A dock paused at 0:00 was not paused by anyone: the shell's DockedTimer
 * (mounted on every page, this one included) stops its own clock when the
 * time is up. The walk's turn keeps running then, so its overtime still
 * counts when the facilitator is back.
 */
export function withDockState(walk: Walk, timer: DockedTimer | null): Walk {
  if (!walk.current || !timer || timer.href !== STANDUP_PATH) return walk;
  if (timer.endsAt === null && walk.endsAt !== null) {
    if (timer.pausedRemaining <= 0) return walk;
    return { ...walk, endsAt: null, pausedRemaining: timer.pausedRemaining };
  }
  if (timer.endsAt !== null && walk.endsAt === null) return { ...walk, endsAt: timer.endsAt };
  return walk;
}

/** Whether the docked clock is the walk's (the dock then says "time's up" itself). */
export function dockIsStandup(): boolean {
  return useDockTimer.getState().timer?.href === STANDUP_PATH;
}

/**
 * Stop a docked "Standup: Bo" clock with no walk behind it. The walk lives
 * in memory and the docked clock in sessionStorage, so a reload mid-walk
 * (or a new day) left a pill on every page that opened a standup with no
 * turn running.
 */
export function stopOrphanedTurn(walk: Walk | null, today: string): void {
  if (walk && walk.date === today && walk.current) return;
  if (dockIsStandup()) useDockTimer.getState().stop();
}
