-- Agile Toolkit — squad-guest hardening: per-squad display-name uniqueness.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- Migration 0010 created `squad_profiles` with no uniqueness on the
-- (squad_id, display_name) pair. Two guests redeeming the same squad
-- code could both pick the display name "Alice" — the rows insert
-- successfully, and in every UI surface (activity feed, canvas
-- presence, poker votes) the two profiles render identically. The
-- only differentiator is the per-row UUID, which is never displayed.
-- Net effect: deliberate impersonation inside an owner's squad.
--
-- This migration adds a PARTIAL unique index on
-- (squad_id, lower(display_name)) WHERE revoked_at IS NULL. Partial
-- so that a revoked profile freeing a name lets a new redemption
-- reuse it. `lower()` so case variations ("Alice" vs "alice") collide
-- on insert — sanitizeDisplayName already does NFC + bidi/zero-width
-- stripping but does NOT lowercase by design (display preserves the
-- author's chosen case). Index-level lower() is the cheap fix.
--
-- The application path in `createSquadProfile` catches 23505 and
-- surfaces a 409 `name_taken` to the redeem route — see
-- src/lib/squads/server.ts and src/app/api/guest/redeem/route.ts.

create unique index if not exists squad_profiles_unique_name_idx
  on public.squad_profiles (squad_id, lower(display_name))
  where revoked_at is null;
