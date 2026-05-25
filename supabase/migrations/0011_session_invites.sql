-- Agile Toolkit — Phase 2 of the squad-guest feature: session invites.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- A "session invite" grants a squad (or a specific profile in a squad)
-- access to one (toolId, entityId) tuple — a canvas board, a poker
-- round, a retro instance. Where `share_tokens` is the anonymous-URL
-- bearer credential (anyone with the link can use the role), this
-- table is the squad-scoped equivalent: only members of the named
-- squad with a valid guest cookie can join.
--
-- The owner picks "share with squad" instead of (or in addition to)
-- "share via link" depending on whether they want named participants
-- with persistent history attribution or just anyone-with-the-URL.
-- The two tables are intentionally NOT merged — they serve different
-- threat models. See 0003_share_tokens.sql for the URL-bearer model.
--
-- ══════════════════════════════════════════════════════════════════════
-- session_invites
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.session_invites (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null
                references auth.users(id) on delete cascade,
  squad_id    uuid not null
                references public.squads(id) on delete cascade,
  -- (toolId, entityId) shape mirrors share_tokens' (tool_id, board_id)
  -- after migration 0009's plumbing. Tool ids are short slugs from the
  -- tool registry; entity ids are tool-specific (board id, poker round
  -- id, retro id, etc.).
  tool_id     text not null
                check (
                  char_length(tool_id) between 1 and 64
                  and tool_id ~ '^[a-z0-9_-]+$'
                ),
  entity_id   text not null
                check (char_length(entity_id) between 1 and 200),
  role        text not null
                check (role in ('editor', 'viewer', 'commenter')),
  -- Null means "anyone in the squad with an active profile may join".
  -- Non-null pins the invite to one specific profile (private invite).
  profile_id  uuid
                references public.squad_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  -- Cheap insurance against malformed clients writing expired-on-arrival
  -- invites. Owners can issue long-lived ones — capped at 366 days like
  -- the share_tokens table for consistency.
  check (expires_at is null or expires_at > created_at),
  check (expires_at is null or expires_at < created_at + interval '366 days')
);

comment on table  public.session_invites is
  'Squad-scoped invites to a (tool, entity) session. Per-profile when profile_id is set; otherwise any active profile in the squad qualifies.';
comment on column public.session_invites.profile_id is
  'Null = any profile in the squad may join. Non-null = pinned to one specific profile.';

-- Uniqueness on the same shape that lookups use. coalesce gives us a
-- single-row guarantee even when profile_id is null (postgres treats
-- nulls as distinct in unique constraints without the coalesce).
create unique index if not exists session_invites_unique_idx
  on public.session_invites (
    squad_id,
    tool_id,
    entity_id,
    coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where revoked_at is null;

create index if not exists session_invites_owner_idx
  on public.session_invites (owner_id, created_at desc);
create index if not exists session_invites_squad_lookup_idx
  on public.session_invites (squad_id, tool_id, entity_id)
  where revoked_at is null;
create index if not exists session_invites_profile_lookup_idx
  on public.session_invites (profile_id, created_at desc)
  where revoked_at is null and profile_id is not null;

alter table public.session_invites enable row level security;

-- ══════════════════════════════════════════════════════════════════════
-- Grants — same model as squads: owner uses authenticated client (RLS),
-- guest reads go through /api/guest/* using service-role.
-- ══════════════════════════════════════════════════════════════════════
revoke all on table public.session_invites from anon;
grant  select, insert, update, delete on table public.session_invites to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- RLS — owner-only direct access. Guests are mediated through routes.
-- ══════════════════════════════════════════════════════════════════════
drop policy if exists "session_invites_owner_select" on public.session_invites;
drop policy if exists "session_invites_owner_insert" on public.session_invites;
drop policy if exists "session_invites_owner_update" on public.session_invites;
drop policy if exists "session_invites_owner_delete" on public.session_invites;

create policy "session_invites_owner_select"
  on public.session_invites for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "session_invites_owner_insert"
  on public.session_invites for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "session_invites_owner_update"
  on public.session_invites for update
  to authenticated
  using      ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "session_invites_owner_delete"
  on public.session_invites for delete
  to authenticated
  using ((select auth.uid()) = owner_id);
