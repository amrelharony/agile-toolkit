-- Agile Toolkit — Phase 1 of the squad-guest feature: squads + guest profiles.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- Until now the toolkit is single-owner: one Google email passes the
-- edge middleware; everyone else is redirected. The only crack is the
-- canvas tool's per-board share links — anonymous bearer URLs that
-- don't remember who used them.
--
-- This migration introduces persistent guest identities. The owner
-- creates a "squad" (a long-lived invite code). A squad member redeems
-- the code once, picks a display name + color, and gets an httpOnly
-- cookie bound to their per-profile secret. The cookie resumes the
-- same identity across sessions / devices (via a separately handed-
-- out claim code, added in a later phase). Per-action attribution in
-- `history_events.squad_profile_id` (migration 0009) labels actions
-- correctly in the owner's activity feed.
--
-- ══════════════════════════════════════════════════════════════════════
-- Threat model
-- ══════════════════════════════════════════════════════════════════════
-- * Squad code: a bearer credential for "create a profile under this
--   squad". Stored plaintext — RLS prevents enumeration. If leaked the
--   owner regenerates (the `code` column is mutable via UPDATE).
-- * Cookie secret: per-profile random bytes. The guest cookie carries
--   `<profileId>.<HMAC(cookie_secret, profileId)>`. Compromise of one
--   row's secret only compromises that one profile. The DB row is the
--   sole holder of the secret; never logged, never returned to the
--   client beyond the initial cookie value.
-- * Guest data access goes through `/api/guest/*` routes using the
--   service-role key. RLS on guest-touching tables is set to "owner
--   only" — service-role bypasses RLS, anon never queries directly.
--   A future maintainer who accidentally exposes a guest-touching
--   query through the anon client hits a default-deny RLS wall.

-- ══════════════════════════════════════════════════════════════════════
-- squads
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.squads (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null
                references auth.users(id) on delete cascade,
  name        text not null
                check (char_length(name) between 1 and 80),
  code        text not null unique
                check (char_length(code) between 16 and 64),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

comment on table  public.squads is
  'Owner-defined group of guests. The code is the squad-level invite.';
comment on column public.squads.code is
  'Bearer-credential invite. Anyone with this code can create a profile under this squad (subject to revoked_at). Regenerate to invalidate prior shares.';

create index if not exists squads_owner_idx on public.squads(owner_id);

alter table public.squads enable row level security;

-- ══════════════════════════════════════════════════════════════════════
-- squad_profiles
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.squad_profiles (
  id             uuid primary key default gen_random_uuid(),
  squad_id       uuid not null
                   references public.squads(id) on delete cascade,
  display_name   text not null
                   check (char_length(display_name) between 1 and 60),
  color          text not null
                   check (char_length(color) between 4 and 16),
  avatar_seed    text not null default ''
                   check (char_length(avatar_seed) <= 64),
  -- Random 32-byte secret, base64url-encoded. HMAC'd into the guest
  -- cookie. Never returned to the client after profile creation.
  cookie_secret  text not null
                   check (char_length(cookie_secret) between 32 and 128),
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz,
  revoked_at     timestamptz
);

comment on table  public.squad_profiles is
  'Persistent guest identity. Cookie holds <id>.<HMAC(cookie_secret, id)>.';
comment on column public.squad_profiles.cookie_secret is
  'Per-profile HMAC key. Compromise scope = this one profile only.';

create index if not exists squad_profiles_squad_idx on public.squad_profiles(squad_id);

alter table public.squad_profiles enable row level security;

-- ══════════════════════════════════════════════════════════════════════
-- Backfill the FK on history_events.squad_profile_id (added in 0009).
-- 0009 deliberately added the column without a constraint because the
-- target table didn't exist yet. Now it does — add the FK so a deleted
-- profile null-out cascades cleanly to its history rows.
-- ══════════════════════════════════════════════════════════════════════
alter table public.history_events
  drop constraint if exists history_events_squad_profile_fk;

alter table public.history_events
  add constraint history_events_squad_profile_fk
    foreign key (squad_profile_id)
    references public.squad_profiles(id)
    on delete set null;

-- ══════════════════════════════════════════════════════════════════════
-- Table-level GRANTs
--
-- anon never touches these tables directly. The owner's UI uses the
-- authenticated client (RLS scopes to owner_id); guests are mediated
-- entirely through /api/guest/* server routes using the service-role
-- key, which bypasses RLS. Defense-in-depth: REVOKE explicit anon
-- access so a future maintainer can't expose a row by mistake.
-- ══════════════════════════════════════════════════════════════════════
revoke all on table public.squads         from anon;
revoke all on table public.squad_profiles from anon;

grant select, insert, update, delete on table public.squads         to authenticated;
grant select, insert, update, delete on table public.squad_profiles to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- RLS policies — owner reads/writes only.
-- ══════════════════════════════════════════════════════════════════════
drop policy if exists "squads_owner_select"    on public.squads;
drop policy if exists "squads_owner_insert"    on public.squads;
drop policy if exists "squads_owner_update"    on public.squads;
drop policy if exists "squads_owner_delete"    on public.squads;
drop policy if exists "squad_profiles_via_owner_select" on public.squad_profiles;
drop policy if exists "squad_profiles_via_owner_insert" on public.squad_profiles;
drop policy if exists "squad_profiles_via_owner_update" on public.squad_profiles;
drop policy if exists "squad_profiles_via_owner_delete" on public.squad_profiles;

create policy "squads_owner_select"
  on public.squads for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "squads_owner_insert"
  on public.squads for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "squads_owner_update"
  on public.squads for update
  to authenticated
  using      ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "squads_owner_delete"
  on public.squads for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- For squad_profiles, owner reach is via the squad's owner_id. A direct
-- SELECT predicate on the row needs the join in EXISTS form because
-- subselects against the same row's column are fine in RLS USING/CHECK.
create policy "squad_profiles_via_owner_select"
  on public.squad_profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.squads s
      where s.id = squad_id and s.owner_id = (select auth.uid())
    )
  );

create policy "squad_profiles_via_owner_insert"
  on public.squad_profiles for insert
  to authenticated
  with check (
    exists (
      select 1 from public.squads s
      where s.id = squad_id and s.owner_id = (select auth.uid())
    )
  );

create policy "squad_profiles_via_owner_update"
  on public.squad_profiles for update
  to authenticated
  using (
    exists (
      select 1 from public.squads s
      where s.id = squad_id and s.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.squads s
      where s.id = squad_id and s.owner_id = (select auth.uid())
    )
  );

create policy "squad_profiles_via_owner_delete"
  on public.squad_profiles for delete
  to authenticated
  using (
    exists (
      select 1 from public.squads s
      where s.id = squad_id and s.owner_id = (select auth.uid())
    )
  );
