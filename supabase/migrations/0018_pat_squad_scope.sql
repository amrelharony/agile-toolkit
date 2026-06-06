-- Agile Toolkit — squad-scoped Personal Access Tokens.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- The MCP buildout (Phase 0 of the 14-squad parallel sprint) introduces
-- "authorized agent" PATs that act on behalf of a specific squad rather
-- than the workspace owner globally. One workspace owner can mint
-- multiple PATs — one per agent — each scoped to a different squad
-- profile, so e.g. the Sprint-Planning agent and the Incidents agent
-- can both run concurrently against the same workspace without seeing
-- each other's data or attribution.
--
-- An empty `squad_profile_ids` array (the default) preserves the
-- pre-0018 unscoped behaviour: the PAT acts as the owner with full
-- workspace reach. Existing tokens are unchanged.
--
-- Enforcement landing site:
--   - src/lib/mcp/pat.ts          verifyBearer returns the scope
--   - src/lib/mcp/transport-http  sets the scope in AsyncLocalStorage around
--                                 the handler (src/lib/actions/scope-context.ts)
--   - src/lib/actions/context.ts  ctx.squadProfileIds available to handlers
--   - src/lib/actions/server-store.ts  ENFORCES it centrally (migration 0024)
--
-- ══════════════════════════════════════════════════════════════════════
-- Threat model
-- ══════════════════════════════════════════════════════════════════════
-- NOTE (superseded by migration 0024): when this migration shipped, scope
-- was ADVISORY — only stored on the token, with no handler filtering on it,
-- so a scoped PAT had the same data reach as an unscoped one. As of 0024 it
-- is ENFORCED centrally in server-store (the single module that touches
-- user_entities on the MCP path), via a per-entity squad_profile_id tag and a
-- hybrid model: a scoped PAT reads untagged/shared + its own squad's rows and
-- writes only its own squad's rows; it never sees or mutates a peer squad's
-- data. The text below is retained for historical context.
--
-- [historical] The scope is informational at the transport layer: a PAT with
-- scope [profile_A] does not magically prevent a handler from reading data
-- attributable to profile_B if the handler ignores ctx.squadProfileIds.
--
-- Squad-PAT minting is still owner-only (`requireAuthorizedUser`).
-- An attacker who steals a scoped PAT now gets only that scope's slice
-- (shared + own squad). An attacker who steals an unscoped (legacy) PAT still
-- gets full workspace reach — recommend re-minting unscoped PATs with scopes.

-- ══════════════════════════════════════════════════════════════════════
-- Column
-- ══════════════════════════════════════════════════════════════════════
alter table public.access_tokens
  add column if not exists squad_profile_ids uuid[] not null default '{}'::uuid[];

comment on column public.access_tokens.squad_profile_ids is
  'Squad-profile scope for this PAT. Empty array = full workspace access (default; preserves pre-0018 behaviour). Non-empty = the PAT acts as / is attributable to one or more of these squad profiles. Enforced by handlers via ctx.squadProfileIds, not by the transport.';

-- ══════════════════════════════════════════════════════════════════════
-- resolve_pat overloads — return scope as a third column.
--
-- Both overloads (per-token-salt and legacy fixed-salt) are updated so
-- the verifier always receives the scope alongside token_id/user_id.
-- Existing callers that destructure {token_id, user_id} keep working;
-- new callers can also read squad_profile_ids. We CREATE OR REPLACE
-- without dropping first because the (return-table) signature change is
-- backward-incompatible for type lookups — Postgres requires us to
-- explicitly drop and recreate when the OUT type set changes.
-- ══════════════════════════════════════════════════════════════════════

drop function if exists public.resolve_pat(text, text);
drop function if exists public.resolve_pat(text);

create function public.resolve_pat(p_hash text, p_salt text)
  returns table (token_id uuid, user_id uuid, squad_profile_ids uuid[])
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
    returning id, access_tokens.user_id, access_tokens.squad_profile_ids;
end;
$$;

revoke all     on function public.resolve_pat(text, text) from public;
grant  execute on function public.resolve_pat(text, text) to service_role;

create function public.resolve_pat(p_hash text)
  returns table (token_id uuid, user_id uuid, squad_profile_ids uuid[])
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
    returning id, access_tokens.user_id, access_tokens.squad_profile_ids;
end;
$$;

revoke all     on function public.resolve_pat(text) from public;
grant  execute on function public.resolve_pat(text) to service_role;
