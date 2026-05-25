-- Agile Toolkit — Phase 0 of the squad-guest feature: history multi-author.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- Today every `history_events` row's `user_id` is the workspace owner —
-- the single signed-in Google user who is allowed past the edge
-- middleware. When the squad-guest feature lands, guests will author
-- events too (a sticky added to a shared retro, a vote cast in a shared
-- poker round). We need to distinguish "the owner did this" from "this
-- guest did this" without breaking the existing RLS model.
--
-- Decision: keep `user_id` mandatory and stamped with the WORKSPACE
-- OWNER's id on every row (including guest-authored ones). Add a
-- nullable `squad_profile_id` column that names the guest when one
-- authored the event. This preserves the existing "owner sees their own
-- events" RLS predicate as-is — owners see every event in their
-- workspace, regardless of author — while letting the UI label the
-- actual author when rendering activity.
--
-- The foreign key to `public.squad_profiles` is intentionally NOT added
-- here because that table is created in `0010_squads.sql` (Phase 1).
-- Migration 0010 backfills the FK constraint once the target table
-- exists. Until then `squad_profile_id` is an unconstrained uuid, which
-- is safe because no code path stamps it yet (the column is added now
-- so the round-trip plumbing in `src/lib/history/sync.ts` can ship
-- alongside this migration).
--
-- Compatibility:
--   * Existing rows get NULL — they stay owner-attributed exactly as
--     before. No backfill required.
--   * Existing RLS policies on history_events are untouched; the owner
--     still sees all their rows via `auth.uid() = user_id`.
--   * The audit-log immutability (no UPDATE policy) is preserved.

alter table public.history_events
  add column if not exists squad_profile_id uuid;

comment on column public.history_events.squad_profile_id is
  'Non-null when a squad guest authored this event. user_id always references the workspace owner; this column attributes the actual author.';

-- Partial index: only the rows that have a guest author. The vast
-- majority of rows will be owner-authored (squad_profile_id IS NULL)
-- and adding a full b-tree on a mostly-null column wastes space and
-- write amplification on every owner action. The partial index covers
-- the "show events authored by guest X" query path that the squad-
-- management UI will need.
create index if not exists history_events_squad_profile_idx
  on public.history_events (squad_profile_id, occurred_at desc)
  where squad_profile_id is not null;
