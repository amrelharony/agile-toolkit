/**
 * Visitor live rooms: the gate and the shared rules.
 *
 * A visitor (no owner sign-in, no squad invite) can run Planning Poker or
 * a Retro live with their team over a temporary Supabase broadcast and
 * presence channel, and anyone can run an anonymous vote round (Health
 * Check, Psych Safety, Mood Tracker) the same way. Nothing is written to a
 * database. The whole feature is off unless the build sets
 * `NEXT_PUBLIC_VISITOR_ROOMS=1`.
 *
 * Owners don't run Poker or Retro visitor rooms: strangers' cards and
 * votes would sync into the owner's workspace. Vote rounds are the one,
 * documented exception (RUNBOOK "Live vote rounds"): the owner hosts them
 * here too, because participants following a `/join` link hold only the
 * anon key, and they can send nothing but encrypted scale indexes, of which
 * only the totals reach the workspace, on an explicit Save
 * (`vote-room/protocol.ts`).
 *
 * Security model (see RUNBOOK "Visitor live rooms"): the anon key can open
 * any `visitor:` channel (public, or private through migration 0026/0027's
 * visitor branch), so the 12-character code is the only thing keeping
 * strangers out (31^12, about 2^59 codes). Anyone holding the link is a
 * full member and can claim to be the host to other participants in Poker
 * and Retro; every inbound message is validated, capped and rate-limited,
 * and only the trusted host's state is applied. Vote rounds also sign the
 * host's messages and encrypt answers to the host.
 *
 * No browser globals at import time: the server join page imports the
 * code and tool checks.
 */

import { nanoid } from "nanoid";
import { cleanName, MAX_NAME_LENGTH } from "./sanitize";
import type { InboundLimitConfig } from "./rate-limit";

// ── Kill switch ──────────────────────────────────────────────────────

/**
 * True only when the build set `NEXT_PUBLIC_VISITOR_ROOMS=1`. Next inlines
 * the value at build time, so turning it on or off needs a redeploy.
 * Read on every call (not cached) so tests can stub it.
 */
export function visitorRoomsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VISITOR_ROOMS === "1";
}

// ── Tools and codes ──────────────────────────────────────────────────

/**
 * The tools that can run a visitor room. Migration 0027 lists the same
 * tools in the Realtime policy's visitor branch: change both together
 * (test/realtime/visitor-topic-migration.test.ts checks they agree).
 */
export const VISITOR_TOOLS = [
  "planning-poker",
  "retro",
  "health-check",
  "psych-safety",
  "mood-tracker",
] as const;
export type VisitorTool = (typeof VISITOR_TOOLS)[number];

export function isVisitorTool(value: unknown): value is VisitorTool {
  return typeof value === "string" && (VISITOR_TOOLS as readonly string[]).includes(value);
}

/** Which room a tool's `/join` link opens. */
export type VisitorRoomKind = "poker" | "retro" | "vote";

/**
 * The room each visitor tool runs. `/join` routes on this, so a new tool
 * can't land in another tool's room by default: the compiler asks for its
 * entry here.
 */
export const VISITOR_ROOM_KIND: Readonly<Record<VisitorTool, VisitorRoomKind>> = {
  "planning-poker": "poker",
  retro: "retro",
  "health-check": "vote",
  "psych-safety": "vote",
  "mood-tracker": "vote",
};

/** The owner rooms' alphabet: no 0/O, 1/I/L, so codes read aloud cleanly. */
export const VISITOR_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const VISITOR_CODE_LENGTH = 12;
const VISITOR_CODE_RE = /^[23456789A-HJKMNP-Z]{12}$/;

/** A well-formed visitor room code. Owner rooms' 6-character codes fail. */
export function isVisitorRoomCode(value: unknown): value is string {
  return typeof value === "string" && VISITOR_CODE_RE.test(value);
}

/**
 * A fresh 12-character room code from `crypto.getRandomValues`, with
 * rejection sampling so every symbol is equally likely.
 */
export function newVisitorRoomCode(): string {
  const n = VISITOR_CODE_ALPHABET.length;
  const limit = 256 - (256 % n); // bytes at or above this would bias the modulo
  let out = "";
  const bytes = new Uint8Array(VISITOR_CODE_LENGTH * 2);
  while (out.length < VISITOR_CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && out.length < VISITOR_CODE_LENGTH; i++) {
      if (bytes[i] < limit) out += VISITOR_CODE_ALPHABET[bytes[i] % n];
    }
  }
  return out;
}

/**
 * The Realtime channel for a visitor room: `visitor:<tool>:<code>`. The
 * prefix can never collide with owner and guest rooms (`tool:…`). Null for
 * a tool outside the allowlist or a malformed code, so callers open nothing.
 */
export function visitorChannelName(tool: string, code: string): string | null {
  if (!isVisitorTool(tool) || !isVisitorRoomCode(code)) return null;
  return `visitor:${tool}:${code}`;
}

/** The path a participant opens to join: `/join/<tool>/<code>`. Null when invalid. */
export function joinUrl(tool: string, code: string): string | null {
  if (!isVisitorTool(tool) || !isVisitorRoomCode(code)) return null;
  return `/join/${tool}/${code}`;
}

// ── Limits ───────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;

export const VISITOR_LIMITS = {
  /** People in one room, host included. */
  maxMembers: 20,
  /** The host re-sends its state this often (plus once when someone joins). */
  keepaliveMs: 30_000,
  /** Largest broadcast accepted or sent, in JSON characters. */
  maxPayloadChars: 100_000,
  /**
   * The host ends the room this long after starting it, and every other
   * client leaves this long after joining, whatever happens.
   */
  hardTtlMs: 3 * HOUR_MS,
  /** The host offers to end the room after this long with no activity. */
  idleMs: 30 * 60 * 1000,
  /** After that offer, the room ends this long later unless the host keeps it. */
  idleGraceMs: 2 * 60 * 1000,
  /** Display names, as `cleanName` cuts them. */
  maxNameChars: MAX_NAME_LENGTH,
  /** One retro card or story line, as `cleanText` cuts it. */
  maxTextChars: 500,
  /**
   * Inbound broadcast budget. A host sends at most about 2 a second
   * (500 ms throttle) and a participant sends on each vote or card, so a
   * burst of 20 then 4 a second per sender is generous for people and
   * tight for scripts. The per-event budget covers 20 members at once.
   */
  inbound: {
    perSender: { capacity: 20, refillPerSec: 4 },
    perEvent: { capacity: 100, refillPerSec: 25 },
    maxSenders: 64,
  } satisfies InboundLimitConfig,
} as const;

// ── Per-room identity ────────────────────────────────────────────────

/** Who this browser tab is inside one visitor room. */
export interface VisitorIdentity {
  /** nanoid(16). Fresh per room, so ids can't link a person across rooms. */
  id: string;
  name: string;
}

const VISITOR_ID_RE = /^[A-Za-z0-9_-]{16}$/;
const IDENTITY_KEY_PREFIX = "agile-toolkit:visitor-room:";

/** A member id as visitor rooms issue them (nanoid, 16 characters). */
export function isVisitorMemberId(value: unknown): value is string {
  return typeof value === "string" && VISITOR_ID_RE.test(value);
}

/** A well-formed identity whose name is already clean (no control or bidi characters). */
export function isVisitorIdentity(value: unknown): value is VisitorIdentity {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<VisitorIdentity>;
  return isVisitorMemberId(v.id) && typeof v.name === "string" && cleanName(v.name) === v.name;
}

function identityKey(code: string): string {
  return `${IDENTITY_KEY_PREFIX}${code}`;
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked
  }
}

/**
 * The identity this tab already has in room `code` (kept in sessionStorage,
 * so a refresh rejoins as the same member and closing the tab forgets it).
 * Null when there is none, it's malformed, or storage is unavailable.
 */
export function readVisitorIdentity(code: string): VisitorIdentity | null {
  if (!isVisitorRoomCode(code)) return null;
  try {
    const raw = sessionStore()?.getItem(identityKey(code));
    if (!raw || raw.length > 1024) return null;
    const parsed: unknown = JSON.parse(raw);
    return isVisitorIdentity(parsed) ? { id: parsed.id, name: parsed.name } : null;
  } catch {
    return null;
  }
}

/**
 * Record the name chosen in the consent dialog for room `code`, keeping
 * this tab's id if it already has one there. Returns the identity to pass
 * to `useRoom`, or null when the code or name is unusable. Works (without
 * surviving a refresh) when storage is blocked.
 */
export function saveVisitorIdentity(code: string, name: string): VisitorIdentity | null {
  if (!isVisitorRoomCode(code)) return null;
  const clean = cleanName(name);
  if (!clean) return null;
  const identity: VisitorIdentity = {
    id: readVisitorIdentity(code)?.id ?? nanoid(16),
    name: clean,
  };
  try {
    sessionStore()?.setItem(identityKey(code), JSON.stringify(identity));
  } catch {
    /* storage full or blocked: the identity still works for this page */
  }
  return identity;
}

/** Forget this tab's identity in room `code` (after leaving or ending it). */
export function clearVisitorIdentity(code: string): void {
  if (!isVisitorRoomCode(code)) return;
  try {
    sessionStore()?.removeItem(identityKey(code));
  } catch {
    /* storage blocked */
  }
}

// ── Presence: validation and admission ───────────────────────────────

/** A presence entry that passed `readVisitorPresence`. `color` is still unvetted. */
export interface VisitorPresence {
  id: string;
  name: string;
  color: string;
  joinedAt: string;
}

/** Entries looked at per presence sync; anything past this is ignored. */
const PRESENCE_SCAN_LIMIT = VISITOR_LIMITS.maxMembers * 10;

/**
 * The well-formed members in a Supabase presence state, in its key order.
 * An entry is dropped unless its presence key equals its `id` (so one
 * client can't claim another's id under a second key), the id is a visitor
 * id, the name is clean, `joinedAt` is a real time and `color` is a short
 * string. The caller still maps `color` through its allowlist.
 */
export function readVisitorPresence(state: Record<string, unknown>): VisitorPresence[] {
  const out: VisitorPresence[] = [];
  let scanned = 0;
  for (const key of Object.keys(state)) {
    if (++scanned > PRESENCE_SCAN_LIMIT) break;
    const metas = state[key];
    const first: unknown = Array.isArray(metas) ? metas[0] : undefined;
    if (!first || typeof first !== "object") continue;
    const m = first as Record<string, unknown>;
    if (m.id !== key || !isVisitorMemberId(m.id)) continue;
    if (typeof m.name !== "string" || cleanName(m.name) !== m.name) continue;
    if (typeof m.color !== "string" || m.color.length > 32) continue;
    if (typeof m.joinedAt !== "string" || m.joinedAt.length > 40) continue;
    if (!Number.isFinite(Date.parse(m.joinedAt))) continue;
    out.push({ id: m.id, name: m.name, color: m.color, joinedAt: m.joinedAt });
  }
  return out;
}

export interface Admission {
  /** Members holding a seat, in the order this client first saw them. */
  admitted: string[];
  /** Members present past the cap, in the same order. */
  overflow: string[];
}

export interface AdmissionLedger {
  /**
   * Feed the ids present now. Ids seen for the first time queue behind
   * everyone already seated (several at once: sorted by id, with `selfId`
   * last, so this client never jumps ahead of people already in the room).
   * Ids no longer present give up their place. `selfId` counts as present.
   */
  update(present: readonly string[], selfId?: string): Admission;
}

/**
 * Seats members in the order this client first saw them, up to `max`.
 * The host's ledger decides who is in; everyone else uses theirs to cap
 * the member list they show.
 */
export function createAdmissionLedger(max: number = VISITOR_LIMITS.maxMembers): AdmissionLedger {
  const order = new Map<string, number>();
  let seq = 0;
  return {
    update(present, selfId) {
      const now = new Set(present);
      if (selfId) now.add(selfId);
      for (const id of Array.from(order.keys())) {
        if (!now.has(id)) order.delete(id);
      }
      const fresh = Array.from(now).filter((id) => !order.has(id) && id !== selfId);
      fresh.sort();
      if (selfId && !order.has(selfId)) fresh.push(selfId);
      for (const id of fresh) order.set(id, seq++);
      const ranked = Array.from(order.entries())
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => id);
      return { admitted: ranked.slice(0, max), overflow: ranked.slice(max) };
    },
  };
}

/**
 * Whether a joiner whose first presence sync shows `othersPresent` other
 * members should turn back: the room already holds `maxMembers` without it.
 */
export function isRoomFull(
  othersPresent: number,
  max: number = VISITOR_LIMITS.maxMembers
): boolean {
  return othersPresent >= max;
}
