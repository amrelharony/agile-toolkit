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
 *
 * Tool stores (`createPersistedStore` blobs in `user_state`, keyed by
 * "agile-toolkit:<name>") are written only through
 * `serverPatchUserStateBlob`, and only for the keys on
 * `SERVER_WRITABLE_BLOB_KEYS`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { jsonBytes } from "@/lib/utils/json-bytes";

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
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await c
      .from("user_entities")
      .select("payload, updated_at, deleted")
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("entity_id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data || (data as { deleted: boolean }).deleted) return null;
    const row = data as { payload: T; updated_at: string };
    const baseVersion = row.payload.version ?? 0;
    const next = { ...mutate(row.payload), version: baseVersion + 1 };
    const { data: updated, error: upErr } = await c
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
      .eq("updated_at", row.updated_at) // CAS: only if no one wrote since our read
      .select("entity_id");
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
 *
 * The blob adapter stores a FLAT `{ teamName, maturityLevel }` payload
 * (workspace-store.ts getSnapshot), so we return it as-is.
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
 * A tool's cloud-synced `usePersisted` blob (a `user_state` row by its
 * store key, e.g. "agile-toolkit:dod-builder"), or null when the user has
 * none. Agents read a tool that hasn't moved into the workspace; a tool on
 * SERVER_WRITABLE_BLOB_KEYS is written with serverPatchUserStateBlob.
 */
export async function serverGetUserStateBlob(
  userId: string,
  storeKey: string
): Promise<unknown | null> {
  const { data, error } = await admin()
    .from("user_state")
    .select("payload")
    .eq("user_id", userId)
    .eq("store_key", storeKey)
    .maybeSingle();
  if (error) throw error;
  return (data as { payload?: unknown } | null)?.payload ?? null;
}

/**
 * Tool stores the server may write: `createPersistedStore` keys
 * ("agile-toolkit:<name>") whose page applies a remote row. Never a core
 * store or a moved store's old blob.
 *
 * An allow list, not a pattern: "agile-toolkit:workspace" (browser-local),
 * ":workspace:scalars" (serverPatchWorkspaceBlob's own row), ":history",
 * ":llm" and the old DoD Builder blob ("agile-toolkit:dod-builder",
 * DOD_LEGACY_KEY, kept as a backup since its data moved into the workspace)
 * all look like tool keys. A tool joins when its MCP write verbs move onto
 * `serverPatchUserStateBlob`, one key per line.
 */
export const SERVER_WRITABLE_BLOB_KEYS: readonly string[] = [
  "agile-toolkit:card-decks", // CARD_DECKS_STORE_KEY: deal, shuffle and add_card (P2.0c)
  "agile-toolkit:relative-sizing", // RELATIVE_SIZING_STORE_KEY: create_board, place, set_bucket_points and apply_sizes (P2.1)
];

/**
 * The most a server blob write may grow a row to, as `jsonBytes` measures
 * it: half the database's 1 MB cap on `user_state.payload`
 * (0005_user_state.sql), which measures the stored jsonb text, a little
 * longer than compact JSON. The browser saves up to the database's cap, so a
 * row can already be bigger: a write over this cap is refused only when it is
 * also bigger than the row it replaces (never refuse a write only because it
 * came over MCP).
 */
export const USER_STATE_BLOB_MAX_BYTES = 512 * 1024;

/** What `serverPatchUserStateBlob` did: wrote `payload`, or wrote nothing and why. */
export type BlobPatchResult<T> =
  | { written: true; payload: T }
  | { written: false; reason: "unchanged" | "too_large" };

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * The compare-and-set loop every `user_state` write goes through. Reads the
 * row, runs `mutate` on its payload (null when there is no row), and writes
 * the result back:
 * - no row: insert. If a concurrent writer beats us to it, the
 *   (user_id, store_key) primary key refuses our insert (23505) and we loop
 *   to take the update path instead;
 * - a row: update ONLY if its `updated_at` is unchanged since the read (the
 *   `touch_sync_updated_at` trigger re-stamps it on every write, so it is the
 *   CAS token). Zero rows back means another writer got there first: re-read
 *   and run `mutate` again on the winner's payload.
 * `mutate` returning null writes nothing ("unchanged"); a result over
 * `maxBytes` that is also bigger than the row it read writes nothing
 * ("too_large"), while one that doesn't grow the row is written. Throws after
 * `maxAttempts` lost races (a hot row under sustained contention: vanishingly
 * rare for one user).
 */
async function casUserState<T>(
  userId: string,
  storeKey: string,
  mutate: (current: unknown | null) => T | null,
  maxAttempts: number,
  { maxBytes = Infinity, what }: { maxBytes?: number; what: string }
): Promise<BlobPatchResult<T>> {
  const c = admin();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error: readErr } = await c
      .from("user_state")
      .select("payload, updated_at")
      .eq("user_id", userId)
      .eq("store_key", storeKey)
      .maybeSingle();
    if (readErr) throw readErr;

    const row = data as { payload?: unknown; updated_at: string } | null;
    const current = row?.payload ?? null;
    const next = mutate(current);
    if (next === null) return { written: false, reason: "unchanged" };
    if (maxBytes !== Infinity) {
      const nextBytes = jsonBytes(next);
      // Refuse only a write that is over the cap AND bigger than the row we
      // read. The browser has no cap of its own below the database's, so a
      // row can already be over ours; a write that doesn't grow it (a
      // shuffle that clears a round) is left to the database's own check,
      // just like the page's save. The row is measured only when needed,
      // and again on every attempt, since a lost race brings a new row.
      if (nextBytes > maxBytes && nextBytes > (row ? jsonBytes(current) : 0)) {
        return { written: false, reason: "too_large" };
      }
    }

    if (!row) {
      const { error: insErr } = await c.from("user_state").insert({
        user_id: userId,
        store_key: storeKey,
        payload: next,
        client_id: SERVER_CLIENT_ID,
      });
      if (!insErr) return { written: true, payload: next };
      if ((insErr as { code?: string }).code !== "23505") throw insErr;
      continue;
    }

    const { data: updated, error: upErr } = await c
      .from("user_state")
      .update({
        payload: next,
        client_id: SERVER_CLIENT_ID,
        // Re-stamped server-side by the touch_sync_updated_at trigger.
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("store_key", storeKey)
      .eq("updated_at", row.updated_at) // CAS: only if no one wrote since our read
      .select("store_key");
    if (upErr) throw upErr;
    if (updated && updated.length === 1) return { written: true, payload: next };
    // Lost the race — another writer advanced updated_at. Re-read & retry.
  }
  throw new Error(`[server-store] ${what} did not converge after ${maxAttempts} attempts`);
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
  await casUserState(
    userId,
    WORKSPACE_SCALARS_STORE_KEY,
    (current) => ({ ...asObject(current), ...patch }),
    maxAttempts,
    { what: "workspace blob patch" }
  );
}

/**
 * Write a tool store's cloud blob from the server: Amr's MCP write verbs for
 * a tool that keeps a `createPersistedStore`, with the same compare-and-set
 * as the workspace scalars. Only for keys on `SERVER_WRITABLE_BLOB_KEYS`; any
 * other key throws before a database call.
 *
 * The contract for `mutate`:
 * - it is pure, and runs again on the fresh payload when the write loses a
 *   race (capture the verb's answer in a closure: the last run wins);
 * - it gets null when the user has no row yet;
 * - it returns the WHOLE flat blob, normalised by the store's own
 *   normaliser, with every key of the store's initial state (the browser's
 *   setSnapshot keeps only known keys and merges), or null to write nothing
 *   (an honest refusal: say why in the verb's answer).
 *
 * Open tabs pick the row up over realtime, because its `client_id` is not
 * theirs. Known limit: a tab whose store changed and hasn't pushed yet
 * (mid-debounce) ignores the remote row (BUG-S14 guard) and pushes its own
 * snapshot over it, as with the workspace scalars; a converted verb's
 * description says so.
 *
 * Returns `{written: true, payload}`, or `{written: false, reason}` for
 * "unchanged" (`mutate` returned null) and "too_large" (over `maxBytes`,
 * default `USER_STATE_BLOB_MAX_BYTES`, and bigger than the row it would
 * replace). A write that doesn't grow the row is never "too_large", even on a
 * row the browser already saved past the cap, because the page could save it
 * too. Never refuse a write only because it came over MCP.
 */
export async function serverPatchUserStateBlob<T extends object>(
  userId: string,
  storeKey: string,
  mutate: (current: unknown | null) => T | null,
  opts: { maxAttempts?: number; maxBytes?: number } = {}
): Promise<BlobPatchResult<T>> {
  if (!SERVER_WRITABLE_BLOB_KEYS.includes(storeKey)) {
    throw new Error(
      `[server-store] "${storeKey}" is not a server-writable tool store (SERVER_WRITABLE_BLOB_KEYS)`
    );
  }
  const { maxAttempts = 5, maxBytes = USER_STATE_BLOB_MAX_BYTES } = opts;
  return casUserState(
    userId,
    storeKey,
    (current) => {
      const next = mutate(current);
      if (next !== null && (typeof next !== "object" || Array.isArray(next))) {
        throw new Error(
          `[server-store] blob patch for ${storeKey} must return the store's whole blob as an object`
        );
      }
      return next;
    },
    maxAttempts,
    { maxBytes, what: `blob patch for ${storeKey}` }
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
