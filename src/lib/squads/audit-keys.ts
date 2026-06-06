/**
 * Audit-log key helpers for server-issued history_events rows.
 *
 * `history_events.client_event_id` and `.tool_run_id` are both capped at
 * 32 chars by CHECK constraints (supabase/migrations/0002_auth_history.sql).
 * A full 36-char `gen_random_uuid()` invite id overflows them, so the
 * server-authored invite create/revoke audit rows must use a shortened,
 * still-unique key. (Pure module — safe to import from tests; no
 * `server-only` dependency.)
 */

export type InviteAuditKind = "create" | "revoke";

export interface InviteAuditKeys {
  /** Unique per (user_id, client_event_id) — distinct prefix per kind. */
  clientEventId: string;
  toolRunId: string;
}

/**
 * Build the audit-row keys for an invite create/revoke event. Both stay
 * within the 32-char column constraint; the `inv_c_`/`inv_r_` prefixes keep
 * the create and revoke rows for the SAME invite distinct under the
 * `(user_id, client_event_id)` unique index.
 */
export function inviteAuditKeys(inviteId: string, kind: InviteAuditKind): InviteAuditKeys {
  // 24 hex chars (96 bits) — collision-free in practice, and short enough
  // that the longest key (`inv_c_` + 24 = 30) stays under the 32-char cap.
  const short = inviteId.replace(/-/g, "").slice(0, 24);
  return {
    clientEventId: `inv_${kind === "create" ? "c" : "r"}_${short}`,
    toolRunId: `inv_${short}`,
  };
}
