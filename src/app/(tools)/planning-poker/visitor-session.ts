/**
 * Planning Poker in a visitor live room: the extra wire rules.
 *
 * Owner and guest rooms only run `isValidSession`. A visitor room is open
 * to anyone holding the link, so on top of that:
 *
 * - every receiver (host included) refuses a session for another room,
 *   with more than `VISITOR_LIMITS.maxMembers` participants, with ids that
 *   aren't visitor ids, or with control or bidi characters in any text;
 * - every sender strips those characters first, so an honest host whose
 *   pasted story title carries a stray direction mark isn't refused by
 *   everyone else.
 *
 * Pure, so tests and the hook share one definition.
 */

import { CONTROL_OR_BIDI_RE, hasControlOrBidi } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS, isVisitorMemberId } from "@/lib/realtime/visitor-rooms";
import type { Session } from "./types";

const STRIP_RE = new RegExp(CONTROL_OR_BIDI_RE.source, "g");

/** True when `s` has control or bidi characters other than line breaks and tabs. */
function hasBadMultiline(s: string): boolean {
  return hasControlOrBidi(s.replace(/[\r\n\t]/g, " "));
}

/**
 * Whether a session that already passed `isValidSession` may be applied in
 * visitor room `code`.
 */
export function isVisitorRoomSession(s: Session, code: string): boolean {
  if (s.roomCode !== code) return false;
  if (s.participants.length > VISITOR_LIMITS.maxMembers) return false;
  if (!isVisitorMemberId(s.hostId)) return false;
  if (hasControlOrBidi(s.sessionName) || hasControlOrBidi(s.host)) return false;
  if (s.scale.some(hasControlOrBidi)) return false;
  for (const p of s.participants) {
    if (!isVisitorMemberId(p.id) || hasControlOrBidi(p.name)) return false;
    if (p.vote !== null && hasControlOrBidi(p.vote)) return false;
  }
  for (const st of s.stories) {
    if (hasControlOrBidi(st.title)) return false;
    if (st.description !== undefined && hasBadMultiline(st.description)) return false;
    if (st.finalEstimate !== null && hasControlOrBidi(st.finalEstimate)) return false;
    if (st.rounds?.some((round) => round.some(hasControlOrBidi))) return false;
  }
  return true;
}

/** `s` without control or bidi characters (keeping line breaks and tabs when asked). */
function strip(s: string, keepLines = false): string {
  if (!hasControlOrBidi(s)) return s;
  return s.replace(STRIP_RE, (ch) => (keepLines && (ch === "\n" || ch === "\t") ? ch : ""));
}

/** A required field: stripped, or `fallback` when nothing is left. */
function stripRequired(s: string, fallback: string): string {
  const out = strip(s).trim();
  return out.length > 0 ? out : fallback;
}

/**
 * The session as it goes on the wire in a visitor room: every text field
 * with control and bidi characters removed (descriptions keep their line
 * breaks). Returns `s` itself when nothing needed changing.
 */
export function toVisitorWire(s: Session): Session {
  const dirty =
    hasControlOrBidi(s.sessionName) ||
    hasControlOrBidi(s.host) ||
    s.scale.some(hasControlOrBidi) ||
    s.participants.some(
      (p) => hasControlOrBidi(p.name) || (p.vote !== null && hasControlOrBidi(p.vote))
    ) ||
    s.stories.some(
      (st) =>
        hasControlOrBidi(st.title) ||
        (st.description !== undefined && hasBadMultiline(st.description)) ||
        (st.finalEstimate !== null && hasControlOrBidi(st.finalEstimate)) ||
        (st.rounds?.some((round) => round.some(hasControlOrBidi)) ?? false)
    );
  if (!dirty) return s;
  return {
    ...s,
    sessionName: strip(s.sessionName),
    host: stripRequired(s.host, "Host"),
    scale: s.scale.map((v) => stripRequired(v, "?")),
    participants: s.participants.map((p) => ({
      ...p,
      name: stripRequired(p.name, "Player"),
      vote: p.vote === null ? null : strip(p.vote),
    })),
    stories: s.stories.map((st) => ({
      ...st,
      title: stripRequired(st.title, "Untitled story"),
      ...(st.description !== undefined ? { description: strip(st.description, true) } : {}),
      finalEstimate: st.finalEstimate === null ? null : strip(st.finalEstimate),
      ...(st.rounds
        ? { rounds: st.rounds.map((round) => round.map((v) => stripRequired(v, "?"))) }
        : {}),
    })),
  };
}

/**
 * The session with only the host's seat: what the host keeps when a
 * visitor room ends, and what this browser stores while one is live. The
 * other people's names never reach storage.
 */
export function withHostOnly(s: Session): Session {
  if (s.participants.every((p) => p.id === s.hostId)) return s;
  return { ...s, participants: s.participants.filter((p) => p.id === s.hostId) };
}
