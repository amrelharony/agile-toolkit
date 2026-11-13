/**
 * Wall rooms: what a participant's tab keeps for its session, in
 * sessionStorage like the room identity (`visitor-rooms.ts`): a refresh
 * keeps it, closing the tab forgets it, and nothing here is ever sent as it
 * is.
 *  - The tab's secret. It travels inside every sealed request, and the host
 *    ties the member id to it on first use, so nobody else can send under
 *    that id (`host.ts`). A refresh keeps it, so the same person goes on.
 *  - In a 25/10 round: the posts this tab scores, its scores with the keys
 *    to change them, and which posts it wrote, so a refresh shows the same
 *    five, keeps the scores and can still change them.
 * Every read and write is guarded: with storage blocked, it all lives in
 * the tab's memory only, as before.
 */

import { ROUND_ID_RE } from "../vote-room/wire";
import { WALL_LIMITS, isScore, isSenderSecret } from "./protocol";

const PREFIX = "agile-toolkit:wall-room:";

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked
  }
}

function read(key: string): string | null {
  try {
    return session()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    session()?.setItem(key, value);
  } catch {
    // Full or blocked: memory only.
  }
}

/**
 * This tab's secret in room `code` as member `member`: the stored one, or
 * `make()`'s, stored for next time.
 */
export function tabSecret(code: string, member: string, make: () => string): string {
  const key = `${PREFIX}secret:${code}:${member}`;
  const stored = read(key);
  if (isSenderSecret(stored)) return stored;
  const fresh = make();
  write(key, fresh);
  return fresh;
}

/** A 25/10 round as this tab remembers it. */
export interface ScoreMemo {
  round: string;
  /** The posts it scores, once picked (absent before). */
  pick?: string[];
  /** Post id → its score and the key behind the score's lock. */
  scores: Record<string, { value: number; key: string }>;
  /** The posts this tab wrote this round. */
  mine: string[];
}

const isId = (v: unknown): v is string => typeof v === "string" && ROUND_ID_RE.test(v);

function ids(raw: unknown, max: number): string[] | null {
  if (!Array.isArray(raw) || raw.length > max || !raw.every(isId)) return null;
  return Array.from(new Set(raw as string[]));
}

/** The round this tab remembers in room `code`, or null (none, or not readable). */
export function readScoreMemo(code: string, member: string): ScoreMemo | null {
  const raw = read(`${PREFIX}score:${code}:${member}`);
  if (!raw || raw.length > 8_000) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (!isId(o.round)) return null;
  const mine = ids(o.mine, WALL_LIMITS.maxPostsPerMember);
  if (!mine) return null;
  const memo: ScoreMemo = { round: o.round, scores: {}, mine };
  if (o.pick !== undefined) {
    const pick = ids(o.pick, WALL_LIMITS.scoresPerMember);
    if (!pick) return null;
    memo.pick = pick;
  }
  const scores = o.scores;
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) return null;
  for (const [pid, s] of Object.entries(scores as Record<string, unknown>)) {
    if (!isId(pid) || !s || typeof s !== "object") continue;
    const { value, key } = s as Record<string, unknown>;
    if (isScore(value) && isSenderSecret(key)) memo.scores[pid] = { value, key };
    if (Object.keys(memo.scores).length >= WALL_LIMITS.scoresPerMember * 2) break;
  }
  return memo;
}

export function writeScoreMemo(code: string, member: string, memo: ScoreMemo): void {
  write(`${PREFIX}score:${code}:${member}`, JSON.stringify(memo));
}
