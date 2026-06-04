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
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";

const MAX_BODY_BYTES = 65_536; // 64 KiB — redeem body is ~150 bytes; cap is generous.

export async function POST(req: NextRequest) {
  const admin = getSquadAdminClient();
  if (!admin) {
    return Response.json({ error: "service_unavailable" }, { status: 503 });
  }

  // The caller has no profile id yet — key the bucket on the remote IP so a
  // single host can't spam profile creation. Prefer `x-real-ip`, which the
  // fronting proxy (Vercel/Cloudflare) sets from the verified client IP and
  // overwrites if a client tries to supply it. Fall back to the first
  // `x-forwarded-for` entry only when x-real-ip is absent. Keying on a
  // client-controllable value would hand an attacker a fresh rate-limit
  // bucket per request, defeating both the per-IP and per-(IP,code) limits.
  const realIp = req.headers.get("x-real-ip")?.trim();
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (realIp || fwd?.split(",")[0]?.trim() || "unknown").slice(0, 64);
  if (!consumeGuestRateToken(`ip:${ip}`)) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "60" } }
    );
  }

  let body: unknown;
  try {
    // Enforce the cap WHILE streaming, independent of Content-Length — a
    // chunked/header-less client otherwise bypasses the size guard entirely
    // (this route is unauthenticated, so the body cap is the front-line
    // protection against a buffer-the-stream DoS).
    body = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return Response.json({ error: "body_too_large" }, { status: 413 });
    }
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
