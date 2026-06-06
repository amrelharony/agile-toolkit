/**
 * Context passed to every action handler.
 *
 * - `userId` is the authenticated user (always present — auth gating
 *   happens at the route layer before the handler runs).
 * - `source` lets handlers branch on caller: a write action invoked from
 *   the UI might trigger a toast; the same action invoked over MCP
 *   skips the toast.
 * - `confirm` is supplied by the in-app agent runtime so handlers
 *   marked `requiresConfirmation: true` can request approval inline
 *   (the UI shows a card; the user clicks Approve/Deny).
 */
export type ActionSource = "ui" | "agent" | "mcp";

export interface ActionContext {
  userId: string;
  source: ActionSource;
  /** Resolves true if approved, false if denied. Only the agent runtime
   *  supplies this; MCP and UI callers leave it undefined and the
   *  handler must assume approval.
   *
   *  SECURITY NOTE: over MCP there is no interactive channel, so
   *  `requiresConfirmation` / `ctx.confirm` gates are NOT enforced — a valid
   *  PAT can invoke destructive/terminal actions with no out-of-band
   *  approval. `requiresConfirmation` is therefore a UI affordance, not a
   *  server-side authorization control. If you need to restrict what a PAT
   *  can do (e.g. a read-only or no-destructive token), gate it at the
   *  transport/route on the action's `category` — do not rely on this hook. */
  confirm?: (summary: string) => Promise<boolean>;
  /** Squad-profile scope for this call. Empty array = unscoped (the
   *  caller has full workspace reach, equivalent to the workspace
   *  owner). Non-empty = the caller is acting as one or more of these
   *  squad profiles. Always defined (an array, possibly empty) so
   *  handlers can read it without null-checks.
   *
   *  Handlers do NOT need to filter on this themselves: over MCP the
   *  transport mirrors it into AsyncLocalStorage (scope-context.ts) and
   *  server-store enforces the hybrid read/write model centrally
   *  (migration 0024) — a scoped call only sees/writes untagged + own-squad
   *  rows. This field is exposed for handlers that want to branch on scope
   *  (e.g. attribution in a custom payload), not for them to re-implement
   *  the isolation. */
  squadProfileIds: string[];
}

export function makeContext(
  userId: string,
  source: ActionSource,
  confirm?: ActionContext["confirm"],
  squadProfileIds: readonly string[] = []
): ActionContext {
  return { userId, source, confirm, squadProfileIds: [...squadProfileIds] };
}
