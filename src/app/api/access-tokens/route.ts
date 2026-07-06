import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { generateRawToken, generateSalt, hashTokenWithSalt, prefixOf } from "@/lib/mcp/pat";
import { isAccessLevel, type AccessLevel } from "@/lib/mcp/capability";

/**
 * Personal access token CRUD (list + create). Delete lives at /[id].
 *
 * Auth: standard Supabase session + email allowlist. The MCP endpoint
 * itself uses bearer PATs; this endpoint mints them.
 */

export async function GET() {
  let user, supabase;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const { data, error } = await supabase
    .from("access_tokens")
    .select(
      "id, name, prefix, created_at, last_used_at, expires_at, revoked_at, squad_profile_ids, access_level"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    // Don't echo Supabase error text — column names and constraint codes
    // are an information-disclosure channel for an attacker probing the
    // schema. Log server-side, return a generic code to the client.
    // eslint-disable-next-line no-console
    console.error("[access-tokens GET] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  return Response.json({ tokens: data ?? [] });
}

export async function POST(req: NextRequest) {
  let user, supabase;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as {
    name?: unknown;
    expiresAt?: unknown;
    squadProfileIds?: unknown;
    accessLevel?: unknown;
  };
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
  if (!name) {
    return Response.json({ error: "name_required" }, { status: 400 });
  }

  // Operation ceiling (migration 0022). Defaults to 'full' (read+write+intent)
  // — the pre-0022 behaviour. 'write' blocks intents; 'read' blocks all
  // mutation. Enforced server-side by the MCP route, not just advisory.
  const accessLevel: AccessLevel = isAccessLevel(b.accessLevel) ? b.accessLevel : "full";
  // Default expiration: 90 days. A token with `expires_at = null` lives
  // forever; if it leaks, the only mitigation is manual revocation. A
  // 90-day default means a forgotten/leaked token self-expires within a
  // quarter. Callers who genuinely want a long-lived token can pass an
  // explicit ISO date.
  const DEFAULT_TTL_DAYS = 90;
  const MAX_TTL_DAYS = 365;
  let expiresAt: string | null = null;
  if (typeof b.expiresAt === "string") {
    // Validate + clamp. An unparseable string would otherwise reach the
    // timestamptz column and surface as a generic 500 (should be a 400),
    // and an arbitrarily far-future date would silently defeat the
    // self-expiry mitigation documented above — cap at 365 days out.
    const ms = Date.parse(b.expiresAt);
    if (!Number.isFinite(ms)) {
      return Response.json({ error: "invalid_expires_at" }, { status: 400 });
    }
    const maxMs = Date.now() + MAX_TTL_DAYS * 24 * 60 * 60 * 1000;
    expiresAt = new Date(Math.min(ms, maxMs)).toISOString();
  } else {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + DEFAULT_TTL_DAYS);
    expiresAt = d.toISOString();
  }

  // Squad scope (added in migration 0018). Optional — empty array means
  // unscoped (full workspace reach, owner-equivalent). When non-empty
  // we accept any uuid-shaped strings; the DB constraint enforces type.
  // We do NOT verify here that the squad profiles actually belong to
  // this user — RLS on squad_profiles will prevent the owner from
  // creating a PAT against someone else's profile, and the worst case
  // (typo'd uuid) is that the PAT has a scope no handler can match,
  // which is a harmless dead-end rather than a privilege escalation.
  let squadProfileIds: string[] = [];
  if (Array.isArray(b.squadProfileIds)) {
    squadProfileIds = b.squadProfileIds
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter((s) =>
        // Cheap uuid-v4 shape check; not authoritative — the column
        // is uuid[] so Postgres rejects anything malformed regardless.
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
      );
  }

  const raw = generateRawToken();
  // BUG-A3: per-token salt for new tokens. Existing tokens (minted
  // before migration 0008) keep verifying via the legacy fixed-salt
  // back-compat path in verifyBearer().
  const salt = generateSalt();
  const hash = hashTokenWithSalt(raw, salt);
  const prefix = prefixOf(raw);

  const { data, error } = await supabase
    .from("access_tokens")
    .insert({
      user_id: user.id,
      name,
      token_hash: hash,
      salt,
      prefix,
      expires_at: expiresAt,
      squad_profile_ids: squadProfileIds,
      access_level: accessLevel,
    })
    .select(
      "id, name, prefix, created_at, last_used_at, expires_at, revoked_at, squad_profile_ids, access_level"
    )
    .single();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[access-tokens POST] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  // CRITICAL: this is the only time the raw token is sent to the client.
  // We never persist it server-side. If the user loses it, they revoke
  // and mint a new one.
  return Response.json({ token: data, rawToken: raw });
}
