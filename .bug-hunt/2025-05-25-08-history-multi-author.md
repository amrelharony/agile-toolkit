# History multi-author audit (2026-05-25)

Scope: Phase 0 multi-author plumbing in `src/lib/history/*`, the guest
ingestion endpoint `src/app/api/guest/log/route.ts`, migration
`supabase/migrations/0009_history_multi_author.sql`, and the two
unit-test files. Where bugs trace into adjacent code that was needed
to confirm the issue, the file is named explicitly.

---

## Confirmed bugs

### [HIGH] Guest-log route does not re-sanitize payload server-side

- File: `src/app/api/guest/log/route.ts:165-209`
- What triggers it: a guest browser (or any HTTP client holding a valid
  guest cookie) POSTs `/api/guest/log` with a payload containing an
  email or a `password` / `secret` / `apiKey` field. The client-side
  `sanitizePayload` only runs inside the toolkit's own React tree.
- What happens: the route validates shape, JSON-serializability, and
  size, but never calls `sanitizePayload(payload)`. The raw object is
  written verbatim into `history_events.payload`. The defence-in-depth
  model in `sanitize.ts` ("belt-and-braces stripping of accidentally-
  logged secrets") is bypassed for every guest write — a hostile or
  buggy guest client can land plaintext emails, tokens, and API keys
  in the owner's append-only audit log.
- Suggested fix: import `sanitizePayload` from `@/lib/history/sanitize`
  and apply it (server-only — fine because the function is pure) before
  the JSON-size check. The owner-side push path is allowed to skip it
  because the same client that owns the logger runs the sanitizer; the
  guest path crosses a trust boundary and must re-sanitize.

### [HIGH] JSON export leaks `userId` and `squadProfileId` to anyone with the file

- File: `src/lib/history/export.ts:6-8`
- What triggers it: an owner opens `/history` and chooses "Export as
  JSON". The exporter calls `exportToJSON(events, filename)` with the
  full `HistoryEvent[]`.
- What happens: `exportToJSON` is a thin wrapper around
  `JSON.stringify`, so every persisted property is serialized — including
  the owner's `auth.uid()` repeated on every row, every guest's
  `squadProfileId` (raw UUID), the per-browser `clientId`, and the
  per-tab `toolRunId`. The CSV and Markdown exporters both strip these,
  so the disclosure is JSON-specific and surprising. A shared export
  file effectively publishes the owner's account-level identifier and a
  full guest-attribution graph.
- Suggested fix: in `exportEventsAsJSON`, map events through a
  whitelist that mirrors the CSV columns (`occurredAt`, `toolId`,
  `action`, `isMilestone`, `payload`) — or, if author info is wanted,
  hash `squadProfileId` to a short display key and drop `userId`,
  `clientId`, `toolRunId` entirely.

### [HIGH] No INSERT-side guard tying `squad_profile_id` to the writer's squad

- File: `supabase/migrations/0009_history_multi_author.sql:36-37` and
  the unchanged INSERT policy in `0002_auth_history.sql:173-177`
- What triggers it: an authenticated owner writes directly via the
  Supabase JS client (legitimate path is `pushEvents` — but any
  client-side path that constructs a row can do this) and sets
  `squad_profile_id` to an arbitrary uuid, including the id of a guest
  that belongs to a _different_ owner's squad.
- What happens: RLS only checks `auth.uid() = user_id`; the
  `squad_profile_id` column has no CHECK or RLS predicate enforcing
  "this profile belongs to a squad owned by me". The owner can
  attribute their own actions to any guest id they know. Within a
  single owner's workspace the damage is contained (they're forging
  attribution against themselves), but the comment on the column
  ("attributes the actual author") will mislead anyone who later
  treats the field as a trusted identity claim — e.g. an activity-feed
  endpoint that filters by guest profile id and assumes every row
  belongs to that guest.
- Suggested fix: add an INSERT WITH CHECK that validates the
  squad_profile_id, when non-null, points to a profile under a squad
  owned by the writer:
  ```sql
  with check (
    (select auth.uid()) = user_id
    and (squad_profile_id is null or exists (
      select 1 from public.squad_profiles p
      join public.squads s on s.id = p.squad_id
      where p.id = history_events.squad_profile_id
        and s.owner_id = (select auth.uid())
    ))
  )
  ```
  The service-role guest-log route bypasses RLS by design, so it
  isn't affected.

### [MEDIUM] `addEvent` (single-event path) skips chronological insertion

- File: `src/lib/history/history-store.ts:115-128`
- What triggers it: any caller passes `opts.occurredAt` set to a past
  date (backfill, import, fixing a clock-skew event). The owner-side
  logger supports this via `LogOptions.occurredAt`.
- What happens: `addEvent` appends to the end of `events` without
  re-sorting, while `addEvents` (used by realtime + pull) does sort by
  `syncedAt → occurredAt → clientEventId`. The store's invariant
  "events are roughly chronological" is broken on the single-event
  path. `selectEvents` in `selectors.ts:73` walks the array backwards
  and stops at `limit`, so backfilled events miss the top slot they
  belong in. `useHistory` re-sorts on read so the user-visible drawer
  is fine, but `selectEvents` and `eventCountByDay` (signal bridge,
  correlation analytics, last-event-of) misbehave.
- Suggested fix: in `addEvent`, after the dedupe check, insert the
  event via the same `(syncedAt, occurredAt, clientEventId)` comparator
  used in `addEvents`. Linear scan from the tail is fine — backfilled
  events are rare and the array is capped at 2000.

### [MEDIUM] Owner-side `pushEvents` ignores `squad_profile_id` in the upsert conflict key

- File: `src/lib/history/sync.ts:102-111`
- What triggers it: a guest happens to mint a `clientEventId` that
  collides with one the owner already has unsynced locally
  (vanishingly unlikely with 21-char nanoids, but not zero), OR an
  owner re-pushes a guest-authored event after a bug-fix re-stamps it.
- What happens: the two-phase write SELECTs `(user_id, client_event_id)`
  _without_ filtering by `squad_profile_id IS NULL`. A pre-existing
  guest-authored row swallows the owner-authored event silently — the
  owner's local event is added to `writtenIds` and marked synced
  without ever reaching the database. The underlying unique constraint
  is `(user_id, client_event_id)`, so this isn't fixable purely client-
  side; either the constraint should widen to include
  `coalesce(squad_profile_id, ...)` (Phase 0+ change) or the SELECT
  should explicitly filter `is("squad_profile_id", null)` so the
  collision surfaces as a 409 instead of a silent drop.
- Suggested fix: in `pushEvents`, add `.is("squad_profile_id", null)`
  to the SELECT-existing query. The DB-level fix is to make the
  unique index a partial index keyed on `(user_id, client_event_id)
where squad_profile_id is null` plus a parallel `(user_id,
client_event_id, squad_profile_id) where squad_profile_id is not
null`. The route already handles the cross-author 23505 as a 409;
  the owner path needs the same separation.

### [MEDIUM] Owner-side `pushEvents` write loses `squad_profile_id` if the local store somehow has one

- File: `src/lib/history/sync.ts:27-42` (write path) and
  `src/lib/history/sync-provider.tsx:75-88` (filter)
- What triggers it: an event is sitting in the local store with
  `squadProfileId !== null` and `syncedAt === null` — possible if a
  realtime delivery arrives before `markSynced` lands, or if a future
  feature lets the owner mark a local event as guest-authored.
- What happens: `toRow` does map the column correctly (`squad_profile_id:
e.squadProfileId ?? null`), but the sync-provider's filter for what
  to push is `e.userId === userId && !e.syncedAt`. A guest-authored
  event has `userId === ownerId`, so it MATCHES that filter. The owner
  client would push a row claiming `squad_profile_id = <guest id>` —
  but the INSERT policy doesn't validate that (see the HIGH finding
  above). The DB accepts the forged attribution.
- Suggested fix: in the sync provider's filter (two call sites in
  `sync-provider.tsx`), add `e.squadProfileId == null` so the owner
  client only pushes events it authored itself. Guest events arrive
  from cloud and never need to be re-pushed.

### [LOW] `session_invites` schema lets one owner attach an invite to another owner's squad

- File: `supabase/migrations/0011_session_invites.sql:22-53`
- What triggers it: owner A learns owner B's `squad_id` (uuid — not
  enumerable through RLS, but it appears in URLs, server logs, and
  shareable invite payloads). Owner A inserts a row into
  `session_invites` with `owner_id = A.auth.uid()` and `squad_id =
B.squadId`. RLS only checks `owner_id = auth.uid()`. The FK on
  `squad_id` accepts any existing squad. A guest of B's squad logs an
  event with `entityId` matching A's planted invite — the squad-level
  fallback in `/api/guest/log` (lines 132-156 of the route) picks A's
  invite as highest-rank, and the resulting row lands with
  `user_id = A`. A then sees attribution-stripped guest writes in
  their own audit log.
- What happens: a defense-in-depth gap. The attack requires a
  squad_id leak (currently squad ids only flow through owner-side
  URLs and are never returned to other owners), so practical
  exploitability is near zero today. But the constraint is exactly
  the kind of thing a future feature (squad-explorer, shared-squad
  marketplace) could turn into a real path.
- Suggested fix: add a trigger or CHECK so `session_invites.owner_id`
  must equal the owner of `session_invites.squad_id`. Cheapest form:
  a BEFORE-INSERT trigger that joins squads and raises if
  `(select owner_id from squads where id = new.squad_id) <>
new.owner_id`.

### [LOW] `useHistoryLogger` falls back to owner-mode local writes when a guest cookie is invalid

- File: `src/lib/history/use-history-logger.ts:106-156`
- What triggers it: the (guest) tree's server layout calls
  `getGuestSession()`; if the cookie is malformed/expired/revoked, the
  layout passes `profile: null` to `GuestProfileProvider`. The
  individual `/guest/canvas/[boardId]` and `/guest/[tool]/[entityId]`
  pages currently redirect before render in this case, but
  `/guest/page.tsx` and `/guest/join` render. If any (guest)-tree
  client ever mounts a tool that calls `useHistoryLogger` (not
  `useCollaborativeSession`), `useGuestProfile()` returns null and the
  logger takes the OWNER path — writing to the owner's persisted
  localStorage slot under `agile-toolkit:history`.
- What happens: ghost events accumulate in the local store; when the
  owner returns to the browser they appear in the drawer/history page
  belonging to nobody.
- Suggested fix: add a `usePathname()` pathname-prefix safety net at
  the top of `useHistoryLogger` — if `pathname?.startsWith("/guest")`
  and there's no resolved guest profile, short-circuit (no-op).
  Belt-and-braces against future regressions where someone mounts a
  tool inside (guest) without going through the collab hook.

---

## Dismissed / already defended

- **clientEventId collision determinism** — the `addEvents` merge sort
  tie-breaks on `clientEventId` (history-store.ts:152), and the test
  file covers this. Deterministic across multi-author writes.
- **LWW tie-break** — `syncedAt` is preferred when both sides have it
  (server clock wins over skewed client clocks); falls back to
  `occurredAt`, then `clientEventId`. Correct.
- **Sanitize depth bomb / class instances / typed arrays** — the
  comments in `sanitize.ts:30-55` show the prior fixes for depth
  exhaustion, Date/Map/Set early-return, and class-instance handling.
  Solid.
- **Replica identity for `squad_profile_id`** — `replica identity full`
  on `history_events` from migration 0002 covers later columns
  automatically; realtime delivers the column even though 0009 adds
  it later.
- **Guest cookie HMAC + revoke check** — `getGuestSession` uses
  `timingSafeEqual` and rejects revoked profiles. Good.
- **Per-browser guest-client-id slot** — distinct from
  `agile-toolkit:history.clientId`, validated against `SHORT_ID_RE` on
  read, falls back to a fresh nanoid in private-mode browsers.
- **`SHORT_ID_RE` vs nanoid alphabet** — nanoid's default alphabet is
  `A-Za-z0-9_-`, well within the regex. 21- and 16-char defaults both
  fit the 1–32 length range.
- **PostgREST `.or()` injection** — `session.profileId` is verified
  against `UUID_RE` in `getGuestSession`, so the inline
  `profile_id.eq.${session.profileId}` template is safe.
- **Pre-Phase-0 events backward compat** — `toRow` defaults
  `squad_profile_id` to null when undefined; `fromRow` defaults the
  field. The roundtrip test covers the absent-column path. Old
  rehydrated events render correctly as owner-authored.

---

## Open questions

- Should the `setUserOnAnonymousEvents` path also preserve/clear
  `squadProfileId`? Today it only touches `userId`, and no anonymous
  event has a `squadProfileId` (guests never write to local store),
  so there's nothing to fix — but the function's name promises an
  attribution transformation that doesn't account for the new column.
  Worth a one-line comment to clarify intent.
- The "session_started" / "phase_advanced" milestone actions in
  `event-actions.ts` make sense for owners but not necessarily for
  guests. The route's `COMMENTER_ACTIONS` allowlist (`comment_added`,
  `comment_replied`, `comment_resolved`, `comment_reopened`, `ping`)
  is fine for now; the future risk is editor-tier guests emitting
  `*_reset` actions that wipe owner state via downstream side
  effects. Phase 3+ should formalise an action allowlist per tool.
- A single `agile-toolkit:guest-client-id` slot ties one browser to
  one guest identity even when the user is in multiple squads — but
  the current join flow only supports one active guest cookie at a
  time anyway, so this matches the cookie model. If multi-squad
  guests ever land, the key needs to namespace by squad id.
- The realtime channel name is `history:${userId}` (owner uid). Guest
  events flow through it via `user_id = ownerId`. Confirmed correct
  by reading `subscribeToHistory` — but worth a comment on the
  channel name documenting that guests piggy-back on the owner's
  channel.

---

## Missing test coverage

- No integration test for `/api/guest/log`:
  - Role × action allowlist enforcement (`viewer` rejected, `commenter`
    only on the COMMENTER_ACTIONS set, `editor` allowed-all).
  - Squad-scoped fallback when `entityId` is absent — should pick the
    most-privileged active invite.
  - Expired invite filtering (rows past `expires_at`).
  - Revoked invite filtering (rows with `revoked_at` non-null).
  - 23505 → 409 path on cross-guest `clientEventId` collision.
  - Far-future `occurredAt` rejection (the +5min guard).
  - Payload-too-large 413 path.
  - Non-object payload (array / scalar) → 400.
- No test that the owner-side push path filters out
  `squadProfileId !== null` events from `unsynced` (related to the
  MEDIUM sync-provider finding above).
- No test that the realtime `onInsert` path round-trips
  `squad_profile_id` into `HistoryEvent.squadProfileId` (only
  `toRow`/`fromRow` are tested directly, not the realtime callback
  chain).
- No test that `useHistoryLogger`'s guest branch does NOT call
  `addEvent` — the comment on lines 106-114 promises this but only
  the `if (guest)` early-return guarantees it. A regression that
  removes the return statement would silently pollute the local
  store.
- No test for `setUserOnAnonymousEvents` against events carrying
  `squadProfileId` (should be a no-op since those events also have a
  `userId` already, but worth pinning).
- No test that the JSON exporter doesn't include `userId` or
  `squadProfileId` (would catch the HIGH finding above and pin the
  fix once applied).
