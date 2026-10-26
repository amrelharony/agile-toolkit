/**
 * Host control messages that every visitor room shares: "remove this
 * member" (kick) and "the room is over" (end).
 *
 * The readers check shape only. `by` is self-declared, so whether the
 * sender may kick or end is the room hook's call: Retro accepts them from
 * the trusted host while it is in presence; vote rounds also need a
 * signature from the host key pinned by the join link (`readSignature`,
 * checked in `vote-room/use-vote-room.ts`).
 *
 * Pure, no browser globals.
 */

import { isVisitorMemberId } from "./visitor-rooms";

export interface KickMessage {
  /** The host's member id. */
  by: string;
  /** The member being removed. */
  id: string;
}

export interface EndMessage {
  by: string;
}

/** A message body plus the host's signature over it. */
export type Signed<T> = T & { sig: string };

/**
 * An ECDSA P-256 signature as vote rounds send it: IEEE P1363 `r || s`,
 * 64 bytes, unpadded base64url (86 characters).
 */
export const ROOM_SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** `{ by, id }` with two visitor member ids, rebuilt so extra fields are dropped. */
export function readKickMessage(raw: unknown): KickMessage | null {
  const m = obj(raw);
  if (!m || !isVisitorMemberId(m.by) || !isVisitorMemberId(m.id)) return null;
  return { by: m.by, id: m.id };
}

/** `{ by }` with a visitor member id, rebuilt so extra fields are dropped. */
export function readEndMessage(raw: unknown): EndMessage | null {
  const m = obj(raw);
  if (!m || !isVisitorMemberId(m.by)) return null;
  return { by: m.by };
}

/** The well-formed `sig` field of a signed message, or null. Checks the shape, not the signature. */
export function readSignature(raw: unknown): string | null {
  const m = obj(raw);
  return m && typeof m.sig === "string" && ROOM_SIGNATURE_RE.test(m.sig) ? m.sig : null;
}
