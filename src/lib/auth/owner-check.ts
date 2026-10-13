/**
 * Client-side owner verification.
 *
 * The owner allowlist (`AUTHORIZED_EMAILS`) is a server-only env var, so
 * the browser cannot decide on its own whether a Supabase session belongs
 * to the owner. `checkOwner()` asks the server (`GET /api/auth/owner`,
 * which runs the same `requireAuthorizedUser()` gate as every owner API)
 * and maps the answer to four outcomes:
 *
 *   owner   — 200 `{ owner: true }`
 *   denied  — 403: signed in, but not the owner account
 *   invalid — 401: the server does not see a usable session
 *   unknown — anything else (5xx, network error, timeout, odd body).
 *             Callers must not treat this as owner OR as denied.
 *
 * Never throws.
 */

export type OwnerCheckResult = "owner" | "denied" | "invalid" | "unknown";

export const OWNER_CHECK_URL = "/api/auth/owner";

/**
 * localStorage marker set once the owner has been verified on this
 * browser. Lets the visitor UI hint "Sign in to sync" after the owner's
 * session expires. Re-exported from `use-is-owner.ts`; it lives here so
 * the provider can write it without a circular import.
 */
export const OWNER_SEEN_KEY = "agile-toolkit:owner-seen";

/**
 * `AuthState.error` while a session exists but `/api/auth/owner` gave no
 * answer (offline, 5xx, timeout). Status is "error" with no user, so
 * nothing owner-only runs until a retry confirms the owner — but the
 * session is still there, so this is not a visitor either. Lives here (and
 * is re-exported from auth-provider) so hooks can read it without pulling
 * in the provider, which many tests mock with only `useAuthOptional`.
 */
export const OWNER_UNVERIFIED = "owner_unverified";

const DEFAULT_TIMEOUT_MS = 8_000;

export async function checkOwner(
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<OwnerCheckResult> {
  const { fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // The race (not just the abort signal) bounds the whole exchange,
  // including the body read, even if a fetch implementation ignores
  // `signal`.
  const timedOut = new Promise<OwnerCheckResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve("unknown");
    }, timeoutMs);
  });

  const request = (async (): Promise<OwnerCheckResult> => {
    const init: RequestInit = {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller?.signal,
    };
    const res = fetchImpl
      ? await fetchImpl(OWNER_CHECK_URL, init)
      : await fetch(OWNER_CHECK_URL, init);
    if (res.status === 200) {
      const body: unknown = await res.json().catch(() => null);
      const isOwner =
        typeof body === "object" && body !== null && (body as { owner?: unknown }).owner === true;
      return isOwner ? "owner" : "unknown";
    }
    if (res.status === 403) return "denied";
    if (res.status === 401) return "invalid";
    return "unknown";
  })().catch((): OwnerCheckResult => "unknown");

  try {
    return await Promise.race([request, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
