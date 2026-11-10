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
 *   everyone else;
 * - a session over `VISITOR_LIMITS.maxPayloadChars` isn't sent at all, so
 *   stories pulled in from the queue have their descriptions shortened to
 *   fit before they join one (`fitStoriesToVisitorRoom`).
 *
 * Pure, so tests and the hook share one definition.
 */

import { CONTROL_OR_BIDI_RE, hasControlOrBidi } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS, isVisitorMemberId } from "@/lib/realtime/visitor-rooms";
import type { Session, Story } from "./types";

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

/* ── Room for the queue ──────────────────────────────────────────────── */

/**
 * JSON characters kept free per story for what the session adds to it: the
 * accepted estimate and a couple of rounds of the room's votes.
 */
const STORY_HEADROOM = 300;
/** JSON characters kept free for the seats as people join. */
const ROOM_HEADROOM = 4_000;
/** What the field adds around its text: `"description":` and a comma. */
const DESCRIPTION_KEY = 15;
/** A description cut to less text than this says too little to keep. */
const MIN_DESCRIPTION = 120;

/** Ends a shortened description, so the room can see the text goes on elsewhere. */
export const SHORTENED_MARK = "… (shortened to fit the live room)";

const jsonSize = (value: unknown) => JSON.stringify(value).length;

/**
 * `text` cut to at most `max` JSON characters, ending with `SHORTENED_MARK`:
 * on a line end when one is near the cut, and never through half a
 * surrogate pair. Undefined when too little of it would be left.
 */
function shortenedTo(text: string, max: number): string | undefined {
  if (max < MIN_DESCRIPTION) return undefined;
  let end = Math.min(text.length, max);
  while (end > 0) {
    let head = text.slice(0, end);
    const last = head.charCodeAt(head.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
    const lineEnd = head.lastIndexOf("\n");
    const onLine = lineEnd >= head.length * 0.6;
    const kept = (onLine ? head.slice(0, lineEnd) : head).trimEnd();
    if (!kept) return undefined;
    const cut = `${kept}${onLine ? "\n" : ""}${SHORTENED_MARK}`;
    const over = jsonSize(cut) - max;
    if (over <= 0) return cut;
    end -= Math.max(1, over);
  }
  return undefined;
}

/**
 * Stories about to join a visitor room's session, with their descriptions
 * shortened where the session would otherwise be too big to send. A queued
 * backlog story brings its notes and acceptance criteria (up to about 4,000
 * characters), so a few dozen of them pass `maxChars`, and then the room
 * stops getting the host's changes altogether.
 *
 * What the session already holds, the new stories' titles and room for the
 * votes to come are set aside first. The rest is shared out between the new
 * descriptions: a short one is kept whole, and the long ones are cut to an
 * equal share each (dropped when the share is too small to say anything).
 * Returns `added` itself when everything fits.
 */
export function fitStoriesToVisitorRoom<T extends Story>(
  session: Session,
  added: T[],
  maxChars: number = VISITOR_LIMITS.maxPayloadChars
): T[] {
  const costs = added.map((st) =>
    st.description ? jsonSize(st.description) + DESCRIPTION_KEY : 0
  );
  const wanted = costs.reduce((sum, c) => sum + c, 0);
  if (wanted === 0) return added;
  const without = (st: T): T => {
    const copy = { ...st };
    delete copy.description;
    return copy;
  };
  const stories = [...session.stories, ...added.map(without)];
  const fixed = jsonSize({ state: { ...session, stories }, by: session.hostId });
  let room = maxChars - fixed - stories.length * STORY_HEADROOM - ROOM_HEADROOM;
  if (wanted <= room) return added;

  // Shortest first: each takes what it needs up to an equal share of what
  // is left, so the room a short description doesn't use goes to the long ones.
  const order = costs
    .map((cost, index) => ({ cost, index }))
    .filter((c) => c.cost > 0)
    .sort((a, b) => a.cost - b.cost);
  const allowed = new Map<number, number>();
  order.forEach(({ cost, index }, i) => {
    const share = Math.floor(Math.max(0, room) / (order.length - i));
    const take = Math.min(cost, share);
    allowed.set(index, take);
    room -= take;
  });
  return added.map((st, index) => {
    const allow = allowed.get(index);
    if (allow === undefined || allow >= costs[index] || !st.description) return st;
    const description = shortenedTo(st.description, allow - DESCRIPTION_KEY);
    return description ? { ...st, description } : without(st);
  });
}
