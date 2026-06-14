-- ══════════════════════════════════════════════════════════════════════
-- Harden SECURITY DEFINER functions.
--
-- 1. kudos_add_reaction — defence-in-depth IDOR guard.
--    The function is SECURITY DEFINER (bypasses RLS) and is granted to
--    `authenticated`, so an owner can call it directly via PostgREST
--    (`supabase.rpc('kudos_add_reaction', …)`) and skip the
--    /api/kudos/[id]/reactions ownership gate, appending a reaction to ANOTHER
--    owner's kudos row — a cross-tenant write, since multiple owners can share
--    one Supabase project via AUTHORIZED_EMAILS. The route's own comment already
--    flags this; the protection lived only in application code.
--    Now: an AUTHENTICATED caller may only react to kudos they own. The
--    service-role guest path has a NULL auth.uid() and stays trusted — the guest
--    route HMAC-verifies the caller and gates ownership before delegating here.
--
-- 2. Pin `search_path = public, pg_temp` (the project's hardened form, already
--    used by resolve_pat / lookup_share_token) on the kudos + chat-usage
--    SECURITY DEFINER functions that previously pinned only `public`. Placing
--    pg_temp explicitly last stops a caller's temp-schema object from shadowing
--    an unqualified name the function might resolve at runtime.
--
-- Idempotent: `create or replace` + `alter function … set` re-run safely.
-- ══════════════════════════════════════════════════════════════════════

create or replace function public.kudos_add_reaction(
  p_kudos_id text,
  p_emoji text,
  p_by_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_reactions jsonb;
  already_reacted boolean;
begin
  -- Belt-and-braces input checks (the API parses already).
  if p_emoji is null or char_length(p_emoji) > 32 then
    raise exception 'kudos.invalid_emoji'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_by_profile_id is null then
    raise exception 'kudos.missing_profile'
      using errcode = 'invalid_parameter_value';
  end if;

  -- IDOR guard: an authenticated caller may only react to kudos they own.
  -- The service-role guest path (auth.uid() is null) is trusted. Raising
  -- not_found (rather than a distinct "forbidden") avoids revealing existence
  -- to a cross-tenant probe, and the route already maps not_found → 404.
  if auth.uid() is not null then
    if not exists (
      select 1 from public.kudos
      where id = p_kudos_id and owner_id = auth.uid()
    ) then
      raise exception 'kudos.not_found'
        using errcode = 'no_data_found';
    end if;
  end if;

  select reactions into existing_reactions
  from public.kudos
  where id = p_kudos_id
  for update;

  if existing_reactions is null then
    raise exception 'kudos.not_found'
      using errcode = 'no_data_found';
  end if;

  -- Cap total reactions at 24 (parser-aligned ceiling).
  if jsonb_array_length(existing_reactions) >= 24 then
    raise exception 'kudos.reactions_full'
      using errcode = 'check_violation';
  end if;

  -- Idempotency: same (profile, emoji) pair already present → no-op.
  select exists (
    select 1
    from jsonb_array_elements(existing_reactions) e
    where (e->>'emoji') = p_emoji
      and (e->>'byProfileId') = p_by_profile_id::text
  ) into already_reacted;

  if already_reacted then
    return;
  end if;

  update public.kudos
  set reactions = existing_reactions || jsonb_build_object(
    'emoji', p_emoji,
    'byProfileId', p_by_profile_id::text,
    'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
  where id = p_kudos_id;
end;
$$;

-- create or replace preserves the existing ACL; restate for clarity/idempotency.
revoke all on function public.kudos_add_reaction(text, text, uuid) from public;
grant execute on function public.kudos_add_reaction(text, text, uuid) to authenticated;

-- ── search_path hardening (body unchanged) ────────────────────────────
alter function public.kudos_fairness_window_enforce() set search_path = public, pg_temp;
alter function public.check_chat_rate_limit() set search_path = public, pg_temp;
alter function public.record_chat_usage(integer, text) set search_path = public, pg_temp;
alter function public.peek_chat_usage() set search_path = public, pg_temp;
