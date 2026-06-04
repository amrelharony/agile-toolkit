-- Agile Toolkit — per-PAT operation capability ("access level").
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- Over MCP there is no interactive confirmation channel, so a PAT's
-- `requiresConfirmation` gates are not enforced (see src/lib/actions/context.ts)
-- — a valid token can invoke any write/intent, including destructive ones.
-- This adds a server-side ceiling: a token can be minted read-only (or
-- write-but-no-intents) so a stolen / shared / prompt-injected token can't
-- mutate (or can't run the powerful intent compositions).
--
-- This is ORTHOGONAL to squad scope (0018): scope restricts WHICH data a
-- token sees; access_level restricts WHAT operations it may perform. Both
-- compose. Enforcement landing sites:
--   - src/lib/mcp/pat.ts            verifyBearer returns access_level
--   - src/lib/mcp/capability.ts     level → allowed action category
--   - src/app/api/mcp/route.ts      rejects a tools/call whose action's
--                                   category exceeds the token's level (-32003)
--
-- An empty/legacy value defaults to 'full' (pre-0022 behaviour). Existing
-- tokens are unchanged.

-- ══════════════════════════════════════════════════════════════════════
-- Column
-- ══════════════════════════════════════════════════════════════════════
alter table public.access_tokens
  add column if not exists access_level text not null default 'full'
    check (access_level in ('full', 'write', 'read'));

comment on column public.access_tokens.access_level is
  'Operation ceiling for this PAT: full (read+write+intent, default), write (read+write, no intents), or read (read-only). Enforced by the MCP route per tools/call against the action category. Orthogonal to squad_profile_ids (data scope).';

-- ══════════════════════════════════════════════════════════════════════
-- resolve_pat overloads — return access_level as a fourth column.
--
-- Adding an OUT column changes the return-table signature, so (as in 0018)
-- both overloads must be dropped and recreated rather than CREATE OR REPLACE.
-- ══════════════════════════════════════════════════════════════════════

drop function if exists public.resolve_pat(text, text);
drop function if exists public.resolve_pat(text);

create function public.resolve_pat(p_hash text, p_salt text)
  returns table (token_id uuid, user_id uuid, squad_profile_ids uuid[], access_level text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  return query
    update public.access_tokens
    set last_used_at = now()
    where token_hash = p_hash
      and salt = p_salt
      and revoked_at is null
      and (expires_at is null or expires_at > now())
    returning id, access_tokens.user_id, access_tokens.squad_profile_ids, access_tokens.access_level;
end;
$$;

revoke all     on function public.resolve_pat(text, text) from public;
grant  execute on function public.resolve_pat(text, text) to service_role;

create function public.resolve_pat(p_hash text)
  returns table (token_id uuid, user_id uuid, squad_profile_ids uuid[], access_level text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  return query
    update public.access_tokens
    set last_used_at = now()
    where token_hash = p_hash
      and salt is null
      and revoked_at is null
      and (expires_at is null or expires_at > now())
    returning id, access_tokens.user_id, access_tokens.squad_profile_ids, access_tokens.access_level;
end;
$$;

revoke all     on function public.resolve_pat(text) from public;
grant  execute on function public.resolve_pat(text) to service_role;
