/**
 * `syncEngine.whenReady()`: resolves only once the engine's first pull
 * (including adapters that registered during it) has finished, so one-off
 * local writes such as the legacy sprint migration can't beat newer cloud
 * rows.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncEngine, type SyncAdapter } from "@/lib/sync/engine";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Just enough of a Supabase client for start()'s realtime subscribe. */
function fakeSupabase(): SupabaseClient {
  const channel = {
    topic: "realtime:user-sync:u1",
    on() {
      return channel;
    },
    subscribe() {
      return channel;
    },
  };
  return {
    getChannels: () => [],
    channel: () => channel,
    removeChannel: async () => "ok",
  } as unknown as SupabaseClient;
}

function adapter(id: string, pull: () => Promise<void>): SyncAdapter {
  return {
    id,
    realtimeTable: "user_entities",
    pull,
    push: async () => {},
    onRemote: () => {},
    hasPendingWrites: () => false,
  };
}

/** Whether `p` has settled after the current microtasks drain. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => {
    done = true;
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return done;
}

const registered: string[] = [];
function register(a: SyncAdapter) {
  registered.push(a.id);
  syncEngine.register(a);
}

afterEach(() => {
  syncEngine.stop();
  registered.splice(0).forEach((id) => syncEngine.unregister(id));
});

describe("syncEngine.whenReady", () => {
  it("waits while idle, then resolves when start's pull finishes", async () => {
    const pull = deferred();
    register(adapter("a", () => pull.promise));
    const ready = syncEngine.whenReady();
    expect(await settled(ready)).toBe(false);

    const started = syncEngine.start(fakeSupabase(), "u1");
    expect(await settled(ready)).toBe(false);

    pull.resolve();
    await started;
    expect(await settled(ready)).toBe(true);
  });

  it("resolves at once when the engine is already up", async () => {
    register(adapter("a", async () => {}));
    await syncEngine.start(fakeSupabase(), "u1");
    expect(await settled(syncEngine.whenReady())).toBe(true);
  });

  it("also waits for adapters that registered during the first pull", async () => {
    const first = deferred();
    const late = deferred();
    register(adapter("a", () => first.promise));
    const started = syncEngine.start(fakeSupabase(), "u1");
    register(adapter("late", () => late.promise));
    const ready = syncEngine.whenReady();

    first.resolve();
    expect(await settled(ready)).toBe(false);
    late.resolve();
    await started;
    expect(await settled(ready)).toBe(true);
  });

  it("counts a failed pull as finished", async () => {
    register(
      adapter("a", async () => {
        throw new Error("offline");
      })
    );
    const ready = syncEngine.whenReady();
    const warn = console.warn;
    console.warn = () => {};
    try {
      await syncEngine.start(fakeSupabase(), "u1");
    } finally {
      console.warn = warn;
    }
    expect(await settled(ready)).toBe(true);
  });

  it("a start stopped midway doesn't count; the next one does", async () => {
    const pull = deferred();
    register(adapter("a", () => pull.promise));
    const ready = syncEngine.whenReady();
    const started = syncEngine.start(fakeSupabase(), "u1");
    syncEngine.stop();
    pull.resolve();
    await started;
    expect(await settled(ready)).toBe(false);
    expect(await settled(syncEngine.whenReady())).toBe(false);

    await syncEngine.start(fakeSupabase(), "u1");
    expect(await settled(ready)).toBe(true);
  });

  it("waits again after a stop", async () => {
    register(adapter("a", async () => {}));
    await syncEngine.start(fakeSupabase(), "u1");
    syncEngine.stop();
    expect(await settled(syncEngine.whenReady())).toBe(false);
  });
});
