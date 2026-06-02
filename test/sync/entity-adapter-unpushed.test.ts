/**
 * Regression: a brand-new, never-pushed entity must survive a pull that
 * races its first push (BUG-S9).
 *
 * Repro: user creates entity X → markDirty() schedules a debounced push.
 * Before the push fires, a pull runs (realtime SUBSCRIBED / tab focus /
 * visibility all call pullAll()). The old pull rebuilt `lastPushed` for
 * EVERY merged entity — including X, which has no server timestamp — so the
 * subsequent push diffed X out (`last.json === json`) and cleared `dirty`.
 * X then lived only in localStorage and never reached the cloud / peers.
 *
 * The fix leaves unpushed locals out of `lastPushed` so the next push
 * uploads them.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const scheduleFlush = vi.fn();
vi.mock("@/lib/sync/engine", () => ({
  syncEngine: {
    getClientId: () => "test-client",
    scheduleFlush: (...args: unknown[]) => scheduleFlush(...args),
  },
}));

import { makeEntityAdapter } from "@/lib/sync/entity-adapter";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Row {
  id: string;
  name: string;
}

/**
 * Minimal thenable Supabase stub. The pull chain
 * (`.select().eq().eq().order().limit()[.gt()]`) is awaited directly and
 * resolves to `remoteRows`. The push chain (`.upsert().select()`) records
 * the upserted rows and resolves to a server-shaped `{entity_id, updated_at}`.
 */
function makeSupabase(remoteRows: unknown[], capturedUpserts: Record<string, unknown>[]) {
  const from = () => {
    let upserting: Record<string, unknown>[] | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      gt: () => b,
      upsert: (rows: Record<string, unknown>[]) => {
        upserting = rows;
        return b;
      },
      then: (resolve: (r: { data: unknown; error: null }) => void) => {
        if (upserting) {
          capturedUpserts.push(...upserting);
          resolve({
            data: upserting.map((r) => ({
              entity_id: r.entity_id,
              updated_at: "2026-01-01T00:00:00.000Z",
            })),
            error: null,
          });
        } else {
          resolve({ data: remoteRows, error: null });
        }
      },
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

beforeEach(() => scheduleFlush.mockClear());

describe("entity-adapter — unpushed local survives a racing pull", () => {
  it("pushes a locally-created entity even after a pull ran first", async () => {
    const store: Row[] = [];
    const adapter = makeEntityAdapter<Row>({
      kind: "workspace:sprint",
      getEntities: () => store,
      setEntities: (next) => {
        store.length = 0;
        store.push(...next);
      },
    });

    // User creates X locally, then flags the collection dirty.
    store.push({ id: "X", name: "Sprint X" });
    adapter.markDirty();

    // A pull races in before the debounced push (empty remote — nothing
    // else exists in the cloud yet).
    const capturedUpserts: Record<string, unknown>[] = [];
    const sb = makeSupabase([], capturedUpserts);
    await adapter.pull(sb, "user-1");

    // X must still be present locally...
    expect(store.map((e) => e.id)).toEqual(["X"]);
    // ...and the pull must have re-armed a flush (unpushed local detected).
    expect(scheduleFlush).toHaveBeenCalledWith("entity:workspace:sprint");

    // The subsequent push MUST upload X (the bug skipped it).
    await adapter.push(sb, "user-1");
    expect(capturedUpserts.map((r) => r.entity_id)).toContain("X");
  });

  it("does NOT re-push an entity that is already server-confirmed", async () => {
    const store: Row[] = [{ id: "Y", name: "Sprint Y" }];
    const adapter = makeEntityAdapter<Row>({
      kind: "workspace:sprint",
      getEntities: () => store,
      setEntities: (next) => {
        store.length = 0;
        store.push(...next);
      },
    });

    // Pull returns Y as an existing remote row → it gets a server timestamp.
    const capturedUpserts: Record<string, unknown>[] = [];
    const remote = [
      {
        entity_id: "Y",
        payload: { id: "Y", name: "Sprint Y" },
        updated_at: "2026-01-01T00:00:00.000Z",
        deleted: false,
        client_id: "peer",
      },
    ];
    await adapter.pull(makeSupabase(remote, capturedUpserts), "user-1");

    // Nothing dirty / no unpushed local → push is a no-op (no upload).
    await adapter.push(makeSupabase([], capturedUpserts), "user-1");
    expect(capturedUpserts).toHaveLength(0);
  });
});
