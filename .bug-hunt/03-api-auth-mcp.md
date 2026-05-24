# Server-Side Security Audit: API, Auth, MCP

## Critical Issues

### [CRITICAL] Rate limit is instance-local, not global

**File**: src/app/api/mcp/route.ts:10-22
**Bug**: The per-token rate limiter uses an in-memory bucket that exists only on the current instance. On multi-instance deployments (Vercel, horizontal scaling), each instance has its own 120 req/min limit. An attacker with one PAT can burn `120 × NUM_INSTANCES` requests/min across the backend.
**Evidence**:

```typescript
// src/app/api/mcp/route.ts:10-22
const RATE_LIMIT_PER_MIN = 120;
const bucket = new Map<string, { tokens: number; updated: number }>();
// ... consumeToken() only checks bucket.get(tokenId) which is instance-local
```

Deployed on Vercel's default 12+ functions, this allows ~1440 req/min per token — enough to DoS Supabase/LLM APIs.

**Repro / impact**: Create a PAT, distribute it across 12 function invocations (one per region/instance), each sends 120 requests/min. Total: ~1440 requests/min per token, bypassing the intended 120 req/min limit. Escalates to RLS-wide DoS if you exhaust quota on backend services.
**Fix idea**: Use Redis/Upstash for distributed rate limiting, or accept that single-user deployments don't require it (note in docs).

---

### [CRITICAL] Email verification bypass: identities array can be empty

**File**: src/lib/auth/require-user.ts:94-101
**Bug**: The code requires email_verified only if identities.length > 0. Some Supabase configs omit the identities array. If the array is empty or undefined, the email verification check is skipped entirely — an unverified Google account can sign in.
**Evidence**:

```typescript
// src/lib/auth/require-user.ts:94-101
if (identities.length > 0) {
  const matched = identities.find(...);
  if (matched && matched.identity_data?.email_verified === false) {
    throw jsonError(403, "email_unverified", "Email not verified.");
  }
}
// Falls through if identities.length === 0, no error thrown
```

**Repro / impact**: If a Supabase Auth user has an unverified Google email but the identities array is unpopulated, requireAuthorizedUser() accepts them. Worst case: an attacker with a stolen allowlist email can sign in if Google sent the account before email verification and identities weren't populated.
**Fix idea**: Fail closed: throw if identities.length === 0 OR if the matched identity has email_verified === false. Add a comment explaining why.

---

### [CRITICAL] Provider check is incomplete; should assert Google + verified

**File**: src/lib/auth/require-user.ts:83-86
**Bug**: The provider check only rejects non-Google identities IF provider is set. If provider is undefined (null/missing), the check is skipped. An attacker who finds a way to manufacture a user row with provider=undefined would bypass this check.
**Evidence**:

```typescript
// src/lib/auth/require-user.ts:83-86
const provider = (data.user.app_metadata as { provider?: unknown } | null)?.provider;
if (provider !== undefined && provider !== "google") {
  throw jsonError(403, "wrong_provider", "Only Google identities are accepted.");
}
// If provider === undefined, check is skipped
```

**Repro / impact**: A user manually created in Supabase (outside OAuth flow) with provider=undefined and an allowlist email would pass. Requires admin access or DB injection, but comment notes this is load-bearing for multi-provider setups.
**Fix idea**: Change to `if (provider !== "google")` (reject undefined too). The comment correctly notes this is paranoid but necessary for future multi-provider scenarios.

---

## High Issues

### [HIGH] No size limit on MCP request body

**File**: src/app/api/mcp/route.ts:127-133
**Bug**: The route accepts arbitrary JSON bodies with no size limit. A malicious PAT holder could send multi-megabyte payloads to exhaust memory or hit the default Next.js bodyParser limit (which may vary).
**Evidence**:

```typescript
// src/app/api/mcp/route.ts:127-133
let body: unknown;
try {
  body = await req.json();
} catch {
  return Response.json({ error: "Parse error" }, { status: 400 });
}
```

No explicit size limit; relies on Next.js defaults (typically 1MB for API routes).

**Repro / impact**: PAT holder sends a 100MB JSON body. Node buffers it entirely before parsing, consuming RAM. On a resource-constrained Vercel instance, this could OOM the function.
**Fix idea**: Set an explicit size limit on req.json() or validate Content-Length header before parsing.

---

### [HIGH] Supabase error messages leak database state

**File**: src/app/api/access-tokens/route.ts:27,75; [id]/route.ts:27,41
**Bug**: All Supabase errors are returned directly to the client. While tokens aren't exposed, database schema hints (column names, constraint violations) can leak.
**Evidence**:

```typescript
// src/app/api/access-tokens/route.ts:62-75
const { data, error } = await supabase.from("access_tokens").insert({...})
if (error) {
  return Response.json({ error: error.message }, { status: 500 });
}
```

**Repro / impact**: An attacker enumerates token_hash prefixes by creating tokens, triggering constraint violations, and reading error messages.
**Fix idea**: Catch Supabase errors, log them server-side, return generic `{ error: "server_error" }` to client.

---

### [HIGH] MCP notification handling doesn't validate before filtering

**File**: src/lib/mcp/transport-http.ts:39-44
**Bug**: Notifications (id=null) are silently dropped without validation. Invalid notifications could mask bugs.
**Evidence**:

```typescript
// src/lib/mcp/transport-http.ts:39-44
if (request.id === undefined || request.id === null) {
  return null;
}
```

**Repro / impact**: Low practical risk (no side effects) but defense-in-depth should log/audit invalid notifications.
**Fix idea**: Validate that notifications are only `notifications/initialized`, `notifications/cancelled`, or `notifications/progress`. Log others as warnings.

---

## Medium Issues

### [MEDIUM] Token generation doesn't enforce default expiration

**File**: src/app/api/access-tokens/route.ts:52,70
**Bug**: expires_at is optional and can be null indefinitely. Leaked or generated tokens never expire.
**Evidence**:

```typescript
const expiresAt = typeof b.expiresAt === "string" ? b.expiresAt : null;
insert({
  expires_at: expiresAt, // Can be null forever
});
```

**Repro / impact**: An attacker with authenticated access can mint infinite long-lived tokens.
**Fix idea**: Add a default expiration window (e.g., 90 days if expiresAt is null). Rate-limit token creation per user.

---

## Low Issues

### [LOW] Email normalization doesn't handle IDNA

**File**: src/lib/auth/authorize.ts:14-20
**Bug**: Internationalized domain names ("café" vs "cafe") aren't normalized consistently.
**Evidence**:

```typescript
function normalize(s: string): string {
  return s.replace(/^﻿/, "").normalize("NFC").trim().toLowerCase();
}
```

**Repro / impact**: Fail-closed; user can't sign in with alternate Unicode forms. Low risk.
**Fix idea**: Add comment explaining known limitations. Consider using `email-validator` library.

---

### [LOW] CSP includes wildcard \*.supabase.co

**File**: next.config.mjs:36
**Bug**: Should be tightened to specific project domain in production.
**Evidence**:

```javascript
"connect-src 'self' https://*.supabase.co wss://*.supabase.co ...";
```

**Repro / impact**: Defense-in-depth; mitigated by SOP and CORS.
**Fix idea**: Use specific project URL at build-time.

---

## Architecture Assessment

**Well Done**:

- Email allowlist is centralized and checked everywhere (middleware, handlers, callback)
- Fail-closed: if AUTHORIZED_EMAILS unset, deny everything
- Session verified via getUser() (JWT verification), not getSession() (trusts cookie)
- PAT hashing uses per-token salts (migration 0008) with back-compat
- Middleware correctly bypasses auth-exempt routes
- safeRelativeUrl() validates with URL parsing against dummy origin

**Areas for Improvement**:

- Rate limiting is instance-local (critical for multi-instance)
- Email verification check falls through if identities array is empty
- Provider check permits undefined (should reject)
- No request body size limits
- Error messages leak database state
