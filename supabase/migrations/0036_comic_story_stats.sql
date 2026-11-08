-- 0036: anonymous engagement counts for the weekly stories, and the owner's
-- print shortlist.
--
-- comic_story_stats holds running totals per story, per release week (the
-- Sunday, UTC, that starts it), per metric: page views, first views from a
-- browser, first finishes, loves and loves taken back, shares, retro hand-offs,
-- clicks on the story's tool, and a band of active reading time. As with
-- comic_visit_counts (0034) and comic_story_taps (0035), no row says who did
-- anything: no IP address, user agent, cookie or device id is stored, and a
-- browser's own record (lib/comics/reading) is all that keeps one reader from
-- counting twice. Written only through comic_story_stat, by /api/comics/stats.
--
-- comic_story_totals sums them per story for the pages (the heart's count,
-- "Read by N readers", Readers' favourites) and the owner's Insights tab.
--
-- print_shortlist marks the stories the owner is considering for a printed
-- volume. Owner-only: no page reads it.
--
-- Idempotent.

create table if not exists public.comic_story_stats (
  ep     int      not null check (ep between 27 and 999),
  week   date     not null check (extract(dow from week) = 0),
  metric text     not null check (
    metric in ('view', 'visitor', 'reader', 'love', 'unlove', 'share', 'retro', 'tool', 'time')
  ),
  bucket smallint not null default 0 check (bucket between 0 and 5),
  count  bigint   not null default 0 check (count >= 0),
  primary key (ep, week, metric, bucket),
  -- Only reading time comes in bands.
  constraint comic_story_stats_bucket_metric check (metric = 'time' or bucket = 0)
);

comment on table public.comic_story_stats is
  'Anonymous weekly totals of views, first views, finishes, loves, shares, retro hand-offs, tool clicks and reading-time bands per weekly story, written through comic_story_stat. No visitor identifiers.';

alter table public.comic_story_stats enable row level security;
revoke all on table public.comic_story_stats from anon, authenticated;

-- One call adds one to each event ("view", "time:3", ...) in the current week,
-- then answers the story's net loves and readers, this call included. The rest
-- of the statement reads the table as it was before the insert, so this call's
-- own events are added from `ev`. Repeated events are grouped first: one insert
-- can't update the same row twice.
create or replace function public.comic_story_stat(
  p_ep     int,
  p_events text[]
) returns table (loves bigint, readers bigint)
language sql
set search_path = ''
as $$
  with ev as (
    select split_part(e, ':', 1) as metric,
           coalesce(nullif(split_part(e, ':', 2), ''), '0')::smallint as bucket,
           count(*)::bigint as n
      from unnest(p_events) as e
     group by 1, 2
  ),
  hit as (
    insert into public.comic_story_stats as s (ep, week, metric, bucket, count)
    select p_ep,
           (now() at time zone 'utc')::date - extract(dow from (now() at time zone 'utc'))::int,
           ev.metric,
           ev.bucket,
           ev.n
      from ev
    on conflict (ep, week, metric, bucket)
    do update set count = s.count + excluded.count
    returning 1
  )
  select greatest(
           0,
           coalesce(sum(case s.metric when 'love' then s.count when 'unlove' then -s.count end), 0)
           + coalesce((select sum(case ev.metric when 'love' then ev.n when 'unlove' then -ev.n end) from ev), 0)
         )::bigint,
         (coalesce(sum(s.count) filter (where s.metric = 'reader'), 0)
           + coalesce((select sum(ev.n) from ev where ev.metric = 'reader'), 0))::bigint
    from public.comic_story_stats s
   where s.ep = p_ep and s.metric in ('love', 'unlove', 'reader');
$$;

create or replace function public.comic_story_totals()
returns table (
  ep       int,
  views    bigint,
  visitors bigint,
  readers  bigint,
  loves    bigint,
  shares   bigint,
  retros   bigint,
  tools    bigint
)
language sql
stable
set search_path = ''
as $$
  select s.ep,
         coalesce(sum(s.count) filter (where s.metric = 'view'), 0)::bigint,
         coalesce(sum(s.count) filter (where s.metric = 'visitor'), 0)::bigint,
         coalesce(sum(s.count) filter (where s.metric = 'reader'), 0)::bigint,
         greatest(
           0,
           coalesce(sum(s.count) filter (where s.metric = 'love'), 0)
           - coalesce(sum(s.count) filter (where s.metric = 'unlove'), 0)
         )::bigint,
         coalesce(sum(s.count) filter (where s.metric = 'share'), 0)::bigint,
         coalesce(sum(s.count) filter (where s.metric = 'retro'), 0)::bigint,
         coalesce(sum(s.count) filter (where s.metric = 'tool'), 0)::bigint
    from public.comic_story_stats s
   group by s.ep;
$$;

-- `from public` alone isn't enough: Supabase grants EXECUTE explicitly to anon
-- and authenticated (see 0025). Service role only.
revoke all on function public.comic_story_stat(int, text[]) from public, anon, authenticated;
grant execute on function public.comic_story_stat(int, text[]) to service_role;
revoke all on function public.comic_story_totals() from public, anon, authenticated;
grant execute on function public.comic_story_totals() to service_role;

alter table public.comic_stories
  add column if not exists print_shortlist boolean not null default false;

comment on column public.comic_stories.print_shortlist is
  'The owner is considering this story for a printed volume. Set in the portal''s Insights tab; no page reads it.';
