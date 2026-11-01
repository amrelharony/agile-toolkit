-- 0032_comic_entry_vip.sql
--
-- A third way in for the anonymous entry counts: opening the link printed in the
-- book. The route handler at /vip/<key> adds one, through comic_entry_hit, for a
-- valid key only. Still daily totals and nothing about a visitor; ep and building
-- stay 0, as they do for the plain /comics address.
--
-- comic_entry_hit needs no change: it takes any value the check allows, and only
-- the service role may call it. The public beacon can't send this value either,
-- because lib/comics/hit.ts allowlists what it accepts.
--
-- Idempotent: the constraint is dropped if it's there, then added again.

alter table public.comic_entry_counts
  drop constraint if exists comic_entry_counts_entry_check;

alter table public.comic_entry_counts
  add constraint comic_entry_counts_entry_check
  check (entry in ('poster', 'direct', 'vip'));
