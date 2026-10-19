import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived Realtime room tokens, minted by our server.
 *
 * Private Realtime channels (`config: { private: true }`) are authorized by
 * the RLS policy on `realtime.messages` (migration 0026), which reads the
 * claims of the JWT the socket presents. The anon key carries none of ours,
 * so the server mints a JWT that Supabase trusts (HS256 under the project's
 * legacy JWT secret, `SUPABASE_JWT_SECRET`) and that names what the holder
 * may join:
 *
 *   owner   `room_owner: true`  — any `tool:%` room of this project
 *   guest   `rooms: [topic…]`   — exactly the topics the server validated
 *                                  against the guest's invites
 *
 * `role` is `anon` on purpose: Postgres runs the policy as that role, and a
 * leaked token used against the REST API is worth no more than the public
 * anon key itself. There is no `aud`, for the same reason (the anon key has
 * none). Signed with `node:crypto`; no JWT dependency.
 */

/** The `iss` of every room token; the database policy only honours ours. */
export const ROOM_TOKEN_ISSUER = "agile-toolkit";
/** Room tokens live an hour; the client refreshes five minutes early. */
export const ROOM_TOKEN_TTL_SECONDS = 3600;

const HEADER = { alg: "HS256", typ: "JWT" } as const;

export interface RoomTokenClaims {
  iss: typeof ROOM_TOKEN_ISSUER;
  role: "anon";
  /** Owner user id, or guest squad-profile id (both UUIDs). */
  sub: string;
  iat: number;
  exp: number;
  /** Owner tokens only. */
  room_owner?: true;
  /** Guest tokens only: the exact topics allowed. */
  rooms?: string[];
}

export interface MintRoomTokenInput {
  sub: string;
  roomOwner?: boolean;
  rooms?: string[];
}

export interface MintedRoomToken {
  token: string;
  /** When the token expires, in ms since the epoch. */
  expiresAt: number;
}

/**
 * The signing secret, or null when unset. Trimmed: a value pasted into an
 * env var easily picks up a trailing newline, and Supabase signs with the
 * bare secret, so a stray byte would make every token fail to verify.
 */
function jwtSecret(): string | null {
  const raw = process.env.SUPABASE_JWT_SECRET;
  const secret = typeof raw === "string" ? raw.trim() : "";
  return secret.length > 0 ? secret : null;
}

/** Whether the server can mint room tokens (`SUPABASE_JWT_SECRET` is set). */
export function privateRoomsConfigured(): boolean {
  return jwtSecret() !== null;
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(input: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(input).digest();
}

/**
 * Mint a room token. Throws when the secret is unset or `sub` is empty;
 * callers check {@link privateRoomsConfigured} first and answer 503.
 */
export function mintRoomToken(input: MintRoomTokenInput): MintedRoomToken {
  const secret = jwtSecret();
  if (!secret) throw new Error("SUPABASE_JWT_SECRET is not set");
  if (typeof input.sub !== "string" || input.sub.length === 0) {
    throw new Error("A room token needs a subject");
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ROOM_TOKEN_TTL_SECONDS;
  const claims: RoomTokenClaims = {
    iss: ROOM_TOKEN_ISSUER,
    role: "anon",
    sub: input.sub,
    iat,
    exp,
  };
  if (input.roomOwner) claims.room_owner = true;
  if (input.rooms) claims.rooms = [...input.rooms];

  const unsigned = `${encodeSegment(HEADER)}.${encodeSegment(claims)}`;
  const signature = sign(unsigned, secret).toString("base64url");
  return { token: `${unsigned}.${signature}`, expiresAt: exp * 1000 };
}

function decodeSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Verify a room token: HS256 header, a signature that matches (compared in
 * constant time), our issuer, and an `exp` still in the future. Returns the
 * claims, or null for anything else. Supabase does the real verification;
 * this exists for tests and for any server code that has to read a token back.
 */
export function verifyRoomToken(token: string): RoomTokenClaims | null {
  const secret = jwtSecret();
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return null;

  const header = decodeSegment(headerPart) as { alg?: unknown } | null;
  if (!header || header.alg !== "HS256") return null;

  const expected = sign(`${headerPart}.${payloadPart}`, secret);
  const given = Buffer.from(signaturePart, "base64url");
  // Refuse a non-canonical encoding of the right bytes, so one token has
  // exactly one valid spelling.
  if (given.toString("base64url") !== signaturePart) return null;
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const claims = decodeSegment(payloadPart) as Partial<RoomTokenClaims> | null;
  if (!claims || typeof claims !== "object") return null;
  if (claims.iss !== ROOM_TOKEN_ISSUER) return null;
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) return null;
  if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
  return claims as RoomTokenClaims;
}
