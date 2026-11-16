-- 0039_realtime_phase1_rooms.sql
--
-- Admit the five Phase 1 room tools to the visitor branch of the Realtime
-- room policy: Quick Vote (quick-vote, an anonymous vote round), Audience
-- Wall (audience-wall, a wall room: short anonymous posts and upvotes), and
-- Picker, Team Mixer and Card Decks (picker, team-mixer, card-decks, show
-- rooms: the host shows, everyone watches). Their rooms are visitor rooms
-- like every other, `visitor:<tool>:<code>` (src/lib/realtime/vote-room,
-- show-room and wall-room).
--
-- WHY: 0027 and 0028 admit only the topic shape of the tools they list.
-- With NEXT_PUBLIC_PRIVATE_ROOMS=1 (production), a private channel for any
-- other tool is refused, so until this is pushed the new tools' live rooms
-- can't connect (each tool still works on one screen). The regex becomes:
--
--   ^visitor:(planning-poker|retro|health-check|psych-safety|mood-tracker|kano-model|buy-a-feature|hundred-dollar-test|quick-vote|audience-wall|picker|team-mixer|card-decks):[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$
--
-- The tools are listed in the order of VISITOR_TOOLS
-- (src/lib/realtime/visitor-rooms.ts); the test
-- test/realtime/visitor-topic-migration.test.ts checks the newest
-- migration that defines this function agrees with it. A new visitor tool
-- needs a new migration that re-creates this function with the tool added.
-- The number may change when the phase merges (other migrations land too);
-- the test finds the newest one by content, not by name.
--
-- WHAT DOES NOT CHANGE: everything else is 0028's function exactly (and so
-- 0027's and 0026's): every other branch (owner room token, guest room
-- token, the owner's own feeds), the signature, `language sql`, `stable`,
-- `set search_path = ''`, the comment and the explicit grant. The 12-character
-- code shape stays. The policies on realtime.messages already call this
-- function, so they are not touched. Public channels
-- (NEXT_PUBLIC_PRIVATE_ROOMS unset) never consult it, so applying it changes
-- nothing for them.
--
-- The regex is POSIX (`~`, case-sensitive), anchored at both ends. A null
-- topic makes it null, and the coalesce below turns that into false.
--
-- ROLLING BACK: re-run the `create or replace function` block of 0028 in
-- the SQL editor (it is idempotent); the five tools' private channels are
-- refused again. Nothing else needs undoing.
--
-- EMERGENCY BRAKE (see RUNBOOK "Emergency brake"): to stop every visitor
-- room at once, re-create this function without the visitor line (keep
-- `set search_path = ''` and the grant), then undo it by re-running this
-- file's function block.
--
-- Idempotent: create or replace, re-grant.

create or replace function public.realtime_room_allowed(topic text)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Every branch is null-safe: no JWT, a missing claim or a null topic make
  -- that branch null or false, and the coalesce turns "unknown" into false.
  select coalesce(
    -- Visitor rooms: code-gated, joinable with the plain anon key. Only the
    -- app's own tools and 12-character codes (0027; 0028 added Kano,
    -- Buy-a-Feature and the $100 Test; 0039 the Phase 1 room tools).
    topic ~ '^visitor:(planning-poker|retro|health-check|psych-safety|mood-tracker|kano-model|buy-a-feature|hundred-dollar-test|quick-vote|audience-wall|picker|team-mixer|card-decks):[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$'

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
-- 0025 note in 0026). The function reads only the caller's own JWT claims,
-- so letting anyone call it reveals nothing.
grant execute on function public.realtime_room_allowed(text) to anon, authenticated, service_role;
