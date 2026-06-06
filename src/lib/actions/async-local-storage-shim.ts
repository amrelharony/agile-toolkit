/**
 * Client-side no-op stand-in for `node:async_hooks`' AsyncLocalStorage.
 *
 * `scope-context.ts` uses AsyncLocalStorage to carry the MCP squad scope on the
 * Node server. That module is reachable from the BROWSER bundle — the action
 * registry pulls in `server-store`, which imports `scope-context` — so a raw
 * `node:async_hooks` import would make webpack try to bundle a Node builtin for
 * the client and fail the build.
 *
 * next.config.mjs replaces `node:async_hooks` with this module in the CLIENT
 * build only. The browser NEVER opens a scope frame (only the MCP transport,
 * server-side, calls runWithScope), so a no-op is correct: runWithScope just
 * invokes the function, and getStore() returns undefined → currentScopeIds()
 * is `[]` (unscoped). The real AsyncLocalStorage is used untouched on the
 * server, where enforcement actually happens.
 */
export class AsyncLocalStorage<T> {
  run<R>(_store: T, fn: () => R): R {
    return fn();
  }
  getStore(): T | undefined {
    return undefined;
  }
}
