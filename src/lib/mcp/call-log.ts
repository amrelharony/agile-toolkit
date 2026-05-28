/**
 * MCP call observability — structured per-call logging to `mcp_call_log`.
 *
 * Every `tools/call` records {action_id, duration_ms, user_id,
 * squad_profile_ids, is_error} so usage can be analysed (which tools agents
 * actually call, error rates, latency, per-squad attribution).
 *
 * Design:
 *   - `buildCallLogRow` is pure (unit-tested) — it maps the transport's
 *     per-call record + auth context to a DB row.
 *   - `logMcpCalls` is the side-effecting writer. It is DEFENSIVE: missing
 *     service-role env → no-op (dev/test never break); any insert error is
 *     swallowed (console.error only) so observability never affects the
 *     request path or surfaces to the agent.
 *
 * The route awaits `logMcpCalls` via Promise.allSettled before returning so
 * the write flushes in a serverless function, but a failed write can never
 * fail the response.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Per-call record emitted by the transport for each tools/call. */
export interface McpCallRecord {
  actionId: string;
  ms: number;
  isError: boolean;
}

/** A row in public.mcp_call_log. */
export interface McpCallLogRow {
  action_id: string;
  duration_ms: number;
  user_id: string;
  squad_profile_ids: string[];
  is_error: boolean;
}

/** Pure: build a DB row from a transport record + auth context. Clamps
 *  duration to a non-negative integer; copies the scope array defensively. */
export function buildCallLogRow(
  rec: McpCallRecord,
  userId: string,
  squadProfileIds: readonly string[]
): McpCallLogRow {
  return {
    action_id: rec.actionId,
    duration_ms: Math.max(0, Math.round(rec.ms)),
    user_id: userId,
    squad_profile_ids: [...squadProfileIds],
    is_error: rec.isError,
  };
}

let cachedAdmin: SupabaseClient | null = null;
function admin(): SupabaseClient | null {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Missing config → observability is simply off (dev / test / preview).
  if (!url || !serviceKey) return null;
  cachedAdmin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

/**
 * Insert call-log rows. Never throws — a logging failure must not affect the
 * MCP response. Returns silently on empty input or unconfigured env.
 */
export async function logMcpCalls(rows: McpCallLogRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = admin();
  if (!client) return;
  try {
    const { error } = await client.from("mcp_call_log").insert(rows);
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[mcp-call-log] insert failed:", error.message);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mcp-call-log] insert threw:", err instanceof Error ? err.message : err);
  }
}
