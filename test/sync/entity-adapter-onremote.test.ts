/**
 * Regression: a realtime UPDATE must not clobber an unpushed local edit.
 *
 * pull() already preserves unpushed local edits (BUG-S8 neighbourhood); the
 * realtime onRemote() path lacked the same guard, so a peer UPDATE arriving
 * inside the local push-debounce window overwrote the user's in-flight edit,
 * which was then silently lost on the next push diff. onRemote now mirrors the
 * pull() guard: clean local → remote applies; dirty (unpushed) local → kept.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/sync/engine", () => ({
  syncEngine: {
    getClientId: () => "test-client",
    scheduleFlush: () => undefined,
  },
}));

import { makeEntityAdapter } from "@/lib/sync/entity-adapter";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Row {
  id: string;
  name: string;
}

/** Pull-only Supabase stub: the `.select().eq()...` chain resolves to `rows`. */
function makeSupabase(rows: unknown[]) {
  const from = () => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      gt: () => b,
      then: (resolve: (r: { data: unknown; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

function peerRow(id: string, name: string, updatedAt: string) {
  return {
    kind: "workspace:sprint",
    entity_id: id,
    payload: { id, name },
    updated_at: updatedAt,
    deleted: false,
    client_id: "peer",
  };
}

function makeAdapterWithSyncedX() {
  const store: Row[] = [];
  const adapter = makeEntityAdapter<Row>({
    kind: "workspace:sprint",
    getEntities: () => store,
    setEntities: (next) => {
      store.length = 0;
      store.push(...next);
    },
  });
  return { store, adapter };
}

describe("entity-adapter onRemote — unpushed local edit guard", () => {
  it("applies a peer UPDATE when the local copy is clean (server-confirmed)", async () => {
    const { store, adapter } = makeAdapterWithSyncedX();
    await adapter.pull(makeSupabase([peerRow("X", "v1", "2026-01-01T00:00:00.000Z")]), "u1");
    expect(store).toEqual([{ id: "X", name: "v1" }]);

    adapter.onRemote(peerRow("X", "v2", "2026-01-02T00:00:00.000Z"), "UPDATE");
    expect(store).toEqual([{ id: "X", name: "v2" }]);
  });

  it("keeps an unpushed local edit instead of clobbering it with a peer UPDATE", async () => {
    const { store, adapter } = makeAdapterWithSyncedX();
    await adapter.pull(makeSupabase([peerRow("X", "v1", "2026-01-01T00:00:00.000Z")]), "u1");

    // User edits X locally; the debounced push hasn't fired yet.
    store[0] = { id: "X", name: "local-edit" };

    // A newer peer UPDATE arrives mid-debounce — it must NOT overwrite the edit.
    adapter.onRemote(peerRow("X", "v2", "2026-01-02T00:00:00.000Z"), "UPDATE");
    expect(store).toEqual([{ id: "X", name: "local-edit" }]);
  });

  it("still inserts a peer entity that doesn't exist locally", async () => {
    const { store, adapter } = makeAdapterWithSyncedX();
    await adapter.pull(makeSupabase([peerRow("X", "v1", "2026-01-01T00:00:00.000Z")]), "u1");

    adapter.onRemote(peerRow("Y", "y1", "2026-01-02T00:00:00.000Z"), "INSERT");
    expect(store.map((e) => e.id).sort()).toEqual(["X", "Y"]);
  });
});
