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

// Capture every .eq() filter and .upsert() row the helpers issue.
const captured: { eqs: Array<[string, unknown]>; upserts: Array<Record<string, unknown>> } = {
  eqs: [],
  upserts: [],
};
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
    upsert: async (row: Record<string, unknown>) => {
      captured.upserts.push(row);
      return { data: null, error: null };
    },
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
  captured.upserts = [];
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

  it("serverPatchWorkspaceBlob upserts a flat blob under the scalars store_key", async () => {
    nextReadPayload = { payload: { maturityLevel: 4 } };
    await serverPatchWorkspaceBlob("user-1", { teamName: "Falcons" });
    expect(captured.upserts).toHaveLength(1);
    const row = captured.upserts[0];
    expect(row.store_key).toBe(EXPECTED_KEY);
    // Merge preserves the sibling scalar, writes flat (no `state` wrapper).
    expect(row.payload).toEqual({ maturityLevel: 4, teamName: "Falcons" });
    expect(row.client_id).toBe("server-mcp");
  });

  it("serverPatchWorkspaceBlob handles first-touch (no existing row)", async () => {
    nextReadPayload = null;
    await serverPatchWorkspaceBlob("user-1", { maturityLevel: 2 });
    expect(captured.upserts[0].store_key).toBe(EXPECTED_KEY);
    expect(captured.upserts[0].payload).toEqual({ maturityLevel: 2 });
  });
});
