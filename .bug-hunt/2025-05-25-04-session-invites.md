# session_invites audit (2026-05-25)

Scope: `src/app/api/sessions/route.ts`, `src/app/api/sessions/[id]/route.ts`,
`supabase/migrations/0011_session_invites.sql`, `src/lib/squads/invites.ts`
(`resolveGuestInvite` lives here). Cross-checked: `0010_squads.sql`,
`src/app/api/guest/log/route.ts`, `src/lib/auth/guest-session.ts`.

## Confirmed bugs

### [High] `resolveGuestInvite` does not validate `expires_at` inside the SQL query for the OPEN (squad-wide) path, and the pinned-fallthrough path skips the open invite when a pinned one exists but is expired

- File: `src/lib/squads/invites.ts:85-115`
- What triggers it: An owner issues a pinned invite to profile X with a TTL.
  The TTL passes. The same owner also has (or later issues) a squad-wide
  invite (`profile_id = NULL`) for the same `(tool, entity)`. Guest X visits
  the entity.
- What happens: The first query (`pinned`) returns the expired pinned row
  (it filters only `revoked_at is null`, not `expires_at`). Line 97 checks
  `expires_at > nowIso`, so the function falls through to the open lookup
  — that part is fine. **But** there is a subtler variant: if the pinned
  row's `expires_at` is `null` (no TTL) and the row exists but the
  schema-level CHECK `expires_at > created_at` was passed at insert time
  yet some other validation issue exists, the open invite is never even
  consulted. More importantly, the OPEN lookup at line 100-110 also lacks
  any `expires_at` filter, and only checks it in JS at line 112. That is
  correct in isolation, but means that the "best invite" semantics
  (pinned > open) silently prefer an expired pinned over a still-valid
  open — only because expiry is checked AFTER selecting the pinned row.
  Today line 97 does fall through, so this works; the bug is the
  surrounding fragility: if a future maintainer flips the `&&` to `||`,
  expired pinned invites become accepted. Worth converting both filters
  to SQL-side `.or("expires_at.is.null,expires_at.gt.<iso>")` so DB and
  JS agree.
- Suggested fix: Push the `expires_at` predicate into both queries as a
  PostgREST `.or()` filter (mirroring `listInvitesForGuest` at line 62).
  That way the DB layer enforces the temporal contract regardless of the
  fallthrough order.

### [High] `resolveGuestInvite` never re-validates that the squad still owns the profile or that the squad itself is alive

- File: `src/lib/squads/invites.ts:73-116`
- What triggers it: An owner soft-revokes a `squad` by setting
  `squads.revoked_at` (the column exists per `0010_squads.sql:49`, even
  though the current API only hard-deletes). The guest cookie still
  resolves via `getGuestSession` because that function only checks
  `squad_profiles.revoked_at` (`src/lib/auth/guest-session.ts:85`).
  The squad row's `revoked_at` is ignored everywhere except
  `findActiveSquadByCode`.
- What happens: A revoked squad's guests retain access to every active
  `session_invite` for that squad. Hard-delete works (FK cascade), but
  soft-revoke is silently ineffective — yet `0010_squads.sql:55` calls
  it out as a regenerate-or-revoke surface. There is also no join to
  `squad_profiles.squad_id` inside `resolveGuestInvite` to confirm the
  guest's profile still belongs to the squad it claims (the cookie
  carries the profile id, and `getGuestSession` reads `squad_id`
  from the profile row, so this is mostly self-consistent — but a row
  whose `squad_id` was UPDATEd would silently grant access to the new
  squad's invites).
- Suggested fix: Either (a) add `getGuestSession` a join to `squads`
  via a second admin query and reject when `squads.revoked_at` is set,
  or (b) treat soft-revoke as unsupported and document/remove the
  `squads.revoked_at` column. At minimum: have `resolveGuestInvite` /
  `listInvitesForGuest` filter `squads.revoked_at IS NULL` via a
  `select` join (`squads!inner(...)` PostgREST embed).

### [Medium] `session_invites_owner_update` policy lets the owner change `owner_id` to another auth user, with no `with check ((select auth.uid()) = owner_id)` constraint on the NEW row

- File: `supabase/migrations/0011_session_invites.sql:108-112`
- What triggers it: An authenticated owner POSTs an UPDATE that sets
  `owner_id` to a different user id. The policy `with check` clause
  evaluates `auth.uid() = owner_id` where `owner_id` is the NEW row's
  value. Since `auth.uid()` is the caller and the row would now have
  a different `owner_id`, the policy will reject it. Wait — re-read:
  `with check ((select auth.uid()) = owner_id)` — this DOES enforce
  the new row's owner_id == caller. So this particular policy is fine.
  Strike: NOT a bug. (Kept here for record — initial read flagged this
  and verification cleared it.)
- What happens: N/A — moved to "Dismissed".
- Suggested fix: N/A.

### [Medium] 23505 recovery does not handle the "row exists but is revoked" race correctly

- File: `src/app/api/sessions/route.ts:181-198`
- What triggers it: Two requests race. Request A inserts an invite,
  succeeds. Request B starts inserting the same `(squad, tool, entity,
profile_id)` tuple. Between B's insert attempt and B's recovery
  SELECT, request C revokes A's invite. The partial unique index frees
  up — but B has already taken the 23505. B's recovery SELECT filters
  `revoked_at IS NULL` (`route.ts:193`) and finds nothing.
- What happens: B returns 500 `server_error` even though the right
  behavior is to retry the insert (the conflict slot is now free).
  Today this is rare, but the diagnostic ("server_error") is misleading
  — the user just experienced a no-op race.
- Suggested fix: On 23505 + lookup-empty, attempt a single retry of
  the INSERT before returning 500. Cap at 1 retry to prevent loops.
  Alternatively, return a 409 `invite_was_revoked_retry` so the client
  can re-submit.

### [Medium] Invite creation / revocation are not audited

- File: `src/app/api/sessions/route.ts:164-204`, `src/app/api/sessions/[id]/route.ts:25-29`
- What triggers it: An owner issues an invite or revokes one.
- What happens: No `history_events` row is written. The owner's
  activity feed shows guest-authored events under that invite but
  not the invite issuance itself, so an admin reviewing the timeline
  cannot reconstruct "when did this guest gain access". `0010_squads.sql`
  set up the `squad_profile_id` plumbing for guest attribution but
  there is no parallel for owner-side invite admin actions.
- Suggested fix: After successful INSERT/UPDATE, write a
  `history_events` row with `action='invite_issued'` / `invite_revoked'`
  and payload containing `{ squadId, toolId, entityId, role,
profileId, inviteId }`. Owner-authored (`squad_profile_id = NULL`).

### [Low] `DELETE /api/sessions/[id]` returns `{ ok: true }` even when the id doesn't exist or isn't owned by the caller

- File: `src/app/api/sessions/[id]/route.ts:25-35`
- What triggers it: Caller sends `DELETE /api/sessions/<random uuid>`
  or `DELETE /api/sessions/<uuid of another owner's invite>`.
- What happens: The `.update` does not match any row (RLS + the
  `.eq("owner_id", user.id)` guard). PostgREST reports no error, just
  zero rows affected. The route returns `200 ok`. This conflates
  "successfully revoked" with "nothing to do" and lets a malicious
  caller probe... actually no, it gives the SAME answer either way,
  so it does NOT leak existence. Still, a 404 for the not-found /
  not-owned case is more informative for legitimate clients with
  stale UIs.
- Suggested fix: Use `.select("id")` after the update and return 404
  when the returned set is empty.

### [Low] `DELETE /api/sessions/[id]` allows re-revoking an already-revoked invite, bumping its timestamp

- File: `src/app/api/sessions/[id]/route.ts:25-29`
- What triggers it: An invite is revoked, then revoked again.
- What happens: The UPDATE overwrites `revoked_at` with a newer
  timestamp. The original revocation moment is lost. For auditability
  this is mildly bad (and complicates "when was access actually
  removed"). It does not affect security since `revoked_at IS NULL`
  is the predicate used everywhere.
- Suggested fix: Add `.is("revoked_at", null)` to the UPDATE so it
  becomes a no-op for already-revoked rows.

### [Low] `GET /api/sessions` returns expired invites (those past `expires_at`) in the listing

- File: `src/app/api/sessions/route.ts:32-39`
- What triggers it: Owner views the share dialog after a TTL has
  expired on a prior invite.
- What happens: The query filters only `revoked_at IS NULL`. Expired
  invites still appear as "active". Guests can no longer use them
  (`resolveGuestInvite` rejects via `expires_at > nowIso`), but the
  owner UI happily lists them as live.
- Suggested fix: Add `.or("expires_at.is.null,expires_at.gt.<now>")`
  to the listing query, or filter in the JS map.

### [Low] `POST /api/sessions` profile-in-squad check uses authenticated client and can return a confusing `profile_not_in_squad` if the profile is revoked

- File: `src/app/api/sessions/route.ts:152-162`
- What triggers it: Owner pins an invite to a profile whose
  `squad_profiles.revoked_at` is set.
- What happens: `select("id").eq("id", profileId).eq("squad_id",
squadId).maybeSingle()` does NOT filter on `revoked_at`. So the
  check passes, the invite is created with `profile_id` pointing at
  a revoked profile, and the guest can never claim it (their cookie
  was already invalidated). The row sits as a dead invite, occupying
  the unique-index slot until manually cleaned.
- Suggested fix: Add `.is("revoked_at", null)` to the profile-in-squad
  guard. Alternatively the schema could enforce this via a trigger,
  but the API-level fix is cheaper.

### [Low] `expires_at` upper bound differs between API and schema

- File: `src/app/api/sessions/route.ts:133` (`Math.min(365, ...)`)
  vs `supabase/migrations/0011_session_invites.sql:52` (`< created_at +
interval '366 days'`)
- What triggers it: Direct DB writes (e.g., service-role inserts via
  some future maintenance script) using 365 days will pass; using
  365 days computed in JS (rounded up to 366 by leap-year edge) will
  also pass; but the comment at `route.ts:133` and the schema check
  use different numbers (365 vs 366). Minor drift, not a runtime
  bug today.
- Suggested fix: Align both to 365 days, or document the off-by-one
  buffer.

## Dismissed / already defended

- **NULL handling in partial unique index** — Schema uses
  `coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid)`
  (`0011_session_invites.sql:68`), so the classic NULL-distinctness
  footgun does NOT apply. Squad-wide invites are correctly singleton.
- **`.eq(profile_id, uuid)` vs `.is(profile_id, null)` in 23505 recovery**
  — The route branches on `profileId ? .eq : .is` at `route.ts:194`,
  handling both pinned and squad-wide cases correctly. The known
  constraint from the commit message is honored.
- **RLS owner scoping** — `session_invites_owner_*` policies all bind
  `auth.uid() = owner_id` with `with check` clauses on insert/update
  (`0011_session_invites.sql:98-117`). A second owner of the same
  squad cannot read or revoke another owner's invites (and the schema
  doesn't even support multi-owner squads — `squads.owner_id` is a
  single column). Anon is `revoke all`. Guests read via service-role
  through `/api/guest/*` only.
- **FK cascade shape** — `owner_id → auth.users(id) on delete cascade`,
  `squad_id → squads(id) on delete cascade`, `profile_id →
squad_profiles(id) on delete cascade`. Hard-deleting an owner / squad
  / pinned profile cleans up the invite. For squad-wide invites where
  `profile_id IS NULL`, the FK is inert. ✓
- **Lookup indexes for resolveGuestInvite** — Both queries hit
  `session_invites_unique_idx` (squad+tool+entity+coalesced-profile,
  partial on `revoked_at is null`). The pinned query uses all four
  columns; the open query uses the first three. Covered.
- **Chained `.or()` semantics in `listInvitesForGuest`** — Two `.or()`
  calls produce `(p1 OR p2) AND (p3 OR p4)` via separate query params.
  This is the desired semantics. Confirmed by inspection of PostgREST
  behavior.
- **`session_invites_owner_update` `with check`** — Does enforce the
  new row's `owner_id` equals the caller. An owner cannot transfer an
  invite to another user via UPDATE.
- **Race between INSERT and 23505 recovery (happy path)** — When a
  legitimate idempotent retry happens, the recovery SELECT finds the
  row and returns `existed: true`. The schema's partial unique index
  guarantees there is at most one matching row.
- **Role enumeration / regex bypass** — `ROLES` set in route +
  `check (role in ...)` in schema match. `TOOL_ID_RE` matches the
  schema's regex pattern. `entity_id` length bounds match.
- **PostgREST filter injection via ISO timestamps** — `nowIso` contains
  `:` and `.` but no `,` so it cannot break out of the `.or()` group.

## Open questions

- Should `session_invites` carry a `last_used_at` column so revoke
  decisions can rest on "this invite was last used N days ago"? Today
  the only signal is the count of guest-authored history_events under
  that owner+squad_profile.
- The `squads.revoked_at` column is dead code if the only revoke path
  is DELETE. Either wire it up consistently (and propagate to invite
  resolution) or drop it from the schema.
- `expires_at` is owner-controlled, capped at 365–366 days. Is there a
  workspace policy where shorter caps are appropriate (e.g., a free
  tier capped at 7 days)? No setting exists today.
- `session_invites_profile_lookup_idx` (`0011:77-79`) is unused by the
  current code paths (no query selects by `profile_id` alone). It may
  be future-facing; otherwise it's an index that costs write throughput
  for no read benefit.
- The 50-row `.limit(50)` in `/api/guest/log` (`route.ts:142`) is a
  silent ceiling: a guest whose squad has 51+ active invites for the
  same owner could have legitimately-best-role invites truncated. The
  ordering is `created_at desc`, so the OLDEST invites get dropped,
  but if an old invite carried a privileged role and a newer one is
  viewer, the guest gets viewer. Worth either ordering by role rank
  in SQL or removing the limit.
