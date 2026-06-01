-- Agile Toolkit — agent chat usage + rate limits.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- The in-app agent streams through the OpenClaw gateway (which proxies to
-- GLM with the key held server-side). OpenClaw itself doesn't enforce
-- per-user limits, so a runaway tool-use loop or an accidental flood could
-- burn gateway budget unbounded. This table + RPCs mirror the personal
-- website's chat rate-limiting (api/chat.js → check_chat_rate_limit /
-- record_chat_usage) so /api/agent/stream can:
--   • cap usage per rolling 24h / 7d / 30d window,
--   • surface a usage bar in the mascot panel via X-RateLimit-* headers.
--
-- This is a SINGLE-OWNER toolkit, so the caps are deliberately generous —
-- they're cost-protection ceilings, not a throttle on normal use. One row
-- is recorded per *agent turn* (not per tool-use round): the route only
-- calls the check when the client marks a turn start, so a 10-round
-- tool chain still counts as one unit of usage. Adjust the v_*_max
-- defaults below to taste.
--
-- Identity comes from auth.uid() (the cookie-bound authenticated client in
-- requireAuthorizedUser), never a caller-supplied id — so one user can't
-- inflate or exhaust another's quota. All access goes through the two
-- SECURITY DEFINER functions; the table itself is locked.
--
-- Idempotent: `if not exists` + `create or replace` + `drop ... if exists`.

-- ══════════════════════════════════════════════════════════════════════
-- chat_usage — one row per recorded agent turn
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.chat_usage (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  tokens_used integer     not null default 0,
  model       text        not null default 'openclaw'
);

comment on table public.chat_usage is
  'Per-turn agent usage for rate limiting. Written via check_chat_rate_limit (SECURITY DEFINER); identity is auth.uid(). One row ≈ one agent turn.';

-- Rate-limit queries always slice by (user, recent time) — index for it.
create index if not exists chat_usage_user_created_idx
  on public.chat_usage (user_id, created_at desc);

alter table public.chat_usage enable row level security;

-- No direct access — everything goes through the SECURITY DEFINER RPCs.
revoke all on table public.chat_usage from anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- check_chat_rate_limit() — atomic check-and-record
--
-- Counts the caller's usage across three rolling windows. If under every
-- cap, records one row (counting this turn) and returns allowed=true with
-- the post-increment counts; otherwise returns allowed=false WITHOUT
-- recording. An advisory xact lock serialises concurrent calls for the
-- same user so two turns can't both slip past the same remaining slot.
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.check_chat_rate_limit()
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
  -- Generous single-owner ceilings (cost protection, not a throttle).
  v_daily_max   integer := 200;
  v_weekly_max  integer := 1000;
  v_monthly_max integer := 4000;
  v_allowed     boolean := true;
  v_now         timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text || '_agent_rate'));

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

  if v_daily >= v_daily_max or v_weekly >= v_weekly_max or v_monthly >= v_monthly_max then
    v_allowed := false;
  end if;

  if v_allowed then
    insert into public.chat_usage (user_id, tokens_used, model)
    values (v_user_id, 0, 'openclaw');
    v_daily   := v_daily + 1;
    v_weekly  := v_weekly + 1;
    v_monthly := v_monthly + 1;
  end if;

  return jsonb_build_object(
    'allowed',      v_allowed,
    'daily_used',   v_daily,
    'daily_max',    v_daily_max,
    'weekly_used',  v_weekly,
    'weekly_max',   v_weekly_max,
    'monthly_used', v_monthly,
    'monthly_max',  v_monthly_max
  );
end;
$$;

revoke all on function public.check_chat_rate_limit() from public, anon;
grant execute on function public.check_chat_rate_limit() to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- record_chat_usage(p_tokens, p_model) — attach a token count to the
-- caller's most recent turn row (best-effort; the edge route doesn't tally
-- streamed tokens today, but this keeps parity with the website and lets a
-- future caller backfill token spend without a schema change).
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.record_chat_usage(
  p_tokens integer,
  p_model  text default 'openclaw'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.chat_usage
     set tokens_used = greatest(0, coalesce(p_tokens, 0)),
         model       = coalesce(p_model, model)
   where id = (
     select id from public.chat_usage
      where user_id = v_user_id
      order by created_at desc
      limit 1
   );
end;
$$;

revoke all on function public.record_chat_usage(integer, text) from public, anon;
grant execute on function public.record_chat_usage(integer, text) to authenticated;
