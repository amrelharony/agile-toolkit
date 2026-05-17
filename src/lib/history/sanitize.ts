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
//
// R5 widening: prior regex was camelCase-only. Most third-party SDKs
// (Supabase, Stripe, GitHub, Slack) hand back snake_case keys verbatim,
// so `access_token` / `client_secret` / `api_key` previously sailed
// through. The optional `[_-]?` between prefix and root admits both
// snake_case and kebab-case variants. Also added missing roots:
// `pwd`, `pin`, `passcode`, `hash`, `salt`, `signature`/`sig`,
// `credential(s)`, `nonce`, `otp`, `mfa`, and prefixes `private`,
// `signing`, `encryption`, `master`, `public`.
const SUSPICIOUS_KEYS =
  /^(?:(?:access|refresh|bearer|id|csrf|auth|session|api|client|app|service|webhook|private|public|signing|encryption|master)[_-]?)?(?:token|secret|password|passwd|pwd|passcode|pin|key|jwt|hash|salt|signature|sig|credential|nonce|otp|mfa)s?$|^(?:authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;
// Global flag is required so .replace() redacts every match, not just the first
// occurrence in a multi-email string. /gi for case-insensitive global.
const EMAIL_LIKE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function sanitizePayload<T>(input: T, depth = 0): T {
  // R5: depth bomb should *redact* not return raw. A 7-level-deep payload
  // with `password` at level 7 previously passed through unchanged.
  if (depth > 6) return "[depth-exceeded]" as unknown as T;
  if (input == null) return input;

  if (typeof input === "string") {
    // Reset .lastIndex defensively — global regex carries state across calls.
    EMAIL_LIKE.lastIndex = 0;
    if (!EMAIL_LIKE.test(input)) return input;
    EMAIL_LIKE.lastIndex = 0;
    return input.replace(EMAIL_LIKE, "[redacted-email]") as unknown as T;
  }

  // R5: `Object.entries(new Date())` returns `[]` and silently wipes the
  // value. Same for Map / Set / URL / RegExp / typed arrays. Return these
  // as-is so the logger doesn't quietly destroy structured payloads.
  if (
    input instanceof Date ||
    input instanceof Map ||
    input instanceof Set ||
    input instanceof RegExp ||
    input instanceof URL ||
    (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(input as unknown as ArrayBufferView))
  ) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((v) => sanitizePayload(v, depth + 1)) as unknown as T;
  }

  if (typeof input === "object") {
    // Refuse anything that isn't a plain object — class instances would
    // otherwise be silently flattened, losing methods + identity.
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) {
      return input;
    }
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
