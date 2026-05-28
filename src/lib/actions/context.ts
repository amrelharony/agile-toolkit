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
   *  handler must assume approval. */
  confirm?: (summary: string) => Promise<boolean>;
  /** Squad-profile scope for this call. Empty array = unscoped (the
   *  caller has full workspace reach, equivalent to the workspace
   *  owner). Non-empty = the caller is acting as one or more of these
   *  squad profiles; handlers may use this to filter reads and to
   *  attribute writes via history_events.squad_profile_id. Always
   *  defined (an array, possibly empty) so handlers can read it
   *  without null-checks. */
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
