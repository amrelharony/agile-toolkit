-- 0030_comic_reorder_queue.sql
--
-- Reorder the unreleased weekly queue in one transaction. A story's number is
-- its primary key and source_id is unique, and both are checked row by row, so
-- a swap can't be done with separate writes from the route: a failure halfway
-- would leave a story missing or two stories under one number.
--
-- Each number keeps its release date and takes another story's content, so
-- moving a story up really does bring it out sooner. The check here repeats the
-- route's, under a row lock, because a story can pass its release time between
-- the route's read and this write. A released story's number never changes.
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
       for update
  )
  select count(*) into queued from locked;
  if queued <> n then
    raise exception 'comic_reorder_queue: every number must be an unreleased weekly story';
  end if;

  select array_agg(s) into snapshot
    from public.comic_stories as s
   where s.ep = any (p_slots);

  -- Cleared first: source_id is unique, and a swap would collide row by row.
  update public.comic_stories set source_id = null where ep = any (p_slots);

  update public.comic_stories as t
     set source_id      = s.source_id,
         title          = s.title,
         lesson         = s.lesson,
         squad_question = s.squad_question,
         cast_names     = s.cast_names,
         themes         = s.themes,
         panels         = s.panels,
         share_path     = s.share_path,
         updated_at     = now()
    from unnest(p_slots, p_stories) as m (slot, story)
    join unnest(snapshot) as s on s.ep = m.story
   where t.ep = m.slot;
end;
$$;

-- `from public` alone isn't enough: Supabase grants EXECUTE explicitly to anon
-- and authenticated (see 0025). Service role only.
revoke all on function public.comic_reorder_queue(int[], int[])
  from public, anon, authenticated;
grant execute on function public.comic_reorder_queue(int[], int[]) to service_role;
