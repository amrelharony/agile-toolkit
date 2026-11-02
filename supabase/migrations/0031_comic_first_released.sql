-- 0031_comic_first_released.sql
--
-- A story's number is fixed once it has been out, and release_at alone can't
-- say that: unpublishing clears it, and rescheduling moves it to the future. So
-- the first release is remembered here, for good, and a once-released story can
-- never again be reordered, bulk-scheduled or deleted, even while it's a draft.
--
-- There's no scheduler, so nothing writes when a scheduled story's time passes.
-- That's why the trigger looks at the old value too: the fact is recorded by the
-- first write that would otherwise lose it. Until then release_at still says it.
-- Readers treat either as released (src/lib/comics/story-input.ts, everReleased).
--
-- Idempotent: `if not exists`, `create or replace`, `drop trigger if exists`.

alter table public.comic_stories
  add column if not exists first_released_at timestamptz;

comment on column public.comic_stories.first_released_at is
  'When this story first went out. Set by a trigger and never cleared. Its number and existence are fixed from then on.';

update public.comic_stories
   set first_released_at = release_at
 where first_released_at is null
   and release_at is not null
   and release_at <= now();

create or replace function public.comic_stories_keep_first_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only this function decides, whatever a write tries to set.
  if tg_op = 'UPDATE' then
    new.first_released_at := old.first_released_at;
    if new.first_released_at is null
       and old.release_at is not null
       and old.release_at <= now() then
      new.first_released_at := old.release_at;
    end if;
  else
    new.first_released_at := null;
  end if;
  if new.first_released_at is null
     and new.release_at is not null
     and new.release_at <= now() then
    new.first_released_at := new.release_at;
  end if;
  return new;
end;
$$;

revoke all on function public.comic_stories_keep_first_release()
  from public, anon, authenticated;

drop trigger if exists comic_stories_keep_first_release on public.comic_stories;
create trigger comic_stories_keep_first_release
  before insert or update on public.comic_stories
  for each row
  execute function public.comic_stories_keep_first_release();

-- As in 0030, with the new rule added to the check under the row lock.
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

revoke all on function public.comic_reorder_queue(int[], int[])
  from public, anon, authenticated;
grant execute on function public.comic_reorder_queue(int[], int[]) to service_role;
