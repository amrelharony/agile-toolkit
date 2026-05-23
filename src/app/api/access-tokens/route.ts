import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { generateRawToken, hashToken, prefixOf } from "@/lib/mcp/pat";

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
    return Response.json({ error: error.message }, { status: 500 });
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
  const expiresAt = typeof b.expiresAt === "string" ? b.expiresAt : null;

  const raw = generateRawToken();
  const hash = hashToken(raw);
  const prefix = prefixOf(raw);

  const { data, error } = await supabase
    .from("access_tokens")
    .insert({
      user_id: user.id,
      name,
      token_hash: hash,
      prefix,
      expires_at: expiresAt,
    })
    .select("id, name, prefix, created_at, last_used_at, expires_at, revoked_at")
    .single();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // CRITICAL: this is the only time the raw token is sent to the client.
  // We never persist it server-side. If the user loses it, they revoke
  // and mint a new one.
  return Response.json({ token: data, rawToken: raw });
}
