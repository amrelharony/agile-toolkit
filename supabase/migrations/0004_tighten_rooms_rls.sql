-- Agile Toolkit — Tighten rooms / room_state RLS for single-user mode
--
-- ══════════════════════════════════════════════════════════════════════
-- Background
-- ══════════════════════════════════════════════════════════════════════
-- 0001_init.sql created rooms + room_state with fully-permissive
-- "anyone can read/write" policies. That matched the original
-- public-toolkit posture: any visitor could spin up a planning-poker
-- room. With the single-user lock applied at the middleware layer,
-- the API surface is no longer publicly reachable — but defense in
-- depth requires the RLS layer to also enforce ownership so a leaked
-- anon key can't be used to dump or mutate other rooms.
--
-- Changes:
--   * Add `owner_id uuid` to rooms, referencing auth.users.
--   * Drop the four permissive policies.
--   * Replace with owner-scoped policies on rooms.
--   * Add owner-scoped policies on room_state (joined through rooms).
--   * Revoke anon access; grant only what authenticated needs.
--
-- Backfill strategy: drop existing rows. Rooms expire after 30 days
-- anyway and no current-user data is at risk under the new model.

-- ══════════════════════════════════════════════════════════════════════
-- 1. Wipe existing data BEFORE adding the NOT NULL column
-- ══════════════════════════════════════════════════════════════════════
truncate table public.room_state;
truncate table public.rooms cascade;

-- ══════════════════════════════════════════════════════════════════════
-- 2. Add owner_id column
-- ══════════════════════════════════════════════════════════════════════
alter table public.rooms
  add column if not exists owner_id uuid not null
    references auth.users (id) on delete cascade;

create index if not exists rooms_owner_id_idx on public.rooms(owner_id);

-- ══════════════════════════════════════════════════════════════════════
-- 3. Drop legacy permissive policies
-- ══════════════════════════════════════════════════════════════════════
drop policy if exists "anyone can read rooms"        on public.rooms;
drop policy if exists "anyone can create rooms"      on public.rooms;
drop policy if exists "anyone can update rooms"      on public.rooms;
drop policy if exists "anyone can read room_state"   on public.room_state;
drop policy if exists "anyone can write room_state"  on public.room_state;
drop policy if exists "anyone can update room_state" on public.room_state;
drop policy if exists "anyone can delete room_state" on public.room_state;

-- ══════════════════════════════════════════════════════════════════════
-- 4. Owner-scoped policies on rooms
-- ══════════════════════════════════════════════════════════════════════
create policy "rooms_select_own"
  on public.rooms
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "rooms_insert_own"
  on public.rooms
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "rooms_update_own"
  on public.rooms
  for update
  to authenticated
  using      ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "rooms_delete_own"
  on public.rooms
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- ══════════════════════════════════════════════════════════════════════
-- 5. Owner-scoped policies on room_state (join through rooms)
-- ══════════════════════════════════════════════════════════════════════
create policy "room_state_select_own"
  on public.room_state
  for select
  to authenticated
  using (
    exists (
      select 1 from public.rooms r
      where r.id = room_state.room_id
        and r.owner_id = (select auth.uid())
    )
  );

create policy "room_state_insert_own"
  on public.room_state
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.rooms r
      where r.id = room_state.room_id
        and r.owner_id = (select auth.uid())
    )
  );

create policy "room_state_update_own"
  on public.room_state
  for update
  to authenticated
  using (
    exists (
      select 1 from public.rooms r
      where r.id = room_state.room_id
        and r.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.rooms r
      where r.id = room_state.room_id
        and r.owner_id = (select auth.uid())
    )
  );

create policy "room_state_delete_own"
  on public.room_state
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.rooms r
      where r.id = room_state.room_id
        and r.owner_id = (select auth.uid())
    )
  );

-- ══════════════════════════════════════════════════════════════════════
-- 6. Table-level GRANTs (defense-in-depth)
-- ══════════════════════════════════════════════════════════════════════
revoke all on table public.rooms       from anon;
revoke all on table public.room_state  from anon;

grant  select, insert, update, delete on table public.rooms      to authenticated;
grant  select, insert, update, delete on table public.room_state to authenticated;
