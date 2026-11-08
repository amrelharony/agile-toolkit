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
-- "Read by N readers", Readers' favourites); comic_story_insight_totals and
-- comic_story_weekly_totals sum them for the owner's Insights tab.
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
-- then answers the story's net loves and readers, this call included. A love
-- taken back is only counted while the story has a love to take back, so stray
-- or replayed "unlove" events can't leave a deficit that hides later loves. The
-- story's lock makes two calls for one story take turns, so that check holds.
create or replace function public.comic_story_stat(
  p_ep     int,
  p_events text[]
) returns table (loves bigint, readers bigint)
language plpgsql
set search_path = ''
as $$
declare
  this_week date := (now() at time zone 'utc')::date - extract(dow from (now() at time zone 'utc'))::int;
  net bigint;
  n bigint;
  ev record;
begin
  perform pg_advisory_xact_lock(36, p_ep);
  select coalesce(sum(case s.metric when 'love' then s.count when 'unlove' then -s.count end), 0)
    into net
    from public.comic_story_stats s
   where s.ep = p_ep and s.metric in ('love', 'unlove');

  for ev in
    select split_part(e, ':', 1) as metric,
           coalesce(nullif(split_part(e, ':', 2), ''), '0')::smallint as bucket,
           count(*)::bigint as total
      from unnest(p_events) as e
     group by 1, 2
  loop
    n := ev.total;
    if ev.metric = 'unlove' then
      n := least(n, greatest(net, 0));
    end if;
    continue when n <= 0;
    insert into public.comic_story_stats as s (ep, week, metric, bucket, count)
    values (p_ep, this_week, ev.metric, ev.bucket, n)
    on conflict (ep, week, metric, bucket)
    do update set count = s.count + excluded.count;
    if ev.metric = 'love' then
      net := net + n;
    elsif ev.metric = 'unlove' then
      net := net - n;
    end if;
  end loop;

  return query
    select greatest(net, 0),
           coalesce((select sum(s.count) from public.comic_story_stats s
                      where s.ep = p_ep and s.metric = 'reader'), 0)::bigint;
end;
$$;

-- Per story, or for one story with p_ep.
drop function if exists public.comic_story_totals();
create or replace function public.comic_story_totals(p_ep int default null)
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
   where p_ep is null or s.ep = p_ep
   group by s.ep;
$$;

-- The owner's Insights: each story's totals per metric and time band, all
-- time ('all') and over its first p_first_weeks weeks from its release week
-- ('first4'). A few rows per story, however many weeks pass.
create or replace function public.comic_story_insight_totals(p_first_weeks int default 4)
returns table (ep int, scope text, metric text, bucket smallint, count bigint)
language sql
stable
set search_path = ''
as $$
  select s.ep, 'all'::text, s.metric, s.bucket, sum(s.count)::bigint
    from public.comic_story_stats s
   group by s.ep, s.metric, s.bucket
  union all
  select s.ep, 'first4'::text, s.metric, s.bucket, sum(s.count)::bigint
    from public.comic_story_stats s
    join public.comic_stories c on c.ep = s.ep
   cross join lateral (
     select (c.release_at at time zone 'utc')::date
            - extract(dow from (c.release_at at time zone 'utc'))::int as release_week
   ) r
   where c.release_at is not null
     and s.week >= r.release_week
     and s.week < r.release_week + p_first_weeks * 7
   group by s.ep, s.metric, s.bucket;
$$;

-- Views, readers and loves across every story, week by week, for the trend.
create or replace function public.comic_story_weekly_totals()
returns table (week date, metric text, count bigint)
language sql
stable
set search_path = ''
as $$
  select s.week, s.metric, sum(s.count)::bigint
    from public.comic_story_stats s
   where s.metric in ('view', 'reader', 'love', 'unlove')
   group by s.week, s.metric;
$$;

-- `from public` alone isn't enough: Supabase grants EXECUTE explicitly to anon
-- and authenticated (see 0025). Service role only.
revoke all on function public.comic_story_stat(int, text[]) from public, anon, authenticated;
grant execute on function public.comic_story_stat(int, text[]) to service_role;
revoke all on function public.comic_story_totals(int) from public, anon, authenticated;
grant execute on function public.comic_story_totals(int) to service_role;
revoke all on function public.comic_story_insight_totals(int) from public, anon, authenticated;
grant execute on function public.comic_story_insight_totals(int) to service_role;
revoke all on function public.comic_story_weekly_totals() from public, anon, authenticated;
grant execute on function public.comic_story_weekly_totals() to service_role;

alter table public.comic_stories
  add column if not exists print_shortlist boolean not null default false;

comment on column public.comic_stories.print_shortlist is
  'The owner is considering this story for a printed volume. Set in the portal''s Insights tab; no page reads it.';
