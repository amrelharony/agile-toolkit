/**
 * Per-board share link generation (Phase 30).
 *
 * Generates a token-based URL that lands on the canvas in either edit
 * or read-only mode. Tokens are NOT cryptographically secure — they're
 * a short random id stored in localStorage. Real auth comes when the
 * backend is wired up; this is the front-end plumbing so the UI
 * already supports the concept.
 *
 * The token → boardId mapping lives in localStorage at
 * `agile-toolkit:share-tokens` so the same URL works across reloads.
 */

import { emitSignal } from "@/lib/signals/signal-bus";

const STORAGE_KEY = "agile-toolkit:share-tokens";

export type ShareRole = "editor" | "viewer" | "commenter";

export interface ShareToken {
  token: string;
  boardId: string;
  role: ShareRole;
  /** Epoch-ms expiration. */
  expiresAt: number;
  createdAt: number;
}

interface StoredTokens {
  tokens: ShareToken[];
}

function load(): StoredTokens {
  if (typeof window === "undefined") return { tokens: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tokens: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tokens)) {
      return { tokens: [] };
    }
    // C3 — validate every token entry. localStorage is user-writable, so
    // a hand-crafted payload could otherwise grant editor access on read.
    const now = Date.now();
    const oneYearOut = now + 366 * 24 * 60 * 60 * 1000;
    const valid: ShareToken[] = [];
    for (const t of parsed.tokens) {
      if (!t || typeof t !== "object") continue;
      if (typeof t.token !== "string" || t.token.length === 0 || t.token.length > 100) continue;
      if (typeof t.boardId !== "string" || t.boardId.length === 0) continue;
      if (t.role !== "editor" && t.role !== "viewer" && t.role !== "commenter") continue;
      if (typeof t.expiresAt !== "number" || !Number.isFinite(t.expiresAt)) continue;
      if (typeof t.createdAt !== "number" || !Number.isFinite(t.createdAt)) continue;
      // Reject expiresAt > 1 year out — defense against injected immortal tokens.
      if (t.expiresAt > oneYearOut) continue;
      valid.push(t);
    }
    // H15 — purge expired tokens on read so localStorage doesn't leak.
    const fresh = valid.filter((t) => t.expiresAt > now);
    if (fresh.length !== parsed.tokens.length) {
      // Persist the cleanup so a future read doesn't re-run the same filter.
      save({ tokens: fresh });
    }
    return { tokens: fresh };
  } catch {
    return { tokens: [] };
  }
}

function save(state: StoredTokens): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota / private mode — fail silently.
  }
}

function randomToken(): string {
  // R5: prefer crypto.getRandomValues from BOTH window and globalThis
  // (Node ≥19 / Edge runtime exposes crypto on globalThis without a
  // window). The previous Math.random() fallback was a SILENT downgrade
  // to a predictable PRNG — a token leaked from one session could be
  // brute-forced for adjacent tokens via the same PRNG state.
  const cryptoObj =
    (typeof window !== "undefined" && window.crypto) ||
    (typeof globalThis !== "undefined" && (globalThis as { crypto?: Crypto }).crypto) ||
    null;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(12);
    cryptoObj.getRandomValues(bytes);
    // base62 encode (URL-safe, no padding). 12 bytes = ~16 chars.
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let out = "";
    for (const b of Array.from(bytes)) out += alphabet[b % alphabet.length];
    return out;
  }
  // No CSPRNG → fail loud rather than mint a predictable token. Callers
  // catch and surface "share-link disabled" to the user.
  throw new Error("share-link: no CSPRNG available; token generation refused");
}

/**
 * Build a share URL for a given board+token+role. Centralised so both
 * share-link.ts and share-modal.tsx produce identical strings and can't
 * drift apart (the view= param semantics have to stay in sync with the
 * canvas reader).
 */
export function buildShareUrl(boardId: string, token: string, role: ShareRole): string {
  if (typeof window === "undefined") return "";
  // Editors get no view= param; viewers get ?view=readonly (no pointer
  // mutations at all); commenters get ?view=commenter (read-only objects
  // but they can drop new comment threads).
  const viewParam =
    role === "viewer" ? "&view=readonly" :
    role === "commenter" ? "&view=commenter" :
    "";
  // URL-encode user-controllable inputs. `boardId` is auto-generated
  // today, but external imports / future user-rename flows could
  // contain `&`, `#`, `?`, spaces or non-ASCII — without encoding,
  // those would either split the query string or be silently dropped
  // by `window.location.origin`. Tokens are alphanumeric today but
  // encoded for the same defensive reason.
  return `${window.location.origin}/canvas?board=${encodeURIComponent(boardId)}&share=${encodeURIComponent(token)}${viewParam}`;
}

/**
 * Create a share token for a board. Returns the token and the full
 * URL that opens the canvas in the right mode.
 */
export function createShareToken(boardId: string, role: ShareRole, ttlDays = 7): { token: string; url: string } {
  const now = Date.now();
  // H14 — clamp ttlDays. Anything <1 day or >365 (or NaN/undefined) is
  // coerced to a safe window; floors fractional days so the math is clean.
  const safeDays = Math.max(1, Math.min(365, Math.floor(Number(ttlDays) || 7)));
  const expiresAt = now + safeDays * 24 * 60 * 60 * 1000;
  const token = randomToken();
  const state = load();
  // Purge expired tokens before persisting the new one — keeps the
  // store from accumulating cruft.
  const fresh = state.tokens.filter((t) => t.expiresAt > now);
  fresh.push({ token, boardId, role, expiresAt, createdAt: now });
  save({ tokens: fresh });
  const url = buildShareUrl(boardId, token, role);
  emitSignal({
    kind: "whiteboard.boardShared",
    at: new Date(now).toISOString(),
    toolId: "canvas",
    // Do NOT leak the share token into the signal bus — it persists
    // in the ring buffer (visible to any subscriber and to the future
    // debug history page) and would let anyone with read access to
    // recent signals escalate to whatever role the link granted.
    // Expose only a non-secret fingerprint for correlation in
    // analytics / activity feeds.
    payload: {
      boardId,
      role,
      ttlDays: safeDays,
      tokenPrefix: token.slice(0, 6),
    },
  });
  return { token, url };
}

/** Resolve a share token from a URL query string. Returns null when
 * the token doesn't exist or has expired. */
export function resolveShareToken(token: string): ShareToken | null {
  const state = load();
  const now = Date.now();
  const hit = state.tokens.find((t) => t.token === token);
  if (!hit) return null;
  if (hit.expiresAt < now) return null;
  return hit;
}

/** Revoke a token immediately (delete from storage). */
export function revokeShareToken(token: string): void {
  const state = load();
  save({ tokens: state.tokens.filter((t) => t.token !== token) });
}

/** List all valid (non-expired) share tokens for a board. */
export function listShareTokens(boardId: string): ShareToken[] {
  const state = load();
  const now = Date.now();
  return state.tokens.filter((t) => t.boardId === boardId && t.expiresAt > now);
}
