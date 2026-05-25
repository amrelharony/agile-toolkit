# Middleware + guest layouts audit (2026-05-25)

Scope: `src/middleware.ts`, `src/app/(guest)/layout.tsx`,
`src/app/(guest)/guest/page.tsx`, `guest-home-client.tsx`,
`src/app/(guest)/guest/join/page.tsx` + `join-client.tsx`,
`src/app/(guest)/guest/[tool]/[entityId]/page.tsx` + placeholder,
`src/app/(guest)/guest/canvas/[boardId]/page.tsx` + client,
`src/app/(guest)/guest/planning-poker/[roomCode]/page.tsx` + client.
Cross-checked: `src/lib/auth/guest-session.ts`, `guest-next-url.ts`,
`guest-profile-provider.tsx`, `src/components/layout/app-shell.tsx`,
`src/lib/squads/invites.ts`, `src/lib/collab/use-collaborative-session.ts`,
`src/lib/realtime/use-room.ts`, `src/app/api/guest/redeem/route.ts`,
`src/app/api/guest/me/route.ts`, `src/app/api/guest/sessions/route.ts`,
`src/app/api/guest/log/route.ts`, `next.config.mjs`, `src/lib/stores/workspace-store.ts`.

## Confirmed bugs

### [High] GuestCanvasClient writes a placeholder whiteboard into the SHARED `agile-toolkit:workspace` localStorage, polluting owner-mode tabs on the same browser

- File: `src/app/(guest)/guest/canvas/[boardId]/guest-canvas-client.tsx:56-68`
- What triggers it: A guest visits `/guest/canvas/<boardId>` for a board they have no local entry of. After `useWorkspaceStore.persist.rehydrate()`, the effect calls `st.upsertWhiteboard({ id: boardId, name: "Shared board", createdAt: now, updatedAt: now })`.
- What happens: `workspace-store.ts:1072` shows the persist key is `"agile-toolkit:workspace"` — shared with every owner-mode tab on the same browser. The guest seeds a `Shared board` row into the shared store; the next time the OWNER opens their dashboard on the same browser, that ghost whiteboard appears in their board list. It is also live on the BroadcastChannel sync (`workspace-store.ts:1195`), so any concurrently-mounted owner tab picks it up immediately. Pollutes both ways: any whiteboard the owner edits also writes into the guest's persisted store.
- Suggested fix: Don't mutate `useWorkspaceStore` from the guest tree at all. The seed exists only so `WhiteboardCanvas` can find an entry by `boardId`; instead, pass `boardId` (plus a synthesized minimal metadata object) directly into the canvas component as a prop, or fork a guest-only in-memory whiteboard registry that is not persisted. Worst case: namespace the persist key for guest tabs (e.g., suffix with `:guest:${profileId}`) so localStorage is isolated from owner-mode mounts.

### [High] AppShell `BARE_ROUTE_PREFIXES` includes `/auth`, but middleware bypass is `/auth/` (with trailing slash) — `pathname === "/auth"` (no trailing slash) renders the bare shell yet still runs the Supabase auth check in middleware

- File: `src/middleware.ts:33` (bypass `pathname.startsWith("/auth/")`) vs `src/components/layout/app-shell.tsx:49,53` (`BARE_ROUTE_PREFIXES = ["/auth", ...]` matched by `pathname === "/auth" || pathname.startsWith("/auth/")`).
- What triggers it: A direct request to `/auth` with no trailing slash. There is no `src/app/auth/page.tsx` today, so the request 404s before this matters; however, if a future contributor adds an `/auth` landing page, the middleware will redirect unauthenticated visitors to `/auth/sign-in?next=/auth` (because `/auth` ≠ `/auth/...`), while the client-side shell renders the page bare. The two predicates have drifted.
- What happens: Right now: 404 (no route file). Future maintenance hazard.
- Suggested fix: Align the predicates. Either change the matcher in middleware to `pathname === "/auth" || pathname.startsWith("/auth/")`, or change `BARE_ROUTE_PREFIXES` to `["/auth/", ...]` and update `isBareRoute`. Today the same trap is harmless for `/guest` because middleware bypasses both `pathname === "/guest"` and `pathname.startsWith("/guest/")` (lines 39-40), but `/auth` is asymmetric.

### [Medium] `/api/guest/redeem` has no rate-limit and no replacement-of-existing semantics — every POST mints a fresh `squad_profiles` row, orphaning the prior one

- File: `src/app/api/guest/redeem/route.ts:53-67`, `src/lib/squads/server.ts:101-122`
- What triggers it: A visitor re-redeems (same browser, same code, different display name) or an attacker scripts POSTs against a known squad code.
- What happens: Each call inserts a new `squad_profiles` row. The cookie is overwritten so the prior profile becomes orphaned (never revoked, never reused, never garbage-collected). At a low rate this is data hygiene noise; at attack rate (no rate-limit, no captcha, no per-IP cap) it is unbounded write amplification against the service-role client. Since middleware bypasses `/api/guest/*`, there is no upstream gate either. `SquadCode` brute-force is also unhindered — `findActiveSquadByCode` short-circuits on length but otherwise does one DB lookup per attempt; with 192 bits of entropy a brute force is unfeasible, but a leaked code becomes a DOS lever.
- Suggested fix: (1) Add a per-IP rate limit on `/api/guest/*` (the existing middleware bypass list is the natural place to plug an Edge-level limiter). (2) On re-redeem of the same code, soft-revoke the prior profile this cookie pointed to (read the cookie BEFORE clobbering it, update `revoked_at` on the old row). (3) Optionally short-circuit when an existing valid cookie already matches the requested squad — return 200 with the existing profile rather than creating a duplicate.

### [Medium] `(guest)` route group has no `error.tsx` / `loading.tsx` / `not-found.tsx` — a thrown Server Component error renders the default Next error page (and may flash stack frames in dev)

- File: `src/app/(guest)/` (missing `error.tsx`, `loading.tsx`, `not-found.tsx`); root `src/app/` is also missing these.
- What triggers it: `getGuestSession()` calling out to Supabase fails with a network/DNS error during the layout render; `resolveGuestInvite` throws (e.g., transient PostgREST 5xx). `getGuestSession` catches its own errors and returns null, but a rejected promise (transport-layer) still propagates out of `await`. The (tools)/canvas + planning-poker clients mounted under (guest) can also throw during rehydrate; the AppShell `ErrorBoundary` only wraps the FULL shell, NOT the bare-route branch (`app-shell.tsx:64-66`). Bare routes get `<>{children}</>` with no boundary at all.
- What happens: Next falls back to its built-in error page. In production this is acceptable; in development the user sees the stack overlay (no leakage to end users but easy to mistake for a security issue). More importantly, the `notFound()` call inside `[tool]/[entityId]/page.tsx:31` etc. hits the default 404, which renders the root layout — but for the (guest) tree it visually drops the user out of guest UI entirely (sidebar/header etc. would mount if the path doesn't begin with `/guest`, which here it does, so the bare shell stays — confirm via testing).
- Suggested fix: Add `src/app/(guest)/error.tsx` exporting a client component that explains "Something went wrong; try refreshing or contact whoever shared this with you" and a `reset` button. Add `src/app/(guest)/loading.tsx` for a centered spinner. Add `src/app/(guest)/not-found.tsx` so revoked / wrong-squad guest links render a friendly "Session not found" instead of the root 404.

### [Medium] Cookie precedence: guest cookie ALWAYS wins under `(guest)/*`, regardless of whether the visitor also holds a valid owner Supabase session — `useCollaborativeSession` reports `mode: "guest"` even for the owner inside a guest route

- File: `src/lib/collab/use-collaborative-session.ts:95-100`
- What triggers it: An authenticated owner (Supabase session set, email in AUTHORIZED_EMAILS) ALSO holds a `agile-toolkit:guest` cookie (e.g. they were testing the guest flow on their own browser and didn't sign out the guest profile). They visit `/guest/canvas/abc`.
- What happens: Middleware bypasses `/guest/*` (line 39-40) so the owner session isn't even consulted there. `(guest)/layout.tsx` reads the guest cookie and mounts `GuestProfileProvider`. `useCollaborativeSession` then sees `guest` truthy first (`guest ? "guest" : ...`) and reports the user as a GUEST — history writes go to `/api/guest/log` with the guest's `squad_profile_id`, not the owner's `user_id`. This is downgrade rather than escalation (guest is less privileged), but it is invisible: the same human acting in two roles on the same page produces audit-log rows attributed to different identities. If the guest cookie's invite happens to grant editor on a canvas the owner owns, the owner's edits land in the guest history bucket. Confusing for forensic review and breaks the "owner is always editor" invariant on owner-owned content.
- Suggested fix: In `(guest)/layout.tsx` (or `useCollaborativeSession`) prefer the owner session when BOTH are present. Concretely: read both `getGuestSession()` and the Supabase session in the layout; if the owner is signed in AND in AUTHORIZED_EMAILS, redirect `/guest/*` to the owner-side route (`/canvas/${boardId}` etc.). Alternative: ignore the guest cookie when the owner cookie is present, so the layout renders without a `GuestProfileProvider` and the user sees the canvas-from-owner-view.

### [Medium] `params.tool` and `params.entityId` are passed straight to `resolveGuestInvite` and into the redirect URL without any length / charset cap at the page layer

- File: `src/app/(guest)/guest/[tool]/[entityId]/page.tsx:15-32`, `src/app/(guest)/guest/canvas/[boardId]/page.tsx:14-30`, `src/app/(guest)/guest/planning-poker/[roomCode]/page.tsx:14-27`
- What triggers it: Visiting `/guest/<huge string>/<huge string>` (Next.js URL segments don't admit `/`, but they accept up to ~2 KB each). Or with non-ASCII / case-variant input.
- What happens: The 2 KB string is sent into `.eq("tool_id", ...)` / `.eq("entity_id", ...)`. PostgREST is parameterized so there's no injection; the lookup just returns no rows → notFound. No security impact. BUT the redirect path `redirect(\`/guest/join?next=...\`)`(page.tsx:18) embeds the raw`params.tool`and`params.entityId`into the next-URL.`encodeURIComponent`wraps the whole next value, so the inner segments are double-encoded by the browser when re-following: harmless but produces an ugly URL. More concerning:`entity_id`length is bounded in`/api/guest/log/route.ts:82` to 200 chars; the page layer accepts arbitrary length, so an attacker can craft a URL that the page accepts but the log endpoint refuses. Mostly cosmetic; flag for consistency.
- Suggested fix: Add a shared `isValidEntityId` / `isValidToolId` validator (regex + length cap, same constants as the log route) and call `notFound()` at the top of each guest [tool]/[entity] page when either input fails. Bonus: matches the existing `TOOL_ID_RE = /^[a-z0-9_-]{1,64}$/` in log/route.ts.

### [Low] `JoinPage` early-redirect when `existing` is set + `next=/guest/join` triggers a 2-hop bounce (not a loop, but ugly)

- File: `src/app/(guest)/guest/join/page.tsx:31-34`
- What triggers it: A guest hits `/guest/join?next=/guest/join` (intentionally crafted or via a copy-paste accident). They already have a valid cookie.
- What happens: `safeNext = "/guest/join"` (passes `isSafeGuestNextUrl`). `existing` truthy → redirect to `/guest/join`. Re-request: now `next` is empty → `safeNext = "/guest"` → redirect to `/guest`. Net: two extra hops. Bounded, not infinite.
- Suggested fix: In `isSafeGuestNextUrl`, reject `/guest/join` (and `/guest/join?...`) explicitly — the join page is never a meaningful destination. Or in `JoinPage`, normalize `safeNext === "/guest/join"` to `"/guest"` before the existing-session redirect.

### [Low] `GuestHomeClient.onSignOut` updates the SHARED `agile-toolkit:user` localStorage slot only on sign-out, leaving stale identity if the user closes the tab without clicking "Sign out"

- File: `src/app/(guest)/guest/guest-home-client.tsx:60-75`
- What triggers it: A guest signs in, lands on `/guest`, never clicks the sign-out button, just closes the tab. The `useRoom` codepath via `getOrCreateUser()` (`use-room.ts:60-91`) writes `agile-toolkit:user` ONLY when no override is mounted. Inside (guest) it's not written (the `PresenceIdentityProvider` overrides). So this comment in `onSignOut` is defensive against an OLD build that DID write the shared slot. The defensive code is correct, but it ALSO doesn't help a new guest who never reaches sign-out: if a hypothetical future regression starts writing the shared slot from guest pages, this code only mops up on the explicit sign-out path.
- Suggested fix: None required today — the defensive code is correct as-is. Document in a comment that the localStorage purge is purely belt-and-braces for pre-fix builds.

### [Low] `GuestCanvasClient` `useEffect` lists `boardId, profile.id, profile.displayName` as deps but never re-runs meaningfully — the rehydrate is keyed on `boardId` only, and `profile.id` / `profile.displayName` never change for a mounted guest

- File: `src/app/(guest)/guest/canvas/[boardId]/guest-canvas-client.tsx:48-75`
- What triggers it: N/A — the deps just inflate the dependency array.
- What happens: On the first run, the rehydrate chain executes. `boardId` is also a URL param, so it shouldn't change without a remount. `profile.id` / `displayName` are immutable for a session. The effect is a one-shot; the extra deps are noise but cause no bug.
- Suggested fix: Drop `profile.id` and `profile.displayName` from the dependency array; keep `boardId`. Or use `useEffect(..., [])` and document why.

### [Low] `JoinClient.onSubmit` shadows the outer `code` variable with a local `code` from the error response

- File: `src/app/(guest)/guest/join/join-client.tsx:42-55`
- What triggers it: A 4xx response from `/api/guest/redeem`.
- What happens: Line 44 declares `const code = j.error ?? \`failed\_${res.status}\`;`which shadows the outer`code`from`useState`. Inside this `if (!res.ok)`block, any read of`code`(the state) is hidden. Today the inner block doesn't reference the outer`code`, so no behavior bug. But a future contributor adding `setError(\`Couldn't redeem \${code}\`)` would silently log the error-code string instead of the squad-code state. Minor footgun.
- Suggested fix: Rename to `errCode` or destructure as `const { error: errCode = \`failed\_${res.status}\` } = j`.

### [Low] `JoinPage` calls `getGuestSession()` AND `(guest)/layout.tsx` also calls `getGuestSession()` — every guest page does two parallel DB lookups (profile row read twice)

- File: `src/app/(guest)/layout.tsx:16`, `src/app/(guest)/guest/join/page.tsx:31`, every other guest page (each calls `getGuestSession` independently).
- What triggers it: Every page load under `(guest)`.
- What happens: Two service-role round-trips to `squad_profiles` per page render — one from the layout, one from the page. Tiny latency cost, no security issue. The layout's read populates the React provider; the page's read populates server-side `session` for `resolveGuestInvite`. They can't share state across the Server-Component boundary today (React's `cache()` would let them, but only inside the same Request scope — which they ARE, but the helper doesn't wrap with `cache`).
- Suggested fix: Wrap `getGuestSession` in `React.cache(...)` so the second call within the same request reuses the first. The function returns `null` or a value but no side effects in the call path that consumers care about — safe to memoize per-request.

### [Low] No explicit `Cache-Control` on guest pages or `/api/guest/*` endpoints — relies on Next 14 inferring "dynamic" from `cookies()` reads

- File: `src/app/(guest)/*` (none of the pages export `dynamic`/`revalidate`).
- What triggers it: Any change to Next.js behavior re: auto-dynamic detection.
- What happens: Today, Server Components that read `cookies()` are forced-dynamic by Next 14 (no static caching). All guest pages read cookies via `getGuestSession`. So in practice nothing is cached. But the contract is implicit. A future maintainer refactoring `getGuestSession` to receive cookies as an argument (or accidentally caching the function) could break dynamic detection and serve a stale post-revocation page. The `/api/guest/*` route handlers similarly emit no cache headers; Vercel's default for route handlers is `Cache-Control: public, max-age=0, must-revalidate` which is safe, but worth pinning.
- Suggested fix: Add `export const dynamic = "force-dynamic";` to each guest page. Costs nothing (they're already dynamic in practice) and locks in the intent.

## Dismissed / already defended

- **Open redirect on `?next=`** — `isSafeGuestNextUrl` (`guest-next-url.ts:22-37`) rejects absolute URLs, protocol-relative `//`, backslash tricks, control chars, AND restricts the path prefix to `/guest`. The URL-parse double-check (`u.origin === "http://dummy.local"`) catches encoded scheme/host bypasses. Confirmed by inspection.
- **Owner-side `safeRelativeUrl` in middleware** — Same shape as `isSafeGuestNextUrl` minus the `/guest` prefix lock (`middleware.ts:139-154`). The middleware sets `next=` only for the `unauthenticated` reason (line 128-132), never for `denied` or `config` — the latter two land on terminal pages without `next`. Good.
- **Static export traps** — `next.config.mjs` does NOT set `output: "export"`. No guest page exports `dynamic = "force-static"`. Cookie reads force-dynamic per Next 14 default. ✓
- **Forged guest cookie** — `getGuestSession` (`guest-session.ts:66-94`) verifies HMAC via the profile's per-row `cookie_secret` and rejects on mismatch, missing profile, or `revoked_at`. `timingSafeEqual` prevents timing attacks. Profile-id format is also UUID-regex gated.
- **Cookie attributes match between set and clear** — `setGuestSessionCookie` and `clearGuestSessionCookie` mirror name, path, sameSite, secure, httpOnly. Per the comment at `guest-session.ts:113-117`, browsers require this for a clear to actually delete.
- **`/guest/*` routes leaking owner data** — The guest tree never imports owner-only data sources; the canvas / poker clients route every fetch through `useCollaborativeSession` which dispatches to `/api/guest/*` in guest mode. The owner-mode history-store imports are dynamic-ish via Zustand but the workspace-store pollution is the only cross-tab leak (see [High] above).
- **Locale/case sensitivity** — `boardId`, `roomCode`, `toolId` are all case-sensitive `.eq` lookups against PostgreSQL text columns. By design — these are opaque IDs, not human-typed strings.
- **Middleware cookie-rotation race** — `cookiesToSet` array + single-pass apply pattern (`middleware.ts:64-103`) correctly handles the Supabase double-set (access + refresh). The redirect path also goes through `buildResponse` (lines 106-111), avoiding the regression noted in the comment.
- **`encodeURIComponent` on `next=` build** — Each guest page that builds a `next=` for the join URL calls `encodeURIComponent` on the inner path (`canvas/[boardId]/page.tsx:20`, `[tool]/[entityId]/page.tsx:18`, `planning-poker/[roomCode]/page.tsx:17`). The validator on the join page side decodes via the URL constructor. Symmetric.
- **`safeRelativeUrl` URL-parse fallback** — Catches `/%2F%2Fevil.com` style encoded-host bypasses via the `u.origin !== "http://dummy.local"` check (`middleware.ts:148-149`). Mirrored in `isSafeGuestNextUrl:29-30`.
- **Email-allowlist bypass via `/guest/*`** — Guests are NOT Supabase users; the entire `/guest/*` and `/api/guest/*` tree is intentionally outside the AUTHORIZED_EMAILS gate. Authorization moves to `(invite-cookie + invite-row)`. An attacker who has neither a valid Supabase session nor a squad code cannot use guest routes to escape the owner gate.
- **`/guest/canvas` (missing boardId)** — No route file matches, Next returns 404. ✓
- **Route precedence between `[tool]/[entityId]` and explicit `canvas/[boardId]`** — Next.js prefers the more specific path. `/guest/canvas/abc` lands on `canvas/[boardId]/page.tsx`, NOT `[tool]/[entityId]/page.tsx`. ✓

## Open questions

- Should the `(guest)` group reject visits where the visitor ALSO has a valid owner Supabase session? Today both can coexist and the guest cookie wins (see [Medium] above). The cleanest UX is "owner sees the owner version; guest cookie is ignored when owner is present." Worth a product decision before fixing.
- Is the squad-code being treated as a long-lived bearer token (rotatable) or as a one-time invite link? Current code is the former (the code lives in `squads.code` indefinitely). A leaked code is permanent until manually rotated. Consider adding `expires_at` to `squads` so codes have a TTL.
- Should `useGuestProfile` (`guest-profile-provider.tsx`) propagate through `(invite-revoked)` mid-session? Today the layout reads the cookie at SSR; if the cookie is revoked WHILE the user is on the canvas, only the client-side `/api/guest/sessions` poller catches it (see `guest-home-client.tsx:38-41`). The canvas/poker clients don't poll. A guest whose invite is revoked mid-session can keep broadcasting until they navigate away or refresh.
- The `/api/guest/redeem` endpoint doesn't differentiate between "code is wrong" and "code is right but squad is hard-deleted" — `findActiveSquadByCode` returns `null` for both. That's appropriate for security (no enumeration), but means support diagnosis is hard.
- The Phase-3 comment in `[tool]/[entityId]/guest-tool-placeholder.tsx:5-7` says it will be replaced; for tools that exist today (canvas, planning-poker) the explicit routes already exist. Is the placeholder route still reachable for any real tool, or is it now dead code? Should `[tool]` validate against a registry of known tools and 404 otherwise?
