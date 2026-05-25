/**
 * Guest session — httpOnly cookie carrying a HMAC-signed profile id.
 *
 * Cookie format: `<profileId>.<base64url(HMAC-SHA256(cookie_secret, profileId))>`
 *
 * Security model:
 *   * The signing key is the profile's own `cookie_secret` column. The
 *     server looks up the row by profile id, then verifies the HMAC.
 *     A leaked single cookie_secret compromises only that one guest.
 *   * The cookie is httpOnly + sameSite=lax + secure (in production).
 *     XSS can't read it; CSRF is mitigated by sameSite for state-
 *     changing endpoints. Token bearer semantics — anyone holding
 *     the signed cookie acts as that profile until revoke_at is set.
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
}

/** Random base64url string suitable for storing as a profile's HMAC key. */
export function generateCookieSecret(): string {
  return randomBytes(32).toString("base64url");
}

function sign(profileId: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(profileId).digest("base64url");
  return `${profileId}.${sig}`;
}

function verifySignature(value: string, secret: string): boolean {
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const profileId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(profileId).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Read the guest cookie, verify the HMAC against the database row, and
 * return the resolved session. Returns null when:
 *   * cookie missing or malformed
 *   * profile id doesn't exist
 *   * profile has been revoked
 *   * HMAC mismatch (cookie was tampered or secret was rotated)
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

  const { data, error } = await admin
    .from("squad_profiles")
    .select("id, squad_id, display_name, color, cookie_secret, revoked_at, last_seen_at")
    .eq("id", profileId)
    .single();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (!verifySignature(value, data.cookie_secret as string)) return null;

  return {
    profileId: data.id as string,
    squadId: data.squad_id as string,
    displayName: data.display_name as string,
    color: data.color as string,
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
