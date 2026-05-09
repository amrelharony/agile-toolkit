-- Agile Toolkit — Auth profiles + universal per-tool history audit log
--
-- ══════════════════════════════════════════════════════════════════════
-- Security model
-- ══════════════════════════════════════════════════════════════════════
--   * RLS is enabled on both tables; every row is private to its owner.
--   * Policies are scoped `TO authenticated` and use (select auth.uid())
--     so the call is cached per query, not re-evaluated per row.
--   * Default privileges are REVOKE'd from `anon`; `authenticated` is
--     granted only the operations that match the policies. RLS is the
--     real boundary, but defense-in-depth keeps anon out of grant maps.
--   * history_events has no UPDATE policy — the audit log is immutable
--     by default-deny. Only INSERT and DELETE (purge / privacy wipe).
--   * Input shape is enforced with CHECK constraints (regex on tool_id
--     and action, size caps on payload + snapshots, future-date guard
--     on occurred_at). Cheap insurance against malformed clients.
--   * SECURITY DEFINER functions pin `search_path` and revoke EXECUTE
--     from PUBLIC. Each is granted only to the role that needs it.
--   * Realtime publication uses REPLICA IDENTITY FULL so row-level
--     filters on `user_id` work; the realtime server still applies RLS
--     per-subscriber via the JWT, so cross-user leakage is impossible.

-- ══════════════════════════════════════════════════════════════════════
-- profiles
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id              uuid primary key
                    references auth.users (id) on delete cascade,
  email           text not null
                    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name    text
                    check (display_name is null or char_length(display_name) <= 200),
  avatar_url      text
                    check (avatar_url is null or char_length(avatar_url) <= 2000),
  provider        text
                    check (provider is null or char_length(provider) <= 50),
  email_verified  boolean not null default false,
  scrum_role      text
                    check (scrum_role in
                      ('scrum_master','product_owner','developer','tester','stakeholder')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

comment on table  public.profiles is
  'Per-user profile; one row created automatically on first sign-in.';
comment on column public.profiles.scrum_role is
  'Self-declared role; informational only — no role-based access enforcement.';

alter table public.profiles enable row level security;

-- ══════════════════════════════════════════════════════════════════════
-- history_events  (append-only audit log)
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.history_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null
                    references auth.users (id) on delete cascade,

  tool_id         text not null
                    check (
                      char_length(tool_id) between 1 and 64
                      and tool_id ~ '^[a-z0-9_-]+$'
                    ),
  action          text not null
                    check (
                      char_length(action) between 1 and 64
                      and action ~ '^[a-z0-9_]+$'
                    ),

  payload         jsonb not null default '{}'::jsonb
                    check (octet_length(payload::text) <= 32768),  -- 32 KB
  before_state    jsonb
                    check (before_state is null
                           or octet_length(before_state::text) <= 262144),  -- 256 KB
  after_state     jsonb
                    check (after_state  is null
                           or octet_length(after_state::text)  <= 262144),

  is_milestone    boolean not null default false,

  client_id       text not null check (char_length(client_id)       between 1 and 32),
  client_event_id text not null check (char_length(client_event_id) between 1 and 32),
  tool_run_id     text not null check (char_length(tool_run_id)     between 1 and 32),

  occurred_at     timestamptz not null
                    check (occurred_at <= now() + interval '5 minutes'),
  created_at      timestamptz not null default now(),

  -- Snapshots are only meaningful on milestone rows.
  constraint history_events_snapshots_only_on_milestones_chk check (
    is_milestone or (before_state is null and after_state is null)
  ),

  unique (user_id, client_event_id)
);

comment on table public.history_events is
  'Append-only audit log; one row per meaningful user action across tools.';

create index if not exists history_events_user_tool_time_idx
  on public.history_events (user_id, tool_id, occurred_at desc);
create index if not exists history_events_user_time_idx
  on public.history_events (user_id, occurred_at desc);
create index if not exists history_events_user_milestone_idx
  on public.history_events (user_id, tool_id, occurred_at desc)
  where is_milestone;
create index if not exists history_events_created_at_idx
  on public.history_events (created_at);

alter table public.history_events enable row level security;

-- Required so realtime postgres_changes filters on `user_id` work
-- (filters on non-PK columns need full row replication).
alter table public.history_events replica identity full;

-- ══════════════════════════════════════════════════════════════════════
-- Table-level GRANTs
--
-- Defense-in-depth: anon never gets a chance to attempt anything on these
-- tables. RLS would block it anyway, but explicit revocation keeps the
-- privilege graph clean.
-- ══════════════════════════════════════════════════════════════════════
revoke all on table public.profiles       from anon;
revoke all on table public.history_events from anon;

grant  select, insert, update on table public.profiles       to authenticated;
grant  select, insert, delete on table public.history_events to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- RLS policies
-- ══════════════════════════════════════════════════════════════════════

-- ── profiles ─────────────────────────────────────────────────────────
drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;

create policy "profiles_select_self"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_insert_self"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using      ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ── history_events ───────────────────────────────────────────────────
-- Note: there is intentionally NO update policy. The audit log is
-- immutable. Any UPDATE attempt fails with permission denied because
-- RLS denies-by-default when no matching policy exists.
drop policy if exists "history_events_select_self" on public.history_events;
drop policy if exists "history_events_insert_self" on public.history_events;
drop policy if exists "history_events_delete_self" on public.history_events;

create policy "history_events_select_self"
  on public.history_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "history_events_insert_self"
  on public.history_events
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "history_events_delete_self"
  on public.history_events
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ══════════════════════════════════════════════════════════════════════
-- Realtime publication (idempotent)
--
-- Catches:
--   duplicate_object  → table already in the publication (re-runs).
--   undefined_object  → publication doesn't exist (self-hosted Supabase
--                       without realtime). Migration still succeeds; the
--                       cloud-sync feature degrades to "push only" until
--                       realtime is enabled.
-- ══════════════════════════════════════════════════════════════════════
do $$
begin
  alter publication supabase_realtime add table public.history_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ══════════════════════════════════════════════════════════════════════
-- Functions + triggers
-- ══════════════════════════════════════════════════════════════════════

-- ── handle_new_user: auto-create profile on auth.users insert ────────
-- Runs as SECURITY DEFINER because the trigger fires from auth admin
-- context which lacks INSERT on public.profiles. search_path is pinned.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url, provider, email_verified)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.email
    ),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_app_meta_data->>'provider', 'email'),
    coalesce(new.email_confirmed_at is not null, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all     on function public.handle_new_user() from public;
grant  execute on function public.handle_new_user() to service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── touch_profile_updated_at ─────────────────────────────────────────
-- SECURITY INVOKER (default): runs with the calling user's privileges.
-- The trigger only mutates the row being updated, so no escalation
-- needed. search_path pinned to neutralise mutable-search-path attacks.
create or replace function public.touch_profile_updated_at()
  returns trigger
  language plpgsql
  set search_path = pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all     on function public.touch_profile_updated_at() from public;
grant  execute on function public.touch_profile_updated_at() to authenticated, service_role;

drop trigger if exists on_profile_update on public.profiles;
create trigger on_profile_update
  before update on public.profiles
  for each row execute function public.touch_profile_updated_at();

-- ── purge_old_history_events ─────────────────────────────────────────
-- Service-role only. Call from a scheduled task (pg_cron, edge function,
-- or external cron). Returns the number of rows deleted.
create or replace function public.purge_old_history_events(retention interval default interval '90 days')
  returns bigint
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  rows_deleted bigint;
begin
  delete from public.history_events
  where created_at < now() - retention;
  get diagnostics rows_deleted = row_count;
  return rows_deleted;
end;
$$;

revoke all     on function public.purge_old_history_events(interval) from public;
grant  execute on function public.purge_old_history_events(interval) to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- Schedule the daily purge via pg_cron (best-effort).
--
-- pg_cron is available on Supabase paid tiers and many self-hosted setups.
-- If the extension is not installed, the migration succeeds but no schedule
-- is created — operators can call public.purge_old_history_events()
-- manually or wire an external cron / Edge Function.
-- ══════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule any prior version under the same name to keep this idempotent.
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'purge_old_history_events_daily';
    perform cron.schedule(
      'purge_old_history_events_daily',
      '0 3 * * *',  -- 03:00 UTC daily
      $cmd$ select public.purge_old_history_events() $cmd$
    );
  end if;
exception
  when undefined_table or undefined_function or insufficient_privilege then
    -- pg_cron present but cron schema not exposed, or caller lacks rights.
    -- Don't fail the migration — just skip scheduling.
    null;
end $$;
