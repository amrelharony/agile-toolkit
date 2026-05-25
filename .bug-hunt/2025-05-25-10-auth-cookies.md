# Auth + cookie flow audit (2026-05-25)

Scope: `src/lib/auth/*`, `src/lib/squads/{server,invites,validate,colors}.ts`, `src/middleware.ts`,
`src/app/auth/callback/route.ts`, `src/app/api/guest/*`, `src/app/api/squads/*`, and the four `test/auth/*.test.ts`
files. The "guest-session-signing" and "squad-display-name" file names in the brief don't exist as such — the
signing logic lives in `src/lib/auth/guest-session.ts` and display-name sanitisation lives in
`src/lib/squads/validate.ts` (the tests are named for the _behaviour_ not the file). Both audited.

Prior-fix checkpoint (verified still in place):

- `require-user.ts:88-91` rejects `provider !== "google"`, which catches `undefined`. Good.
- `require-user.ts:101-110` requires `email_confirmed_at` on the identities-empty path. Good.
- `authorize.ts` normaliser strips BOM, NFC, trim, lowercase (line 14-20). Case-insensitive + trim covered.

---

## Confirmed bugs

### [HIGH] Display-name uniqueness inside a squad is not enforced anywhere

- File: `supabase/migrations/0010_squads.sql:64-81` (schema) + `src/app/api/guest/redeem/route.ts:32-79`
  (writer) + `src/lib/squads/server.ts:101-122` (insert helper).
- Trigger / attack: Two guests join the same squad code with the same display name "Alice" (or one guest
  joins twice). The `squad_profiles` table has no unique index on `(squad_id, display_name)` — `created_at`
  - `id` are the only differentiators. Both rows succeed, both get their own `cookie_secret`, both render
    as "Alice" in the canvas presence avatar, the activity feed, the poker board, etc.
- What happens: impersonation in the owner's activity feed ("Alice resolved 12 cards" — which Alice?), and
  guests cannot tell who is who in the cursor overlay. Compounds with the _next_ finding: a freshly-minted
  "Alice" profile inherits another Alice's history-event author label visually, even though the underlying
  `squad_profile_id` differs.
- Suggested fix: `create unique index squad_profiles_unique_name on public.squad_profiles (squad_id,
lower(display_name)) where revoked_at is null;` plus a 409 handler in `createSquadProfile`. Match the
  `lower()` because `sanitizeDisplayName` does not lowercase.

### [HIGH] Squad-redeem endpoint has no rate limit / multiplicity cap

- File: `src/app/api/guest/redeem/route.ts:32-79` (and middleware bypass at `src/middleware.ts:32-44`).
- Trigger / attack: Anyone with the squad code (it's a bearer credential, often shared in chat/email) can
  POST to `/api/guest/redeem` thousands of times to manufacture profile rows. The route is in the
  `/api/guest/*` middleware bypass, no `expires_at` on `squads.code`, no per-IP / per-code limit, and the
  insert uses service-role so RLS doesn't push back.
- What happens: storage exhaustion + `squad_profiles` becomes unusable for the owner's "pin invite to
  profile" dropdown (50+ rows of garbage names). A motivated attacker can also enumerate UUID collisions
  to assist with the next finding (replay-after-revoke).
- Suggested fix: add a per-(IP, code) sliding-window counter (the same `throttle.ts`/Redis pattern other
  endpoints use), AND require the owner to "approve" new profiles, OR bound the squad to a max active
  profile count.

### [MEDIUM] Guest cookie has no embedded expiry; deletion / rotation depends only on browser maxAge + DB lookup

- File: `src/lib/auth/guest-session.ts:24-43, 66-94, 97-109`.
- Trigger / attack: Cookie payload is `<profileId>.<HMAC(secret, profileId)>` — no timestamp, no `iat`,
  no `exp`. A browser that ignores `maxAge` (extensions, manually replayed cookie, headless test bot)
  retains the cookie until `revoked_at` is set on the row. There is no way to _expire_ a cookie short of
  revoking the underlying profile, which also nukes history attribution (FK ON DELETE SET NULL).
- What happens: a guest who borrows a friend's laptop for an hour leaves behind a cookie that resumes a
  year later, even though the friend never re-authorised. The 365-day `COOKIE_MAX_AGE_SECONDS` is
  browser-honour-only.
- Suggested fix: include `iat` in the signed payload (`<profileId>.<iat>.<HMAC>`), verify on read, reject
  beyond N days. Re-issue the cookie with a fresh `iat` after each successful `getGuestSession()` (sliding
  window). This also gives a clean path for "force re-auth all guests" without nulling history rows.

### [MEDIUM] `findActiveSquadByCode` does not enforce a constant-time / unconditional DB hit

- File: `src/lib/squads/server.ts:82-94`.
- Trigger / attack: The pre-DB length check rejects codes outside 16-64 chars; a code outside that range
  short-circuits before the `select`. The `generateSquadCode` helper always produces 32 chars, so a
  legitimate code is always 32 — an attacker can probe code-length via response timing (a 4-char input
  returns in ~0ms; a 32-char input takes a DB round-trip). Not catastrophic — the search space is still
  ~$2^{192}$ — but the length leak narrows it to one bucket. Comment claims "constant-time-ish" but it
  isn't.
- What happens: timing oracle confirms valid code length.
- Suggested fix: drop the length pre-check OR always do the DB query and rely on the unique-index hit /
  miss. Length-cap at 1024 chars to prevent pathological inputs but not at 16/64 boundaries.

### [MEDIUM] OAuth callback does not verify the `state` parameter

- File: `src/app/auth/callback/route.ts:44-98`.
- Trigger / attack: PKCE is pinned (`auth: { flowType: "pkce" }`), which mitigates the _primary_ CSRF
  surface — the code-verifier cookie is required to redeem the code. But the route does not look at
  `searchParams.get("state")` at all, and the Sec-Fetch-Site check (line 56-60) is best-effort (it lets
  the request through when the headers aren't present, e.g. older browsers / curl). An attacker who
  initiates a sign-in flow in their own browser, then phishes the victim into following the resulting
  Google callback URL, can plant an attacker session under the victim's user-agent. PKCE blocks this
  when the victim's browser has no matching verifier — but the route never verifies the verifier was
  the one issued _for this request_, only that Supabase's exchange succeeds.
- What happens: low-likelihood OAuth login-CSRF / session-fixation. Real impact gated by the user
  noticing they're suddenly signed in as someone else.
- Suggested fix: even with PKCE, explicitly assert `state` matches a cookie-bound nonce set when
  `signInWithGoogle` was called. Supabase's OAuth helper passes one when configured; the callback should
  refuse to exchange a code without it.

### [LOW] Per-call cache invalidation in `authorize.loadEmails` is racy under config rotation

- File: `src/lib/auth/authorize.ts:12, 22-34`.
- Trigger / attack: The module-scoped `cached` is keyed on the raw `process.env.AUTHORIZED_EMAILS`
  string. If the env value is rotated (e.g. ops adds a user) the new value re-builds the set on next
  call — fine. But the test at `test/auth/authorize.test.ts:56-62` shows a stale-string can stick when
  `vi.stubEnv` is used in a way that mutates the same string reference; in production this is benign,
  but the implementation comment ("re-checks the raw env value each call") understates the dependency on
  Node giving you a fresh string read each `process.env.X` access.
- What happens: not a security bug; a maintainability/test-hardening note. No exploit.
- Suggested fix: cache by `Object.is(raw, cached.value)` is what the code already does — fine. Document
  that rotations require a process restart on hosts where `process.env` is snapshot at boot (Vercel
  build-time env, Cloudflare Workers).

### [LOW] Display-name sanitiser preserves any _valid_ unicode under 60 chars, with no homograph defence

- File: `src/lib/squads/validate.ts:41-46` + `test/auth/squad-display-name.test.ts`.
- Trigger / attack: A guest joins as "Ⲁlice" (Coptic capital A — U+2C80) which renders identically to
  "Alice" in most fonts. `sanitizeDisplayName` strips the bidi controls and zero-widths the test covers,
  but allows the homograph through. Combined with finding #1 (no uniqueness), a malicious guest can
  impersonate an existing guest visually.
- What happens: phishing the owner's activity feed / canvas comments.
- Suggested fix: limit display names to a script-subset, e.g. reject names containing characters outside
  `\p{L}\p{N}\p{Mn}\p{Pc}\s.\-_'` after NFC. Or — more permissive — Punycode-decode and reject if the
  result contains mixed scripts. Out of scope for v1, but worth a comment in `validate.ts`.

### [LOW] `clearGuestSessionCookie` mismatches `setGuestSessionCookie` on browsers that distinguish secure flag

- File: `src/lib/auth/guest-session.ts:97-109` vs `118-129`.
- Trigger / attack: Both functions condition `secure` on `process.env.NODE_ENV === "production"`. In dev
  they both omit it. In production they both set it. So far so good. But if a deployment ever runs
  `next start` with `NODE_ENV !== "production"` (e.g. staging using `next start` from a build done on a
  dev image), the set call writes a non-secure cookie that the clear call also writes as non-secure —
  still matches. The current code is fine, but the comment on line 113-117 emphasises attribute parity;
  a future maintainer who adds `domain: ".example.com"` to one and not the other will silently break
  sign-out. Mark with a TODO + a unit test that calls set/clear and asserts attribute equality.
- What happens: defensive note, not a current bug.
- Suggested fix: factor the cookie attribute set into a shared constant.

### [LOW] Squad code length check window allows lengths the generator never emits

- File: `src/lib/squads/server.ts:73-75, 85` + `supabase/migrations/0010_squads.sql:46-47`.
- Trigger / attack: Generator outputs 32 chars (`randomBytes(24).toString("base64url")`). DB allows
  16-64. The pre-DB validator allows 16-64. An attacker can submit any 16-char string and force a DB
  lookup. Search space still big, but the asymmetry suggests the validator was copy-pasted from the DB
  check without thought. Tighten to 32 exactly — or `>= 32` if the team plans to rotate to longer codes
  later.
- What happens: enlarges the timing oracle from finding #4.
- Suggested fix: tighten the runtime check to exactly 32 chars; widen later if needed.

### [LOW] `request.cookies.set` in middleware mutates a request-scoped object that browsers never see

- File: `src/middleware.ts:73-83`.
- Trigger / attack: Comment claims "Mutate the request copy so subsequent operations in THIS request see
  the updated cookie." This is correct _for the Supabase library's get() callback that runs later in the
  same call_, but writing to `request.cookies` is a no-op for the browser — only `cookiesToSet` on the
  response sent below actually persists. The current code applies both, so the user-visible behaviour is
  right. The risk is a future refactor that drops the `cookiesToSet` array and assumes
  `request.cookies.set` is enough; it isn't.
- What happens: defensive note.
- Suggested fix: extract to a named helper or add a guard test that asserts the response carries the set
  cookies after a rotation.

---

## Dismissed / already defended

- **Timing-safe HMAC compare** — `guest-session.ts:52-55` uses `node:crypto`'s `timingSafeEqual` after
  a length check; this is the correct primitive in Node, no Web Crypto needed. Tests at
  `test/auth/guest-session-signing.test.ts:34-70` confirm tampered, swapped-id, wrong-secret all reject.
- **JWT/alg confusion** — N/A. The guest cookie is HMAC-SHA256 over a profileId string, not a JWT. No
  algorithm field to confuse. Supabase JWT verification on the owner side is delegated to
  `supabase.auth.getUser()`, which round-trips to Supabase Auth (`require-user.ts:69`).
- **HttpOnly / SameSite / Path** — set correctly: httpOnly true, sameSite "lax", path "/", secure in
  prod (`guest-session.ts:100-108`). No `domain` set — defaults to the current host, so no
  parent-domain leak across `*.example.com` neighbours.
- **Cookie scope across squads** — cookie holds only a profile UUID; the profile row carries the
  `squad_id`. A profile cannot be promoted to a different squad without changing its UUID. Replay across
  squads is not possible.
- **Allow-list case sensitivity + trim** — `authorize.ts:14-20` normalises both sides (NFC + BOM + trim
  - lowercase). Tests cover whitespace and casing.
- **PKCE on OAuth** — pinned on both browser and server clients (`supabase-browser.ts:34`,
  `supabase-server.ts:24`). Implicit-flow fallback is explicitly closed.
- **Server-side display-name resolution** — guest pages read `displayName` from `getGuestSession()`
  (server) and inject via `GuestProfileProvider`; client never supplies it back.
- **Bidi + zero-width strip** — `validate.ts:26-39` covers a comprehensive set; the test file
  enumerates the cases.
- **Role × action allowlist** — `guest/log/route.ts:31-43` is consistent: viewers reject everything,
  commenters limited to comment\_\* + ping, editors anything. Server-only; cannot be bypassed from client.
- **Service-role isolation** — `getSquadAdminClient()` (`squads/server.ts:26-35`) returns null when
  service key missing; not exposed to client; never inlined.
- **Squad code regen invalidates new joins but preserves existing cookies** — by design, documented in
  `0010_squads.sql:25-26` and `squads/[id]/route.ts:14-18`.

---

## Open questions

1. `/api/guest/me` DELETE has no CSRF defence beyond SameSite=Lax. Sign-out is non-destructive so the
   risk is annoyance-only, but worth a note.
2. The `(guest)` layout (`src/app/(guest)/layout.tsx:15-37`) reads the cookie _and_ renders children
   regardless. Pages individually re-check (`guest/page.tsx:11`, `guest/[tool]/[entityId]/page.tsx:16`),
   so missing cookie is caught — but a page that forgets to re-check could leak a fall-through render.
   Worth a lint rule or a wrapper component.
3. `touchProfileLastSeen` (`squads/server.ts:125-132`) updates `last_seen_at` on every guest fetch with
   no debounce. At guest scale (handful of users) this is fine, but at 100+ concurrent guests it would
   thrash. Note for later.
4. The `or` filter in `guest/log/route.ts:140` and `invites.ts:61` interpolates `session.profileId`
   into a PostgREST filter string. `getGuestSession` validates the cookie's profileId against `UUID_RE`
   before the lookup (`guest-session.ts:74`), so injection is blocked — but the construction _reads_ as
   injection-vulnerable and a future refactor that loosens the cookie format would expose it. Comment
   the invariant.

---

## Missing test coverage

`test/auth/guest-session-signing.test.ts` (5 cases) covers only the pure HMAC primitives. Missing:

- The cookie-to-row resolution path (`getGuestSession`): mock `next/headers` + `getSquadAdminClient` and
  assert null when `revoked_at` is set, when the row is missing, when the UUID regex fails.
- The cookie-attribute mirror between set/clear (asserts httpOnly, sameSite, secure, path, maxAge).
- A test that the cookie _value_ a `setGuestSessionCookie` writes is byte-for-byte what
  `verifySignature` accepts. Currently the test reproduces the sign/verify inline; it does NOT exercise
  `guest-session.ts` itself.
- Replay-across-squads negative test: build a cookie signed with squad-A's profile's secret, change the
  profileId prefix to a squad-B profile, assert rejection at the DB lookup step.

`test/auth/squad-display-name.test.ts` (9 cases) covers good control-char / bidi cases. Missing:

- Homograph cases (Coptic Ⲁ vs Latin A, Cyrillic а vs Latin a).
- Mixed-script names (Latin + Cyrillic in one name).
- Whitespace-only-after-strip names (an input that's only zero-widths + trim should return null — test
  doesn't currently cover this).
- The 60-char boundary: test confirms 61 rejects; missing 60 accepts and the off-by-one at 60 vs 61.
- NFC normalisation of the _output_ — a decomposed input becomes composed, but the test compares
  visual strings; an explicit `Array.from(s)` length check would catch a regression that swaps NFC to
  NFD.

`test/auth/authorize.test.ts` (6 cases) covers env-not-set, null/empty input, case, trim, unknown emails,
count. Missing:

- BOM-prefixed entry (`﻿alice@example.com`) — the normaliser strips BOM, but no test asserts it.
- NFC composed vs decomposed emails (`café` vs `cafe + combining accent`).
- A truly empty `AUTHORIZED_EMAILS=,,,` should give count 0 (test sets `a,b, c ,,` and asserts 3, but
  no test for the all-empty case).
- Whitespace-only entry rejection (`AUTHORIZED_EMAILS=" "`).

`test/auth/require-user.test.ts` (8 cases) covers provider gating + identity verification. Missing:

- Email casing in identity match: identity says `Alice@Example.com`, top-level says `alice@example.com`.
  The current code lower-cases both sides on line 103, but no test pins it.
- Missing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` → 503 path
  (`require-user.ts:36-38`).
- Identities with `email_verified` undefined (not `false`) — the code says `=== false`, so undefined
  passes; needs a test pinning that this is intentional.
- The `authorize.ts` cache poisoning regression: call once with one env value, switch env, call again,
  assert the new value takes effect. (Implicit in the `vi.unstubAllEnvs` pattern but never asserted on
  the second call.)
