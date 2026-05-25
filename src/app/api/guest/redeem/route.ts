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
 *   409 name_taken               — display_name already active in squad.
 *   429 rate_limited             — too many redemptions from this IP+code.
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
import { consumeGuestRateToken, consumeRedeemAttempt } from "../_rate-limit";

const MAX_BODY_BYTES = 65_536; // 64 KiB — redeem body is ~150 bytes; cap is generous.

export async function POST(req: NextRequest) {
  const admin = getSquadAdminClient();
  if (!admin) {
    return Response.json({ error: "service_unavailable" }, { status: 503 });
  }

  // The caller has no profile id yet — key the bucket on the remote IP
  // so a single host can't spam profile creation. `x-forwarded-for` is
  // honoured because the deployment sits behind Vercel/Cloudflare.
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd?.split(",")[0]?.trim() ?? "unknown").slice(0, 64);
  if (!consumeGuestRateToken(`ip:${ip}`)) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "60" } }
    );
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return Response.json({ error: "body_too_large" }, { status: 413 });
    }
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

  // Per-(IP, code) cap: 10 redemptions/hour. Cheap defense against a
  // hostile script grinding the squad code into a sea of disposable
  // profiles, layered on top of the general per-IP token bucket above.
  if (!consumeRedeemAttempt(`${ip}:${code}`)) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "3600" } }
    );
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
  if (created.error) {
    const status = created.error === "name_taken" ? 409 : 500;
    return Response.json({ error: created.error }, { status });
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
