-- Agile Toolkit — Phase 4 hardening: tie `history_events.squad_profile_id`
-- to the writer's squad on owner-side INSERTs.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- Migration 0009 added a nullable `squad_profile_id` to
-- `history_events` so squad-guest writes can attribute the actual author
-- while keeping `user_id` pinned to the workspace owner (preserves
-- existing owner-side RLS visibility). 0010 added the FK to
-- `squad_profiles` so a deleted guest cascades to null.
--
-- The INSERT policy on `history_events` (from 0002) only checks
-- `auth.uid() = user_id`. An authenticated owner could therefore write
-- their own row but set `squad_profile_id` to ANY uuid — including a
-- guest belonging to a different owner's squad. Within a single
-- workspace the damage is contained (the owner is forging attribution
-- against themselves), but downstream readers that treat
-- `squad_profile_id` as a trusted identity claim (e.g. an activity-feed
-- endpoint filtering by guest profile id) would render misleading data.
--
-- Service-role guest-log writes (`/api/guest/log`) BYPASS RLS by design
-- — this predicate doesn't change that path. It primarily defends the
-- owner-authenticated INSERT path used by `src/lib/history/sync.ts`.
--
-- Idempotent: drop + recreate so re-running this migration is safe.

drop policy if exists "history_events_insert_self" on public.history_events;

create policy "history_events_insert_self"
  on public.history_events
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      squad_profile_id is null
      or exists (
        select 1
        from public.squad_profiles sp
        join public.squads s on s.id = sp.squad_id
        where sp.id = history_events.squad_profile_id
          and s.owner_id = (select auth.uid())
      )
    )
  );
