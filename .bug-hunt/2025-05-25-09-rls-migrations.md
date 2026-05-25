# RLS migrations 0009-0011 audit (2026-05-25)

Audited every line of `0009_history_multi_author.sql`, `0010_squads.sql`,
`0011_session_invites.sql`; cross-referenced `0001_init.sql`,
`0002_auth_history.sql`, `0003_share_tokens.sql`,
`0004_tighten_rooms_rls.sql`, `0007_share_token_lookup_and_hardening.sql`
plus the API code that consumes the schema
(`src/lib/squads/*`, `src/lib/auth/guest-session.ts`,
`src/app/api/guest/**`, `src/app/api/sessions/**`,
`src/lib/history/sync.ts`).

## Confirmed bugs

### [Medium] Owner can read every guest's `cookie_secret` via RLS

- File: supabase/migrations/0010_squads.sql:64-90, 158-166
- What triggers it: `squad_profiles.cookie_secret` is a real table column
  with no column-level GRANT restriction. The `squad_profiles_via_owner_select`
  policy lets any authenticated owner SELECT every column of every profile
  in their squads. Today the code carefully avoids `select("*")` and never
  asks for `cookie_secret` from the authenticated client
  (`src/app/api/sessions/route.ts:65-69`,
  `src/app/api/guest/sessions/route.ts:32`), but RLS does not enforce that
  discipline — a future maintainer who writes `.select("*")` in a "manage
  guests" UI will leak every guest's HMAC key to the owner's browser.
- What an attacker / a wrong query achieves: the owner can mint forged
  guest cookies for any of their guests
  (`HMAC-SHA256(cookie_secret, profileId)` per
  `src/lib/auth/guest-session.ts:40-43`) and impersonate them in
  `/api/guest/log` writes — defeating per-author attribution in the
  history audit trail. The blast radius is "within the owner's own
  workspace", but it silently breaks the integrity promise that
  `squad_profile_id` is supposed to provide.
- Suggested fix: revoke column-level SELECT on `cookie_secret` from
  `authenticated`. Add to 0010 (or a 0012 follow-up):
  ```sql
  revoke select (cookie_secret) on public.squad_profiles from authenticated;
  ```
  The service-role client (used by `getGuestSession`,
  `createSquadProfile`) bypasses RLS and column GRANTs, so guest-session
  verification keeps working. Or store `cookie_secret` in a sibling
  `squad_profile_secrets` table where RLS denies the owner entirely.

### [Low] `session_invites.owner_id` and `squad_id` ownership not bound by RLS

- File: supabase/migrations/0011_session_invites.sql:103-106
- What triggers it: `session_invites_owner_insert` only checks
  `auth.uid() = owner_id`. It does NOT verify that
  `squad_id` references a `squads` row whose `owner_id` matches the
  inserter. The "squad belongs to owner" check is enforced only in the
  API route (`src/app/api/sessions/route.ts:141-149`).
- What an attacker / a wrong query achieves: an authenticated user who
  goes around `/api/sessions` and queries Supabase directly with their
  own anon-key + session can `insert` a session_invite with
  `(owner_id = self, squad_id = some other owner's squad_id, tool_id,
entity_id)`. Guests of that other squad would then see an invite
  pointing at `entity_id` claimed by the inserting owner. In the
  current single-owner middleware lock this is unreachable (only one
  owner email passes), but the moment multi-tenant lands this becomes
  cross-tenant authorization bypass.
- Suggested fix: tighten the WITH CHECK clause to also verify the squad
  belongs to the inserter:
  ```sql
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.squads s
      where s.id = squad_id and s.owner_id = (select auth.uid())
    )
  )
  ```
  Same on the UPDATE policy.

### [Low] `add constraint history_events_squad_profile_fk` takes an ACCESS EXCLUSIVE lock for a full validation scan

- File: supabase/migrations/0010_squads.sql:98-105
- What triggers it: the constraint is added without `NOT VALID`, so
  Postgres scans every row in `history_events` while holding ACCESS
  EXCLUSIVE on the table. All existing rows have
  `squad_profile_id IS NULL` (0009 added the column with no backfill),
  so the validation itself is trivial — but the lock blocks the daily
  `purge_old_history_events` job and every owner-side write while the
  scan runs.
- What an attacker / a wrong query achieves: nothing exploitable;
  it's an availability concern on a populated database.
- Suggested fix: in environments with non-trivial history volume use
  the two-step pattern:
  ```sql
  alter table public.history_events
    add constraint history_events_squad_profile_fk
    foreign key (squad_profile_id)
    references public.squad_profiles(id)
    on delete set null
    not valid;
  alter table public.history_events validate constraint history_events_squad_profile_fk;
  ```
  `validate` only needs SHARE UPDATE EXCLUSIVE so other writers proceed.

## Dismissed / already defended

- **anon revoked on all new tables** — 0010:116-117 and 0011:87 explicitly
  `revoke all ... from anon`. Defense-in-depth matches 0002/0004 pattern.
- **`to authenticated` is explicit on every new policy** — unlike the
  BUG-S14 mistake in 0003 (open-to-PUBLIC policy fixed in 0007), every
  new policy names its role.
- **Idempotent re-runs** — 0009 uses `add column if not exists`, 0010
  uses `create table if not exists` + `drop policy if exists` before
  each `create policy` + `drop constraint if exists` before re-adding
  the FK. 0011 mirrors the pattern. Re-running cleanly tested
  conceptually.
- **`unique (code)` on squads** prevents code reuse / collision. Codes
  are 32-char base64url (192 bits) from `randomBytes(24)`, no
  CITEXT/LOWER() needed — base64url is case-significant by design and
  the alphabet is the same on every host (`src/lib/squads/server.ts:73-75`).
- **Partial unique index `coalesce(profile_id, '00...00'::uuid)`** in
  0011:63-70 — the sentinel UUID is theoretically collision-prone but
  `gen_random_uuid()` cannot produce all-zeros (cryptographic RNG,
  effectively never). Acceptable.
- **Append-only audit log preserved** — 0009 does not add an UPDATE
  policy to `history_events`; the immutability invariant from 0002:160-165
  carries over.
- **NULL semantics in unique indexes** — 0011 handles the
  `profile_id IS NULL` distinct-NULL trap via `coalesce`; the partial
  index `where revoked_at is null` correctly excludes revoked rows so
  the same tuple can be re-invited after revocation.
- **`squad_profile_id` realtime visibility** — `history_events`
  already has `replica identity full` from 0002:116, so the new column
  flows through realtime without further config. Owner-side filters on
  `user_id=eq.<ownerId>` still pick up guest-authored rows because the
  guest log route stamps `user_id = ownerId`
  (`src/app/api/guest/log/route.ts:197-208`).
- **CHECK constraints on enum-like columns** — `role in
('editor','viewer','commenter')` matches the share*tokens enum
  (0003:35) and the API allowlist (`src/app/api/sessions/route.ts:17`).
  `tool_id ~ '^[a-z0-9*-]+$'` matches the registry pattern in 0002:65.
- **Guest writes via service-role bypass RLS cleanly** — the
  intentional split where guests go through `/api/guest/*` with
  service-role and owners use the authenticated client (RLS) is
  documented in 0010:32-36 and 0011:84-86. The action allowlist for
  commenter role is enforced in the route, not the DB
  (`src/app/api/guest/log/route.ts:31-43`) — but the role itself is
  CHECK-constrained at the DB.
- **CASCADE / SET NULL choices** —
  - `squads.owner_id` CASCADE: auth.users delete tears down the owner's
    squads + profiles (via the second CASCADE) + invites (third CASCADE).
    Clean.
  - `squad_profiles.squad_id` CASCADE: deleting a squad nukes its
    profiles. Cookies become invalid (lookup returns no row).
  - `history_events.squad_profile_id` SET NULL: preserves audit rows
    when a guest profile is deleted, attribution reverts to owner.
  - `session_invites.squad_id` CASCADE: invites die with the squad.
  - `session_invites.profile_id` CASCADE: pinned invites die when the
    pinned guest is deleted. Alternative `set null` would silently
    upgrade pinned → open which is wrong; CASCADE is the right pick.
- **Search-path security** — 0010/0011 add no plpgsql functions, so no
  search_path risk introduced. 0001's `purge_expired_rooms` was already
  hardened in 0007 (`set search_path = public, pg_temp`); 0002's
  `handle_new_user`, `touch_profile_updated_at`,
  `purge_old_history_events` all pin search_path.

## Open questions

- **Squad revocation semantics**: 0010 adds `squads.revoked_at` but
  there is no plumbing that propagates it to in-flight guest cookies.
  `getGuestSession` (`src/lib/auth/guest-session.ts:79-85`) only checks
  `squad_profiles.revoked_at`, not the parent squad's. Revoking a squad
  prevents new redemptions via `findActiveSquadByCode`
  (`src/lib/squads/server.ts:92`), but existing cookies keep working.
  Is that intentional ("revoke = stop NEW invites, existing members
  unaffected") or a missed check ("revoke = burn the squad")? The 0010
  header comment (lines 23-26) reads "If leaked the owner regenerates
  (the `code` column is mutable via UPDATE)" — implying code rotation
  is the user-facing recovery, not `revoked_at`. If that's the design,
  consider dropping `revoked_at` from `squads` or documenting it as
  "informational only" to prevent confusion.
- **`squad_profile_id` partial index ordering** — the index in
  0009:48-50 is `(squad_profile_id, occurred_at desc)`. A typical query
  "show events authored by guest X recently" filters on
  `squad_profile_id = ?` and orders by `occurred_at desc`. The index
  serves both predicates. Fine. But "show ALL guest activity across my
  workspace, regardless of author" (no profile filter) won't use this
  index — the predicate `squad_profile_id IS NOT NULL` would scan. If
  that query path matters, add a complementary partial index or rely
  on `history_events_user_time_idx` from 0002:104.
- **`session_invites.expires_at` boundary** — the CHECK
  `expires_at < created_at + interval '366 days'` (0011:52) refuses an
  invite with `expires_at = created_at + 366d`. Probably fine but
  inconsistent with share_tokens 0003:44 which uses the same `<` cap;
  consistent with itself, so no action needed.

## Table-by-table RLS matrix

### `squads` (0010)

| Op     | Role          | Predicate                          |
| ------ | ------------- | ---------------------------------- |
| SELECT | authenticated | `auth.uid() = owner_id`            |
| INSERT | authenticated | WITH CHECK `auth.uid() = owner_id` |
| UPDATE | authenticated | both: `auth.uid() = owner_id`      |
| DELETE | authenticated | `auth.uid() = owner_id`            |
| any    | anon          | denied (REVOKE + no policy)        |
| any    | service_role  | bypasses RLS                       |

Net: only the owner of a squad can touch it via the authenticated
client. Guests never query directly. Service role (guest API routes)
bypasses RLS.

### `squad_profiles` (0010)

| Op     | Role          | Predicate                                                      |
| ------ | ------------- | -------------------------------------------------------------- |
| SELECT | authenticated | EXISTS(squads s WHERE s.id=squad_id AND s.owner_id=auth.uid()) |
| INSERT | authenticated | WITH CHECK: same EXISTS                                        |
| UPDATE | authenticated | both: same EXISTS                                              |
| DELETE | authenticated | same EXISTS                                                    |
| any    | anon          | denied                                                         |
| any    | service_role  | bypasses RLS                                                   |

Net: owner sees / modifies every profile across all their squads.
Guests are mediated by service-role. Column-level concern flagged
above re `cookie_secret`.

### `session_invites` (0011)

| Op     | Role          | Predicate                             |
| ------ | ------------- | ------------------------------------- |
| SELECT | authenticated | `auth.uid() = owner_id`               |
| INSERT | authenticated | WITH CHECK `auth.uid() = owner_id` \* |
| UPDATE | authenticated | both: `auth.uid() = owner_id` \*      |
| DELETE | authenticated | `auth.uid() = owner_id`               |
| any    | anon          | denied                                |
| any    | service_role  | bypasses RLS                          |

\* Missing: the WITH CHECK does NOT verify that the referenced
`squad_id` belongs to the inserter — see [Low] finding above.

Net: owners can issue/revoke invites for any squad_id they specify,
trusting the API route's pre-flight ownership check. RLS alone is
weaker than the API enforcement.

### `history_events.squad_profile_id` (0009 column addition)

- No new policy; existing 0002 policies still apply.
- `select` policy `auth.uid() = user_id` — owner sees every row in
  their workspace including guest-authored ones, because the route
  stamps `user_id = ownerId`.
- `insert` policy `auth.uid() = user_id` — guest writes can NOT go
  through authenticated client (guests have no auth.uid()); they MUST
  go through `/api/guest/log` with service-role. RLS is the second
  fence after the route handler.
- `delete` policy `auth.uid() = user_id` — owner can delete their own
  rows (including guest-authored). Guests cannot delete via any path
  (no `/api/guest/log` DELETE; service-role would bypass but no code
  invokes it).
- `update` — still no policy; audit-log immutability intact.

## Summary

Migrations 0009-0011 are tight overall. The single defense-in-depth
hole worth fixing now is the `cookie_secret` column being readable by
the owner (Medium); the rest are belt-and-braces concerns that don't
exploit under the current single-owner middleware lock but become
real if the deployment model changes. Verified that idempotency is
preserved, GRANT-anon is correctly revoked on every new table, every
policy names a role explicitly, and the CASCADE / SET NULL choices
match the intent of audit-trail preservation vs. row teardown.
