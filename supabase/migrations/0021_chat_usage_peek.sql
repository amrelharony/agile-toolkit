-- Agile Toolkit — read-only agent-usage snapshot.
--
-- check_chat_rate_limit() (migration 0020) is the only way to read usage, but it
-- INSERTS a row when allowed — so it can't be used to merely display the bar
-- without consuming quota. peek_chat_usage() runs the same three rolling-window
-- counts WITHOUT recording, so the mascot panel can show "187 / 200 used today"
-- the moment it opens (and refresh on every open) instead of staying blank until
-- the user spends a turn.
--
-- Identity is auth.uid() (never caller-supplied). The caps below MUST match
-- check_chat_rate_limit() in 0020 — keep them in sync if you retune.
--
-- Idempotent: create or replace + explicit grants.

create or replace function public.peek_chat_usage()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid    := auth.uid();
  v_daily       integer;
  v_weekly      integer;
  v_monthly     integer;
  -- Keep in sync with check_chat_rate_limit() (0020).
  v_daily_max   integer := 200;
  v_weekly_max  integer := 1000;
  v_monthly_max integer := 4000;
  v_now         timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select count(*) into v_daily
    from public.chat_usage
   where user_id = v_user_id
     and created_at > v_now - interval '24 hours';

  select count(*) into v_weekly
    from public.chat_usage
   where user_id = v_user_id
     and created_at > v_now - interval '7 days';

  select count(*) into v_monthly
    from public.chat_usage
   where user_id = v_user_id
     and created_at > v_now - interval '30 days';

  return jsonb_build_object(
    'allowed',      (v_daily < v_daily_max and v_weekly < v_weekly_max and v_monthly < v_monthly_max),
    'daily_used',   v_daily,
    'daily_max',    v_daily_max,
    'weekly_used',  v_weekly,
    'weekly_max',   v_weekly_max,
    'monthly_used', v_monthly,
    'monthly_max',  v_monthly_max
  );
end;
$$;

revoke all on function public.peek_chat_usage() from public, anon;
grant execute on function public.peek_chat_usage() to authenticated;
