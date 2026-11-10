-- 0037_visitor_ai_usage.sql
--
-- The meter for Amr's AI for signed-out visitors (POST /api/agent/visitor).
--
-- Every request the route forwards to the model is one call; a request that
-- starts with a new visitor message is also one turn. visitor_ai_meter checks
-- the limits in visitor_ai_config and counts the request in one transaction,
-- and the route refuses whenever it can't get an answer (fails closed).
--
-- What is kept, and for how long:
--   visitor_ai_usage   per visitor and Cairo day. The visitor is a code the
--                      route makes from an HMAC of the IP address (its /64 for
--                      IPv6), the Cairo date and a server secret, so it changes
--                      every day and can't be turned back into an address. The
--                      IP address itself never reaches this database. Only
--                      today's rows are kept: a code is only ever read on its
--                      own Cairo day, so the next day its rows are deleted.
--   visitor_ai_daily   site-wide totals per Cairo day, no identifiers; 30 days.
--   visitor_ai_hourly  site-wide calls per UTC hour, no identifiers; 6 hours.
--                      This is the rolling 5-hour cap that leaves room on the
--                      Coding Plan for the owner's own Claude Code and Hermes.
--
-- visitor_ai_housekeeping deletes what is past those times. The meter runs it
-- on every call, before it takes any lock and whatever its answer (the brake
-- included), and pg_cron runs it every hour where the extension is installed,
-- so nothing outlives its time just because no one is calling the meter.
--
-- visitor_ai_config is one row holding every limit, the peak window and the
-- reasoning effort, so each can be changed instantly with an `update`, no
-- redeploy (see RUNBOOK.md, "Visitor AI"). The peak window is Z.AI's busy
-- hours: Monday to Friday 14:00-18:00 Singapore time, which is 08:00-12:00 in
-- Cairo in winter and 09:00-13:00 in summer. It is worked out in peak_tz, so
-- Postgres handles daylight saving. peak_days are ISO days (1 = Monday).
-- Each visitor's peak count is kept per Cairo day; with the default window
-- that is one window, as the whole window falls inside one Cairo day.
--
-- Closed to the public API: RLS on with no policies, and only the service
-- role may call the meter.
--
-- Idempotent: `if not exists`, `on conflict do nothing` and
-- `create or replace` throughout.

create table if not exists public.visitor_ai_usage (
  day         date not null,
  visitor_key text not null check (visitor_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  turns       int  not null default 0,
  peak_turns  int  not null default 0,
  calls       int  not null default 0,
  primary key (day, visitor_key)
);

comment on table public.visitor_ai_usage is
  'Visitor AI usage per daily visitor code (an HMAC, never an IP address) and Cairo day. Deleted the next Cairo day.';

create table if not exists public.visitor_ai_daily (
  day        date primary key,
  turns      int not null default 0,
  peak_turns int not null default 0,
  calls      int not null default 0
);

comment on table public.visitor_ai_daily is
  'Visitor AI totals per Cairo day, site-wide. No identifiers. Kept 30 days.';

create table if not exists public.visitor_ai_hourly (
  hour  timestamptz primary key,
  calls int not null default 0
);

comment on table public.visitor_ai_hourly is
  'Visitor AI model calls per UTC hour, for the rolling 5-hour cap. No identifiers. Kept 6 hours.';

create table if not exists public.visitor_ai_config (
  id                     boolean primary key default true check (id),
  enabled                boolean not null default true,
  turns_per_visitor      int not null default 100   check (turns_per_visitor >= 0),
  peak_turns_per_visitor int not null default 25    check (peak_turns_per_visitor >= 0),
  turns_per_day          int not null default 20000 check (turns_per_day >= 0),
  peak_turns_per_day     int not null default 2000  check (peak_turns_per_day >= 0),
  calls_per_visitor      int not null default 300   check (calls_per_visitor >= 0),
  calls_per_day          int not null default 60000 check (calls_per_day >= 0),
  calls_per_5h           int not null default 6000  check (calls_per_5h >= 0),
  reasoning_effort       text not null default 'high' check (reasoning_effort in ('low', 'high', 'max')),
  peak_tz                text not null default 'Asia/Singapore',
  peak_days              int[] not null default '{1,2,3,4,5}' check (peak_days <@ '{1,2,3,4,5,6,7}'),
  peak_start             int not null default 14 check (peak_start between 0 and 24),
  peak_end               int not null default 18 check (peak_end between 0 and 24)
);

comment on table public.visitor_ai_config is
  'Visitor AI limits, peak window and reasoning effort: one row, read by visitor_ai_meter on every request.';

insert into public.visitor_ai_config (id) values (true) on conflict (id) do nothing;

alter table public.visitor_ai_usage  enable row level security;
alter table public.visitor_ai_daily  enable row level security;
alter table public.visitor_ai_hourly enable row level security;
alter table public.visitor_ai_config enable row level security;

revoke all on table public.visitor_ai_usage  from public, anon, authenticated;
revoke all on table public.visitor_ai_daily  from public, anon, authenticated;
revoke all on table public.visitor_ai_hourly from public, anon, authenticated;
revoke all on table public.visitor_ai_config from public, anon, authenticated;

-- Delete what the meter no longer needs: visitor rows from before today (a
-- code is only read on its own Cairo day), hourly rows older than 6 hours
-- (the 5-hour cap reads at most the last 6), daily rows older than 30 days.
--
-- Best-effort, and never in a request's way:
--   - a call skips it while another call is already at it (the advisory lock
--     is held to the end of that call's transaction, so a flood runs it one
--     at a time, not once per request in a queue);
--   - it waits at most 200 ms for a row another transaction still holds (a
--     request from just before Cairo midnight), then leaves the rest for next
--     time rather than make the meter wait or fail.
-- It only touches past days and hours, never the rows the meter locks.
create or replace function public.visitor_ai_housekeeping()
returns void
language plpgsql
set search_path = ''
set lock_timeout = '200ms'
as $$
declare
  v_day  date := (now() at time zone 'Africa/Cairo')::date;
  v_hour timestamptz := date_trunc('hour', now() at time zone 'utc') at time zone 'utc';
begin
  if not pg_try_advisory_xact_lock(hashtext('public.visitor_ai_housekeeping')) then
    return;
  end if;
  begin
    delete from public.visitor_ai_usage where day < v_day;
    delete from public.visitor_ai_hourly where hour < v_hour - interval '6 hours';
    delete from public.visitor_ai_daily where day < v_day - 30;
  exception
    when lock_not_available then
      null;
  end;
end;
$$;

-- Internal: the meter (which runs as the owner), pg_cron and the SQL editor
-- call it. No API role may.
revoke all on function public.visitor_ai_housekeeping()
  from public, anon, authenticated;

-- Check one request against the limits and, when it's allowed, count it.
--
-- Refusals, in order: disabled; on a new turn, visitor_limit,
-- visitor_peak_limit (in the peak window), site_limit, site_peak_limit (in
-- the peak window); then, for every call, site_busy (the visitor's calls
-- today, the site's calls today, or the site's calls in the last 5 hours).
-- The turn limits apply only to a new turn, so a turn that was let in can
-- finish its tool rounds.
--
-- The counts are looked at twice. The first look takes no lock: today's
-- counts only ever grow, so a request refused on it would be refused under
-- the locks too, and refusals (a flood that is over its limits) never queue
-- on the site-wide day row. A request the first look allows is looked at
-- again with the day row locked first and the visitor row second, always in
-- that order, so two requests can't deadlock and the second look sees counts
-- no other request can change before this one commits.
--
-- lock_timeout keeps a pile-up from holding requests: the route gives up
-- after 2.5 s anyway, and refuses.
create or replace function public.visitor_ai_meter(
  p_visitor  text,
  p_new_turn boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_cfg      public.visitor_ai_config%rowtype;
  v_now      timestamptz := now();
  v_day      date := (now() at time zone 'Africa/Cairo')::date;
  v_hour     timestamptz := date_trunc('hour', now() at time zone 'utc') at time zone 'utc';
  v_new_turn boolean := coalesce(p_new_turn, true);
  v_local    timestamp;
  v_peak     boolean := false;
  v_peak_end timestamptz;
  v_daily    public.visitor_ai_daily%rowtype;
  v_usage    public.visitor_ai_usage%rowtype;
  v_5h       bigint;
  v_locked   boolean := false;
  v_reason   text;
begin
  if p_visitor is null or p_visitor !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'visitor_ai_meter: invalid visitor code' using errcode = '22023';
  end if;

  -- Before anything can return, and before any lock.
  perform public.visitor_ai_housekeeping();

  select * into v_cfg from public.visitor_ai_config where id;

  if not found or not v_cfg.enabled then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'disabled',
      'turns_used', 0,
      'turns_max', coalesce(v_cfg.turns_per_visitor, 0),
      'peak', false,
      'peak_turns_used', 0,
      'peak_turns_max', coalesce(v_cfg.peak_turns_per_visitor, 0),
      'peak_ends_at', null,
      'reasoning_effort', coalesce(v_cfg.reasoning_effort, 'high')
    );
  end if;

  -- The peak window, in peak_tz's own wall-clock time.
  v_local := v_now at time zone v_cfg.peak_tz;
  v_peak := extract(isodow from v_local)::int = any (v_cfg.peak_days)
    and extract(hour from v_local)::int >= v_cfg.peak_start
    and extract(hour from v_local)::int < v_cfg.peak_end;
  if v_peak then
    v_peak_end := (date_trunc('day', v_local) + make_interval(hours => v_cfg.peak_end))
      at time zone v_cfg.peak_tz;
  end if;

  loop
    if v_locked then
      -- Day row, then visitor row: create if missing, then lock.
      insert into public.visitor_ai_daily (day) values (v_day) on conflict (day) do nothing;
      select * into v_daily from public.visitor_ai_daily where day = v_day for update;

      insert into public.visitor_ai_usage (day, visitor_key) values (v_day, p_visitor)
        on conflict (day, visitor_key) do nothing;
      select * into v_usage from public.visitor_ai_usage
        where day = v_day and visitor_key = p_visitor for update;
    else
      -- No lock and no row created: a missing row is nothing used yet.
      select * into v_daily from public.visitor_ai_daily where day = v_day;
      if not found then
        v_daily.turns := 0;
        v_daily.peak_turns := 0;
        v_daily.calls := 0;
      end if;
      select * into v_usage from public.visitor_ai_usage
        where day = v_day and visitor_key = p_visitor;
      if not found then
        v_usage.turns := 0;
        v_usage.peak_turns := 0;
        v_usage.calls := 0;
      end if;
    end if;

    -- The current hour's bucket and the 5 before it: between 5 and 6 hours,
    -- never less, so the cap can count too much but never too little.
    select coalesce(sum(calls), 0) into v_5h from public.visitor_ai_hourly
      where hour >= v_hour - interval '5 hours';

    v_reason := null;
    if v_new_turn and v_usage.turns >= v_cfg.turns_per_visitor then
      v_reason := 'visitor_limit';
    elsif v_new_turn and v_peak and v_usage.peak_turns >= v_cfg.peak_turns_per_visitor then
      v_reason := 'visitor_peak_limit';
    elsif v_new_turn and v_daily.turns >= v_cfg.turns_per_day then
      v_reason := 'site_limit';
    elsif v_new_turn and v_peak and v_daily.peak_turns >= v_cfg.peak_turns_per_day then
      v_reason := 'site_peak_limit';
    elsif v_usage.calls >= v_cfg.calls_per_visitor
      or v_daily.calls >= v_cfg.calls_per_day
      or v_5h >= v_cfg.calls_per_5h then
      v_reason := 'site_busy';
    end if;

    -- A refusal on either look is the answer; a request counts only once the
    -- second look, under the locks, allows it too.
    exit when v_reason is not null or v_locked;
    v_locked := true;
  end loop;

  if v_reason is null then
    update public.visitor_ai_usage
      set turns      = turns + (case when v_new_turn then 1 else 0 end),
          peak_turns = peak_turns + (case when v_new_turn and v_peak then 1 else 0 end),
          calls      = calls + 1
      where day = v_day and visitor_key = p_visitor
      returning * into v_usage;

    update public.visitor_ai_daily
      set turns      = turns + (case when v_new_turn then 1 else 0 end),
          peak_turns = peak_turns + (case when v_new_turn and v_peak then 1 else 0 end),
          calls      = calls + 1
      where day = v_day;

    insert into public.visitor_ai_hourly as h (hour, calls) values (v_hour, 1)
      on conflict (hour) do update set calls = h.calls + 1;
  end if;

  return jsonb_build_object(
    'allowed', v_reason is null,
    'reason', v_reason,
    'turns_used', v_usage.turns,
    'turns_max', v_cfg.turns_per_visitor,
    'peak', v_peak,
    'peak_turns_used', v_usage.peak_turns,
    'peak_turns_max', v_cfg.peak_turns_per_visitor,
    'peak_ends_at', v_peak_end,
    'reasoning_effort', v_cfg.reasoning_effort
  );
end;
$$;

-- `from public` alone isn't enough: Supabase grants EXECUTE explicitly to anon
-- and authenticated (see 0025). Service role only.
revoke all on function public.visitor_ai_meter(text, boolean)
  from public, anon, authenticated;
grant execute on function public.visitor_ai_meter(text, boolean) to service_role;

-- Housekeeping also runs every hour from pg_cron where the extension is
-- installed (as in 0002), so the rows go on time with the brake on or no one
-- calling the meter. Without pg_cron the meter's own calls are the only
-- cleanup: after a quiet spell, run `select public.visitor_ai_housekeeping();`
-- in the SQL editor (RUNBOOK.md, "Visitor AI").
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule any earlier version under the same name, so this stays idempotent.
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'visitor_ai_housekeeping_hourly';
    perform cron.schedule(
      'visitor_ai_housekeeping_hourly',
      '7 * * * *',
      $cmd$ select public.visitor_ai_housekeeping() $cmd$
    );
  end if;
exception
  when undefined_table or undefined_function or insufficient_privilege or invalid_schema_name then
    -- pg_cron present but its schema out of reach, or no rights: skip the
    -- schedule rather than fail the migration.
    null;
end $$;
