/**
 * Regression guard for the MCP workspace-scalar blob store_key.
 *
 * Scalars (teamName, maturityLevel) cloud-sync through user_state. The
 * browser registers its scalars blob adapter under store_key
 * `agile-toolkit:workspace:scalars` (workspace-store.ts), with a FLAT
 * `{ teamName, maturityLevel }` payload. The MCP server-store path MUST
 * read/write that same row — originally it used `agile-toolkit:workspace`
 * (the localStorage persist name, which is never written to Supabase), so
 * every workspace.scalars.{get,set_team_name,set_maturity_level} hit an
 * orphaned row: writes never reached the UI and `get` always read null.
 *
 * We mock @supabase/supabase-js so admin() returns a capturing fake and we
 * can assert the exact store_key + payload the helpers use, without a DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const EXPECTED_KEY = "agile-toolkit:workspace:scalars";

// Capture every .eq() filter and write row the helpers issue. Writes now go
// through a compare-and-set (update on an existing row, insert on first touch),
// not a blind upsert — see audit M-3.
const captured: {
  eqs: Array<[string, unknown]>;
  updates: Array<Record<string, unknown>>;
  inserts: Array<Record<string, unknown>>;
} = { eqs: [], updates: [], inserts: [] };
// What the next .maybeSingle() read should resolve to.
let nextReadPayload: unknown = null;

function makeBuilder() {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (col: string, val: unknown) => {
      captured.eqs.push([col, val]);
      return b;
    },
    maybeSingle: async () => ({ data: nextReadPayload, error: null }),
    update: (row: Record<string, unknown>) => {
      captured.updates.push(row);
      return b;
    },
    insert: async (row: Record<string, unknown>) => {
      captured.inserts.push(row);
      return { error: null };
    },
    // The update path ends `.update().eq()….select("store_key")` and awaits the
    // builder — resolve a 1-row success (CAS hit).
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: [{ store_key: EXPECTED_KEY }], error: null }),
  };
  return b;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: () => makeBuilder() })),
}));

// admin() needs these present or it throws before reaching the client.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

import {
  serverGetWorkspaceBlob,
  serverPatchWorkspaceBlob,
  WORKSPACE_SCALARS_STORE_KEY,
} from "@/lib/actions/server-store";

beforeEach(() => {
  captured.eqs = [];
  captured.updates = [];
  captured.inserts = [];
  nextReadPayload = null;
});

describe("workspace scalar blob store_key", () => {
  it("exports the browser-aligned scalars store_key", () => {
    expect(WORKSPACE_SCALARS_STORE_KEY).toBe(EXPECTED_KEY);
  });

  it("serverGetWorkspaceBlob reads from the scalars store_key", async () => {
    nextReadPayload = { payload: { teamName: "Falcons", maturityLevel: 3 } };
    const blob = await serverGetWorkspaceBlob("user-1");
    expect(blob).toEqual({ teamName: "Falcons", maturityLevel: 3 });
    expect(captured.eqs).toContainEqual(["store_key", EXPECTED_KEY]);
    // Never the localStorage persist name.
    expect(captured.eqs).not.toContainEqual(["store_key", "agile-toolkit:workspace"]);
  });

  it("serverPatchWorkspaceBlob CAS-updates a flat blob under the scalars store_key", async () => {
    nextReadPayload = { payload: { maturityLevel: 4 }, updated_at: "2026-01-01T00:00:00.000Z" };
    await serverPatchWorkspaceBlob("user-1", { teamName: "Falcons" });
    expect(captured.updates).toHaveLength(1);
    const row = captured.updates[0];
    // Merge preserves the sibling scalar, writes flat (no `state` wrapper).
    expect(row.payload).toEqual({ maturityLevel: 4, teamName: "Falcons" });
    expect(row.client_id).toBe("server-mcp");
    // CAS filters on store_key and on the read updated_at token.
    expect(captured.eqs).toContainEqual(["store_key", EXPECTED_KEY]);
    expect(captured.eqs).toContainEqual(["updated_at", "2026-01-01T00:00:00.000Z"]);
  });

  it("serverPatchWorkspaceBlob inserts on first-touch (no existing row)", async () => {
    nextReadPayload = null;
    await serverPatchWorkspaceBlob("user-1", { maturityLevel: 2 });
    expect(captured.updates).toHaveLength(0);
    expect(captured.inserts).toHaveLength(1);
    expect(captured.inserts[0].store_key).toBe(EXPECTED_KEY);
    expect(captured.inserts[0].payload).toEqual({ maturityLevel: 2 });
    expect(captured.inserts[0].client_id).toBe("server-mcp");
  });
});
