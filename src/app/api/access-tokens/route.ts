import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { generateRawToken, generateSalt, hashTokenWithSalt, prefixOf } from "@/lib/mcp/pat";

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
    .select("id, name, prefix, created_at, last_used_at, expires_at, revoked_at")
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
  const b = (body ?? {}) as { name?: unknown; expiresAt?: unknown };
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
  if (!name) {
    return Response.json({ error: "name_required" }, { status: 400 });
  }
  // Default expiration: 90 days. A token with `expires_at = null` lives
  // forever; if it leaks, the only mitigation is manual revocation. A
  // 90-day default means a forgotten/leaked token self-expires within a
  // quarter. Callers who genuinely want a long-lived token can pass an
  // explicit ISO date.
  const DEFAULT_TTL_DAYS = 90;
  let expiresAt: string | null = null;
  if (typeof b.expiresAt === "string") {
    expiresAt = b.expiresAt;
  } else {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + DEFAULT_TTL_DAYS);
    expiresAt = d.toISOString();
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
    })
    .select("id, name, prefix, created_at, last_used_at, expires_at, revoked_at")
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
