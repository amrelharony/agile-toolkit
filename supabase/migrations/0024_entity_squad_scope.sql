-- Agile Toolkit — per-entity squad attribution (hybrid PAT scope enforcement).
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- 0018 added `squad_profile_ids` to access_tokens but made scope ADVISORY:
-- no handler filtered on it, so a "scoped" PAT had the exact same data reach
-- as an unscoped owner token (its own 0018 threat-model section admits this).
-- This adds the missing half — a squad tag on each entity row — so the MCP
-- server-store can enforce a HYBRID model:
--
--   • A scoped PAT (squad_profile_ids non-empty) READS rows that are untagged
--     (squad_profile_id IS NULL = the shared/owner workspace) OR tagged with
--     one of its own squad profiles. It never sees a PEER squad's rows.
--   • A scoped PAT WRITES only within its own squad: a create is stamped with
--     the acting squad, and update/delete only affect own-squad rows. Shared
--     rows are read-only to it; peer rows are invisible. This contains the
--     blast radius of a stolen / prompt-injected scoped token.
--   • An unscoped PAT (empty scope, the default) and the browser owner are
--     UNCHANGED: squad_profile_id stays NULL and they see/write everything.
--
-- Enforcement lives in src/lib/actions/server-store.ts (the only module that
-- touches user_entities on the MCP path), reading the active scope from an
-- AsyncLocalStorage set at the transport boundary
-- (src/lib/actions/scope-context.ts). Workspace SCALARS (user_state:
-- teamName, maturityLevel) are intentionally NOT squad-scoped — they are
-- single, workspace-global values.
--
-- The column is nullable with no default, so existing rows (and every owner /
-- unscoped write) remain NULL = shared. There is no backfill cliff: a scoped
-- agent can still read the pre-existing workspace; it just can't see or touch
-- another squad's private rows.

alter table public.user_entities
  add column if not exists squad_profile_id uuid;

comment on column public.user_entities.squad_profile_id is
  'Squad attribution for hybrid PAT scope (migration 0024). NULL = shared/owner workspace row, visible to every scope. Non-NULL = belongs to that squad profile; visible only to an unscoped PAT/owner or a PAT whose scope includes it, and writable only by such a PAT. Set by the MCP server-store from the acting PAT scope; the browser owner path never sets it.';

-- Partial index to keep the scoped read filter
-- (squad_profile_id IS NULL OR squad_profile_id = ANY(scope)) and the
-- own-squad write filter efficient. Only TAGGED rows are indexed — the common
-- NULL/shared rows stay on the existing (user_id, kind) access path, so this
-- index costs nothing for the unscoped owner workload.
create index if not exists user_entities_squad_profile_idx
  on public.user_entities (user_id, kind, squad_profile_id)
  where squad_profile_id is not null;
