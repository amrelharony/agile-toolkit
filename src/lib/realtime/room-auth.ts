"use client";

/**
 * Room tokens for private Realtime rooms. Used only with
 * `NEXT_PUBLIC_PRIVATE_ROOMS=1` (see `private-rooms.ts`).
 *
 * Room channels live on the shared anon client (`getSupabaseClient()`).
 * Before a private room joins, this module makes sure that client carries a
 * token the `realtime.messages` policy accepts for the room's topic:
 *
 * - `owner`: one token from `POST /api/realtime/token` (`room_owner: true`,
 *   good for every `tool:` topic), cached and shared by all owner rooms.
 * - `guest`: one token from `POST /api/guest/realtime-token` naming the
 *   exact topics (`rooms`). It covers the union of the topics this tab's
 *   open rooms hold, and is re-minted when a room asks for a topic it
 *   doesn't cover. A room that closes drops its topic from the next mint,
 *   so a guest hopping between boards stays under the server's cap of
 *   `MAX_GUEST_ROOM_TOPICS`.
 * - `visitor`: no token; the anon key reaches `visitor:` topics.
 *
 * Tokens go onto the client with `realtime.setAuth(token)`, and realtime-js
 * pushes each new token to the channels already joined. A token is
 * re-minted `ROOM_TOKEN_REFRESH_LEAD_MS` before it expires while any room
 * still holds it; once none does, it is dropped and the client goes back to
 * the anon key.
 *
 * One request per kind is in flight at a time; concurrent callers share it.
 * Any failure (503 when the server has no `SUPABASE_JWT_SECRET`, 401/403,
 * 429, a network error, a malformed body) resolves `false`. The caller must
 * then stay local-only: with the flag on, a room never falls back to a
 * public channel.
 *
 * `setAuth` applies to the whole shared client, so a visitor channel on it
 * may carry an owner or guest token. That is fine: the policy lets every
 * role into `visitor:` topics. One tab running owner rooms and guest rooms
 * at once would make the two kinds overwrite each other's token; the owner
 * tree and the guest tree never mount together, so that doesn't happen.
 */

import { getSupabaseClient } from "./supabase-client";

export type RoomAuthKind = "owner" | "guest" | "visitor";
type TokenKind = Exclude<RoomAuthKind, "visitor">;

export const OWNER_ROOM_TOKEN_URL = "/api/realtime/token";
export const GUEST_ROOM_TOKEN_URL = "/api/guest/realtime-token";
/** Re-mint a token this long before it expires (or at half its life, if shorter). */
export const ROOM_TOKEN_REFRESH_LEAD_MS = 5 * 60_000;
/** The server's cap on topics in one guest token. */
export const MAX_GUEST_ROOM_TOPICS = 8;
/** The server's cap on one topic's length. */
const MAX_TOPIC_LENGTH = 300;
/** After a failed refresh, try again this soon while the old token lasts. */
const REFRESH_RETRY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TOKEN_LENGTH = 16_384;
/** Bound on authorize()'s re-check loop (each round awaits a request). */
const MAX_ROUNDS = 4;

interface Grant {
  token: string;
  expiresAt: number;
  /** When to re-mint: `ROOM_TOKEN_REFRESH_LEAD_MS` before expiry. */
  refreshAt: number;
  /** Guest tokens: the topics it covers. Owner tokens: null (every `tool:` topic). */
  topics: readonly string[] | null;
}

interface Inflight {
  promise: Promise<boolean>;
  topics: readonly string[] | null;
}

interface KindState {
  grant: Grant | null;
  inflight: Inflight | null;
  /** Topics some open room holds a lease on (lease counts), first-asked first. */
  active: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
}

function emptyState(): KindState {
  return { grant: null, inflight: null, active: new Map(), timer: null };
}

const kinds: Record<TokenKind, KindState> = { owner: emptyState(), guest: emptyState() };
/** The token this module last put on the shared client (null: the anon key). */
let appliedToken: string | null = null;
/** Bumped by resetRoomAuth() so late responses from before it are ignored. */
let epoch = 0;

/**
 * Which token a room needs: a visitor room never needs one; otherwise the
 * verified owner's, else the squad guest's. Null for anyone else (who never
 * reaches a room: `useRealtimeAllowed` keeps them local-only).
 */
export function roomAuthKind(viewer: {
  visitor: boolean;
  isOwner: boolean;
  isGuest: boolean;
}): RoomAuthKind | null {
  if (viewer.visitor) return "visitor";
  if (viewer.isOwner) return "owner";
  if (viewer.isGuest) return "guest";
  return null;
}

export interface RoomAuthLease {
  /**
   * True once the shared client carries a token that may join `topic` as a
   * private channel; false if it can't (the room must stay local-only).
   */
  ready: Promise<boolean>;
  /**
   * The room closed: its topic leaves the guest union at the next mint, and
   * a token no room holds is dropped at its refresh time. Idempotent. A
   * lease that resolves false releases itself.
   */
  release: () => void;
}

/**
 * Hold a lease on `topic` for as long as the room is open, and authorize
 * the shared client for it. Rooms call `release()` when they close.
 */
export function acquireRoomAuth(kind: RoomAuthKind, topic: string): RoomAuthLease {
  if (kind === "visitor") return { ready: authorizeVisitor(), release: () => {} };
  if (typeof topic !== "string" || topic.length === 0 || topic.length > MAX_TOPIC_LENGTH) {
    return { ready: Promise.resolve(false), release: () => {} };
  }
  const s = kinds[kind];
  s.active.set(topic, (s.active.get(topic) ?? 0) + 1);
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    const left = (s.active.get(topic) ?? 0) - 1;
    if (left > 0) s.active.set(topic, left);
    else s.active.delete(topic);
  };
  const ready = authorize(kind, topic, () => held).then(
    (ok) => {
      if (!ok) release();
      return ok;
    },
    () => {
      release();
      return false;
    }
  );
  return { ready, release };
}

/**
 * Authorize the shared anon client for `topic` (the contract's entry point).
 * Unlike `acquireRoomAuth`, the topic is never released: it stays in this
 * tab's guest union until `resetRoomAuth()`. The room hooks use
 * `acquireRoomAuth` so a closed room's topic drops out.
 */
export function ensureRoomAuth(kind: RoomAuthKind, topic: string): Promise<boolean> {
  return acquireRoomAuth(kind, topic).ready;
}

/** Forget every token, lease, timer and in-flight request. For tests. */
export function resetRoomAuth(): void {
  epoch++;
  for (const kind of ["owner", "guest"] as const) {
    const timer = kinds[kind].timer;
    if (timer !== null) clearTimeout(timer);
    kinds[kind] = emptyState();
  }
  appliedToken = null;
}

/** The topics open rooms of `kind` hold leases on. For tests and debugging. */
export function activeRoomAuthTopics(kind: RoomAuthKind): string[] {
  return kind === "visitor" ? [] : Array.from(kinds[kind].active.keys());
}

// ── Internals ────────────────────────────────────────────────────────

async function authorize(kind: TokenKind, topic: string, held: () => boolean): Promise<boolean> {
  const s = kinds[kind];
  const myEpoch = epoch;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (!held() || myEpoch !== epoch) return false;
    const grant = s.grant;
    if (grant && Date.now() < grant.refreshAt && covers(grant, topic)) return apply(grant.token);
    const pending = s.inflight;
    if (pending) {
      // Share the request in flight. If it was asking for this topic too,
      // its failure is ours; otherwise re-check and mint the union.
      const ok = await pending.promise;
      if (!ok && (pending.topics === null || pending.topics.includes(topic))) return false;
      continue;
    }
    if (kind === "guest" && !mintableTopics(s).includes(topic)) return false;
    if (!(await mint(kind))) return false;
  }
  return false;
}

function covers(grant: Grant, topic: string): boolean {
  return grant.topics === null || grant.topics.includes(topic);
}

/** The topics a guest mint asks for: the open rooms', oldest first, capped. */
function mintableTopics(s: KindState): string[] {
  return Array.from(s.active.keys()).slice(0, MAX_GUEST_ROOM_TOPICS);
}

/** Start (or join) the one request for `kind`; resolves whether it got a token on the client. */
function mint(kind: TokenKind): Promise<boolean> {
  const s = kinds[kind];
  if (s.inflight) return s.inflight.promise;
  const topics = kind === "guest" ? mintableTopics(s) : null;
  if (topics !== null && topics.length === 0) return Promise.resolve(false);
  const myEpoch = epoch;
  const promise = (async (): Promise<boolean> => {
    try {
      const grant = await requestGrant(kind, topics);
      if (myEpoch !== epoch || !grant) return false;
      s.grant = grant;
      scheduleRefresh(kind, grant.refreshAt);
      return await apply(grant.token);
    } catch {
      return false;
    }
  })();
  const inflight: Inflight = { promise, topics };
  s.inflight = inflight;
  // Registered before any caller awaits `promise`, so the slot is clear by
  // the time they re-check.
  void promise.then(() => {
    if (s.inflight === inflight) s.inflight = null;
  });
  return promise;
}

async function requestGrant(
  kind: TokenKind,
  topics: readonly string[] | null
): Promise<Grant | null> {
  if (typeof fetch !== "function") return null;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
  try {
    const init: RequestInit = {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller?.signal,
    };
    if (topics !== null) {
      init.headers = { accept: "application/json", "content-type": "application/json" };
      init.body = JSON.stringify({ topics });
    }
    const res = await fetch(kind === "owner" ? OWNER_ROOM_TOKEN_URL : GUEST_ROOM_TOKEN_URL, init);
    if (!res.ok) return null;
    return parseGrant(await res.json(), topics);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `{ token, expiresAt }` (guest: plus `topics`), with `expiresAt` in ms since epoch. */
function parseGrant(body: unknown, requested: readonly string[] | null): Grant | null {
  if (!body || typeof body !== "object") return null;
  const { token, expiresAt, topics } = body as Record<string, unknown>;
  const now = Date.now();
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now) {
    return null;
  }
  let granted: readonly string[] | null = null;
  if (requested !== null) {
    // Trust only topics we asked for; if the server echoes a list, only
    // those of ours it names.
    granted = Array.isArray(topics) ? requested.filter((t) => topics.includes(t)) : requested;
    if (granted.length === 0) return null;
  }
  const lead = Math.min(ROOM_TOKEN_REFRESH_LEAD_MS, (expiresAt - now) / 2);
  return { token, expiresAt, refreshAt: expiresAt - lead, topics: granted };
}

/** Put `token` on the shared client (realtime-js re-sends it to joined channels). */
async function apply(token: string): Promise<boolean> {
  if (appliedToken === token) return true;
  const client = getSupabaseClient();
  if (!client) return false;
  appliedToken = token;
  try {
    await client.realtime.setAuth(token);
    return true;
  } catch {
    if (appliedToken === token) appliedToken = null;
    return false;
  }
}

/** Back to the anon key (setAuth with no token reads the client's own key). */
async function clearClientAuth(): Promise<void> {
  if (appliedToken === null) return;
  appliedToken = null;
  try {
    await getSupabaseClient()?.realtime.setAuth();
  } catch {
    /* client torn down */
  }
}

/** Whether `token` belongs to a grant that hasn't expired. */
function isLiveToken(token: string, now: number): boolean {
  return (["owner", "guest"] as const).some((kind) => {
    const g = kinds[kind].grant;
    return g !== null && g.token === token && g.expiresAt > now;
  });
}

/**
 * Visitor rooms need no token. A live owner or guest token on the client is
 * fine too (the policy admits every role to `visitor:`), but a dead one
 * (dropped or expired) would get the join refused, so go back to the anon key.
 */
async function authorizeVisitor(): Promise<boolean> {
  if (appliedToken !== null && !isLiveToken(appliedToken, Date.now())) await clearClientAuth();
  return true;
}

function scheduleRefresh(kind: TokenKind, at: number): void {
  const s = kinds[kind];
  if (s.timer !== null) clearTimeout(s.timer);
  s.timer = setTimeout(
    () => {
      s.timer = null;
      void refresh(kind);
    },
    Math.max(0, at - Date.now())
  );
}

async function refresh(kind: TokenKind): Promise<void> {
  const s = kinds[kind];
  const myEpoch = epoch;
  if (s.active.size === 0) {
    // No open room holds this token: let it go rather than keep minting.
    const token = s.grant?.token ?? null;
    s.grant = null;
    if (token !== null && token === appliedToken) await clearClientAuth();
    return;
  }
  if (await mint(kind)) return;
  if (myEpoch !== epoch) return;
  const grant = s.grant;
  if (!grant) return;
  const now = Date.now();
  // Keep the old token while it lasts and try again.
  if (grant.expiresAt - now > REFRESH_RETRY_MS) {
    scheduleRefresh(kind, now + REFRESH_RETRY_MS);
    return;
  }
  // It expires before the next try, and Supabase closes the channels that
  // carry it then anyway. Drop it, and put the anon key back so visitor
  // channels on the shared client survive.
  s.grant = null;
  if (grant.token === appliedToken) await clearClientAuth();
}
