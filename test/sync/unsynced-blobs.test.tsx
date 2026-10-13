import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncEngine } from "@/lib/sync/engine";
import { useCloudPersisted } from "@/lib/sync/use-cloud-persisted";
import {
  UNSYNCED_BLOBS_KEY,
  hasUnsyncedBlobData,
  mergeBlobPayloads,
  recordUnsyncedBlob,
} from "@/lib/sync/unsynced-blobs";

/**
 * Blob-synced tools (usePersisted) edited while sync was off — the owner
 * signed out (session lapse, "keep a copy"), or a visitor whose work the
 * owner chose to merge. The in-memory dirty flag doesn't survive the OAuth
 * page load, so before the durable record the first pull applied the older
 * cloud row over those edits; and a tab that still held the flag pushed
 * its value over the cloud row instead. Both now merge.
 */

type Row = { payload: unknown; updated_at: string; client_id: string };

function fakeSupabase(rows: Record<string, Row>) {
  const upserts: Array<{ store_key: string; payload: unknown }> = [];
  const selects: string[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe("user_state");
      const filters: Record<string, string> = {};
      const query = {
        select: () => query,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return query;
        },
        maybeSingle: async () => {
          selects.push(filters.store_key);
          return { data: rows[filters.store_key] ?? null, error: null };
        },
        upsert: (row: { store_key: string; payload: unknown }) => {
          upserts.push({ store_key: row.store_key, payload: row.payload });
          rows[row.store_key] = {
            payload: row.payload,
            updated_at: "2026-10-13T12:00:00.000Z",
            client_id: "me",
          };
          return {
            select: () => ({
              single: async () => ({
                data: { updated_at: "2026-10-13T12:00:00.000Z" },
                error: null,
              }),
            }),
          };
        },
      };
      return query;
    },
    getChannels: () => [],
    removeChannel: async () => "ok",
    channel: () => {
      const ch = { topic: "realtime:user-sync:owner-1", on: () => ch, subscribe: () => ch };
      return ch;
    },
  };
  return { client: client as unknown as SupabaseClient, upserts, selects };
}

type Item = { id: string; title: string };

let current: { value: Item[]; set: (next: Item[]) => void } | null = null;

function Tool({ storeKey }: { storeKey: string }) {
  const [value, set] = useCloudPersisted<Item[]>(storeKey, []);
  useEffect(() => {
    current = { value, set };
  });
  return null;
}

let keySeq = 0;
function freshKey() {
  // Adapters live for the module's lifetime; a key per test keeps them apart.
  keySeq += 1;
  return `agile-toolkit:test-blob-${keySeq}`;
}

const item = (id: string, title = id): Item => ({ id, title });

beforeEach(() => {
  localStorage.clear();
  current = null;
});

afterEach(() => {
  syncEngine.stop();
});

describe("mergeBlobPayloads", () => {
  it("unions id rows, local winning per id", () => {
    expect(
      mergeBlobPayloads([item("a", "a-local"), item("c")], [item("a", "a-cloud"), item("b")])
    ).toEqual([item("a", "a-local"), item("c"), item("b")]);
  });

  it("unions primitive arrays without duplicates", () => {
    expect(mergeBlobPayloads(["x", "y"], ["y", "z", "z"])).toEqual(["x", "y", "z"]);
  });

  it("merges object state key by key, keeping cloud-only keys", () => {
    expect(
      mergeBlobPayloads(
        { items: [item("a")], title: "local" },
        { items: [item("b")], title: "cloud", extra: 1 }
      )
    ).toEqual({ items: [item("a"), item("b")], title: "local", extra: 1 });
  });

  it("keeps the local value when the shapes don't merge", () => {
    expect(mergeBlobPayloads(true, false)).toBe(true);
    expect(mergeBlobPayloads([1, { id: "a" }], [2])).toEqual([1, { id: "a" }]);
    expect(mergeBlobPayloads(null, [item("a")])).toEqual([item("a")]);
  });

  it("never copies prototype keys", () => {
    const local = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
    const merged = mergeBlobPayloads(local, { b: 2 }) as Record<string, unknown>;
    expect(merged).toEqual({ a: 1, b: 2 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("blob tools edited while sync was off", () => {
  it("merges signed-out edits from a previous page load instead of pulling the cloud row over them", async () => {
    const key = freshKey();
    // Previous page session (signed out): the edit is in localStorage and
    // recorded; this page load starts with a clean adapter.
    localStorage.setItem(key, JSON.stringify([item("cloud-1"), item("signed-out-edit")]));
    recordUnsyncedBlob(key);
    render(<Tool storeKey={key} />);
    await waitFor(() => expect(current?.value).toHaveLength(2));

    const { client, upserts } = fakeSupabase({
      [key]: {
        payload: [item("cloud-1"), item("other-device")],
        updated_at: "2026-10-13T10:00:00.000Z",
        client_id: "other",
      },
    });
    await act(async () => {
      await syncEngine.start(client, "owner-1");
      // Skip the push debounce.
      await syncEngine.flushAllNow();
    });

    const merged = [item("cloud-1"), item("signed-out-edit"), item("other-device")];
    await waitFor(() => expect(current?.value).toEqual(merged));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(merged);
    await waitFor(() => expect(upserts).toEqual([{ store_key: key, payload: merged }]));
    // Pushed: the record is gone.
    await waitFor(() => expect(localStorage.getItem(UNSYNCED_BLOBS_KEY)).toBeNull());
  });

  it("records an edit made while sync is off, and merges a still-dirty tab instead of pushing over the cloud", async () => {
    const key = freshKey();
    render(<Tool storeKey={key} />);
    await waitFor(() => expect(current).not.toBeNull());
    act(() => current!.set([item("visitor-row")]));
    expect(JSON.parse(localStorage.getItem(UNSYNCED_BLOBS_KEY)!)).toEqual([key]);
    expect(hasUnsyncedBlobData()).toBe(true);

    const { client, upserts, selects } = fakeSupabase({
      [key]: {
        payload: [item("owner-1"), item("owner-2")],
        updated_at: "2026-10-13T10:00:00.000Z",
        client_id: "other",
      },
    });
    await act(async () => {
      await syncEngine.start(client, "owner-1");
      await syncEngine.flushAllNow();
    });

    // The cloud row was read, not blindly overwritten.
    expect(selects).toContain(key);
    const merged = [item("visitor-row"), item("owner-1"), item("owner-2")];
    await waitFor(() => expect(upserts).toEqual([{ store_key: key, payload: merged }]));
    expect(current?.value).toEqual(merged);
  });

  it("still takes the cloud row on a plain load with no signed-out edits", async () => {
    const key = freshKey();
    localStorage.setItem(key, JSON.stringify([item("stale")]));
    render(<Tool storeKey={key} />);
    await waitFor(() => expect(current?.value).toEqual([item("stale")]));

    const { client, upserts } = fakeSupabase({
      [key]: {
        payload: [item("fresh")],
        updated_at: "2026-10-13T10:00:00.000Z",
        client_id: "other",
      },
    });
    await act(async () => {
      await syncEngine.start(client, "owner-1");
      await syncEngine.flushAllNow();
    });
    await waitFor(() => expect(current?.value).toEqual([item("fresh")]));
    expect(upserts).toEqual([]);
  });

  it("does not record edits while sync is running", async () => {
    const key = freshKey();
    render(<Tool storeKey={key} />);
    await waitFor(() => expect(current).not.toBeNull());
    const { client } = fakeSupabase({});
    await act(async () => {
      await syncEngine.start(client, "owner-1");
    });
    act(() => current!.set([item("owner-edit")]));
    expect(localStorage.getItem(UNSYNCED_BLOBS_KEY)).toBeNull();
  });

  it("does not count UI preferences as visitor work", () => {
    recordUnsyncedBlob("agile-toolkit:tool-prefs:v1");
    recordUnsyncedBlob("agile-toolkit:sidebar:collapsed:v2");
    recordUnsyncedBlob("agile-toolkit:canvas");
    expect(hasUnsyncedBlobData()).toBe(false);
    recordUnsyncedBlob("agile-toolkit:risk-register");
    expect(hasUnsyncedBlobData()).toBe(true);
  });
});
