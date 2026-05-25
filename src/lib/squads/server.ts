/**
 * Server-side squad operations using the service-role Supabase client.
 *
 * Why service-role: guests have no `auth.uid()`, so RLS on squads /
 * squad_profiles is owner-only by design. Every guest data path goes
 * through /api/guest/* routes that mediate access via this module.
 * The route handlers are the authorization boundary; the SQL layer
 * is just storage.
 *
 * Owner-side operations also use this when they need to read a
 * profile by id (e.g. an activity-log lookup that doesn't carry the
 * owner's RLS context for the join).
 */

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

let cachedAdmin: SupabaseClient | null = null;

/**
 * Service-role client. Returns null when env vars are missing so
 * callers can degrade gracefully instead of throwing into the
 * response stream. Cached per process.
 */
export function getSquadAdminClient(): SupabaseClient | null {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedAdmin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

// ──────────────────────────────────────────────────────────────────────
// Validation — pure functions live in ./validate so the client-side
// join form can import them too. Re-exported here so route handlers
// import everything from one place.
// ──────────────────────────────────────────────────────────────────────
export { sanitizeDisplayName, sanitizeSquadName, isValidGuestPathSegment } from "./validate";

// Color palette + validator live in `./colors` so the client-side join
// form can import them without dragging in this server-only module.
export { SQUAD_COLORS, isValidColor } from "./colors";

// ──────────────────────────────────────────────────────────────────────
// Squad CRUD (owner-side)
// ──────────────────────────────────────────────────────────────────────

export interface SquadRow {
  id: string;
  owner_id: string;
  name: string;
  code: string;
  created_at: string;
  revoked_at: string | null;
}

export interface SquadProfileRow {
  id: string;
  squad_id: string;
  display_name: string;
  color: string;
  avatar_seed: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

/** Generate a fresh squad invite code. 32 base64url chars = 192 bits entropy. */
export function generateSquadCode(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Resolve a squad by its bearer code. Returns null when the code is
 * unknown OR the squad has been revoked. Constant-time-ish lookup
 * via unique-index equality — no enumeration vector.
 */
export async function findActiveSquadByCode(code: string): Promise<SquadRow | null> {
  const admin = getSquadAdminClient();
  if (!admin) return null;
  // generateSquadCode always emits exactly 32 base64url chars. Reject
  // any other length pre-DB: the DB constraint allows 16-64 for
  // forward-compat with future code generators, but every real lookup
  // today is exactly 32. Tightening here also narrows the timing
  // oracle (a 32-char unknown code costs a DB hit; everything else
  // returns synchronously, same as a malformed input).
  if (typeof code !== "string" || code.length !== 32) return null;
  const { data, error } = await admin
    .from("squads")
    .select("id, owner_id, name, code, created_at, revoked_at")
    .eq("code", code)
    .single();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  return data as SquadRow;
}

/**
 * Outcome of createSquadProfile. `error` distinguishes the two
 * caller-actionable cases (name collision under the partial unique
 * index from migration 0013, or service-role unavailable / generic
 * insert failure) from the happy path.
 */
export type CreateSquadProfileResult =
  | { row: SquadProfileRow; cookieSecret: string; error: null }
  | { row: null; cookieSecret: null; error: "name_taken" | "server_error" };

/**
 * Create a guest profile under the given squad. Returns the row plus
 * the freshly-minted cookie_secret for the caller to sign the cookie
 * with. The cookie_secret is NEVER returned to the client.
 *
 * On unique-index violation (23505) — same (squad_id, lower(display_name))
 * already active — returns `{ error: "name_taken" }` so the redeem
 * route can surface a 409 to the client.
 */
export async function createSquadProfile(opts: {
  squadId: string;
  displayName: string;
  color: string;
}): Promise<CreateSquadProfileResult> {
  const admin = getSquadAdminClient();
  if (!admin) return { row: null, cookieSecret: null, error: "server_error" };
  const cookieSecret = randomBytes(32).toString("base64url");
  const { data, error } = await admin
    .from("squad_profiles")
    .insert({
      squad_id: opts.squadId,
      display_name: opts.displayName,
      color: opts.color,
      avatar_seed: randomBytes(8).toString("hex"),
      cookie_secret: cookieSecret,
    })
    .select("id, squad_id, display_name, color, avatar_seed, created_at, last_seen_at, revoked_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { row: null, cookieSecret: null, error: "name_taken" };
    }
    return { row: null, cookieSecret: null, error: "server_error" };
  }
  if (!data) return { row: null, cookieSecret: null, error: "server_error" };
  return { row: data as SquadProfileRow, cookieSecret, error: null };
}

/** Update last_seen_at to "now" — best-effort, errors swallowed. */
export async function touchProfileLastSeen(profileId: string): Promise<void> {
  const admin = getSquadAdminClient();
  if (!admin) return;
  await admin
    .from("squad_profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", profileId);
}
