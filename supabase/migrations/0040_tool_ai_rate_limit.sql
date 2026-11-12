-- Agile Toolkit — the owner's tool AI usage + rate limits.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- The tools' Ask Amr buttons reach the owner's OpenClaw gateway through
-- POST /api/ai/tool (src/app/api/ai/tool/route.ts). The gateway's GLM
-- quota is shared with Amr's chat, this machine's Claude Code and the
-- Hermes bot, so a runaway tool (or a stuck retry loop) must hit a ceiling.
-- This mirrors check_chat_rate_limit (0020) but is kept apart from it: a
-- busy day of tool AI never eats into the chat's allowance, and the other
-- way round.
--
-- One row per tool AI use, recorded with the task id and the real model
-- the route picked. The caps are cost-protection ceilings for a single
-- owner, not a throttle on normal use: 300 a rolling day, 1,500 a rolling
-- week, 5,000 a rolling month.
--
-- Unlike the chat's limiter, the route FAILS CLOSED on this one: no answer
-- from check_tool_ai_rate_limit (missing, an error, a timeout) is a 503,
-- so push this migration before the route ships.
--
-- Identity comes from auth.uid() (the owner's cookie-bound client in
-- requireAuthorizedUser), never a caller-supplied id. All access goes
-- through the two SECURITY DEFINER functions; the table itself is locked.
--
-- No prompt, input or answer text is stored: the task id, the model, the
-- time and the token counts only.
--
-- Idempotent: `if not exists` + `create or replace`.

-- ══════════════════════════════════════════════════════════════════════
-- tool_ai_usage — one row per recorded tool AI use
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.tool_ai_usage (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  task        text        not null check (char_length(task) between 1 and 80),
  model       text        not null check (char_length(model) between 1 and 80),
  tokens_in   integer     not null default 0 check (tokens_in >= 0),
  tokens_out  integer     not null default 0 check (tokens_out >= 0)
);

comment on table public.tool_ai_usage is
  'Owner tool AI uses for rate limiting: task id, model, time and token counts, never any text. Written via check_tool_ai_rate_limit (SECURITY DEFINER); identity is auth.uid().';

-- Rate-limit queries always slice by (user, recent time) — index for it.
create index if not exists tool_ai_usage_user_created_idx
  on public.tool_ai_usage (user_id, created_at desc);

alter table public.tool_ai_usage enable row level security;

-- No direct access — everything goes through the SECURITY DEFINER RPCs.
revoke all on table public.tool_ai_usage from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- check_tool_ai_rate_limit(p_task, p_model) — atomic check-and-record
--
-- Counts the caller's uses across three rolling windows. If under every
-- cap, records one row (counting this use) and returns allowed=true with
-- the post-increment counts and the new row's id; otherwise returns
-- allowed=false WITHOUT recording. An advisory xact lock serialises
-- concurrent calls for the same user so two uses can't both slip past the
-- same remaining slot.
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.check_tool_ai_rate_limit(
  p_task  text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid    := auth.uid();
  v_daily       integer;
  v_weekly      integer;
  v_monthly     integer;
  -- Single-owner ceilings (cost protection, not a throttle).
  v_daily_max   integer := 300;
  v_weekly_max  integer := 1500;
  v_monthly_max integer := 5000;
  v_allowed     boolean := true;
  v_id          uuid    := null;
  v_now         timestamptz := now();
  v_task        text    := left(coalesce(nullif(btrim(p_task), ''), 'unknown'), 80);
  v_model       text    := left(coalesce(nullif(btrim(p_model), ''), 'unknown'), 80);
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text || '_tool_ai_rate'));

  select count(*) into v_daily
    from public.tool_ai_usage
   where user_id = v_user_id
     and created_at > v_now - interval '24 hours';

  select count(*) into v_weekly
    from public.tool_ai_usage
   where user_id = v_user_id
     and created_at > v_now - interval '7 days';

  select count(*) into v_monthly
    from public.tool_ai_usage
   where user_id = v_user_id
     and created_at > v_now - interval '30 days';

  if v_daily >= v_daily_max or v_weekly >= v_weekly_max or v_monthly >= v_monthly_max then
    v_allowed := false;
  end if;

  if v_allowed then
    insert into public.tool_ai_usage (user_id, task, model)
    values (v_user_id, v_task, v_model)
    returning id into v_id;
    v_daily   := v_daily + 1;
    v_weekly  := v_weekly + 1;
    v_monthly := v_monthly + 1;
  end if;

  return jsonb_build_object(
    'allowed',     v_allowed,
    'daily',       v_daily,
    'daily_max',   v_daily_max,
    'weekly',      v_weekly,
    'weekly_max',  v_weekly_max,
    'monthly',     v_monthly,
    'monthly_max', v_monthly_max,
    'id',          v_id
  );
end;
$$;

-- `from public` alone isn't enough: Supabase grants EXECUTE explicitly to
-- anon and authenticated (see 0025). Signed-in callers only.
revoke all on function public.check_tool_ai_rate_limit(text, text) from public, anon;
grant execute on function public.check_tool_ai_rate_limit(text, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- record_tool_ai_tokens(p_id, p_tokens_in, p_tokens_out) — attach the
-- token counts to one of the caller's own rows, after the answer (best
-- effort: the route ignores a failure).
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.record_tool_ai_tokens(
  p_id         uuid,
  p_tokens_in  integer,
  p_tokens_out integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.tool_ai_usage
     set tokens_in  = greatest(0, coalesce(p_tokens_in, 0)),
         tokens_out = greatest(0, coalesce(p_tokens_out, 0))
   where id = p_id
     and user_id = v_user_id;
end;
$$;

revoke all on function public.record_tool_ai_tokens(uuid, integer, integer) from public, anon;
grant execute on function public.record_tool_ai_tokens(uuid, integer, integer) to authenticated;
