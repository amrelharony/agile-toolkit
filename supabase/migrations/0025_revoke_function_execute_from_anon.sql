-- 0025_revoke_function_execute_from_anon.sql
--
-- Close the SECURITY DEFINER EXECUTE gap on the service-role-only RPCs.
--
-- WHY `revoke ... from public` WAS NOT ENOUGH
-- ------------------------------------------
-- Supabase provisions every project with:
--
--   alter default privileges for role postgres in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--
-- That is an EXPLICIT grant to the `anon` and `authenticated` roles — it is
-- not a grant to PUBLIC. `REVOKE ALL ON FUNCTION ... FROM public` therefore
-- does not touch it, so every function created by migrations 0002-0024 that
-- used the `from public` form alone remained EXECUTE-able by the anon key.
--
-- `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships in the client bundle, so "anon can
-- execute" means "anyone on the internet can execute". The worst case is
-- `purge_old_history_events`: it is SECURITY DEFINER (RLS does not apply),
-- takes a caller-supplied retention interval, and has no user_id predicate,
-- so an unauthenticated POST to /rest/v1/rpc/purge_old_history_events with
-- {"retention":"00:00:00"} would delete every history_events row for every
-- user.
--
-- Migrations 0020 and 0021 already write the correct form
-- (`revoke all on function ... from public, anon`); this migration brings the
-- remaining service-role-only functions in line. Idempotent — REVOKE on an
-- already-revoked privilege is a no-op.
--
-- Verify afterwards with:
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' order by 1;

-- ── Service-role-only maintenance RPCs ──────────────────────────────────────
revoke execute on function public.purge_old_history_events(interval)
  from anon, authenticated;
revoke execute on function public.purge_expired_rooms()
  from anon, authenticated;

-- ── PAT resolution ──────────────────────────────────────────────────────────
-- Both overloads are the MCP bearer-token oracle: given a token hash they
-- return user_id, squad_profile_ids and access_level. Only the server (which
-- holds the service-role key) has any business calling them.
revoke execute on function public.resolve_pat(text)
  from anon, authenticated;
revoke execute on function public.resolve_pat(text, text)
  from anon, authenticated;

-- ── Signup trigger ──────────────────────────────────────────────────────────
-- Postgres refuses a direct call on a trigger-returning function, so this is
-- defence in depth rather than a live hole.
revoke execute on function public.handle_new_user()
  from anon, authenticated;

-- ── Kudos reactions ─────────────────────────────────────────────────────────
-- `authenticated` is the intended caller and keeps its grant. Revoking `anon`
-- also closes the 0024 owner-guard bypass: that function treats
-- `auth.uid() is null` as "service-role caller → unrestricted", but auth.uid()
-- is equally NULL for `anon`, so an anon caller with EXECUTE landed in the
-- unrestricted branch and could append forged reactions to any kudos row.
revoke execute on function public.kudos_add_reaction(text, text, uuid)
  from anon;

-- NOTE: `public.lookup_share_token(text)` deliberately KEEPS its anon grant —
-- guest share links resolve through it before any session exists, and it
-- returns zero rows for expired/revoked tokens (see 0007). The chat-usage
-- functions were already revoked correctly in 0020/0021.
