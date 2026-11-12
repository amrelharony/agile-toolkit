/**
 * Wall rooms (Audience Wall: open answers, questions with upvotes, a
 * raise-hand queue): participants post short text and upvote, the host
 * runs the wall. The wire protocol, version 1.
 *
 *   host → everyone      "wall:state"   Signed<WallStateBody>  (throttled
 *                                       500 ms, 500 ms after a join, 30 s
 *                                       keepalive)
 *   participant → host   "wall:intent"  IntentEnvelope         (encrypted
 *                                       to the host; re-sent unchanged
 *                                       until acknowledged)
 *   host → everyone      "wall:kick"    Signed<RoomKickBody>
 *   host → everyone      "wall:end"     Signed<RoomEndBody>
 *
 * What a participant may ask (`WallIntent`): post (at most 280 characters,
 * one every 5 seconds, 30 a round), take back their own post, upvote
 * someone else's post (once each) and take the vote back, raise or lower
 * their hand. Posting and voting send a lock (the SHA-256 of a random key
 * only the sender's tab holds); taking back sends the key, which the host
 * checks against the lock, so nobody can take back someone else's post or
 * vote even under their id.
 *
 * Security model (see RUNBOOK "Show and wall rooms"):
 *  - the host signs every message with its room key; participants pin it
 *    through the link's `#k=` (`signed-room.ts`), so nobody else can show
 *    them posts, kick them or end the room;
 *  - every request is encrypted in the participant's browser to the host's
 *    ECDH key (the vote kit's sealing, bound to the sender and the request
 *    id) and padded to one size, so other members see that someone sent
 *    something, never what: a post, a vote or a hand all look alike;
 *  - posts carry no name and no member id. A post's id is a random one its
 *    writer's tab made, inside the encrypted request; who wrote or upvoted
 *    what is a host-side record in memory only (to stop double votes and
 *    check take-backs), never sent and never saved;
 *  - "hidden until reveal": the host's state then carries only how many
 *    posts there are, and the host's own page draws no post text until
 *    Reveal;
 *  - what the host saves (the tool's onSave) is the prompt, each post's text
 *    and vote count: no ids, no names (`toWallResult`).
 * What it doesn't cover: the host's browser sees each request with its
 * sender for an instant before folding it; with "show posts as they
 * arrive", someone watching the channel can match a new post to the member
 * whose request just came in (use "hidden until reveal" for anything
 * sensitive); a raised hand shows the person's name, by design.
 *
 * Every reader treats its input as hostile: size first, then a strict
 * shape, rebuilt field by field. Pure and server-safe.
 */

import { isWithinJsonSize } from "../sanitize";
import { sha256Base64Url } from "../sha256";
import { VISITOR_LIMITS, isVisitorMemberId, type VisitorTool } from "../visitor-rooms";
import {
  SIGNED_ROOM_VERSION,
  controlInput,
  headTuple,
  readSignedHead,
  type RoomEndBody,
  type RoomKickBody,
  type Signed,
  type SignedRoomHead,
} from "../signed-room";
import {
  B64URL_RE,
  IV_RE,
  KEY_RE,
  ROUND_ID_RE,
  b64urlChars,
  isCleanText,
  isCount,
  mdCell,
  obj,
} from "../vote-room/wire";

// ── Tools, events, limits ────────────────────────────────────────────

/** The tools that run wall rooms (their `VISITOR_ROOM_KIND` is "wall"). */
export const WALL_ROOM_TOOLS = ["audience-wall"] as const satisfies readonly VisitorTool[];
export type WallRoomTool = (typeof WALL_ROOM_TOOLS)[number];

export function isWallRoomTool(v: unknown): v is WallRoomTool {
  return typeof v === "string" && (WALL_ROOM_TOOLS as readonly string[]).includes(v);
}

export const WALL_ROOM_EVENTS = {
  state: "wall:state",
  intent: "wall:intent",
  kick: "wall:kick",
  end: "wall:end",
} as const;

export const WALL_LIMITS = {
  /** A post's text, after cleaning. */
  maxPostChars: 280,
  /** A post's raw text before cleaning (a longer one is refused, not cut). */
  maxRawPostChars: 1_000,
  /** One post per member this often. */
  postIntervalMs: 5_000,
  /** Posts one member may make in a round (taking one back doesn't give it back). */
  maxPostsPerMember: 30,
  /** Posts one round takes in all, taken-back ones included. */
  maxPostsPerRound: 200,
  /** The host's prompt. */
  maxPromptChars: 280,
  /** Texts kept under a post when others are merged into it. */
  maxMergedTexts: 10,
  /** Upvotes one post can hold (three per seat, as a vote round's ballots). */
  maxVotesPerPost: VISITOR_LIMITS.maxMembers * 3,
  /**
   * Upvotes one member may give in a round, taken-back ones included: two
   * for every post a round can hold. It bounds the taken-back votes the
   * host remembers (so replaying one can't bring it back).
   */
  maxVotesPerMember: 400,
  /** Every request's plaintext is padded to this many UTF-8 bytes. */
  intentBytes: 1_200,
  /** Request ids the host acknowledges in one state. */
  maxAcks: 64,
  /** Refused request ids (with why) in one state. */
  maxNacks: 32,
  /**
   * Requests whose ids the host remembers, to apply each once. What a
   * take-back undid is remembered for the whole round besides (`host.ts`).
   */
  recentRing: 512,
  /** Largest wall message accepted or sent, in JSON characters. */
  maxStateChars: VISITOR_LIMITS.maxPayloadChars,
  /** Shortest gap between two states from the host. */
  stateThrottleMs: 500,
} as const;

// ── Shapes ───────────────────────────────────────────────────────────

/** "live": posts show as they arrive. "hidden": only a count, until the host reveals them. */
export type WallMode = "live" | "hidden";

/** A post as the room shares it: no author, no member id. */
export interface WallPost {
  /** Random, made by the writer's tab (nanoid(12)). */
  id: string;
  text: string;
  /** People who upvoted it. */
  votes: number;
  /** Texts the host merged into it (duplicates), oldest first. */
  merged: string[];
}

/** The round as the room shares it. */
export interface WallRoundView {
  /** nanoid(12), new every round. */
  id: string;
  prompt: string;
  /** Takes posts and votes. */
  open: boolean;
  mode: WallMode;
  /** The host revealed the posts (a "hidden" round). */
  revealed: boolean;
  /** Posts on the wall (not hidden by the host, not taken back, not merged away). */
  count: number;
  /** The posts, most votes first; null while hidden and not revealed. */
  posts: WallPost[] | null;
}

/** Why the host refused a request. */
export type WallRefusal =
  | "closed"
  | "rate"
  | "member-cap"
  | "round-full"
  | "bad-text"
  | "not-yours"
  | "own-post"
  | "already"
  | "gone"
  | "not-admitted";

export const WALL_REFUSALS = [
  "closed",
  "rate",
  "member-cap",
  "round-full",
  "bad-text",
  "not-yours",
  "own-post",
  "already",
  "gone",
  "not-admitted",
] as const satisfies readonly WallRefusal[];

export interface WallStateBody extends SignedRoomHead {
  tool: WallRoomTool;
  /** The round on the wall; null before the host opens one. */
  round: WallRoundView | null;
  /** Members with a raised hand, oldest first. Hands are named on purpose: it's a queue to speak. */
  hands: string[];
  /** Request ids the host applied, oldest first (at most 64). */
  acks: string[];
  /** Request ids the host refused, with why (at most 32). */
  nacks: { iid: string; why: WallRefusal }[];
}

export type WallStateMessage = Signed<WallStateBody>;

/** What a participant may ask, as it travels inside the encrypted request. */
export type WallIntent =
  | { t: "post"; r: string; pid: string; text: string; lock: string }
  | { t: "withdraw"; r: string; pid: string; key: string }
  | { t: "vote"; r: string; pid: string; lock: string }
  | { t: "unvote"; r: string; pid: string; key: string }
  | { t: "hand"; up: boolean };

/** One request, encrypted to the host's ECDH key. Its size says nothing of what it is. */
export interface IntentEnvelope {
  v: typeof SIGNED_ROOM_VERSION;
  /** The sender's presence key. */
  by: string;
  /** Request id, nanoid(12): the host acknowledges it in `acks`. Not a post id. */
  iid: string;
  /** The sender's ephemeral ECDH public key (87 characters). */
  epk: string;
  /** AES-GCM nonce (16 characters). */
  iv: string;
  /** AES-GCM ciphertext plus tag of the padded request. */
  ct: string;
}

// ── Locks ────────────────────────────────────────────────────────────

/** A key: random, 16 to 64 URL-safe characters (the room makes nanoid(21)). */
const LOCK_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** A lock: a SHA-256 in unpadded base64url. */
const LOCK_RE = /^[A-Za-z0-9_-]{43}$/;

/** The lock for `key`: what a post or vote carries so only the key's holder can take it back. */
export function lockOf(key: string): string {
  return sha256Base64Url(key);
}

// ── Signing ──────────────────────────────────────────────────────────

export const WALL_SIGNING_DOMAIN = "agile-toolkit:wall-room:v1";

function roundTuple(r: WallRoundView | null): unknown {
  if (r === null) return null;
  return [
    r.id,
    r.prompt,
    r.open,
    r.mode,
    r.revealed,
    r.count,
    r.posts === null ? null : r.posts.map((p) => [p.id, p.text, p.votes, p.merged]),
  ];
}

/** The text the host signs for a state. */
export function wallStateInput(body: WallStateBody): string {
  return JSON.stringify([
    WALL_SIGNING_DOMAIN,
    WALL_ROOM_EVENTS.state,
    ...headTuple(body),
    roundTuple(body.round),
    body.hands,
    body.acks,
    body.nacks.map((n) => [n.iid, n.why]),
  ]);
}

/** The text the host signs for a kick or an end. */
export function wallControlInput(event: string, body: RoomKickBody | RoomEndBody): string {
  return controlInput(WALL_SIGNING_DOMAIN, event, body);
}

/** The AAD every request is sealed under: it can't be replayed under another sender or id. */
export function intentAad(by: string, iid: string): string {
  return `agile-toolkit:wall-intent:v1|${by}|${iid}`;
}

// ── Requests: padding and reading ────────────────────────────────────

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/**
 * The request as it is sealed: its JSON padded with spaces to exactly
 * `WALL_LIMITS.intentBytes` UTF-8 bytes, so every request is the same size.
 * Null when it doesn't fit (a post can't, once cleaned to 280 characters).
 */
export function padIntent(intent: WallIntent): string | null {
  const json = JSON.stringify(intent);
  const len = utf8Length(json);
  if (len > WALL_LIMITS.intentBytes) return null;
  return json + " ".repeat(WALL_LIMITS.intentBytes - len);
}

/** The exact ciphertext length (base64url) of every request: the padded bytes plus the tag. */
export function intentCiphertextChars(): number {
  return b64urlChars(WALL_LIMITS.intentBytes + 16);
}

/** A request's envelope, or null. Its contents are read after decryption (`readIntent`). */
export function readIntentEnvelope(raw: unknown): IntentEnvelope | null {
  if (!isWithinJsonSize(raw, 4_000)) return null;
  const m = obj(raw);
  if (!m || m.v !== SIGNED_ROOM_VERSION || !isVisitorMemberId(m.by)) return null;
  if (typeof m.iid !== "string" || !ROUND_ID_RE.test(m.iid)) return null;
  if (typeof m.epk !== "string" || !KEY_RE.test(m.epk)) return null;
  if (typeof m.iv !== "string" || !IV_RE.test(m.iv)) return null;
  if (
    typeof m.ct !== "string" ||
    m.ct.length !== intentCiphertextChars() ||
    !B64URL_RE.test(m.ct)
  ) {
    return null;
  }
  return { v: SIGNED_ROOM_VERSION, by: m.by, iid: m.iid, epk: m.epk, iv: m.iv, ct: m.ct };
}

/**
 * A decrypted request, or null: not the padded size, not JSON, or not
 * exactly one of the shapes a participant may send. A post's text is still
 * raw (the host cleans it, and refuses it when nothing is left).
 */
export function readIntent(plain: string): WallIntent | null {
  if (typeof plain !== "string" || utf8Length(plain) !== WALL_LIMITS.intentBytes) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(plain);
  } catch {
    return null;
  }
  const m = obj(raw);
  if (!m) return null;
  if (m.t === "hand") {
    return typeof m.up === "boolean" ? { t: "hand", up: m.up } : null;
  }
  if (typeof m.r !== "string" || !ROUND_ID_RE.test(m.r)) return null;
  if (typeof m.pid !== "string" || !ROUND_ID_RE.test(m.pid)) return null;
  const r = m.r;
  const pid = m.pid;
  switch (m.t) {
    case "post":
      if (typeof m.text !== "string" || m.text.length > WALL_LIMITS.maxRawPostChars) return null;
      if (typeof m.lock !== "string" || !LOCK_RE.test(m.lock)) return null;
      return { t: "post", r, pid, text: m.text, lock: m.lock };
    case "vote":
      if (typeof m.lock !== "string" || !LOCK_RE.test(m.lock)) return null;
      return { t: "vote", r, pid, lock: m.lock };
    case "withdraw":
    case "unvote":
      if (typeof m.key !== "string" || !LOCK_KEY_RE.test(m.key)) return null;
      return { t: m.t, r, pid, key: m.key };
    default:
      return null;
  }
}

// ── States ───────────────────────────────────────────────────────────

function readPosts(raw: unknown, count: number): WallPost[] | null {
  if (!Array.isArray(raw) || raw.length !== count || raw.length > WALL_LIMITS.maxPostsPerRound) {
    return null;
  }
  const ids = new Set<string>();
  const posts: WallPost[] = [];
  for (const rawPost of raw) {
    const p = obj(rawPost);
    if (!p || typeof p.id !== "string" || !ROUND_ID_RE.test(p.id) || ids.has(p.id)) return null;
    if (!isCleanText(p.text, WALL_LIMITS.maxPostChars)) return null;
    if (!isCount(p.votes, WALL_LIMITS.maxVotesPerPost)) return null;
    if (!Array.isArray(p.merged) || p.merged.length > WALL_LIMITS.maxMergedTexts) return null;
    const merged: string[] = [];
    for (const t of p.merged) {
      if (!isCleanText(t, WALL_LIMITS.maxPostChars)) return null;
      merged.push(t);
    }
    ids.add(p.id);
    posts.push({ id: p.id, text: p.text, votes: p.votes, merged });
  }
  return posts;
}

function readRound(raw: unknown): WallRoundView | null {
  const r = obj(raw);
  if (!r || typeof r.id !== "string" || !ROUND_ID_RE.test(r.id)) return null;
  if (!isCleanText(r.prompt, WALL_LIMITS.maxPromptChars)) return null;
  if (typeof r.open !== "boolean" || typeof r.revealed !== "boolean") return null;
  if (r.mode !== "live" && r.mode !== "hidden") return null;
  if (!isCount(r.count, WALL_LIMITS.maxPostsPerRound)) return null;
  const shown = r.mode === "live" || r.revealed;
  let posts: WallPost[] | null = null;
  if (shown) {
    posts = readPosts(r.posts, r.count);
    if (!posts) return null;
  } else if (r.posts !== null) {
    // Hidden until reveal: a state that carries the posts is refused.
    return null;
  }
  return {
    id: r.id,
    prompt: r.prompt,
    open: r.open,
    mode: r.mode,
    revealed: r.revealed,
    count: r.count,
    posts,
  };
}

/**
 * A host state for this page's `tool`, or null. Checks shape, caps and the
 * hiding rule (no posts while hidden); whether the signature is the pinned
 * host's is the hook's call.
 */
export function readWallState(raw: unknown, tool: WallRoomTool): WallStateMessage | null {
  if (!isWithinJsonSize(raw, WALL_LIMITS.maxStateChars)) return null;
  const m = obj(raw);
  if (!m || !isWallRoomTool(tool)) return null;
  const head = readSignedHead(m, tool);
  if (!head) return null;
  let round: WallRoundView | null = null;
  if (m.round !== null) {
    round = readRound(m.round);
    if (!round) return null;
  }
  if (!Array.isArray(m.hands) || m.hands.length > VISITOR_LIMITS.maxMembers) return null;
  const hands: string[] = [];
  for (const h of m.hands) {
    if (!isVisitorMemberId(h) || hands.includes(h)) return null;
    hands.push(h);
  }
  if (!Array.isArray(m.acks) || m.acks.length > WALL_LIMITS.maxAcks) return null;
  const acks: string[] = [];
  for (const a of m.acks) {
    if (typeof a !== "string" || !ROUND_ID_RE.test(a)) return null;
    acks.push(a);
  }
  if (!Array.isArray(m.nacks) || m.nacks.length > WALL_LIMITS.maxNacks) return null;
  const nacks: { iid: string; why: WallRefusal }[] = [];
  for (const rawNack of m.nacks) {
    const n = obj(rawNack);
    if (!n || typeof n.iid !== "string" || !ROUND_ID_RE.test(n.iid)) return null;
    if (!(WALL_REFUSALS as readonly unknown[]).includes(n.why)) return null;
    nacks.push({ iid: n.iid, why: n.why as WallRefusal });
  }
  return { ...head, tool, round, hands, acks, nacks };
}

// ── The saved result ─────────────────────────────────────────────────

/** A wall round as a tool saves it: the prompt, each post's text and votes. No ids, no names. */
export interface WallRoundResult {
  /** The round's id, for Save once (not a member's). */
  roundId: string;
  tool: WallRoomTool;
  prompt: string;
  /** ISO timestamp of the save. */
  closedAt: string;
  mode: WallMode;
  /** The posts on the wall, most votes first (hidden ones left out). */
  posts: { text: string; votes: number; merged: string[] }[];
}

/** The round as Markdown: the prompt, then each post with its votes. */
export function wallRoundMarkdown(r: WallRoundResult): string {
  const lines = [
    `# ${mdCell(r.prompt)}`,
    "",
    `${r.posts.length} ${r.posts.length === 1 ? "post" : "posts"}, anonymous, ${r.closedAt.slice(0, 10)}.`,
    "",
    "| Post | Votes |",
    "| --- | ---: |",
  ];
  for (const p of r.posts) {
    const merged = p.merged.length > 0 ? ` (also: ${p.merged.map(mdCell).join("; ")})` : "";
    lines.push(`| ${mdCell(p.text)}${merged} | ${p.votes} |`);
  }
  return `${lines.join("\n")}\n`;
}
