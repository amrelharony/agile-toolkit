/**
 * serverPatchWorkspaceBlob compare-and-set (audit M-3).
 *
 * The scalar blob holds independent fields (teamName, maturityLevel). A
 * concurrent / batched MCP write of both used to lose one field via a blind
 * read-merge-write. The CAS re-reads the winner's blob and merges onto it.
 *
 * The Supabase client is stubbed with a tiny chainable builder driven by an
 * ordered response queue, so we can simulate a lost CAS race deterministically.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const responses: Array<{ data?: unknown; error?: unknown }> = [];
const updateCalls: Array<Record<string, unknown>> = [];
const insertCalls: Array<Record<string, unknown>> = [];

vi.mock("@supabase/supabase-js", () => {
  const next = () => Promise.resolve(responses.shift() ?? { data: null, error: null });
  // One shared chainable, thenable builder. Chain methods return `this`;
  // terminals (`maybeSingle`, `insert`, and awaiting the update's `.select()`)
  // each consume the next queued response.
  const builder: Record<string, unknown> = {
    from: () => builder,
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    gt: () => builder,
    is: () => builder,
    update: (payload: Record<string, unknown>) => {
      updateCalls.push(payload);
      return builder;
    },
    insert: (payload: Record<string, unknown>) => {
      insertCalls.push(payload);
      return next();
    },
    maybeSingle: () => next(),
    then: (resolve: (v: unknown) => unknown) =>
      resolve(responses.shift() ?? { data: null, error: null }),
  };
  return { createClient: () => builder };
});

import { serverPatchWorkspaceBlob } from "@/lib/actions/server-store";

beforeEach(() => {
  responses.length = 0;
  updateCalls.length = 0;
  insertCalls.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

describe("serverPatchWorkspaceBlob — CAS", () => {
  it("retries on a lost race and merges onto the winner's blob (no field loss)", async () => {
    // read1: only teamName present, token T1
    responses.push({
      data: { payload: { teamName: "A" }, updated_at: "2026-01-01T00:00:00.000Z" },
    });
    // update1: CAS miss (a concurrent writer advanced updated_at) → 0 rows
    responses.push({ data: [] });
    // read2: the concurrent writer's blob — it added maturityLevel, token T2
    responses.push({
      data: {
        payload: { teamName: "A", maturityLevel: 3 },
        updated_at: "2026-01-01T00:00:01.000Z",
      },
    });
    // update2: success
    responses.push({ data: [{ store_key: "k" }] });

    await serverPatchWorkspaceBlob("u1", { teamName: "B" });

    expect(updateCalls).toHaveLength(2);
    // The retried write preserves the concurrent writer's maturityLevel.
    expect(updateCalls[1].payload).toMatchObject({ teamName: "B", maturityLevel: 3 });
  });

  it("inserts on first touch (no row yet)", async () => {
    responses.push({ data: null }); // read → no row
    responses.push({ error: null }); // insert ok
    await serverPatchWorkspaceBlob("u1", { teamName: "X" });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].payload).toMatchObject({ teamName: "X" });
    expect(updateCalls).toHaveLength(0);
  });

  it("falls back to update when a concurrent insert wins the first-touch race", async () => {
    responses.push({ data: null }); // read1 → no row
    responses.push({ error: { code: "23505" } }); // insert → unique violation
    responses.push({ data: { payload: { maturityLevel: 2 }, updated_at: "t2" } }); // read2 → row now exists
    responses.push({ data: [{ store_key: "k" }] }); // update → success
    await serverPatchWorkspaceBlob("u1", { teamName: "Y" });
    expect(insertCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({ teamName: "Y", maturityLevel: 2 });
  });
});
