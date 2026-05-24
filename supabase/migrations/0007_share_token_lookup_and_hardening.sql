-- Agile Toolkit — Security hardening: bearer-token lookup + index/grant fixes
--
-- ══════════════════════════════════════════════════════════════════════
-- BUG-S14 (CRITICAL): close the open share_tokens enumeration hole
-- ══════════════════════════════════════════════════════════════════════
-- The `valid_tokens_visible_for_lookup` policy in 0003 permits SELECT on
-- ANY row where `revoked_at is null and expires_at > now()` to BOTH anon
-- and authenticated. The intent was "you can look up a row IF you know
-- the token", but RLS has no `WHERE token = $1` enforcement primitive,
-- so a hostile client could simply `SELECT *` and harvest every valid
-- bearer in the database, then visit any board_id with any role.
--
-- Fix: drop the open SELECT and gate token lookup behind a SECURITY
-- DEFINER function that REQUIRES the caller to supply the token. The
-- function returns the matching row or nothing — there is no enumeration
-- surface.
--
-- The "issuers see their own tokens" policy stays in place so the
-- Share modal's "my active links" UI still works for authenticated users.

drop policy if exists "valid_tokens_visible_for_lookup" on public.share_tokens;

create or replace function public.lookup_share_token(p_token text)
  returns table (
    token       text,
    board_id    text,
    role        text,
    expires_at  timestamptz,
    created_at  timestamptz,
    revoked_at  timestamptz
  )
  language sql
  security definer
  set search_path = public, pg_temp
  stable
as $$
  -- Equality lookup by primary key — single index hit; no scan path.
  -- The function returns 0 rows for expired / revoked tokens so the
  -- caller can treat "no row" as "invalid bearer".
  select t.token, t.board_id, t.role, t.expires_at, t.created_at, t.revoked_at
  from public.share_tokens t
  where t.token = p_token
    and t.revoked_at is null
    and t.expires_at > now();
$$;

comment on function public.lookup_share_token(text) is
  'Bearer-token lookup. Returns the row only if caller supplies a token that matches; otherwise empty. Replaces the previous open SELECT policy that allowed anyone to enumerate valid tokens.';

revoke all on function public.lookup_share_token(text) from public;
grant  execute on function public.lookup_share_token(text) to anon, authenticated;

-- Now that SELECT goes through the function, revoke direct table SELECT
-- from anon. The `issuers_see_own_tokens` policy keeps issuers' "my links"
-- UI working for authenticated users.
revoke select on table public.share_tokens from anon;

-- ══════════════════════════════════════════════════════════════════════
-- BUG-S12: drop the redundant non-unique index on access_tokens.token_hash
-- ══════════════════════════════════════════════════════════════════════
-- Postgres automatically creates a UNIQUE btree index for the inline
-- `unique` constraint on access_tokens.token_hash (see 0006 line 60).
-- The explicit `create index access_tokens_hash_idx` at 0006 lines 72-73
-- creates a SECOND non-unique btree on the same column. Wasteful storage
-- and double the write amplification on every PAT issuance / last_used_at
-- update. Drop the redundant index; the unique one keeps lookups fast.

drop index if exists public.access_tokens_hash_idx;

-- ══════════════════════════════════════════════════════════════════════
-- BUG-S16: harden purge_expired_rooms()
-- ══════════════════════════════════════════════════════════════════════
-- The original function in 0001 was `security definer` without a pinned
-- search_path and without revoking PUBLIC EXECUTE. A hostile session
-- with `search_path = attacker_schema, public` could resolve `rooms` to
-- a different table before invocation. Defense-in-depth gap.

create or replace function public.purge_expired_rooms()
  returns void
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  delete from public.rooms where expires_at < now();
$$;

revoke all on function public.purge_expired_rooms() from public;
grant  execute on function public.purge_expired_rooms() to service_role;
