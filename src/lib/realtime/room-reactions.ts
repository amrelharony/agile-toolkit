/**
 * Emoji reactions in a visitor room: six emoji anyone in the room can send,
 * which rise briefly over the room screen for everyone and are never kept.
 *
 * A reaction is an index into `ROOM_REACTIONS`, nothing else: no text from
 * the wire is ever shown. The screen shows the emoji without a name. Each
 * member may send a short burst, then one every couple of seconds; every
 * receiver applies the same limit per sender (`createReactionLimiter`), so a
 * script can't flood anyone's screen, and the screen holds a fixed number at
 * once.
 *
 * Pure and server-safe: no React, no browser globals.
 */

import { isWithinJsonSize } from "./sanitize";
import { ID_RE, obj } from "./vote-room/wire";

/** The broadcast event reactions travel on. */
export const ROOM_REACT_EVENT = "room:react";
export const ROOM_REACT_VERSION = 1 as const;

/** The six reactions, in the order the bar shows them. Wire messages carry the index. */
export const ROOM_REACTIONS = [
  { emoji: "👍", label: "Thumbs up" },
  { emoji: "👏", label: "Applause" },
  { emoji: "😂", label: "Laugh" },
  { emoji: "😮", label: "Wow" },
  { emoji: "❤️", label: "Love it" },
  { emoji: "🤔", label: "Hmm" },
] as const;

export const REACTION_LIMITS = {
  /** Reactions one member may send in a row. */
  burst: 3,
  /** Then one more per this many ms. */
  refillMs: 2000,
  /** How long a reaction stays on screen. */
  showMs: 2400,
  /** Reactions on screen at once; the oldest goes first. */
  maxOnScreen: 24,
  /** Senders the limiter remembers; the least recent is forgotten past this. */
  maxSenders: 64,
  /** Largest reaction message accepted, in JSON characters. */
  maxChars: 120,
} as const;

export interface ReactionMessage {
  v: typeof ROOM_REACT_VERSION;
  by: string;
  /** Index into `ROOM_REACTIONS`. */
  r: number;
}

/** Whether `r` is one of the six reactions. */
export function isReactionIndex(r: unknown): r is number {
  return typeof r === "number" && Number.isInteger(r) && r >= 0 && r < ROOM_REACTIONS.length;
}

/** A reaction from the wire, rebuilt so extra fields are dropped, or null. */
export function readReactionMessage(raw: unknown): ReactionMessage | null {
  if (!isWithinJsonSize(raw, REACTION_LIMITS.maxChars)) return null;
  const m = obj(raw);
  if (!m || m.v !== ROOM_REACT_VERSION) return null;
  if (typeof m.by !== "string" || !ID_RE.test(m.by)) return null;
  if (!isReactionIndex(m.r)) return null;
  return { v: ROOM_REACT_VERSION, by: m.by, r: m.r };
}

export interface ReactionLimiter {
  /** Whether `by` may react at `now` (and, if so, it costs one). */
  allow(by: string, now: number): boolean;
}

/** A token bucket per sender: `burst` at once, then one per `refillMs`. */
export function createReactionLimiter(
  cfg: { burst?: number; refillMs?: number; maxSenders?: number } = {}
): ReactionLimiter {
  const burst = cfg.burst ?? REACTION_LIMITS.burst;
  const refillMs = cfg.refillMs ?? REACTION_LIMITS.refillMs;
  const maxSenders = cfg.maxSenders ?? REACTION_LIMITS.maxSenders;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    allow(by, now) {
      const prev = buckets.get(by);
      const tokens = prev
        ? Math.min(burst, prev.tokens + Math.max(0, now - prev.at) / refillMs)
        : burst;
      // Most recent last, so the first key is the least recent sender.
      buckets.delete(by);
      if (tokens < 1) {
        buckets.set(by, { tokens, at: now });
        return false;
      }
      buckets.set(by, { tokens: tokens - 1, at: now });
      while (buckets.size > maxSenders) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
      return true;
    },
  };
}

/** A reaction on screen. */
export interface FloatingReaction {
  /** Unique on this screen. */
  key: string;
  /** Index into `ROOM_REACTIONS`. */
  r: number;
  /** Where across the room screen it rises, 0.08–0.92 of the width. */
  lane: number;
  /** When it appeared (this device's clock). */
  at: number;
}

const GOLDEN = 0.618033988749895;

/** The lane for the `n`th reaction: spread evenly without chance (golden-ratio steps). */
export function reactionLane(n: number): number {
  const f = (n * GOLDEN) % 1;
  return 0.08 + f * 0.84;
}

/** `list` with `next` added and only the newest `maxOnScreen` kept. */
export function addFloating(
  list: readonly FloatingReaction[],
  next: FloatingReaction,
  max: number = REACTION_LIMITS.maxOnScreen
): FloatingReaction[] {
  const out = [...list, next];
  return out.length > max ? out.slice(out.length - max) : out;
}
