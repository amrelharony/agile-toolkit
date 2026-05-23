import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Personal Access Tokens for the MCP HTTP transport.
 *
 * Token format: `pat_` + 32 random bytes encoded as base64url (44 chars
 * after the prefix → 48 total). Stored as scrypt(rawToken, salt) base64.
 * Prefix (`pat_xxxx` first 8 chars) is also stored plaintext for UI
 * display (recognise tokens in lists without revealing the full value).
 *
 * Verification uses the security-definer `resolve_pat(text)` function
 * that bypasses RLS — the request is unauthenticated at the Postgres
 * layer because the bearer is not a Supabase JWT.
 */

const SCRYPT_SALT = "agile-toolkit-pat-v1";
const SCRYPT_KEYLEN = 32;
const TOKEN_PREFIX = "pat_";
const TOKEN_BODY_BYTES = 24; // base64url(24) = 32 chars

export function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BODY_BYTES).toString("base64url");
}

export function hashToken(raw: string): string {
  // scrypt is intentionally slow — fast enough for per-request verification
  // (single-user, low call volume) and slow enough to make any leaked DB
  // dump uneconomical to crack offline.
  return scryptSync(raw, SCRYPT_SALT, SCRYPT_KEYLEN).toString("base64");
}

/**
 * Constant-time string compare to defend against length-leak / timing
 * oracles when comparing the bearer hash to the stored hash.
 *
 * In practice the Supabase RLS-bypass function we call does the lookup
 * by hash directly (so it returns 0 or 1 row); the explicit compare
 * here is belt-and-braces for any future direct table query.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Resolve a raw bearer token to (token_id, user_id) via the security-
 * definer Postgres function. Updates last_used_at as a side-effect.
 *
 * Returns null when:
 *   - Service-role key not configured
 *   - Token doesn't match any row
 *   - Token is revoked or expired
 */
export async function verifyBearer(bearer: string): Promise<{ userId: string; tokenId: string } | null> {
  if (!bearer.startsWith(TOKEN_PREFIX)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  // Service-role client bypasses RLS for this one privileged lookup.
  // We never expose this client to user code paths.
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const hash = hashToken(bearer);
  const { data, error } = await admin.rpc("resolve_pat", { p_hash: hash });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[mcp/pat] resolve_pat failed:", error.message);
    return null;
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  const row = rows[0] as { token_id: string; user_id: string };
  return { userId: row.user_id, tokenId: row.token_id };
}

export function prefixOf(rawToken: string): string {
  return rawToken.slice(0, 8);
}
