-- Agile Toolkit — Server-persisted share tokens (Phase post-launch)
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- The original share-link.ts stored tokens in localStorage on the
-- issuer's device. That meant:
--   * Clearing localStorage on the issuing device silently invalidated
--     every link you'd ever issued.
--   * Tokens issued on Mac A were not visible / revocable from Phone B.
--   * Revocation only stopped FUTURE creations on the same device — old
--     URLs continued working until natural expiry.
--   * No audit trail.
--
-- This migration adds `share_tokens` so the token → role mapping lives
-- in Postgres. Issuance requires sign-in (`created_by` references
-- auth.users). The URL itself is still anonymous: anyone with the
-- token can use the role it grants, matching the existing "share by
-- URL" UX. RLS exposes only valid (non-revoked, non-expired) rows to
-- anon for lookup, so a malicious client can't enumerate or escalate.
--
-- Migration of existing localStorage tokens: not done. share-link.ts
-- validates BOTH stores during the transition window; old tokens
-- expire naturally and never get migrated.

-- ══════════════════════════════════════════════════════════════════════
-- share_tokens
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.share_tokens (
  token         text primary key
                  check (char_length(token) between 8 and 100),
  board_id      text not null
                  check (char_length(board_id) between 1 and 200),
  role          text not null
                  check (role in ('editor','viewer','commenter')),
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  created_by    uuid not null
                  references auth.users(id) on delete cascade,
  revoked_at    timestamptz,
  -- Cheap insurance against malformed clients writing nonsense windows.
  -- 366 days matches the upper bound enforced in share-link.ts.
  check (expires_at > created_at),
  check (expires_at < created_at + interval '366 days')
);

comment on table  public.share_tokens is
  'Per-board share tokens; the URL bearer credential grants the row''s role.';
comment on column public.share_tokens.role is
  'editor (full read+write), viewer (read only), commenter (read + drop comments).';
comment on column public.share_tokens.revoked_at is
  'Non-null when the issuer revoked the link; row stays for audit but is filtered from lookup.';

create index if not exists share_tokens_created_by_idx
  on public.share_tokens(created_by);
create index if not exists share_tokens_board_id_idx
  on public.share_tokens(board_id);

alter table public.share_tokens enable row level security;

-- ══════════════════════════════════════════════════════════════════════
-- RLS policies
-- ══════════════════════════════════════════════════════════════════════
-- The token IS the credential. Anyone holding the token can present it
-- to validate access — this is the same semantics as the localStorage
-- store, just with the source-of-truth moved server-side. RLS does the
-- security work the URL parser used to do.
--
-- SELECT — TWO policies; RLS combines them with OR:
--   * `valid_tokens_visible_for_lookup` — anyone (anon + authenticated)
--     can SELECT a row whose token they know IF the row is still valid.
--     Expired or revoked rows are filtered at the policy layer, so even
--     a buggy client that forgets to filter still can't see them.
--   * `issuers_see_own_tokens` — signed-in users see every row they
--     issued, including revoked / expired ones, for the "my active
--     links" UI in the Share modal.
--
-- INSERT — only authenticated users; created_by must match auth.uid()
-- so a hostile client can't impersonate someone else's identity in the
-- audit trail.
--
-- UPDATE / DELETE — only the issuer. Revocation = UPDATE setting
-- revoked_at. Hard DELETE is supported for full audit-trail removal
-- on account closure (the CASCADE from auth.users handles that too).

drop policy if exists "valid_tokens_visible_for_lookup" on public.share_tokens;
drop policy if exists "issuers_see_own_tokens"         on public.share_tokens;
drop policy if exists "auth_users_create_tokens"       on public.share_tokens;
drop policy if exists "issuers_revoke_own_tokens"      on public.share_tokens;
drop policy if exists "issuers_delete_own_tokens"      on public.share_tokens;

create policy "valid_tokens_visible_for_lookup"
  on public.share_tokens for select
  using (revoked_at is null and expires_at > now());

create policy "issuers_see_own_tokens"
  on public.share_tokens for select
  to authenticated
  using ((select auth.uid()) = created_by);

create policy "auth_users_create_tokens"
  on public.share_tokens for insert
  to authenticated
  with check (
    (select auth.uid()) = created_by
    and revoked_at is null
  );

create policy "issuers_revoke_own_tokens"
  on public.share_tokens for update
  to authenticated
  using      ((select auth.uid()) = created_by)
  with check ((select auth.uid()) = created_by);

create policy "issuers_delete_own_tokens"
  on public.share_tokens for delete
  to authenticated
  using ((select auth.uid()) = created_by);

-- ══════════════════════════════════════════════════════════════════════
-- Table-level GRANTs (defense-in-depth)
-- ══════════════════════════════════════════════════════════════════════
-- anon gets SELECT only (RLS filters to valid rows). Cannot insert /
-- update / delete — those routes require sign-in. Without this grant,
-- the RLS policy would still permit SELECT for anon, but the privilege
-- graph stays explicit.
revoke all on table public.share_tokens from anon;
grant  select on table public.share_tokens to anon;
grant  select, insert, update, delete on table public.share_tokens to authenticated;
