-- Agile Toolkit — Cross-device cloud sync tables
--
-- ══════════════════════════════════════════════════════════════════════
-- Tables
-- ══════════════════════════════════════════════════════════════════════
-- user_state    — one row per (user_id, store_key) holding a JSON blob.
--                 Used for tool-local stores (retro-board state, canvas
--                 UI prefs, BYOK-LLM settings, etc.) where the entire
--                 store is small enough to push as a single object.
--
-- user_entities — one row per (user_id, kind, entity_id) holding a
--                 single workspace entity (sprint, story, whiteboard
--                 object, etc.). Soft-delete via `deleted` so concurrent
--                 devices can reconcile a removal even if they were
--                 offline when it happened.
--
-- Both tables get `client_id` so the realtime subscriber can ignore
-- echoes of its own writes.

-- ══════════════════════════════════════════════════════════════════════
-- user_state  (per-blob sync)
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.user_state (
  user_id     uuid not null
                references auth.users (id) on delete cascade,
  store_key   text not null
                check (char_length(store_key) between 1 and 128
                       and store_key ~ '^[a-z0-9:_-]+$'),
  payload     jsonb not null
                check (octet_length(payload::text) <= 1048576), -- 1 MB
  client_id   text not null
                check (char_length(client_id) between 1 and 32),
  updated_at  timestamptz not null default now(),
  primary key (user_id, store_key)
);

comment on table public.user_state is
  'Per-user, per-store-key JSON blob. Replaces localStorage as source of truth when signed in.';

create index if not exists user_state_user_updated_idx
  on public.user_state(user_id, updated_at desc);

alter table public.user_state enable row level security;
alter table public.user_state replica identity full;

-- ══════════════════════════════════════════════════════════════════════
-- user_entities  (per-entity sync)
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.user_entities (
  user_id     uuid not null
                references auth.users (id) on delete cascade,
  kind        text not null
                check (char_length(kind) between 1 and 64
                       and kind ~ '^[a-zA-Z0-9_-]+$'),
  entity_id   text not null
                check (char_length(entity_id) between 1 and 64),
  payload     jsonb not null
                check (octet_length(payload::text) <= 524288), -- 512 KB per entity
  client_id   text not null
                check (char_length(client_id) between 1 and 32),
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind, entity_id)
);

comment on table public.user_entities is
  'Per-user, per-entity workspace row. Soft-deleted so other devices can reconcile.';
comment on column public.user_entities.deleted is
  'When true, the entity has been removed locally; other devices should drop it on next pull/realtime.';

create index if not exists user_entities_user_kind_updated_idx
  on public.user_entities(user_id, kind, updated_at desc);
create index if not exists user_entities_user_updated_idx
  on public.user_entities(user_id, updated_at desc);

alter table public.user_entities enable row level security;
alter table public.user_entities replica identity full;

-- ══════════════════════════════════════════════════════════════════════
-- updated_at trigger — Postgres-stamped, never trust client clocks
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.touch_sync_updated_at()
  returns trigger
  language plpgsql
  set search_path = pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all     on function public.touch_sync_updated_at() from public;
grant  execute on function public.touch_sync_updated_at() to authenticated, service_role;

drop trigger if exists on_user_state_touch    on public.user_state;
drop trigger if exists on_user_entities_touch on public.user_entities;

create trigger on_user_state_touch
  before insert or update on public.user_state
  for each row execute function public.touch_sync_updated_at();

create trigger on_user_entities_touch
  before insert or update on public.user_entities
  for each row execute function public.touch_sync_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- Table-level GRANTs (defense-in-depth)
-- ══════════════════════════════════════════════════════════════════════
revoke all on table public.user_state    from anon;
revoke all on table public.user_entities from anon;

grant  select, insert, update, delete on table public.user_state    to authenticated;
grant  select, insert, update, delete on table public.user_entities to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- RLS — every row private to its user_id
-- ══════════════════════════════════════════════════════════════════════
drop policy if exists "user_state_select_own"    on public.user_state;
drop policy if exists "user_state_insert_own"    on public.user_state;
drop policy if exists "user_state_update_own"    on public.user_state;
drop policy if exists "user_state_delete_own"    on public.user_state;
drop policy if exists "user_entities_select_own" on public.user_entities;
drop policy if exists "user_entities_insert_own" on public.user_entities;
drop policy if exists "user_entities_update_own" on public.user_entities;
drop policy if exists "user_entities_delete_own" on public.user_entities;

create policy "user_state_select_own"
  on public.user_state for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "user_state_insert_own"
  on public.user_state for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "user_state_update_own"
  on public.user_state for update to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "user_state_delete_own"
  on public.user_state for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_entities_select_own"
  on public.user_entities for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "user_entities_insert_own"
  on public.user_entities for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "user_entities_update_own"
  on public.user_entities for update to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "user_entities_delete_own"
  on public.user_entities for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ══════════════════════════════════════════════════════════════════════
-- Realtime publication
-- ══════════════════════════════════════════════════════════════════════
do $$
begin
  alter publication supabase_realtime add table public.user_state;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.user_entities;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
