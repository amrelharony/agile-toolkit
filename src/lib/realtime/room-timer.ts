/**
 * A countdown the host runs in a visitor room, shown on everyone's phone.
 *
 * The room never sends a message a second. The host sends the timer only
 * when it changes (start, pause, resume, more time, stop) and again when
 * someone joins and on a slow keepalive; every screen counts down by itself
 * from the end time. Past zero the same end time drives an overtime count
 * up, so time's up needs no message either.
 *
 * Clocks differ between devices, so a message carries the host's clock at
 * sending (`at`) and each receiver moves the end time onto its own clock
 * (`anchorRoomTimer`): what everyone sees is the time left, not the host's
 * wall clock.
 *
 * In the signed rooms (vote, show, wall) the host signs each timer with the
 * room key and participants check it against the key pinned from the link's
 * `#k=`, so nobody else in the room can set a timer. Poker trusts the host
 * id, like its session (`use-room-extras.ts` does both).
 *
 * Pure and server-safe: no React, no browser globals.
 */

import { cleanText, isWithinJsonSize } from "./sanitize";
import { readSignature } from "./room-control";
import { ID_RE, isCleanText, obj } from "./vote-room/wire";

/** The broadcast event a room timer travels on. */
export const ROOM_TIMER_EVENT = "room:timer";
export const ROOM_TIMER_VERSION = 1 as const;

/** The longest timer: the room's own 3-hour limit. */
export const ROOM_TIMER_MAX_SECONDS = 3 * 60 * 60;
/** A label's longest length, as `cleanText` cuts it. */
export const ROOM_TIMER_LABEL_MAX = 60;
/** Overtime counts up this far past zero, then holds. */
export const ROOM_TIMER_MAX_OVERTIME_SECONDS = 99 * 60 + 59;
/** Largest timer message accepted, in JSON characters. */
export const ROOM_TIMER_MAX_CHARS = 600;
/** The lengths offered, in seconds. */
export const ROOM_TIMER_PRESETS = [60, 120, 180, 300, 600] as const;

export interface RoomTimer {
  /**
   * While it runs: epoch ms when it reaches zero, on the clock of whoever
   * holds this object (the host's own, or a receiver's after anchoring).
   * Past it, overtime counts up. Null while paused.
   */
  endsAt: number | null;
  /** While paused: whole seconds left. */
  pausedSeconds: number;
  /** The length it was set to, in whole seconds. */
  totalSeconds: number;
  /** What is being timed, e.g. "Discuss"; may be empty. */
  label: string;
  /** Planning Poker: the host reveals the cards when it reaches zero. */
  autoReveal: boolean;
}

export interface RoomTimerMessage {
  v: typeof ROOM_TIMER_VERSION;
  /** The host's member id. */
  by: string;
  /** Rises with every timer the host sends; receivers drop anything older. */
  seq: number;
  /** The host's clock (epoch ms) when it sent this. */
  at: number;
  timer: RoomTimer | null;
  /** Signed rooms: the host's signature over `roomTimerInput`. */
  sig?: string;
}

const clampSeconds = (s: number, max = ROOM_TIMER_MAX_SECONDS): number =>
  Math.max(0, Math.min(max, Math.round(Number.isFinite(s) ? s : 0)));

/** A timer of `seconds`, running from `now`. Null for a length under one second. */
export function startRoomTimer(
  seconds: number,
  now: number,
  opts: { label?: string; autoReveal?: boolean } = {}
): RoomTimer | null {
  const total = clampSeconds(seconds);
  if (total < 1) return null;
  return {
    endsAt: now + total * 1000,
    pausedSeconds: total,
    totalSeconds: total,
    label: cleanText(opts.label ?? "", ROOM_TIMER_LABEL_MAX) ?? "",
    autoReveal: opts.autoReveal === true,
  };
}

/** Whole seconds left: rounded up while it runs, never below zero. */
export function roomTimerLeft(t: RoomTimer, now: number): number {
  if (t.endsAt === null) return clampSeconds(t.pausedSeconds);
  return Math.max(0, Math.ceil((t.endsAt - now) / 1000));
}

/** Whether it ran out and is counting overtime. A paused timer is never up. */
export function isRoomTimerUp(t: RoomTimer, now: number): boolean {
  return t.endsAt !== null && now >= t.endsAt;
}

/** Whole seconds past zero (0 until it runs out), held at the overtime cap. */
export function roomTimerOvertime(t: RoomTimer, now: number): number {
  if (!isRoomTimerUp(t, now) || t.endsAt === null) return 0;
  return Math.min(ROOM_TIMER_MAX_OVERTIME_SECONDS, Math.floor((now - t.endsAt) / 1000));
}

/** Paused where it is. A timer already up or paused comes back unchanged. */
export function pauseRoomTimer(t: RoomTimer, now: number): RoomTimer {
  if (t.endsAt === null || isRoomTimerUp(t, now)) return t;
  return { ...t, endsAt: null, pausedSeconds: roomTimerLeft(t, now) };
}

/** Running again from what was left. A running timer, or one with nothing left, comes back unchanged. */
export function resumeRoomTimer(t: RoomTimer, now: number): RoomTimer {
  if (t.endsAt !== null || t.pausedSeconds < 1) return t;
  return { ...t, endsAt: now + t.pausedSeconds * 1000 };
}

/**
 * `seconds` more. A timer that ran out starts again with just those
 * seconds; a paused one stays paused with more left.
 */
export function addRoomTimerSeconds(t: RoomTimer, seconds: number, now: number): RoomTimer {
  const add = clampSeconds(seconds);
  if (add < 1) return t;
  if (t.endsAt === null) {
    const left = clampSeconds(t.pausedSeconds + add);
    return { ...t, pausedSeconds: left, totalSeconds: clampSeconds(t.totalSeconds + add) };
  }
  if (isRoomTimerUp(t, now)) {
    return { ...t, endsAt: now + add * 1000, pausedSeconds: add, totalSeconds: add };
  }
  const left = Math.min(ROOM_TIMER_MAX_SECONDS, roomTimerLeft(t, now) + add);
  return {
    ...t,
    endsAt: now + left * 1000,
    totalSeconds: clampSeconds(t.totalSeconds + add),
  };
}

/** "4:05", "12:00", "1:02:03". */
export function formatRoomClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Spoken length: "5 minutes", "1 minute 30 seconds", "45 seconds". */
export function spokenDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  const mins = m > 0 ? `${m} ${m === 1 ? "minute" : "minutes"}` : "";
  const secs = rest > 0 || m === 0 ? `${rest} ${rest === 1 ? "second" : "seconds"}` : "";
  return [mins, secs].filter(Boolean).join(" ");
}

// ── Wire ─────────────────────────────────────────────────────────────

/** The timer's fields as the signed text lists them, in order. */
function timerTuple(t: RoomTimer | null): unknown[] {
  return t ? [t.endsAt, t.pausedSeconds, t.totalSeconds, t.label, t.autoReveal] : [null];
}

/**
 * The text a signed room's host signs for a timer: a JSON array under its
 * own domain, with the tool and room code in it, so a signature can't pass
 * for another room's or for any other message.
 */
export function roomTimerInput(
  tool: string,
  code: string,
  m: Pick<RoomTimerMessage, "v" | "by" | "seq" | "at" | "timer">
): string {
  return JSON.stringify([
    "agile-toolkit:room-timer:v1",
    tool,
    code,
    m.v,
    m.by,
    m.seq,
    m.at,
    ...timerTuple(m.timer),
  ]);
}

const isWhole = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** A timer from the wire, rebuilt field by field, or null when anything is off. */
export function readRoomTimer(raw: unknown, sentAt: number): RoomTimer | null {
  const t = obj(raw);
  if (!t) return null;
  if (!isWhole(t.totalSeconds, 1, ROOM_TIMER_MAX_SECONDS)) return null;
  if (!isWhole(t.pausedSeconds, 0, ROOM_TIMER_MAX_SECONDS)) return null;
  if (typeof t.autoReveal !== "boolean") return null;
  if (t.label !== "" && !isCleanText(t.label, ROOM_TIMER_LABEL_MAX)) return null;
  const label = t.label as string;
  let endsAt: number | null = null;
  if (t.endsAt !== null) {
    if (typeof t.endsAt !== "number" || !Number.isFinite(t.endsAt)) return null;
    // From up to the overtime cap behind to up to the longest timer ahead
    // of the host's own clock when it sent this.
    const ahead = t.endsAt - sentAt;
    if (ahead > ROOM_TIMER_MAX_SECONDS * 1000 + 1000) return null;
    if (ahead < -(ROOM_TIMER_MAX_OVERTIME_SECONDS + 60) * 1000) return null;
    endsAt = t.endsAt;
  }
  return {
    endsAt,
    pausedSeconds: t.pausedSeconds,
    totalSeconds: t.totalSeconds,
    label,
    autoReveal: t.autoReveal,
  };
}

/** A timer message from the wire, shape-checked (not its signature), or null. */
export function readRoomTimerMessage(raw: unknown): RoomTimerMessage | null {
  if (!isWithinJsonSize(raw, ROOM_TIMER_MAX_CHARS)) return null;
  const m = obj(raw);
  if (!m || m.v !== ROOM_TIMER_VERSION) return null;
  if (typeof m.by !== "string" || !ID_RE.test(m.by)) return null;
  if (!isWhole(m.seq, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (typeof m.at !== "number" || !Number.isFinite(m.at) || m.at <= 0) return null;
  let timer: RoomTimer | null = null;
  if (m.timer !== null) {
    timer = readRoomTimer(m.timer, m.at);
    if (!timer) return null;
  }
  const sig = readSignature(m);
  if (m.sig !== undefined && !sig) return null;
  return {
    v: ROOM_TIMER_VERSION,
    by: m.by,
    seq: m.seq,
    at: m.at,
    timer,
    ...(sig ? { sig } : {}),
  };
}

/**
 * `t` moved from the sender's clock onto the receiver's: the end time keeps
 * its distance from the moment of sending, counted from the moment of
 * receipt. A paused timer has no end time to move.
 */
export function anchorRoomTimer(t: RoomTimer, sentAt: number, receivedAt: number): RoomTimer {
  if (t.endsAt === null) return t;
  return { ...t, endsAt: receivedAt + (t.endsAt - sentAt) };
}

/**
 * Whether two timers show the same thing: equal fields, and end times within
 * `slackMs` (a keepalive re-anchored a little differently shouldn't make the
 * countdown jump).
 */
export function sameRoomTimer(a: RoomTimer | null, b: RoomTimer | null, slackMs = 1000): boolean {
  if (a === null || b === null) return a === b;
  if (
    a.pausedSeconds !== b.pausedSeconds ||
    a.totalSeconds !== b.totalSeconds ||
    a.label !== b.label ||
    a.autoReveal !== b.autoReveal
  ) {
    return false;
  }
  if (a.endsAt === null || b.endsAt === null) return a.endsAt === b.endsAt;
  return Math.abs(a.endsAt - b.endsAt) <= slackMs;
}
