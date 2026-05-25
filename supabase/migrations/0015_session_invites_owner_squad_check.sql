-- Agile Toolkit — squad-guest hardening: tighten session_invites
-- insert/update policies to also verify squad ownership.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- The 0011 policies on `session_invites` only enforce
-- `auth.uid() = owner_id`. They do NOT verify that the referenced
-- `squad_id` belongs to the inserter. The "squad belongs to owner"
-- check is enforced in the API route
-- (`src/app/api/sessions/route.ts`), so under the current single-
-- owner middleware lock there is no exploit. Once multi-tenant
-- lands, however, an authenticated user who goes around
-- /api/sessions and queries Supabase directly can INSERT an invite
-- row that points at another owner's squad — cross-tenant
-- authorization bypass.
--
-- This migration tightens both the INSERT WITH CHECK and the
-- UPDATE USING/WITH CHECK clauses to require the referenced squad's
-- owner_id equals the caller. Belt-and-braces alongside the
-- API-layer check.
-- ══════════════════════════════════════════════════════════════════════

drop policy if exists "session_invites_owner_insert" on public.session_invites;
drop policy if exists "session_invites_owner_update" on public.session_invites;

create policy "session_invites_owner_insert"
  on public.session_invites for insert
  to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.squads s
      where s.id = session_invites.squad_id
        and s.owner_id = (select auth.uid())
    )
  );

create policy "session_invites_owner_update"
  on public.session_invites for update
  to authenticated
  using (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.squads s
      where s.id = session_invites.squad_id
        and s.owner_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.squads s
      where s.id = session_invites.squad_id
        and s.owner_id = (select auth.uid())
    )
  );
