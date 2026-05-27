-- Agile Toolkit — Phase 1 of the kudos redesign: Supabase persistence.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- Pre-redesign, kudos lived ONLY in the workspace store (localStorage)
-- and the realtime broadcast channel. That model breaks cross-device
-- continuity (open `/kudos` on a fresh tab → empty wall until the
-- owner's heartbeat fires), prevents the fairness LLM (Phase 3) from
-- reasoning across the full history, and rules out server-side rate
-- limits.
--
-- This table is the cloud truth-after-network — the workspace store
-- stays the optimistic source-of-truth on the hot path, and
-- `lib/kudos/cloud-sync.ts` debounces writes here. RLS is owner-only
-- for direct access; squad-guest writes go through `/api/guest/kudos`
-- using the service-role client (same boundary as squad_profiles /
-- history_events / session_invites — see migrations 0009-0011).
--
-- Idempotent: re-runs cleanly via `if not exists` + `drop policy if
-- exists` before each create.

-- ══════════════════════════════════════════════════════════════════════
-- kudos
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.kudos (
  -- Client-generated nanoid (`kud_<16hex>`); 64-char max matches the
  -- parser's id cap so an oversize id can't sneak past the DB either.
  id                       text primary key
                             check (char_length(id) between 1 and 64),
  owner_id                 uuid not null
                             references auth.users(id) on delete cascade,
  -- Null when the kudos was authored owner-side without a squad
  -- context (still legal — the wall is workspace-wide). Set when
  -- guest-authored so RLS can scope squad-member visibility.
  squad_id                 uuid
                             references public.squads(id) on delete set null,
  -- jsonb so both the seven built-in id strings AND Phase 0's custom
  -- theme objects (id/title/emoji/hex) round-trip cleanly.
  theme                    jsonb not null,
  to_name                  text not null
                             check (char_length(to_name) between 1 and 80),
  to_profile_id            uuid
                             references public.squad_profiles(id) on delete set null,
  from_name                text not null
                             check (char_length(from_name) between 1 and 80),
  from_profile_id          uuid
                             references public.squad_profiles(id) on delete set null,
  team_name                text
                             check (team_name is null or char_length(team_name) <= 80),
  message                  text not null
                             check (char_length(message) between 1 and 2000),
  sent_at                  timestamptz not null,
  version                  int not null default 1
                             check (version in (1, 2)),
  -- Phase 3 LLM advisories — all nullable; the no-AI send path leaves
  -- them empty and the wall renders identically.
  sentiment                jsonb,
  fairness_score_at_send   real
                             check (
                               fairness_score_at_send is null
                               or (fairness_score_at_send between 0 and 1)
                             ),
  llm_dedup_group          uuid,
  -- Phase 5 — depth-1 thread. ON DELETE CASCADE so deleting a parent
  -- takes its replies with it (the wall would otherwise render orphan
  -- replies pointing at a gone parent).
  reply_to                 text
                             references public.kudos(id) on delete cascade,
  -- Reactions live INSIDE the row as a jsonb array. The Phase 5 add-
  -- reaction RPC appends idempotently; we don't normalise to a side
  -- table because reactions are bounded (≤ 24 per kudos, parser-
  -- enforced) and the predominant access pattern is "fetch a row,
  -- render its reactions inline".
  reactions                jsonb not null default '[]'::jsonb,
  inserted_at              timestamptz not null default now()
);

comment on table public.kudos is
  'Recognition cards (Phase 1 kudos redesign). Cloud truth-after-network; workspace store stays the optimistic source on the hot path.';
comment on column public.kudos.squad_id is
  'Set when the kudos was authored via /api/guest/kudos so RLS can scope squad-member visibility. Null for owner-mode workspace-wide writes.';
comment on column public.kudos.reactions is
  'Inline jsonb array, capped at 24 entries by the parser + by the kudos_add_reaction RPC. Each entry: {emoji, byProfileId, at}.';

-- ══════════════════════════════════════════════════════════════════════
-- Indexes — every query path the wall + API uses must hit an index.
-- ══════════════════════════════════════════════════════════════════════
-- Wall fetch: GET /api/kudos ordered by sent_at desc, limit/offset.
create index if not exists kudos_owner_sent_at_idx
  on public.kudos (owner_id, sent_at desc);

-- Per-recipient lookup: header beacon "last 5 received by me".
create index if not exists kudos_to_profile_idx
  on public.kudos (to_profile_id, sent_at desc)
  where to_profile_id is not null;

-- Threading: load all replies to a parent.
create index if not exists kudos_reply_to_idx
  on public.kudos (reply_to, sent_at asc)
  where reply_to is not null;

-- LLM dedup: stack same-group cards on the wall.
create index if not exists kudos_dedup_group_idx
  on public.kudos (llm_dedup_group)
  where llm_dedup_group is not null;

-- Fairness window enforcement covers the same per-(sender, recipient,
-- day) slice the trigger reads — partial index keeps it tight.
create index if not exists kudos_fairness_window_idx
  on public.kudos (from_profile_id, to_profile_id, sent_at desc)
  where from_profile_id is not null and to_profile_id is not null;

alter table public.kudos enable row level security;

-- ══════════════════════════════════════════════════════════════════════
-- Grants — same model as squads / session_invites: owner uses RLS
-- via the authenticated client; guest writes/reactions go through
-- /api/guest/kudos and /api/kudos/[id]/reactions using service-role
-- + the RPC defined below.
-- ══════════════════════════════════════════════════════════════════════
revoke all on table public.kudos from anon;
grant  select, insert, update, delete on table public.kudos to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- RLS policies
-- ══════════════════════════════════════════════════════════════════════
drop policy if exists "kudos_select_owner" on public.kudos;
drop policy if exists "kudos_select_squad_member" on public.kudos;
drop policy if exists "kudos_insert_owner" on public.kudos;
drop policy if exists "kudos_update_owner" on public.kudos;
drop policy if exists "kudos_delete_owner" on public.kudos;

-- Owner reads every row they wrote (or that was written under their
-- workspace via service-role on behalf of a squad guest).
create policy "kudos_select_owner"
  on public.kudos for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- Reserved for a future "authenticated squad member" tier that doesn't
-- exist today (the toolkit is single-owner). Defined so a future
-- migration doesn't have to design RLS from scratch — currently
-- evaluates to false because no authenticated non-owner can match.
create policy "kudos_select_squad_member"
  on public.kudos for select
  to authenticated
  using (
    squad_id is not null
    and exists (
      select 1
      from public.squad_profiles sp
      where sp.squad_id = kudos.squad_id
        -- Place-holder for the future user-linked squad-profile column.
        -- Today no squad_profile carries a user_id, so this branch is
        -- dormant (single-owner toolkit). Keeping the policy keeps the
        -- SELECT chain consistent for when multi-tenant lands.
        and false
    )
  );

-- Owner-side inserts mirror the history_events_insert_self pattern from
-- 0012: if `from_profile_id` is set, require it belongs to a squad the
-- owner controls. Defends against an owner forging guest attribution.
create policy "kudos_insert_owner"
  on public.kudos for insert
  to authenticated
  with check (
    (select auth.uid()) = owner_id
    and (
      from_profile_id is null
      or exists (
        select 1
        from public.squad_profiles sp
        join public.squads s on s.id = sp.squad_id
        where sp.id = kudos.from_profile_id
          and s.owner_id = (select auth.uid())
      )
    )
    and (
      to_profile_id is null
      or exists (
        select 1
        from public.squad_profiles sp
        join public.squads s on s.id = sp.squad_id
        where sp.id = kudos.to_profile_id
          and s.owner_id = (select auth.uid())
      )
    )
    and (
      squad_id is null
      or exists (
        select 1 from public.squads s
        where s.id = kudos.squad_id
          and s.owner_id = (select auth.uid())
      )
    )
  );

-- Updates are owner-only. The reaction-append path uses a SECURITY
-- DEFINER RPC so guests don't need broad UPDATE.
create policy "kudos_update_owner"
  on public.kudos for update
  to authenticated
  using      ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "kudos_delete_owner"
  on public.kudos for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- ══════════════════════════════════════════════════════════════════════
-- Fairness-window trigger: cap (from_profile_id, to_profile_id) to
-- 5 sends per rolling 24 h.
--
-- The trigger fires BEFORE INSERT so the over-budget write never lands.
-- The client surfaces the resulting exception as a soft "you've sent a
-- lot to {name} today — pause?" prompt rather than a hard error toast.
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.kudos_fairness_window_enforce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count int;
begin
  -- Only enforce when both sides are squad-profile identified.
  -- Owner-to-anyone or free-text recipients aren't squad-scoped and
  -- aren't subject to the per-pair window.
  if new.from_profile_id is null or new.to_profile_id is null then
    return new;
  end if;

  select count(*) into recent_count
  from public.kudos
  where from_profile_id = new.from_profile_id
    and to_profile_id = new.to_profile_id
    and sent_at > now() - interval '24 hours';

  if recent_count >= 5 then
    raise exception 'kudos.fairness_window_exceeded'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists kudos_fairness_window on public.kudos;
create trigger kudos_fairness_window
  before insert on public.kudos
  for each row
  execute function public.kudos_fairness_window_enforce();

-- ══════════════════════════════════════════════════════════════════════
-- Reaction RPC — SECURITY DEFINER so the service-role guest path can
-- delegate to it without granting broad UPDATE on the kudos table.
--
-- Idempotent: a guest re-clicking the same emoji their profile already
-- placed is a no-op; a different emoji from the same profile appends.
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.kudos_add_reaction(
  p_kudos_id text,
  p_emoji text,
  p_by_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
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

revoke all on function public.kudos_add_reaction(text, text, uuid) from public;
grant execute on function public.kudos_add_reaction(text, text, uuid) to authenticated;
-- service_role gets EXECUTE implicitly via its bypassrls + superuser-
-- like grants; the grant above only relaxes the explicit revoke for
-- the owner-authenticated path.
