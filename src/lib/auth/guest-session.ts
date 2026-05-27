/**
 * Guest session — httpOnly cookie carrying a HMAC-signed profile id.
 *
 * Cookie format (current):
 *   `<profileId>.<iat>.<base64url(HMAC-SHA256(secret, "profileId.iat"))>`
 *
 * Legacy format still accepted during migration:
 *   `<profileId>.<base64url(HMAC-SHA256(secret, "profileId"))>`
 *
 * Security model:
 *   * The signing key is the profile's own `cookie_secret` column. The
 *     server looks up the row by profile id, then verifies the HMAC.
 *     A leaked single cookie_secret compromises only that one guest.
 *   * The cookie is httpOnly + sameSite=lax + secure (in production).
 *     XSS can't read it; CSRF is mitigated by sameSite for state-
 *     changing endpoints. Token bearer semantics — anyone holding
 *     the signed cookie acts as that profile until revoked_at is set
 *     or the embedded iat ages past COOKIE_MAX_AGE_SECONDS.
 *   * The embedded iat lets the server expire a cookie independent
 *     of browser maxAge, which is honour-only (an extension that
 *     persists deleted cookies, a manually-replayed value, etc).
 *   * Verification reads the row via the service-role client (RLS
 *     bypass) because guests have no auth.uid(). Authorization
 *     happens in the calling route after this returns.
 */

import "server-only";
import { cookies } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSquadAdminClient } from "@/lib/squads/server";

const COOKIE_NAME = "agile-toolkit:guest";
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GuestSession {
  profileId: string;
  squadId: string;
  displayName: string;
  color: string;
  /** Workspace owner that this squad belongs to. Used by tools to scope
   *  realtime channels per-workspace — without it, every workspace on
   *  the same Supabase project would share a global channel for any
   *  tool with a constant entityId. */
  squadOwnerId: string;
}

/** Random base64url string suitable for storing as a profile's HMAC key. */
export function generateCookieSecret(): string {
  return randomBytes(32).toString("base64url");
}

function sign(profileId: string, secret: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload = `${profileId}.${iat}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Verify the cookie signature against the secret. Accepts both the
 * current 3-part format (`profileId.iat.sig`) and the legacy 2-part
 * format (`profileId.sig`) during the migration window. Returns
 * `false` (rejecting) when the current-format iat is older than
 * COOKIE_MAX_AGE_SECONDS — server-side expiry independent of the
 * browser's cookie-maxAge.
 *
 * Legacy fallback: TODO remove after grace period — once all
 * pre-iat cookies have aged out via browser maxAge (365 days from
 * deploy), drop the 2-part branch.
 */
function verifySignature(value: string, secret: string): boolean {
  const parts = value.split(".");
  if (parts.length === 3) {
    const [profileId, iatStr, sig] = parts;
    if (!profileId || !iatStr || !sig) return false;
    const iat = Number(iatStr);
    if (!Number.isFinite(iat) || !Number.isInteger(iat) || iat <= 0) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    // Reject cookies whose embedded issuance time is in the future
    // (clock skew or tampering) or aged past the max-age window.
    if (iat > nowSec + 60) return false;
    if (nowSec - iat > COOKIE_MAX_AGE_SECONDS) return false;
    const expected = createHmac("sha256", secret)
      .update(`${profileId}.${iatStr}`)
      .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  if (parts.length === 2) {
    const [profileId, sig] = parts;
    if (!profileId || !sig) return false;
    const expected = createHmac("sha256", secret).update(profileId).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  return false;
}

/**
 * Read the guest cookie, verify the HMAC against the database row, and
 * return the resolved session. Returns null when:
 *   * cookie missing or malformed
 *   * profile id doesn't exist
 *   * profile or its parent squad has been revoked
 *   * HMAC mismatch (cookie was tampered or secret was rotated)
 *   * cookie iat is older than COOKIE_MAX_AGE_SECONDS
 */
export async function getGuestSession(): Promise<GuestSession | null> {
  const cookieStore = cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  if (!value) return null;

  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const profileId = value.slice(0, dot);
  if (!UUID_RE.test(profileId)) return null;

  const admin = getSquadAdminClient();
  if (!admin) return null;

  // Embed `squads.revoked_at` so a soft-revoked squad disables every
  // active cookie under it without nulling the underlying profile.
  // Also embed `owner_id` so tools can scope realtime channels per
  // workspace owner — without that scoping, two distinct owners on the
  // same Supabase project share any global channel name a tool happens
  // to use (e.g. kudos with entityId="workspace").
  const { data, error } = await admin
    .from("squad_profiles")
    .select(
      "id, squad_id, display_name, color, cookie_secret, revoked_at, last_seen_at, squad:squads(revoked_at, owner_id)"
    )
    .eq("id", profileId)
    .single();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  const squad = data.squad as
    | { revoked_at: string | null; owner_id: string }
    | { revoked_at: string | null; owner_id: string }[]
    | null;
  // PostgREST returns embedded one-to-one as either an object or a
  // single-element array depending on relationship hints; handle both.
  const squadRow = Array.isArray(squad) ? (squad[0] ?? null) : squad;
  if (!squadRow) return null;
  if (squadRow.revoked_at) return null;
  if (typeof squadRow.owner_id !== "string" || squadRow.owner_id.length === 0) return null;
  if (!verifySignature(value, data.cookie_secret as string)) return null;

  return {
    profileId: data.id as string,
    squadId: data.squad_id as string,
    displayName: data.display_name as string,
    color: data.color as string,
    squadOwnerId: squadRow.owner_id,
  };
}

/** Set the httpOnly cookie that resumes this profile on subsequent requests. */
export function setGuestSessionCookie(profileId: string, cookieSecret: string): void {
  const value = sign(profileId, cookieSecret);
  const cookieStore = cookies();
  cookieStore.set({
    name: COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/** Clear the guest cookie (sign-out for guests).
 *
 * Mirrors every attribute of `setGuestSessionCookie` — browsers treat
 * cookies as equal only when name + path + domain + secure + httpOnly +
 * sameSite all match. A deletion cookie with mismatched attributes is
 * stored as a separate cookie and the original survives, so a guest who
 * "signs out" remains signed in until they manually clear site data. */
export function clearGuestSessionCookie(): void {
  const cookieStore = cookies();
  cookieStore.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export const GUEST_COOKIE_NAME = COOKIE_NAME;
