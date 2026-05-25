/**
 * Squad redemption endpoint.
 *
 * POST { code, displayName, color } →
 *   * Validate the squad code against `squads` (must be active).
 *   * Validate display_name and color.
 *   * Create a `squad_profiles` row + mint cookie_secret.
 *   * Set the `agile-toolkit:guest` httpOnly cookie.
 *   * Return { profile: { id, displayName, color, squadName } }.
 *
 * Errors:
 *   400 invalid_input            — malformed body or invalid color/name.
 *   404 squad_not_found          — code didn't resolve or squad revoked.
 *   503 service_unavailable      — service-role client unavailable.
 *   500 server_error             — anything else.
 *
 * The route is in the middleware bypass (/api/guest/*) so it's reachable
 * without a Supabase session, which is the whole point — squad members
 * are NOT Supabase users.
 */

import type { NextRequest } from "next/server";
import {
  findActiveSquadByCode,
  createSquadProfile,
  sanitizeDisplayName,
  isValidColor,
  getSquadAdminClient,
} from "@/lib/squads/server";
import { setGuestSessionCookie } from "@/lib/auth/guest-session";

export async function POST(req: NextRequest) {
  const admin = getSquadAdminClient();
  if (!admin) {
    return Response.json({ error: "service_unavailable" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as { code?: unknown; displayName?: unknown; color?: unknown };

  const code = typeof b.code === "string" ? b.code.trim() : "";
  const displayName = sanitizeDisplayName(b.displayName);
  const color = isValidColor(b.color) ? b.color : null;
  if (!code || !displayName || !color) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const squad = await findActiveSquadByCode(code);
  if (!squad) {
    return Response.json({ error: "squad_not_found" }, { status: 404 });
  }

  const created = await createSquadProfile({
    squadId: squad.id,
    displayName,
    color,
  });
  if (!created) {
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  setGuestSessionCookie(created.row.id, created.cookieSecret);

  return Response.json({
    profile: {
      id: created.row.id,
      displayName: created.row.display_name,
      color: created.row.color,
      avatarSeed: created.row.avatar_seed,
      squadId: squad.id,
      squadName: squad.name,
    },
  });
}
