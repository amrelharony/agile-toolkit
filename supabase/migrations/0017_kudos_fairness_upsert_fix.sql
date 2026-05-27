-- Agile Toolkit — kudos redesign Phase 0-2 audit follow-up.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- Two small issues surfaced after 0016 landed:
--
-- 1. The fairness-window trigger counts ALL rows in the 24 h slice
--    when an INSERT fires. For an `upsert(..., onConflict: "id")` that
--    targets an ALREADY-EXISTING row in a maxed-out pair, the trigger
--    counts the existing row (which IS the one being upserted) and
--    raises `kudos.fairness_window_exceeded` — turning every retry +
--    backfill of that row into a 429-loop. Cloud-sync interprets
--    429 as retry, exhausts attempts, page-reload rehydrates the
--    queue → eternal retry loop.
--
--    Fix: exclude the row whose id matches `new.id` from the count.
--    A genuine 6th distinct kudos still trips the limit because its
--    id will not be in the existing rows.
--
-- 2. `kudos_select_squad_member` from 0016 was a place-holder policy
--    with `and false` for the future multi-tenant story. The
--    `and false` short-circuits the planner, but the policy is dead
--    code today and confuses any maintainer reading 0016 in isolation.
--    Drop it. When multi-tenant lands the policy can be reintroduced
--    with the real predicate.
--
-- Idempotent: drop + recreate the trigger / policy.

create or replace function public.kudos_fairness_window_enforce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count int;
begin
  -- Only enforce when both sides are squad-profile identified.
  -- Owner-to-anyone or free-text recipients aren't squad-scoped and
  -- aren't subject to the per-pair window.
  if new.from_profile_id is null or new.to_profile_id is null then
    return new;
  end if;

  -- Exclude the row being upserted from the count. Without this, an
  -- idempotent retry against an existing maxed-out pair would trip
  -- the limit even though no NEW row is being added.
  select count(*) into recent_count
  from public.kudos
  where from_profile_id = new.from_profile_id
    and to_profile_id = new.to_profile_id
    and sent_at > now() - interval '24 hours'
    and id <> new.id;

  if recent_count >= 5 then
    raise exception 'kudos.fairness_window_exceeded'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop policy if exists "kudos_select_squad_member" on public.kudos;
