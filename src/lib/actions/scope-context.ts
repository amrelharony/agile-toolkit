import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Active squad scope for the current MCP call, carried via AsyncLocalStorage.
 *
 * The MCP transport sets this once per `tools/call` — from the verified PAT's
 * `squad_profile_ids` — around the handler invocation. The server-store
 * read/write helpers read it to enforce the hybrid scope model (migration
 * 0024) WITHOUT every handler having to thread the scope through the dozens of
 * `server*` call sites across ~20 tool files (and risk forgetting one — which
 * would be a silent hole in the security boundary). A single chokepoint in
 * server-store, fed by this store, can't be bypassed by adding a new handler.
 *
 * Outside a `runWithScope()` frame — the browser/owner path, or a unit test
 * that calls a helper directly — `currentScopeIds()` returns `[]` = UNSCOPED
 * (owner-equivalent): no read filter, and writes leave `squad_profile_id`
 * untouched. That is the safe, behaviour-preserving default; the only way to
 * get a non-empty scope is for the transport to set it from a real squad-scoped
 * PAT.
 *
 * Node-only (async_hooks). The MCP route runs on the Node runtime, which is
 * the only caller of server-store.
 */
export interface SquadScope {
  /** Squad profiles this call acts as. Empty = unscoped (owner-equivalent). */
  readonly squadProfileIds: readonly string[];
}

const store = new AsyncLocalStorage<SquadScope>();

/**
 * Run `fn` with `squadProfileIds` as the active scope. The store propagates
 * across the awaits inside `fn`, so server-store calls it makes (directly or
 * transitively) observe the scope. Returns whatever `fn` returns (await the
 * result at the call site).
 */
export function runWithScope<T>(squadProfileIds: readonly string[], fn: () => T): T {
  return store.run({ squadProfileIds: [...squadProfileIds] }, fn);
}

/** The active scope's profile ids, or `[]` when unscoped / outside a frame. */
export function currentScopeIds(): readonly string[] {
  return store.getStore()?.squadProfileIds ?? [];
}
