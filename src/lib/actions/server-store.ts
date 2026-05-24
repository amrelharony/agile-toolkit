/**
 * Server-side workspace backing for MCP-invoked actions.
 *
 * The browser Zustand store (`useWorkspaceStore`) is the source of truth
 * for in-app and agent invocations — those run in the user's tab where
 * the store is hydrated from localStorage + Supabase. MCP requests, by
 * contrast, run server-side (Edge/Node lambda) where the Zustand
 * singleton is a fresh empty workspace on every cold start. Reading or
 * writing it would silently no-op for the actual user.
 *
 * This module exposes the same operations the workspace store offers,
 * but reads/writes Supabase directly via the service-role admin client.
 * The MCP route authenticates via PAT (`verifyBearer`) and supplies the
 * resolved userId, so we already know which row to touch — RLS is
 * bypassed deliberately because the user identity has already been
 * proven by the bearer.
 *
 * Entity collections live in `user_entities` keyed by
 * `(user_id, kind, entity_id)`. Workspace scalars (teamName,
 * maturityLevel) live in `user_state` keyed by
 * `(user_id, store_key='agile-toolkit:workspace')` and are merged into
 * a single JSON blob alongside whatever else the browser persist
 * middleware writes there.
 *
 * Echo suppression: rows written from here carry `client_id =
 * "server-mcp"` so the browser sync engine's per-tab id check won't
 * confuse them with the user's own local writes.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const WORKSPACE_STORE_KEY = "agile-toolkit:workspace";
const SERVER_CLIENT_ID = "server-mcp";

let cachedAdmin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "[server-store] SUPABASE_SERVICE_ROLE_KEY not configured — MCP write actions cannot reach the database."
    );
  }
  cachedAdmin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

/** Convert a `defineCrudActions` toolId ("workspace.sprint") to the
 *  entity kind used in user_entities ("workspace:sprint"). */
export function kindFromToolId(toolId: string): string {
  return toolId.replace(/^workspace\./, "workspace:");
}

/** Paginated list of all non-deleted entities of a given kind. */
export async function serverListEntities<T extends { id: string }>(
  userId: string,
  kind: string
): Promise<T[]> {
  const c = admin();
  const out: T[] = [];
  const PAGE = 1000;
  let lastSeenId: string | null = null;
  for (;;) {
    let q = c
      .from("user_entities")
      .select("entity_id, payload, deleted")
      .eq("user_id", userId)
      .eq("kind", kind)
      .order("entity_id", { ascending: true })
      .limit(PAGE);
    if (lastSeenId !== null) q = q.gt("entity_id", lastSeenId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data as Array<{ entity_id: string; payload: unknown; deleted: boolean }>) {
      if (!row.deleted) out.push(row.payload as T);
    }
    lastSeenId = (data[data.length - 1] as { entity_id: string }).entity_id;
    if (data.length < PAGE) break;
  }
  return out;
}

/** Fetch a single entity by id; returns null on missing OR deleted. */
export async function serverGetEntity<T extends { id: string }>(
  userId: string,
  kind: string,
  id: string
): Promise<T | null> {
  const { data, error } = await admin()
    .from("user_entities")
    .select("payload, deleted")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("entity_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || (data as { deleted: boolean }).deleted) return null;
  return (data as { payload: T }).payload;
}

export async function serverUpsertEntity<T extends { id: string }>(
  userId: string,
  kind: string,
  entity: T
): Promise<void> {
  const { error } = await admin().from("user_entities").upsert(
    {
      user_id: userId,
      kind,
      entity_id: entity.id,
      payload: entity,
      client_id: SERVER_CLIENT_ID,
      deleted: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,kind,entity_id" }
  );
  if (error) throw error;
}

/** Soft-delete (tombstone) so other devices reconcile correctly via the
 *  same sync engine path browser writes go through. */
export async function serverDeleteEntity(userId: string, kind: string, id: string): Promise<void> {
  const { error } = await admin().from("user_entities").upsert(
    {
      user_id: userId,
      kind,
      entity_id: id,
      payload: {},
      client_id: SERVER_CLIENT_ID,
      deleted: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,kind,entity_id" }
  );
  if (error) throw error;
}

/** Upsert many entities in one network round-trip. */
export async function serverBulkUpsertEntities<T extends { id: string }>(
  userId: string,
  kind: string,
  entities: T[]
): Promise<void> {
  if (entities.length === 0) return;
  const now = new Date().toISOString();
  const rows = entities.map((e) => ({
    user_id: userId,
    kind,
    entity_id: e.id,
    payload: e,
    client_id: SERVER_CLIENT_ID,
    deleted: false,
    updated_at: now,
  }));
  const { error } = await admin()
    .from("user_entities")
    .upsert(rows, { onConflict: "user_id,kind,entity_id" });
  if (error) throw error;
}

/**
 * Fetch the workspace scalar blob from user_state. Returns an empty
 * object when the user has never written anything (first-touch).
 */
export async function serverGetWorkspaceBlob(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin()
    .from("user_state")
    .select("payload")
    .eq("user_id", userId)
    .eq("store_key", WORKSPACE_STORE_KEY)
    .maybeSingle();
  if (error) throw error;
  const payload = (data as { payload?: unknown } | null)?.payload;
  if (!payload || typeof payload !== "object") return {};
  // The browser persist middleware nests state under `state`. Honour
  // both shapes — older blobs may be raw, newer ones wrapped.
  const raw = payload as Record<string, unknown>;
  if (raw.state && typeof raw.state === "object") {
    return raw.state as Record<string, unknown>;
  }
  return raw;
}

/**
 * Patch fields into the workspace scalar blob. Reads → merges → writes.
 * Preserves the `state` wrapper if the existing blob was already
 * persist-middleware-shaped, so the browser hydration code still parses
 * it correctly on the user's next page load.
 */
export async function serverPatchWorkspaceBlob(
  userId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { data, error: readErr } = await admin()
    .from("user_state")
    .select("payload")
    .eq("user_id", userId)
    .eq("store_key", WORKSPACE_STORE_KEY)
    .maybeSingle();
  if (readErr) throw readErr;
  const existing = (data as { payload?: unknown } | null)?.payload as Record<
    string,
    unknown
  > | null;
  const wrapped = existing && typeof existing === "object" && "state" in existing;
  const innerCurrent: Record<string, unknown> = wrapped
    ? ((existing as { state: Record<string, unknown> }).state ?? {})
    : ((existing as Record<string, unknown>) ?? {});
  const innerNext = { ...innerCurrent, ...patch };
  const payload: Record<string, unknown> = wrapped
    ? { ...(existing as Record<string, unknown>), state: innerNext }
    : innerNext;
  const { error } = await admin().from("user_state").upsert(
    {
      user_id: userId,
      store_key: WORKSPACE_STORE_KEY,
      payload,
      client_id: SERVER_CLIENT_ID,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,store_key" }
  );
  if (error) throw error;
}

/**
 * Compute the next z-index for an object on a board, server-side.
 * Equivalent to `max(z) + 1` across all non-deleted whiteboardObjects
 * with the matching boardId. Used by canvas action mcpHandlers.
 *
 * Doesn't use a SQL MAX() because boardId lives inside the JSON
 * payload — we'd need a GIN-indexed jsonb_path expression. For an MCP-
 * served board with realistic object counts (<10k), a single
 * pagination pass and in-memory max is acceptable.
 */
export async function serverNextZForBoard(userId: string, boardId: string): Promise<number> {
  const all = await serverListEntities<{ id: string; boardId: string; z: number }>(
    userId,
    "workspace:whiteboardObject"
  );
  let max = 0;
  for (const o of all) {
    if (o.boardId !== boardId) continue;
    if (typeof o.z === "number" && o.z > max) max = o.z;
  }
  return max + 1;
}

export { WORKSPACE_STORE_KEY, SERVER_CLIENT_ID };
