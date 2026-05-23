-- Agile Toolkit — Tighten rooms / room_state RLS for single-user mode
--
-- ══════════════════════════════════════════════════════════════════════
-- Background
-- ══════════════════════════════════════════════════════════════════════
-- 0001_init.sql created rooms + room_state with fully-permissive
-- "anyone can read/write" policies. With the single-user lock applied
-- at the middleware layer, the API surface is no longer publicly
-- reachable — but defense in depth requires the RLS layer to also
-- enforce ownership so a leaked anon key can't dump or mutate rooms.
--
-- Changes:
--   * Add `owner_id uuid NULLABLE` to rooms, referencing auth.users.
--     Nullable on purpose — see "Why nullable" below.
--   * Drop the four permissive policies.
--   * Replace with owner-scoped policies on rooms.
--   * Add owner-scoped policies on room_state (joined through rooms).
--   * Revoke anon access; grant only what authenticated needs.
--   * Detach the existing share-token SELECT path from rooms ownership
--     (the bearer token IS the credential — preserved as-is in 0003).
--
-- ══════════════════════════════════════════════════════════════════════
-- Why nullable? (Safety vs the previous truncate-cascade design)
-- ══════════════════════════════════════════════════════════════════════
-- The earlier version of this migration ran TRUNCATE TABLE rooms CASCADE
-- as step 1 — necessary because the new column was NOT NULL with no
-- default. That was DESTRUCTIVE on any non-fresh deployment: rerunning
-- against prod would silently wipe every active room.
--
-- New strategy: owner_id is nullable. Rows with NULL owner_id fail every
-- new RLS policy (auth.uid() = NULL is false), so they become invisible
-- to all clients but stay on disk for operator inspection / backfill /
-- explicit cleanup. The migration is now FULLY IDEMPOTENT — running it
-- multiple times against either a fresh or populated DB produces the
-- same end state without data loss.
--
-- Operators wanting to wipe orphaned rows can do so explicitly:
--   DELETE FROM public.rooms WHERE owner_id IS NULL;

-- ══════════════════════════════════════════════════════════════════════
-- 1. Add owner_id column (nullable — see header)
-- ══════════════════════════════════════════════════════════════════════
alter table public.rooms
  add column if not exists owner_id uuid
    references auth.users (id) on delete cascade;

create index if not exists rooms_owner_id_idx on public.rooms(owner_id);

-- ══════════════════════════════════════════════════════════════════════
-- 2. Drop legacy permissive policies (idempotent — IF EXISTS)
-- ══════════════════════════════════════════════════════════════════════
drop policy if exists "anyone can read rooms"        on public.rooms;
drop policy if exists "anyone can create rooms"      on public.rooms;
drop policy if exists "anyone can update rooms"      on public.rooms;
drop policy if exists "anyone can read room_state"   on public.room_state;
drop policy if exists "anyone can write room_state"  on public.room_state;
drop policy if exists "anyone can update room_state" on public.room_state;
drop policy if exists "anyone can delete room_state" on public.room_state;

-- Also drop any prior owner-scoped versions so re-running this file
-- doesn't error on "policy already exists".
drop policy if exists "rooms_select_own"        on public.rooms;
drop policy if exists "rooms_insert_own"        on public.rooms;
drop policy if exists "rooms_update_own"        on public.rooms;
drop policy if exists "rooms_delete_own"        on public.rooms;
drop policy if exists "room_state_select_own"   on public.room_state;
drop policy if exists "room_state_insert_own"   on public.room_state;
drop policy if exists "room_state_update_own"   on public.room_state;
drop policy if exists "room_state_delete_own"   on public.room_state;

-- ══════════════════════════════════════════════════════════════════════
-- 3. Owner-scoped policies on rooms
--    NULL owner_id fails every comparison — orphaned legacy rows are
--    invisible but preserved on disk.
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
-- 4. Owner-scoped policies on room_state (join through rooms)
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
-- 5. Table-level GRANTs (defense-in-depth)
-- ══════════════════════════════════════════════════════════════════════
revoke all on table public.rooms       from anon;
revoke all on table public.room_state  from anon;

grant  select, insert, update, delete on table public.rooms      to authenticated;
grant  select, insert, update, delete on table public.room_state to authenticated;
