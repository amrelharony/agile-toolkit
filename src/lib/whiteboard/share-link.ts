/**
 * Per-board share link generation.
 *
 * ════════════════════════════════════════════════════════════════════
 * Storage model
 * ════════════════════════════════════════════════════════════════════
 *
 * Tokens now live in Postgres (`public.share_tokens` — migration
 * 0003). Issuance requires sign-in; the token URL itself is still
 * anonymous, so anyone with the URL can use the role it grants.
 *
 * The legacy localStorage store stays as a READ fallback during the
 * transition window: any token that resolves from localStorage but
 * NOT from Supabase is honoured client-side until natural expiry.
 * New tokens never get written to localStorage. Once the existing
 * localStorage tokens have all expired (max TTL is 365 days), the
 * fallback block can be deleted.
 *
 * The token → boardId mapping lives in localStorage at
 * `agile-toolkit:share-tokens` for the read fallback only.
 */

import { emitSignal } from "@/lib/signals/signal-bus";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";

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

// ──────────────────────────────────────────────────────────────────────
// Legacy localStorage fallback (READ-ONLY going forward).
//
// New tokens go to Supabase. These helpers stay around so a user who
// reloads with a still-valid URL issued before the migration keeps
// working — without them, every pre-migration link would suddenly
// 404 on validation.
// ──────────────────────────────────────────────────────────────────────

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
 * Specific error raised when token creation requires sign-in but no
 * authenticated session is available. UI catches this to prompt the
 * user to sign in instead of surfacing a generic Supabase error.
 */
export class ShareTokenAuthRequiredError extends Error {
  constructor() {
    super("Sign-in required to create a share link");
    this.name = "ShareTokenAuthRequiredError";
  }
}

/**
 * Create a share token for a board. Returns the token and the full
 * URL that opens the canvas in the right mode.
 *
 * Requires an authenticated Supabase session. Throws
 * `ShareTokenAuthRequiredError` when no session is available.
 */
export async function createShareToken(
  boardId: string,
  role: ShareRole,
  ttlDays = 7,
): Promise<{ token: string; url: string }> {
  const now = Date.now();
  // H14 — clamp ttlDays. Anything <1 day or >365 (or NaN/undefined) is
  // coerced to a safe window; floors fractional days so the math is clean.
  const safeDays = Math.max(1, Math.min(365, Math.floor(Number(ttlDays) || 7)));
  const expiresAt = now + safeDays * 24 * 60 * 60 * 1000;
  const token = randomToken();

  const client = getAuthBrowserClient();
  if (!client) {
    // No Supabase configured — fail closed. The localStorage path is
    // legacy READ-ONLY now; we don't write new tokens there.
    throw new Error("share-link: Supabase is not configured");
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new ShareTokenAuthRequiredError();
  }
  const { error } = await client.from("share_tokens").insert({
    token,
    board_id: boardId,
    role,
    expires_at: new Date(expiresAt).toISOString(),
    created_by: user.id,
  });
  if (error) {
    throw new Error(`share-link: ${error.message}`);
  }

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

/**
 * Resolve a share token from a URL query string.
 *
 * Server-first lookup: the Supabase `share_tokens` row is the source
 * of truth. The localStorage fallback only honours legacy tokens
 * issued before the server-persistence rollout. Returns null when
 * the token doesn't exist, is revoked, or has expired — RLS already
 * filters those out, so a row coming back means it's valid.
 */
export async function resolveShareToken(token: string): Promise<ShareToken | null> {
  const client = getAuthBrowserClient();
  if (client) {
    const { data, error } = await client
      .from("share_tokens")
      .select("token, board_id, role, expires_at, created_at")
      .eq("token", token)
      .maybeSingle();
    if (!error && data) {
      return {
        token: data.token,
        boardId: data.board_id,
        role: data.role as ShareRole,
        expiresAt: new Date(data.expires_at).getTime(),
        createdAt: new Date(data.created_at).getTime(),
      };
    }
    // error or no row: fall through to legacy localStorage lookup so
    // pre-migration links keep working. Don't surface the supabase
    // error — the user shouldn't see a backend error for a missing
    // legacy token.
  }

  const state = load();
  const now = Date.now();
  const hit = state.tokens.find((t) => t.token === token);
  if (!hit) return null;
  if (hit.expiresAt < now) return null;
  return hit;
}

/**
 * Revoke a token immediately. Server tokens get a revoked_at stamp
 * (audit trail preserved); legacy localStorage tokens are deleted.
 *
 * Requires an authenticated session for server tokens — only the
 * issuer can revoke their own. Returns silently on auth failure so
 * the caller doesn't need to special-case "this was a legacy token,
 * not a server token" — both paths run.
 */
export async function revokeShareToken(token: string): Promise<void> {
  const client = getAuthBrowserClient();
  if (client) {
    // RLS ensures only the issuer can update this row. If the user
    // isn't signed in or isn't the issuer, the UPDATE returns 0 rows
    // and we fall through to the localStorage cleanup.
    await client
      .from("share_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token", token);
  }
  // Legacy: always purge from localStorage so a revoke-of-legacy works.
  const state = load();
  save({ tokens: state.tokens.filter((t) => t.token !== token) });
}

/**
 * List all valid (non-expired, non-revoked) share tokens for a board.
 *
 * Combines server-side issuer-owned tokens with the localStorage
 * fallback. The fallback contributes only pre-migration tokens; new
 * tokens always live server-side.
 */
export async function listShareTokens(boardId: string): Promise<ShareToken[]> {
  const now = Date.now();
  const out: ShareToken[] = [];

  const client = getAuthBrowserClient();
  if (client) {
    const {
      data: { user },
    } = await client.auth.getUser();
    if (user) {
      const { data, error } = await client
        .from("share_tokens")
        .select("token, board_id, role, expires_at, created_at")
        .eq("board_id", boardId)
        .eq("created_by", user.id)
        .is("revoked_at", null)
        .gt("expires_at", new Date(now).toISOString())
        .order("created_at", { ascending: false });
      if (!error && data) {
        for (const row of data) {
          out.push({
            token: row.token,
            boardId: row.board_id,
            role: row.role as ShareRole,
            expiresAt: new Date(row.expires_at).getTime(),
            createdAt: new Date(row.created_at).getTime(),
          });
        }
      }
    }
  }

  // Legacy localStorage tokens. Dedupe against server entries by token
  // string so a token that exists in BOTH (shouldn't happen post-rollout,
  // but defensive) only appears once.
  const serverTokens = new Set(out.map((t) => t.token));
  const legacy = load();
  for (const t of legacy.tokens) {
    if (t.boardId !== boardId) continue;
    if (t.expiresAt <= now) continue;
    if (serverTokens.has(t.token)) continue;
    out.push(t);
  }
  return out;
}
