-- 0026_realtime_room_authorization.sql
--
-- Realtime Authorization for PRIVATE channels (part 2 of the room hardening).
--
-- Every Realtime room used to be a public channel: anyone holding the anon
-- key (it ships in the client bundle) and a channel name could join. Part 1
-- made the names unguessable. This part makes Supabase itself check who
-- joins: the client opens rooms as private channels (`config: { private:
-- true }`), and Realtime then asks the RLS policies on `realtime.messages`
-- below whether the caller's JWT may receive (select) or send (insert) on
-- the topic, i.e. `realtime.topic()`, the channel name as the client gave it.
--
-- WHO GETS IN (public.realtime_room_allowed):
--   * `visitor:%`  anyone. Visitor rooms are code-gated by design: the room
--                  code is the secret, and visitors have no identity at all,
--                  so they join with the bare anon key (role `anon`).
--   * `tool:%`     the owner, holding a room token minted by
--                  POST /api/realtime/token with `room_owner: true`.
--   * listed       a squad guest, holding a room token minted by
--                  POST /api/guest/realtime-token whose `rooms` array lists
--                  exactly the topics the server checked against their
--                  invites.
--   * own feeds    a signed-in user (role `authenticated`, their own Supabase
--                  session JWT) on `user-sync:<their id>`,
--                  `history:<their id>` and `agent-conversations-live`.
--
-- Room tokens are HS256 JWTs signed by our server with the project's legacy
-- JWT secret (SUPABASE_JWT_SECRET), `iss = 'agile-toolkit'`. Their role is
-- `anon` ON PURPOSE: Realtime runs these policies as the token's role, and a
-- leaked room token used against the REST API is then worth no more than the
-- public anon key. That is why both policies are granted to `anon` as well as
-- `authenticated`. The room claims are honoured only with our `iss`, so no
-- token Supabase Auth issues can ever carry them.
--
-- SAFE TO APPLY WHILE THE CLIENT FLAG IS OFF: RLS on realtime.messages is
-- consulted for private channels only. Public channels (everything today,
-- with NEXT_PUBLIC_PRIVATE_ROOMS unset) and postgres_changes are untouched.
-- Policies are permissive, so they add to any that already exist.
--
-- That claim needs one fix elsewhere, at the end of this file: the 0019
-- mcp_call_log read policy applied to `anon` and trusted auth.uid(), which a
-- room token's `sub` would satisfy. It is now `to authenticated`.
--
-- 0025 NOTE: 0025 revoked EXECUTE from `anon` on the service-role-only RPCs.
-- This function must stay EXECUTE-able by `anon` and `authenticated`, or the
-- policy errors for every join, so the grant below is explicit rather than
-- left to Supabase's default privileges.
--
-- Idempotent: create or replace, drop policy if exists, re-grant.

create or replace function public.realtime_room_allowed(topic text)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Every branch is null-safe: no JWT, a missing claim or a null topic make
  -- that branch null or false, and the coalesce turns "unknown" into false.
  select coalesce(
    -- Visitor rooms: code-gated, joinable with the plain anon key.
    topic like 'visitor:%'

    -- Owner room token: any tool room.
    or (
      (auth.jwt() ->> 'iss') = 'agile-toolkit'
      and (auth.jwt() ->> 'room_owner') = 'true'
      and topic like 'tool:%'
    )

    -- Guest room token: exactly the topics in its `rooms` array. The CASE
    -- guarantees jsonb_array_elements_text never sees a non-array (it raises
    -- on a scalar, and AND does not promise evaluation order).
    or (
      (auth.jwt() ->> 'iss') = 'agile-toolkit'
      and case
        when jsonb_typeof(auth.jwt() -> 'rooms') = 'array' then exists (
          select 1
          from jsonb_array_elements_text(auth.jwt() -> 'rooms') as allowed(room)
          where allowed.room = topic
        )
        else false
      end
    )

    -- The signed-in owner's own feeds, on their Supabase session JWT. Compared
    -- as text (`sub`) rather than through auth.uid(), whose uuid cast would
    -- raise on a malformed subject. Room tokens are role `anon`, so they never
    -- reach these feeds.
    or (
      (auth.jwt() ->> 'role') = 'authenticated'
      and (auth.jwt() ->> 'sub') is not null
      and topic in (
        'user-sync:' || (auth.jwt() ->> 'sub'),
        'history:' || (auth.jwt() ->> 'sub'),
        'agent-conversations-live'
      )
    ),
    false
  );
$$;

comment on function public.realtime_room_allowed(text) is
  'Realtime Authorization for private channels: may the caller''s JWT use this topic? See migration 0026.';

-- Explicit, because the policies run as `anon` and `authenticated` (see the
-- 0025 note above). The function reads only the caller's own JWT claims, so
-- letting anyone call it reveals nothing.
grant execute on function public.realtime_room_allowed(text) to anon, authenticated, service_role;

-- ── Policies on realtime.messages ───────────────────────────────────────────
-- Guarded so a database without Realtime (a bare self-hosted Postgres) still
-- applies the rest of the migration. Hosted Supabase always has the table.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0026: realtime.messages not found; skipping the Realtime room policies';
    return;
  end if;

  -- Receive (broadcast and presence) on a private channel.
  execute 'drop policy if exists "realtime_rooms_select" on realtime.messages';
  execute $policy$
    create policy "realtime_rooms_select"
      on realtime.messages
      for select
      to anon, authenticated
      using (public.realtime_room_allowed((select realtime.topic())))
  $policy$;

  -- Send (broadcast, presence track) on a private channel.
  execute 'drop policy if exists "realtime_rooms_insert" on realtime.messages';
  execute $policy$
    create policy "realtime_rooms_insert"
      on realtime.messages
      for insert
      to anon, authenticated
      with check (public.realtime_room_allowed((select realtime.topic())))
  $policy$;
end $$;

-- ── Keep a leaked room token worthless outside Realtime ─────────────────────
-- A room token is role `anon` but carries a real `sub` (the owner's user id,
-- or a guest's profile id), so auth.uid() is NOT null for it. That only stays
-- harmless while no policy or function reachable by `anon` trusts auth.uid().
-- Every table policy is scoped `to authenticated` (and those tables revoke
-- anon) except mcp_call_log_select_own from 0019, which has no TO clause and
-- so applies to PUBLIC: an owner room token sent to PostgREST would read the
-- owner's MCP call log. Scope it like the others, and revoke anon's table
-- grant as 0002/0006/0016 do for theirs. Only the service role writes there.
do $$
begin
  if to_regclass('public.mcp_call_log') is null then
    return;
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'mcp_call_log'
      and policyname = 'mcp_call_log_select_own'
  ) then
    alter policy mcp_call_log_select_own on public.mcp_call_log to authenticated;
  end if;
  revoke all on table public.mcp_call_log from anon;
end $$;
