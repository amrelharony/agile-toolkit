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

/**
 * BUG-A3: legacy fixed salt. Retained for back-compat — tokens minted
 * before migration 0008 (`salt` column null) verify via this salt.
 * NEVER use for new tokens; use {@link generateSalt} + {@link hashTokenWithSalt}.
 */
const LEGACY_SCRYPT_SALT = "agile-toolkit-pat-v1";
const SCRYPT_KEYLEN = 32;
const TOKEN_PREFIX = "pat_";
const TOKEN_BODY_BYTES = 24; // base64url(24) = 32 chars
const SALT_BYTES = 24; // base64url(24) = 32 chars — comfortably above the SQL min(16)

export function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BODY_BYTES).toString("base64url");
}

/** Generate a per-token random salt. Stored alongside the hash. */
export function generateSalt(): string {
  return randomBytes(SALT_BYTES).toString("base64url");
}

/**
 * Hash a raw bearer token with a per-token random salt. This is the
 * forward path for new tokens — see BUG-A3 in the security review.
 * A DB dump now requires per-row scrypt work to crack, restoring the
 * KDF's design intent.
 */
export function hashTokenWithSalt(raw: string, salt: string): string {
  return scryptSync(raw, salt, SCRYPT_KEYLEN).toString("base64");
}

/**
 * Legacy hash function (fixed salt). Only used by the back-compat
 * verification path for tokens minted before migration 0008.
 * @deprecated — new tokens must use {@link hashTokenWithSalt}.
 */
export function hashToken(raw: string): string {
  return scryptSync(raw, LEGACY_SCRYPT_SALT, SCRYPT_KEYLEN).toString("base64");
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
export async function verifyBearer(
  bearer: string
): Promise<{ userId: string; tokenId: string; squadProfileIds: string[] } | null> {
  if (!bearer.startsWith(TOKEN_PREFIX)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  // Service-role client bypasses RLS for this one privileged lookup.
  // We never expose this client to user code paths.
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // BUG-A3 back-compat: look up the token's salt first. Rows minted
  // before migration 0008 have salt=null and verify via the legacy
  // fixed-salt code path; rows minted after carry a per-row random
  // salt. We need to know which to use BEFORE computing the hash, so
  // probe by the token's plaintext prefix (8 chars — already stored
  // for the UI display) and find the matching row.
  //
  // The prefix is a partial credential — knowing 8 base64url chars
  // (~48 bits) doesn't grant access on its own (the bearer needs all
  // 192 bits to verify), and it's already stored plaintext for the
  // token-list UI. This SELECT is on a narrow column with low
  // cardinality; if two tokens ever shared a prefix, we iterate
  // candidates and verify against each.
  const prefix = prefixOf(bearer);
  const { data: candidates, error: probeError } = await admin
    .from("access_tokens")
    .select("id, user_id, salt, token_hash")
    .eq("prefix", prefix)
    .is("revoked_at", null);
  if (probeError) {
    // eslint-disable-next-line no-console
    console.warn("[mcp/pat] probe failed:", probeError.message);
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  for (const row of candidates as Array<{
    id: string;
    user_id: string;
    salt: string | null;
    token_hash: string;
  }>) {
    const expectedHash = row.salt ? hashTokenWithSalt(bearer, row.salt) : hashToken(bearer);
    // Constant-time compare per row to avoid timing oracles across
    // candidates. constantTimeEqual rejects length mismatches first,
    // so a fake-prefix candidate fails fast without leaking timing.
    if (!constantTimeEqual(expectedHash, row.token_hash)) continue;
    // Hit. Call the appropriate resolve_pat overload so last_used_at
    // updates atomically via the security-definer function (keeps the
    // RLS-bypass surface localised to that function).
    const rpcArgs = row.salt
      ? { p_hash: expectedHash, p_salt: row.salt }
      : { p_hash: expectedHash };
    const { data, error } = await admin.rpc("resolve_pat", rpcArgs);
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[mcp/pat] resolve_pat failed:", error.message);
      return null;
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return null;
    const resolved = rows[0] as {
      token_id: string;
      user_id: string;
      squad_profile_ids: string[] | null;
    };
    return {
      userId: resolved.user_id,
      tokenId: resolved.token_id,
      // Post-0018 the column is NOT NULL with default '{}', but a stale
      // RPC return from a pre-0018 deploy can still surface null. Coerce
      // to empty so handlers always receive an array.
      squadProfileIds: resolved.squad_profile_ids ?? [],
    };
  }
  return null;
}

export function prefixOf(rawToken: string): string {
  return rawToken.slice(0, 8);
}
