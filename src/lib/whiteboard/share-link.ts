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
const TOKEN_LENGTH = 12;

export type ShareRole = "editor" | "viewer";

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
    return parsed as StoredTokens;
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
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Create a share token for a board. Returns the token and the full
 * URL that opens the canvas in the right mode.
 */
export function createShareToken(boardId: string, role: ShareRole, ttlDays = 7): { token: string; url: string } {
  const now = Date.now();
  const expiresAt = now + ttlDays * 24 * 60 * 60 * 1000;
  const token = randomToken();
  const state = load();
  // Purge expired tokens before persisting the new one — keeps the
  // store from accumulating cruft.
  const fresh = state.tokens.filter((t) => t.expiresAt > now);
  fresh.push({ token, boardId, role, expiresAt, createdAt: now });
  save({ tokens: fresh });
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/canvas?board=${boardId}&share=${token}${role === "viewer" ? "&view=readonly" : ""}`
    : "";
  emitSignal({
    kind: "whiteboard.boardShared",
    at: new Date(now).toISOString(),
    toolId: "canvas",
    payload: { boardId, role, ttlDays, token },
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
