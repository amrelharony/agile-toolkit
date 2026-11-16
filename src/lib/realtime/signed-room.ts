/**
 * What the signed visitor rooms share (show rooms and wall rooms; vote
 * rounds keep their own, older wire format in `vote-room/protocol.ts`):
 * the head every host state carries, the kick and end messages, and the
 * join link with the host key's fingerprint.
 *
 * The host makes an ECDSA P-256 room key in its browser (`VoteCrypto`, the
 * vote kit's WebCrypto wrapper) and signs every message it sends. The join
 * link carries the key's fingerprint after `#k=` (a fragment: it never
 * reaches the server or its logs), and participants trust only messages
 * signed by that key, so nobody else in the room can pose as the host. A
 * wall room also uses the host's ECDH key from the same pair: participants
 * encrypt their posts to it (`wall-room/protocol.ts`).
 *
 * Every signed text is a JSON array of field values in a fixed order under
 * a domain of its own ("agile-toolkit:show-room:v1", …), with the event
 * name in it: a signature never depends on key order, and one room kind's
 * or one event's signature can't pass for another's.
 *
 * Pure and server-safe: no React, no browser globals.
 */

import { isWithinJsonSize } from "./sanitize";
import { readSignature, type Signed } from "./room-control";
import { isVisitorMemberId, isVisitorRoomCode, joinUrl, type VisitorTool } from "./visitor-rooms";
import { isVoteFingerprint } from "./vote-room/crypto";
import type { HostKeys } from "./vote-room/protocol";
import { KEY_RE, obj } from "./vote-room/wire";

export type { Signed } from "./room-control";
export type { HostKeys } from "./vote-room/protocol";

/** The wire version of show and wall messages. */
export const SIGNED_ROOM_VERSION = 1 as const;

/** What every show or wall state carries before its own fields. */
export interface SignedRoomHead {
  v: typeof SIGNED_ROOM_VERSION;
  /** The host's member id. */
  by: string;
  /** Rises with every state the host sends; participants drop anything older. */
  seq: number;
  tool: VisitorTool;
  /** Epoch ms when the room closes for everyone (start + 3 h). */
  endsAt: number;
  /** The host's public keys: `sig` is pinned through the link's `#k=`; `ecdh` takes wall posts. */
  keys: HostKeys;
}

/** The head's fields as the signed text lists them, in order. */
export function headTuple(h: SignedRoomHead): unknown[] {
  return [h.v, h.by, h.seq, h.tool, h.endsAt, h.keys.sig, h.keys.ecdh];
}

/**
 * The head of a state for `tool`, checked field by field, with its
 * signature's shape (whether it is the pinned key's is the hook's call).
 * Null when anything is off.
 */
export function readSignedHead(
  m: Record<string, unknown>,
  tool: VisitorTool
): (SignedRoomHead & { sig: string }) | null {
  if (m.v !== SIGNED_ROOM_VERSION || !isVisitorMemberId(m.by)) return null;
  if (typeof m.seq !== "number" || !Number.isSafeInteger(m.seq) || m.seq < 0) return null;
  if (m.tool !== tool) return null;
  if (typeof m.endsAt !== "number" || !Number.isFinite(m.endsAt) || m.endsAt <= 0) return null;
  const keys = obj(m.keys);
  if (!keys || typeof keys.sig !== "string" || !KEY_RE.test(keys.sig)) return null;
  if (typeof keys.ecdh !== "string" || !KEY_RE.test(keys.ecdh)) return null;
  const sig = readSignature(m);
  if (!sig) return null;
  return {
    v: SIGNED_ROOM_VERSION,
    by: m.by,
    seq: m.seq,
    tool,
    endsAt: m.endsAt,
    keys: { sig: keys.sig, ecdh: keys.ecdh },
    sig,
  };
}

// ── Kick and end ─────────────────────────────────────────────────────

export interface RoomKickBody {
  v: typeof SIGNED_ROOM_VERSION;
  by: string;
  /** The member being removed. */
  id: string;
}

export interface RoomEndBody {
  v: typeof SIGNED_ROOM_VERSION;
  by: string;
  reason: "host" | "idle" | "expired";
}

/** The signed text of a kick or an end, under `domain`. */
export function controlInput(
  domain: string,
  event: string,
  body: RoomKickBody | RoomEndBody
): string {
  const head = [domain, event, body.v, body.by];
  if ("id" in body) return JSON.stringify([...head, "kick", body.id]);
  return JSON.stringify([...head, "end", body.reason]);
}

/** A signed kick, or null. The signature is checked against the pinned key by the hook. */
export function readRoomKick(raw: unknown, maxChars: number): Signed<RoomKickBody> | null {
  if (!isWithinJsonSize(raw, maxChars)) return null;
  const m = obj(raw);
  if (!m || m.v !== SIGNED_ROOM_VERSION) return null;
  if (!isVisitorMemberId(m.by) || !isVisitorMemberId(m.id)) return null;
  const sig = readSignature(m);
  if (!sig) return null;
  return { v: SIGNED_ROOM_VERSION, by: m.by, id: m.id, sig };
}

/** A signed end, or null. The signature is checked against the pinned key by the hook. */
export function readRoomEnd(raw: unknown, maxChars: number): Signed<RoomEndBody> | null {
  if (!isWithinJsonSize(raw, maxChars)) return null;
  const m = obj(raw);
  if (!m || m.v !== SIGNED_ROOM_VERSION || !isVisitorMemberId(m.by)) return null;
  if (m.reason !== "host" && m.reason !== "idle" && m.reason !== "expired") return null;
  const sig = readSignature(m);
  if (!sig) return null;
  return { v: SIGNED_ROOM_VERSION, by: m.by, reason: m.reason, sig };
}

// ── The join link ────────────────────────────────────────────────────

/**
 * The path a participant opens: `/join/<tool>/<code>#k=<fingerprint>`. The
 * fragment never reaches the server or the Vercel logs. Null when any part
 * is malformed.
 */
export function signedJoinUrl(tool: VisitorTool, code: string, fp: string): string | null {
  if (!isVisitorRoomCode(code) || !isVoteFingerprint(fp)) return null;
  const path = joinUrl(tool, code);
  return path ? `${path}#k=${fp}` : null;
}
