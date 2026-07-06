-- Agile Toolkit — kudos_add_reaction owner guard (audit follow-up).
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- `kudos_add_reaction` (0016) is SECURITY DEFINER, looks the kudos row up
-- by id ALONE, and is granted EXECUTE to `authenticated`. The ownership
-- check lives only in the API route (/api/kudos/[id]/reactions), so any
-- authenticated (allowlisted) user could bypass it by calling the RPC
-- directly through PostgREST — appending reactions to ANOTHER owner's
-- kudos (multiple owners can share one Supabase project via
-- AUTHORIZED_EMAILS), forging `byProfileId`, or padding a foreign card
-- to the 24-reaction cap so nobody else can react.
--
-- Fix: enforce ownership INSIDE the function. `auth.uid()` reads the
-- caller's JWT claims and is unaffected by SECURITY DEFINER:
--   * authenticated caller  → auth.uid() = their uid → must own the row.
--   * service-role caller   → auth.uid() IS NULL     → unrestricted
--     (the guest routes authorize via invite before delegating here).
-- A row that exists but isn't owned raises the same `kudos.not_found`
-- as a missing row, so an unauthorised caller can't distinguish
-- "not mine" from "doesn't exist".
--
-- Idempotent: create or replace + explicit revoke/grant.

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
  -- Reject obvious abuse on the SQL side too (the API layer parses
  -- already; this is belt-and-braces against a service-role caller
  -- with a buggy emoji).
  if p_emoji is null or char_length(p_emoji) > 32 then
    raise exception 'kudos.invalid_emoji'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_by_profile_id is null then
    raise exception 'kudos.missing_profile'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Owner guard (see header): an authenticated caller may only touch
  -- rows in their own workspace; the service role (auth.uid() is null)
  -- keeps full reach for the invite-authorized guest path.
  select reactions into existing_reactions
  from public.kudos
  where id = p_kudos_id
    and (auth.uid() is null or owner_id = auth.uid())
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
  where id = p_kudos_id
    and (auth.uid() is null or owner_id = auth.uid());
end;
$$;

revoke all on function public.kudos_add_reaction(text, text, uuid) from public;
grant execute on function public.kudos_add_reaction(text, text, uuid) to authenticated;
-- service_role gets EXECUTE implicitly via its bypassrls + superuser-
-- like grants; the grant above only relaxes the explicit revoke for
-- the owner-authenticated path.
