/**
 * Shared single-user allowlist check.
 *
 * Reads `AUTHORIZED_EMAILS` (comma-separated). If unset, returns false for
 * every email — fail closed. The middleware, API helpers, agent route, and
 * MCP route all consult this so the rule lives in one place.
 *
 * AUTHORIZED_EMAILS is intentionally NOT prefixed with NEXT_PUBLIC_. The
 * allowlist must never be inlined into the client bundle.
 */

let cached: { value: string | undefined; emails: Set<string> } | null = null;

function loadEmails(): Set<string> {
  const raw = process.env.AUTHORIZED_EMAILS;
  if (cached && cached.value === raw) return cached.emails;
  const emails = new Set<string>();
  if (raw) {
    for (const part of raw.split(",")) {
      const e = part.trim().toLowerCase();
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
  return emails.has(email.trim().toLowerCase());
}

/**
 * For diagnostics only — never expose the list itself to the client. The
 * count answers "is the allowlist configured?" without revealing identities.
 */
export function authorizedEmailCount(): number {
  return loadEmails().size;
}
