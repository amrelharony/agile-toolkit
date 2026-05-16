/**
 * Belt-and-braces stripping of accidentally-logged secrets.
 *
 * The logger never *intentionally* receives secrets — payloads are typed via
 * the per-tool action catalog. This is defense-in-depth in case a tool is
 * refactored carelessly in the future.
 */

// Match exact suspicious key names AND common suffix variants.
// `^token$` catches "token" but misses "accessToken" / "refreshToken" /
// "bearerToken" / "idToken" / "csrfToken" / "clientSecret" / "apiSecret"
// etc. — extending with `(?:[A-Z]\w+)?$` matches both bare and
// camelCased variants. Same for `*Key`, `*Secret`, `*Password`.
const SUSPICIOUS_KEYS = /^(?:(?:access|refresh|bearer|id|csrf|auth|session|api|client|app|service|webhook)?(?:token|secret|password|key|jwt)|authorization|cookie|set-cookie)s?$/i;
// Global flag is required so .replace() redacts every match, not just the first
// occurrence in a multi-email string. /gi for case-insensitive global.
const EMAIL_LIKE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function sanitizePayload<T>(input: T, depth = 0): T {
  if (depth > 6) return input; // guard against pathological objects
  if (input == null) return input;

  if (typeof input === "string") {
    // Reset .lastIndex defensively — global regex carries state across calls.
    EMAIL_LIKE.lastIndex = 0;
    if (!EMAIL_LIKE.test(input)) return input;
    EMAIL_LIKE.lastIndex = 0;
    return input.replace(EMAIL_LIKE, "[redacted-email]") as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((v) => sanitizePayload(v, depth + 1)) as unknown as T;
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SUSPICIOUS_KEYS.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizePayload(v, depth + 1);
    }
    return out as unknown as T;
  }

  return input;
}
