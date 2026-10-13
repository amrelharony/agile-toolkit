"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignOutResult } from "./types";

/**
 * Sign-out that actually leaves THIS browser signed out.
 *
 * supabase-js (auth-js 2.101) POSTs /logout before it drops the stored
 * session — even for `scope: "local"` — and when that call fails (offline,
 * 5xx, 429, a refresh error) it returns `{ error }` WITHOUT removing the
 * session or emitting SIGNED_OUT. It doesn't throw either, so a caller
 * that only catches went on to clear the toolkit's data and reload into a
 * page that restored the owner's session for whoever used the browser
 * next. And the request has no timeout, so a hung one never returned.
 *
 * Here a failed or hung server call is followed by removing the session
 * from this browser anyway: the client's own storage, plus every
 * `sb-*-auth-token*` cookie (@supabase/ssr sets them without httpOnly, so
 * the page can expire them). The refresh token stays valid server-side
 * until it expires, but nothing here holds it any more.
 */

const SIGN_OUT_TIMEOUT_MS = 8_000;
const VERIFY_TIMEOUT_MS = 2_000;

/** `sb-<ref>-auth-token`, its `.N` chunks, the PKCE verifier and the user copy. */
const SB_AUTH_COOKIE = /^sb-.+-auth-token(?:-code-verifier|-user)?(?:\.\d+)?$/;

function supabaseAuthCookieNames(): string[] {
  let raw = "";
  try {
    raw = document.cookie;
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const part of raw.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name && SB_AUTH_COOKIE.test(name)) names.push(name);
  }
  return names;
}

export function hasSupabaseAuthCookie(): boolean {
  if (typeof document === "undefined") return false;
  return supabaseAuthCookieNames().length > 0;
}

/** Expire every Supabase session cookie this page can see. */
export function expireSupabaseAuthCookies(): void {
  if (typeof document === "undefined") return;
  for (const name of supabaseAuthCookieNames()) {
    try {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    } catch {
      /* keep going */
    }
  }
}

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** True when the client still reports a session. Never waits on a lock a hung sign-out holds. */
async function sessionRemains(client: SupabaseClient): Promise<boolean> {
  if (hasSupabaseAuthCookie()) return true;
  const answer = await Promise.race([
    client.auth
      .getSession()
      .then(({ data }) => (data.session ? "yes" : "no"))
      .catch(() => "unknown" as const),
    delay(VERIFY_TIMEOUT_MS, "unknown" as const),
  ]);
  // "unknown" with no cookie left: the cookies are this browser's session
  // storage, so it is signed out.
  return answer === "yes";
}

export async function signOutThisBrowser(
  client: SupabaseClient,
  scope: "global" | "local" = "global"
): Promise<SignOutResult> {
  let revoked = false;
  try {
    const result = await Promise.race([
      client.auth.signOut({ scope }),
      delay(SIGN_OUT_TIMEOUT_MS, null),
    ]);
    revoked = result !== null && !result.error;
  } catch {
    revoked = false;
  }

  if (!revoked) {
    // auth-js's own local removal (storage + SIGNED_OUT to subscribers and
    // other tabs). Private, so reached through a cast; the cookie sweep
    // below doesn't depend on it.
    try {
      await (client.auth as unknown as { _removeSession?: () => Promise<void> })._removeSession?.();
    } catch {
      /* fall through to the cookie sweep */
    }
    expireSupabaseAuthCookies();
  }

  return { revoked, signedOutHere: !(await sessionRemains(client)) };
}
