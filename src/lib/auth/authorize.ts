/**
 * Shared single-user allowlist check.
 *
 * Reads `AUTHORIZED_EMAILS` (comma-separated). If unset, returns false for
 * every email — fail closed. The middleware, API helpers, agent route, OAuth
 * callback and MCP PAT check all consult this (via `isOwnerUser`) so the rule
 * lives in one place.
 *
 * AUTHORIZED_EMAILS is intentionally NOT prefixed with NEXT_PUBLIC_. The
 * allowlist must never be inlined into the client bundle.
 */

let cached: { value: string | undefined; emails: Set<string> } | null = null;

function normalize(s: string): string {
  // NFC + strip BOM + trim + lowercase. The BOM-strip handles env files
  // saved as UTF-8-with-BOM on Windows; NFC handles "alíce" vs "alíce"
  // (composed vs decomposed) which compare unequal under === otherwise.
  // (Test coverage gaps noted in BUG-A test review.)
  return s.replace(/^﻿/, "").normalize("NFC").trim().toLowerCase();
}

function loadEmails(): Set<string> {
  const raw = process.env.AUTHORIZED_EMAILS;
  if (cached && cached.value === raw) return cached.emails;
  const emails = new Set<string>();
  if (raw) {
    for (const part of raw.split(",")) {
      const e = normalize(part);
      if (e) emails.add(e);
    }
  }
  cached = { value: raw, emails };
  return emails;
}

export function isEmailAuthorized(email: string | null | undefined): boolean {
  if (!email) return false;
  const emails = loadEmails();
  if (emails.size === 0) return false; // fail closed when unconfigured
  return emails.has(normalize(email));
}

/**
 * For diagnostics only — never expose the list itself to the client. The
 * count answers "is the allowlist configured?" without revealing identities.
 */
export function authorizedEmailCount(): number {
  return loadEmails().size;
}

/**
 * The slice of a Supabase user `isOwnerUser` reads. Structural so it accepts
 * the full `User` from supabase-js, the middleware's narrowed probe result,
 * and the admin API's `getUserById` payload alike — and so this module stays
 * free of supabase-js imports (it runs at the edge).
 */
export type OwnerCandidate = {
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: { provider?: unknown } | null;
  identities?: ReadonlyArray<{ identity_data?: Record<string, unknown> | null }> | null;
};

export type OwnerCheck =
  | { ok: true }
  | { ok: false; code: "not_authorized" | "wrong_provider" | "email_unverified" };

/**
 * The `message` that goes with each denial code in a 403 body. Shared so the
 * edge middleware and `requireAuthorizedUser` answer identically.
 */
export const OWNER_DENIAL_MESSAGES: Record<Extract<OwnerCheck, { ok: false }>["code"], string> = {
  not_authorized: "This account is not on the allowlist.",
  wrong_provider: "Only Google identities are accepted.",
  email_unverified: "Email not verified.",
};

/**
 * Is this the workspace owner? Allowlisted email AND a Google identity AND a
 * verified email — every server-side owner gate (middleware, API helper,
 * OAuth callback, MCP PAT check) asks this one question. The codes double as
 * the `error` field of the 403 the API returns, so keep them stable.
 */
export function isOwnerUser(user: OwnerCandidate | null | undefined): OwnerCheck {
  if (!user || !isEmailAuthorized(user.email)) return { ok: false, code: "not_authorized" };

  // BUG-A7: assert the identity is a Google identity with a verified email.
  // The allowlist is paranoid-by-default — adding any second OAuth provider
  // later must not silently widen who can sign in just because their email
  // collides with an allowlist entry. Today (Google-only) this is redundant;
  // tomorrow it's load-bearing.
  //
  // Fail-closed on undefined provider: a row without `app_metadata.provider`
  // could come from a manually inserted user, a misconfigured OAuth flow,
  // or a future provider that doesn't populate the field. None of those
  // should pass the Google-only gate.
  if (user.app_metadata?.provider !== "google") return { ok: false, code: "wrong_provider" };

  // Require email-verified. Prefer the identity record's own flag (which
  // reflects the verification state the provider asserted at sign-in); if
  // identities is empty (some Supabase configs omit it), fall back to the
  // top-level `email_confirmed_at` timestamp. Either signal must affirmatively
  // confirm — we never permissively accept an unverified email.
  const identities = user.identities ?? [];
  if (identities.length > 0) {
    const email = user.email?.toLowerCase();
    const matched = identities.find((i) => {
      const idEmail = i.identity_data?.email;
      return typeof idEmail === "string" && idEmail.toLowerCase() === email;
    });
    if (!matched || matched.identity_data?.email_verified === false) {
      return { ok: false, code: "email_unverified" };
    }
  } else if (!user.email_confirmed_at) {
    return { ok: false, code: "email_unverified" };
  }

  return { ok: true };
}
