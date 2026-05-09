/**
 * Universal action history — types shared between client store and Supabase row.
 *
 * Every `HistoryEvent` represents a *semantically meaningful* user action
 * (NOT a keystroke). Tools opt in by calling `useHistoryLogger(toolId).log()`.
 */

export type ToolId = string; // matches ToolDefinition.id in src/lib/constants/tools.ts

export interface HistoryEvent<P = Record<string, unknown>> {
  /** Client-generated nanoid. Same value as `clientEventId`. */
  id: string;
  /** Idempotency key for cloud upsert. */
  clientEventId: string;
  /** Per-browser nanoid (stored in localStorage), debug/audit only. */
  clientId: string;
  /** Per-tool-mount nanoid — correlates events from the same session. */
  toolRunId: string;
  /** Null for anonymous users; populated after sign-in / on cloud rows. */
  userId: string | null;
  /** Tool that emitted the event. */
  toolId: ToolId;
  /** Action name from per-tool catalog (e.g. "card_added", "sprint_committed"). */
  action: string;
  /** Sanitized event payload — typed per tool by the catalog. */
  payload: P;
  /** Optional snapshot — only populated on milestone events (cloud only). */
  beforeState?: unknown;
  afterState?: unknown;
  /** Whether this event carries a snapshot, or whether replay is needed. */
  isMilestone: boolean;
  /** ISO 8601 timestamp when the action occurred client-side. */
  occurredAt: string;
  /** True if pushed to Supabase; false otherwise. Local-only flag. */
  syncedAt: string | null;
  /**
   * Snapshot-stack length at the moment this event was logged, for tools
   * wrapped with `withTimeTravel`. Lets the history drawer compute an
   * exact undo step count for "Restore to here". `undefined` for tools
   * without time-travel.
   */
  undoIndex?: number;
}

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export interface HistoryStoreShape {
  events: HistoryEvent[];
  /** Per-browser id (nanoid), generated once and persisted. */
  clientId: string | null;
  /** Latest `created_at` we've successfully pulled from cloud. */
  lastSyncAt: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
}
