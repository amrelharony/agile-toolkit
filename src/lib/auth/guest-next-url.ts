/**
 * Validator for the `?next=` URL on guest-join redirects.
 *
 * We accept ONLY paths inside the `/guest/` tree. A guest who just
 * redeemed a code has no business landing on `/settings` or any
 * owner-side route — and middleware would 403 them anyway, producing
 * a confusing landing. Stricter than the owner-side `safeRelativeUrl`
 * in `src/middleware.ts` on purpose.
 *
 * Defends against:
 *   - absolute URLs ("https://evil.com/...")
 *   - protocol-relative ("//evil.com/...")
 *   - backslash tricks ("/\\evil.com/...")
 *   - control-character smuggling
 *   - URL-encoded scheme/host bypass ("/%2F%2Fevil.com/...")
 *   - any path not under `/guest/`
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export function isSafeGuestNextUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (!raw || raw.length > 2048) return false;
  if (CONTROL_CHARS.test(raw)) return false;
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return false;
  try {
    const u = new URL(raw, "http://dummy.local");
    if (u.origin !== "http://dummy.local") return false;
    // Lock the destination to the (guest) route group.
    if (u.pathname !== "/guest" && !u.pathname.startsWith("/guest/")) return false;
  } catch {
    return false;
  }
  return true;
}
