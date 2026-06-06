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
 * maturityLevel) cloud-sync as ONE flat JSON blob in `user_state` keyed
 * by `(user_id, store_key='agile-toolkit:workspace:scalars')` — the same
 * store_key the browser's scalars blob adapter registers (see
 * `registerBlobStore({ storeKey: "agile-toolkit:workspace:scalars" })` in
 * workspace-store.ts). It is NOT the localStorage persist `name`
 * ("agile-toolkit:workspace"), which is browser-local and never written
 * to Supabase.
 *
 * Echo suppression: rows written from here carry `client_id =
 * "server-mcp"` so the browser sync engine's per-tab id check won't
 * confuse them with the user's own local writes.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentScopeIds } from "./scope-context";

/**
 * Hybrid squad-scope enforcement (migration 0024). The active scope is read
 * from AsyncLocalStorage (set by the MCP transport from the PAT). Two derived
 * rules:
 *
 *   READ visibility  — a scoped call sees rows that are untagged
 *     (squad_profile_id IS NULL = shared/owner) OR tagged with one of its own
 *     squad profiles. PostgREST `.or()` filter string built here.
 *   WRITE ownership  — a scoped call may mutate ONLY its own squad's rows
 *     (squad_profile_id IN scope); new rows are stamped with the acting squad
 *     (scope[0]). Shared rows are read-only to it; peer rows invisible.
 *
 * An empty scope (unscoped PAT / owner / outside any scope frame) disables
 * both — every helper then behaves exactly as it did pre-0024.
 *
 * The acting squad for a write is the FIRST profile in scope: a squad PAT is
 * normally scoped to one profile (0018), and a multi-profile token is a read
 * union with a single write identity.
 */

/** PostgREST `.or()` predicate for read visibility, or null when unscoped. */
function readVisibilityOr(scope: readonly string[]): string | null {
  if (scope.length === 0) return null;
  // squad_profile_id.is.null OR squad_profile_id.in.(id1,id2,…)
  return `squad_profile_id.is.null,squad_profile_id.in.(${scope.join(",")})`;
}

// Scalars (teamName, maturityLevel) cloud-sync as one flat blob. This key
// MUST equal the storeKey the browser's scalars blob adapter registers
// (registerBlobStore({ storeKey: "agile-toolkit:workspace:scalars" }) in
// workspace-store.ts). Using the localStorage persist `name`
// ("agile-toolkit:workspace") instead — as this did originally — points
// every MCP scalar read/write at an orphaned user_state row the app never
// syncs, so set_team_name / set_maturity_level silently never reach the UI
// and `get` always reads back null.
const WORKSPACE_SCALARS_STORE_KEY = "agile-toolkit:workspace:scalars";
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
 *  entity kind used in user_entities ("workspace:sprint").
 *
 *  The toolId suffix is snake_case but the browser sync engine registers
 *  collections under camelCase kinds (see `registerCollection` in
 *  workspace-store.ts — e.g. "workspace:daciDecision"). We camelCase the
 *  suffix here so MCP server-side writes land on the same `kind` the
 *  browser hydrates from, making MCP→browser round-trip work. Single-word
 *  suffixes (sprint, risk, okr…) are unaffected. */
export function kindFromToolId(toolId: string): string {
  if (!toolId.startsWith("workspace.")) return toolId;
  const suffix = toolId
    .slice("workspace.".length)
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return `workspace:${suffix}`;
}

/** Paginated list of all non-deleted entities of a given kind. */
export async function serverListEntities<T extends { id: string }>(
  userId: string,
  kind: string
): Promise<T[]> {
  const c = admin();
  const visibility = readVisibilityOr(currentScopeIds());
  const out: T[] = [];
  const PAGE = 1000;
  let lastSeenId: string | null = null;
  for (;;) {
    let q = c
      .from("user_entities")
      .select("entity_id, payload, deleted")
      .eq("user_id", userId)
      .eq("kind", kind);
    if (visibility) q = q.or(visibility);
    q = q.order("entity_id", { ascending: true }).limit(PAGE);
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
  let q = admin()
    .from("user_entities")
    .select("payload, deleted")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("entity_id", id);
  const visibility = readVisibilityOr(currentScopeIds());
  if (visibility) q = q.or(visibility);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data || (data as { deleted: boolean }).deleted) return null;
  return (data as { payload: T }).payload;
}

export async function serverUpsertEntity<T extends { id: string }>(
  userId: string,
  kind: string,
  entity: T
): Promise<void> {
  const c = admin();
  const scope = currentScopeIds();
  const base = {
    user_id: userId,
    kind,
    entity_id: entity.id,
    payload: entity,
    client_id: SERVER_CLIENT_ID,
    deleted: false,
    updated_at: new Date().toISOString(),
  };

  if (scope.length === 0) {
    // Unscoped / owner — single upsert that omits squad_profile_id, so an
    // existing row's tag is preserved (not in the update set) and a new row
    // defaults to NULL/shared. Identical to pre-0024 behaviour.
    const { error } = await c
      .from("user_entities")
      .upsert(base, { onConflict: "user_id,kind,entity_id" });
    if (error) throw error;
    return;
  }

  // Scoped — own-squad only. Try to UPDATE an existing own-squad row (never
  // touching squad_profile_id, so the tag is preserved). If none matches,
  // INSERT a new row stamped with the acting squad. A shared (NULL) or peer
  // row with this id is NOT own-squad, so the UPDATE misses and the INSERT
  // hits the (user_id,kind,entity_id) unique constraint → 23505, surfaced as
  // a not-writable error. This makes shared rows read-only and prevents a
  // scoped token from capturing a row out of another scope.
  const { data: updated, error: upErr } = await c
    .from("user_entities")
    .update({
      payload: entity,
      client_id: SERVER_CLIENT_ID,
      deleted: false,
      updated_at: base.updated_at,
    })
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("entity_id", entity.id)
    .in("squad_profile_id", scope as string[])
    .select("entity_id");
  if (upErr) throw upErr;
  if (updated && updated.length === 1) return;

  const { error: insErr } = await c
    .from("user_entities")
    .insert({ ...base, squad_profile_id: scope[0] });
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      throw new Error(
        `Entity "${entity.id}" exists outside this squad's scope and is not writable by this token.`
      );
    }
    throw insErr;
  }
}

/**
 * Optimistic-concurrency read-modify-write for a single entity (audit
 * MEDIUM). Reads the row, applies `mutate`, and writes back ONLY if the
 * row's `updated_at` is unchanged since the read (compare-and-set). On a
 * lost race it re-reads and re-applies `mutate` against the fresh row, so
 * a concurrent writer (the user's browser push, or another agent call)
 * that touched a DIFFERENT field is never clobbered.
 *
 * `updated_at` is the server-side CAS token (a top-level column, always
 * present and exact). `mutate` is responsible for bumping the payload's
 * `version` — the cross-layer LWW token the browser store also honours —
 * so a realtime-delivered row carries a monotonic version and a later
 * stale browser write is rejected by `upsertModel`'s guard.
 *
 * Returns the written payload, or null if the entity is missing/deleted.
 * Throws after `maxAttempts` unresolved conflicts (a hot row under
 * sustained contention — vanishingly rare in the single-user model).
 */
export async function serverVersionedUpdate<T extends { id: string; version?: number }>(
  userId: string,
  kind: string,
  id: string,
  mutate: (current: T) => T,
  maxAttempts = 5
): Promise<T | null> {
  const c = admin();
  // A versioned update is a MUTATION, so it is gated by WRITE ownership, not
  // read visibility: a scoped token may only update its OWN squad's rows
  // (squad_profile_id IN scope), never a shared (NULL) or peer row. Empty
  // scope (owner) applies no filter. squad_profile_id is left out of the
  // UPDATE set so the existing tag is preserved.
  const scope = currentScopeIds();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let sel = c
      .from("user_entities")
      .select("payload, updated_at, deleted")
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("entity_id", id);
    if (scope.length > 0) sel = sel.in("squad_profile_id", scope as string[]);
    const { data, error } = await sel.maybeSingle();
    if (error) throw error;
    if (!data || (data as { deleted: boolean }).deleted) return null;
    const row = data as { payload: T; updated_at: string };
    const baseVersion = row.payload.version ?? 0;
    const next = { ...mutate(row.payload), version: baseVersion + 1 };
    let upd = c
      .from("user_entities")
      .update({
        payload: next,
        client_id: SERVER_CLIENT_ID,
        deleted: false,
        // The `touch_sync_updated_at` BEFORE-UPDATE trigger (migration 0005)
        // re-stamps updated_at := now() server-side, so this value is a no-op
        // placeholder — the DB owns the token. That server now() (microsecond,
        // monotonic) + row-level locking is what makes the CAS sound: under
        // READ COMMITTED a second concurrent writer's `.eq("updated_at", …)`
        // below is re-evaluated against the first writer's committed value and
        // misses, so it re-reads and retries rather than clobbering.
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("entity_id", id)
      .eq("updated_at", row.updated_at); // CAS: only if no one wrote since our read
    if (scope.length > 0) upd = upd.in("squad_profile_id", scope as string[]);
    const { data: updated, error: upErr } = await upd.select("entity_id");
    if (upErr) throw upErr;
    if (updated && updated.length === 1) return next;
    // Lost the race — another writer advanced updated_at. Re-read & retry.
  }
  throw new Error(
    `[server-store] versioned update for ${kind}/${id} did not converge after ${maxAttempts} attempts`
  );
}

/** Soft-delete (tombstone) so other devices reconcile correctly via the
 *  same sync engine path browser writes go through. */
export async function serverDeleteEntity(userId: string, kind: string, id: string): Promise<void> {
  const c = admin();
  const scope = currentScopeIds();
  const now = new Date().toISOString();

  if (scope.length === 0) {
    // Owner — upsert a tombstone (creates one if absent, matching prior
    // behaviour so other devices reconcile a delete even for a never-synced id).
    const { error } = await c.from("user_entities").upsert(
      {
        user_id: userId,
        kind,
        entity_id: id,
        payload: {},
        client_id: SERVER_CLIENT_ID,
        deleted: true,
        updated_at: now,
      },
      { onConflict: "user_id,kind,entity_id" }
    );
    if (error) throw error;
    return;
  }

  // Scoped — only tombstone an existing OWN-squad row (UPDATE, not upsert, so
  // a shared/peer/absent row is a no-op rather than a captured tombstone).
  const { error } = await c
    .from("user_entities")
    .update({ payload: {}, client_id: SERVER_CLIENT_ID, deleted: true, updated_at: now })
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("entity_id", id)
    .in("squad_profile_id", scope as string[]);
  if (error) throw error;
}

/** Upsert many entities. Owner: one round-trip bulk upsert. Scoped: per-row
 *  own-squad upsert (correctness over the single round-trip — MCP bulk sizes
 *  are modest; reuses serverUpsertEntity's scoped create/update rules). */
export async function serverBulkUpsertEntities<T extends { id: string }>(
  userId: string,
  kind: string,
  entities: T[]
): Promise<void> {
  if (entities.length === 0) return;

  if (currentScopeIds().length > 0) {
    for (const e of entities) {
      await serverUpsertEntity(userId, kind, e);
    }
    return;
  }

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
 *
 * The blob adapter stores a FLAT `{ teamName, maturityLevel }` payload
 * (workspace-store.ts getSnapshot), so we return it as-is.
 *
 * NOT squad-scoped (migration 0024): scalars are single, workspace-global
 * values (one team name, one maturity level), so every scope reads/writes the
 * same row. user_state has no squad_profile_id column.
 */
export async function serverGetWorkspaceBlob(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin()
    .from("user_state")
    .select("payload")
    .eq("user_id", userId)
    .eq("store_key", WORKSPACE_SCALARS_STORE_KEY)
    .maybeSingle();
  if (error) throw error;
  const payload = (data as { payload?: unknown } | null)?.payload;
  if (!payload || typeof payload !== "object") return {};
  return payload as Record<string, unknown>;
}

/**
 * Patch fields into the workspace scalar blob. Reads → merges → writes a
 * flat `{ teamName, maturityLevel }` blob, matching the shape the browser
 * scalars blob adapter reads (its setSnapshot pulls those keys directly).
 * `client_id = "server-mcp"` so the browser sync engine applies the write
 * rather than treating it as an echo of its own.
 *
 * Compare-and-set (audit M-3): the blob holds multiple independent fields,
 * so a plain read-merge-write loses data under concurrency — a single MCP
 * batch `[set_team_name, set_maturity_level]` dispatches both handlers in
 * parallel; each reads the same base, merges only its own field, and the
 * later write drops the other field. The CAS guard (`.eq("updated_at", …)` on
 * the value we read, re-stamped server-side by the touch trigger) makes the
 * losing writer re-read the winner's blob and merge onto it instead.
 */
export async function serverPatchWorkspaceBlob(
  userId: string,
  patch: Record<string, unknown>,
  maxAttempts = 5
): Promise<void> {
  const c = admin();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error: readErr } = await c
      .from("user_state")
      .select("payload, updated_at")
      .eq("user_id", userId)
      .eq("store_key", WORKSPACE_SCALARS_STORE_KEY)
      .maybeSingle();
    if (readErr) throw readErr;

    if (!data) {
      // First touch — no row yet. Insert. If a concurrent writer beats us to
      // it, the (user_id, store_key) unique constraint rejects our insert
      // (23505) and we loop to take the update/CAS path instead.
      const { error: insErr } = await c.from("user_state").insert({
        user_id: userId,
        store_key: WORKSPACE_SCALARS_STORE_KEY,
        payload: { ...patch },
        client_id: SERVER_CLIENT_ID,
      });
      if (!insErr) return;
      if ((insErr as { code?: string }).code !== "23505") throw insErr;
      continue;
    }

    const row = data as { payload?: unknown; updated_at: string };
    const current: Record<string, unknown> =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {};
    const merged = { ...current, ...patch };
    const { data: updated, error: upErr } = await c
      .from("user_state")
      .update({
        payload: merged,
        client_id: SERVER_CLIENT_ID,
        // Re-stamped server-side by the touch_sync_updated_at trigger.
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("store_key", WORKSPACE_SCALARS_STORE_KEY)
      .eq("updated_at", row.updated_at) // CAS: only if no one wrote since our read
      .select("store_key");
    if (upErr) throw upErr;
    if (updated && updated.length === 1) return;
    // Lost the race — another writer advanced updated_at. Re-read & merge.
  }
  throw new Error(
    `[server-store] workspace blob patch did not converge after ${maxAttempts} attempts`
  );
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

export { WORKSPACE_SCALARS_STORE_KEY, SERVER_CLIENT_ID };
