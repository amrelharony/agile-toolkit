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
    // Strip C0 / DEL control characters server-side. Owner-side payloads
    // already pass through DOMPurify on render, but guest payloads land
    // in JSONB raw — keep them clean to avoid renderer surprises.
    // eslint-disable-next-line no-control-regex
    const stripped = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    // Cap string length defensively — JSONB total cap already enforces
    // 32KB, but a single huge string is rarely meaningful in a payload.
    const capped = stripped.length > 8192 ? stripped.slice(0, 8192) : stripped;
    // Reset .lastIndex defensively — global regex carries state across calls.
    EMAIL_LIKE.lastIndex = 0;
    if (!EMAIL_LIKE.test(capped)) return capped as unknown as T;
    EMAIL_LIKE.lastIndex = 0;
    return capped.replace(EMAIL_LIKE, "[redacted-email]") as unknown as T;
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

/**
 * Stricter sanitizer for the guest ingestion route. The client-side
 * `sanitizePayload` is best-effort defence-in-depth; this server-side
 * variant additionally enforces a shape contract (max depth 3, max
 * keys/object 50, max total bytes 16 KiB) and throws on violation so the
 * route can return a 400 instead of writing malformed data into the
 * audit log.
 */
const MAX_GUEST_DEPTH = 3;
const MAX_GUEST_KEYS = 50;
const MAX_GUEST_JSON_BYTES = 16_384;

export class GuestPayloadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function sanitizeGuestPayload(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new GuestPayloadError("payload_must_be_object", "payload must be a plain object");
  }
  // Reject oversize before sanitize, otherwise `sanitizePayload`'s per-string
  // 8 KiB truncation would silently turn a 20 KiB hostile payload into a
  // legal 8 KiB one — we want a hard 400 instead.
  let rawSerialized: string;
  try {
    rawSerialized = JSON.stringify(input);
  } catch {
    throw new GuestPayloadError("invalid_payload", "payload could not be serialised");
  }
  if (rawSerialized.length > MAX_GUEST_JSON_BYTES) {
    throw new GuestPayloadError("payload_too_large", "payload exceeds 16 KiB");
  }
  const cleaned = sanitizePayload(input as Record<string, unknown>) as Record<string, unknown>;
  enforceShape(cleaned, 0);
  return cleaned;
}

function enforceShape(value: unknown, depth: number): void {
  if (depth > MAX_GUEST_DEPTH) {
    throw new GuestPayloadError("payload_too_deep", "payload nested too deeply");
  }
  if (value === null) return;
  if (Array.isArray(value)) {
    if (value.length > MAX_GUEST_KEYS) {
      throw new GuestPayloadError("payload_too_wide", "array too large");
    }
    for (const v of value) enforceShape(v, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new GuestPayloadError("payload_must_be_object", "non-plain object in payload");
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_GUEST_KEYS) {
      throw new GuestPayloadError("payload_too_wide", "too many keys");
    }
    for (const [, v] of entries) enforceShape(v, depth + 1);
    return;
  }
  // primitives — already string-capped by sanitizePayload above.
}
