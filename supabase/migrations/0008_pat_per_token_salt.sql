-- Agile Toolkit — per-token PAT salt (BUG-A3 hardening)
--
-- ══════════════════════════════════════════════════════════════════════
-- Why
-- ══════════════════════════════════════════════════════════════════════
-- 0006 hashes PATs with scrypt against a FIXED app-wide salt baked into
-- the application code (`SCRYPT_SALT = "agile-toolkit-pat-v1"`). The
-- security review (BUG-A3) flagged that this defeats scrypt's offline-
-- crack defence: a DB dump becomes a single-target attack rather than
-- per-row salted KDF. At 192 bits of token entropy the practical risk
-- is low, but the design doesn't deliver what the comment promises.
--
-- Fix: add a per-token random salt column. New tokens generate a fresh
-- salt and store it alongside the hash. The hash lookup function
-- accepts a salt argument and computes the lookup hash with it. Old
-- rows (salt is null) continue to verify via the legacy fixed-salt
-- code path in src/lib/mcp/pat.ts — backward compatible so existing
-- PATs aren't invalidated. Roll forward by re-minting tokens at
-- leisure; a later migration can drop the legacy path once the
-- access_tokens table has no rows with salt is null.

alter table public.access_tokens
  add column if not exists salt text
    check (salt is null or char_length(salt) between 16 and 128);

comment on column public.access_tokens.salt is
  'Per-token random salt (base64url, 16+ bytes). Null for tokens minted before 0008 — those verify via the legacy fixed-salt path in src/lib/mcp/pat.ts.';

-- ══════════════════════════════════════════════════════════════════════
-- resolve_pat now takes (p_hash, p_salt) for the new code path AND
-- keeps the single-arg overload for the legacy fixed-salt path so
-- existing tokens keep verifying without a re-issuance window.
--
-- The new overload also asserts that the row's salt matches the one
-- the caller used to compute p_hash — otherwise a fresh-salt token's
-- hash would never match a legacy-salt lookup (or vice versa), so
-- this is correct, but stating the invariant defensively in SQL
-- makes the contract explicit.
-- ══════════════════════════════════════════════════════════════════════

create or replace function public.resolve_pat(p_hash text, p_salt text)
  returns table (token_id uuid, user_id uuid)
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
    returning id, access_tokens.user_id;
end;
$$;

revoke all     on function public.resolve_pat(text, text) from public;
grant  execute on function public.resolve_pat(text, text) to service_role;

-- The single-arg legacy form is retained for back-compat with rows
-- whose salt is null (minted before this migration). The body matches
-- on token_hash AND salt is null so a NEW token can never satisfy the
-- legacy lookup — preserves the constraint that each row verifies via
-- exactly one path.

create or replace function public.resolve_pat(p_hash text)
  returns table (token_id uuid, user_id uuid)
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
    returning id, access_tokens.user_id;
end;
$$;

revoke all     on function public.resolve_pat(text) from public;
grant  execute on function public.resolve_pat(text) to service_role;
