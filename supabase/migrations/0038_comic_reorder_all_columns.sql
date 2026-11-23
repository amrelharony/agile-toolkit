-- 0038_comic_reorder_all_columns.sql
--
-- A reorder moves a whole story. 0031's version copied only the columns that
-- existed in 0030, so everything added since stayed behind on the old number:
-- quiz and try_tool (0033), guess, try_action and extras_draft (0035), and
-- print_shortlist (0036). One story would have shown another's guess, whose
-- `happened` points at a panel of the story it was written for.
--
-- The counts go with the story too. comic_story_taps (0035) are taken early, in
-- a VIP reader's window, so a queued story can already have some.
-- comic_story_stats (0036) are only taken once a story is out, so a queued one
-- should have none; they move anyway, so nothing could stay behind. Rows are
-- deleted and put back under their new numbers rather than renumbered in place,
-- because a swap would hit the primary key row by row. A tap that comes in
-- while this runs is added to the moved row rather than lost.
-- comic_entry_counts and comic_visit_counts stay put: they count ways in to a
-- number, not readers of a story.
--
-- Everything else is as in 0031. test/comics/portal.test.tsx checks that the
-- latest version of this function copies every comic_stories column added in
-- any migration, so a new column can't be forgotten again.
--
-- Idempotent: `create or replace`.

create or replace function public.comic_reorder_queue(
  p_slots   int[],
  p_stories int[]
) returns void
language plpgsql
set search_path = ''
as $$
declare
  n        int := coalesce(cardinality(p_slots), 0);
  queued   int;
  snapshot public.comic_stories[];
  taps     public.comic_story_taps[];
  stats    public.comic_story_stats[];
begin
  if n < 2 or n <> coalesce(cardinality(p_stories), 0) then
    raise exception 'comic_reorder_queue: slots and stories must be two lists of the same length';
  end if;
  if (select count(distinct s) from unnest(p_slots) as s) <> n
     or (select array_agg(s order by s) from unnest(p_slots) as s)
        is distinct from (select array_agg(s order by s) from unnest(p_stories) as s) then
    raise exception 'comic_reorder_queue: stories must be a reordering of the same numbers';
  end if;

  with locked as (
    select ep
      from public.comic_stories
     where ep = any (p_slots)
       and collection = 'weekly'
       and (release_at is null or release_at > now())
       and first_released_at is null
       for update
  )
  select count(*) into queued from locked;
  if queued <> n then
    raise exception 'comic_reorder_queue: every number must be a weekly story that has never been out';
  end if;

  select array_agg(s) into snapshot
    from public.comic_stories as s
   where s.ep = any (p_slots);

  -- Cleared first: source_id is unique, and a swap would collide row by row.
  update public.comic_stories set source_id = null where ep = any (p_slots);

  -- Every column but the number, its collection, book page, dates and created_at.
  update public.comic_stories as t
     set source_id       = s.source_id,
         title           = s.title,
         lesson          = s.lesson,
         squad_question  = s.squad_question,
         cast_names      = s.cast_names,
         themes          = s.themes,
         panels          = s.panels,
         share_path      = s.share_path,
         quiz            = s.quiz,
         try_tool        = s.try_tool,
         guess           = s.guess,
         try_action      = s.try_action,
         extras_draft    = s.extras_draft,
         print_shortlist = s.print_shortlist,
         updated_at      = now()
    from unnest(p_slots, p_stories) as m (slot, story)
    join unnest(snapshot) as s on s.ep = m.story
   where t.ep = m.slot;

  -- Taken and removed in one statement, so a tap landing in between isn't lost.
  with gone as (
    delete from public.comic_story_taps as x
     where x.ep = any (p_slots)
    returning x
  )
  select array_agg(gone.x) into taps from gone;

  insert into public.comic_story_taps as t (ep, kind, choice, count)
  select m.slot, x.kind, x.choice, x.count
    from unnest(p_slots, p_stories) as m (slot, story)
    join unnest(taps) as x on x.ep = m.story
  on conflict (ep, kind, choice)
  do update set count = t.count + excluded.count;

  with gone as (
    delete from public.comic_story_stats as x
     where x.ep = any (p_slots)
    returning x
  )
  select array_agg(gone.x) into stats from gone;

  insert into public.comic_story_stats as t (ep, week, metric, bucket, count)
  select m.slot, x.week, x.metric, x.bucket, x.count
    from unnest(p_slots, p_stories) as m (slot, story)
    join unnest(stats) as x on x.ep = m.story
  on conflict (ep, week, metric, bucket)
  do update set count = t.count + excluded.count;
end;
$$;

-- `from public` alone isn't enough: Supabase grants EXECUTE explicitly to anon
-- and authenticated (see 0025). Service role only.
revoke all on function public.comic_reorder_queue(int[], int[])
  from public, anon, authenticated;
grant execute on function public.comic_reorder_queue(int[], int[]) to service_role;
