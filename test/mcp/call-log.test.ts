/**
 * MCP call-log: the pure row-builder + the transport's onCall emission.
 *
 * The DB insert (logMcpCalls) is intentionally NOT tested here — it is a
 * defensive, env-gated side effect with no return value. We cover the parts
 * that carry logic: buildCallLogRow (pure) and that handleJsonRpc emits an
 * observation for tools/call but not for handshake/discovery methods.
 */

import { describe, it, expect } from "vitest";
import { buildCallLogRow, type McpCallRecord } from "@/lib/mcp/call-log";
import { handleJsonRpc, type McpCallObservation } from "@/lib/mcp/transport-http";

// Side-effect import: register a known read action (tool.daci.list_state).
import "@/lib/actions/tools/daci";

describe("buildCallLogRow", () => {
  const rec: McpCallRecord = { actionId: "tool.daci.list_state", ms: 12.7, isError: false };

  it("maps record + auth context to a DB row", () => {
    const row = buildCallLogRow(rec, "user-1", ["squad-a", "squad-b"]);
    expect(row).toEqual({
      action_id: "tool.daci.list_state",
      duration_ms: 13, // rounded
      user_id: "user-1",
      squad_profile_ids: ["squad-a", "squad-b"],
      is_error: false,
    });
  });

  it("clamps duration to a non-negative integer", () => {
    expect(buildCallLogRow({ ...rec, ms: -5 }, "u", []).duration_ms).toBe(0);
    expect(buildCallLogRow({ ...rec, ms: 0.4 }, "u", []).duration_ms).toBe(0);
    expect(buildCallLogRow({ ...rec, ms: 1.6 }, "u", []).duration_ms).toBe(2);
  });

  it("copies the scope array (no shared reference)", () => {
    const scope = ["s1"];
    const row = buildCallLogRow(rec, "u", scope);
    scope.push("s2");
    expect(row.squad_profile_ids).toEqual(["s1"]);
  });
});

describe("handleJsonRpc — onCall observation", () => {
  it("emits exactly one observation for a tools/call, with actionId + ms", async () => {
    const seen: McpCallObservation[] = [];
    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "tool.daci.list_state", arguments: {} },
      },
      "user-1",
      [],
      (obs) => seen.push(obs)
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].actionId).toBe("tool.daci.list_state");
    expect(seen[0].ms).toBeGreaterThanOrEqual(0);
    // isError reflects the handler outcome — here the mcpHandler hits
    // Supabase, which is absent in the test env, so we only assert the
    // field is populated (a boolean), not its value.
    expect(typeof seen[0].isError).toBe("boolean");
  });

  it("does not emit for handshake / discovery methods", async () => {
    const seen: McpCallObservation[] = [];
    const cb = (obs: McpCallObservation) => seen.push(obs);
    await handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, "u", [], cb);
    await handleJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "u", [], cb);
    expect(seen).toHaveLength(0);
  });

  it("does not emit when arguments fail schema validation (handler never runs)", async () => {
    const seen: McpCallObservation[] = [];
    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        // set_status requires id + status; empty args → -32602 before handler
        params: { name: "tool.daci.set_status", arguments: {} },
      },
      "u",
      [],
      (obs) => seen.push(obs)
    );
    expect(seen).toHaveLength(0);
  });
});
