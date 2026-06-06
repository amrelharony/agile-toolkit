"use client";

import { syncEngine } from "./engine";
import { makeBlobAdapter, type BlobSyncAdapter } from "./blob-adapter";
import { makeEntityAdapter, type EntitySyncAdapter } from "./entity-adapter";

/**
 * Public registration API. Stores call these once at module load
 * (not on component mount — the registry must be populated by the
 * time the sync provider starts the engine).
 */

const blobAdapters = new Map<string, BlobSyncAdapter>();
const entityAdapters = new Map<string, EntitySyncAdapter<{ id: string }>>();

interface RegisterBlobOptions {
  storeKey: string;
  /** Read the current state as a JSON-serialisable value. */
  getSnapshot: () => unknown;
  /** Apply a remote snapshot to the store. */
  setSnapshot: (next: unknown) => void;
  /** Subscribe to local changes; the returned unsubscribe is wired by
   *  the sync provider. The subscribe callback should fire whenever
   *  the snapshot might have changed — the adapter handles diffing. */
  subscribe: (onChange: () => void) => () => void;
  /** Optional debounce. */
  pushIntervalMs?: number;
}

export function registerBlobStore(opts: RegisterBlobOptions): void {
  const existing = blobAdapters.get(opts.storeKey);
  if (existing) {
    // The adapter lives for the process lifetime, but `useCloudPersisted`'s
    // hook-side registry (registered + adapterDirty) is wiped on sign-out /
    // user-switch (resetCloudPersistedRegistry). When a hook re-mounts after
    // that wipe it calls registerBlobStore again to re-establish the
    // local-change wiring. Re-running `subscribe` re-populates the hook's
    // `adapterDirty` map (idempotent — its Map.set just overwrites). Without
    // this, edits after a re-sign-in silently stopped scheduling pushes.
    // (The engine registration itself must NOT be repeated.)
    opts.subscribe(() => existing.markDirty());
    return;
  }
  const adapter = makeBlobAdapter({
    storeKey: opts.storeKey,
    getSnapshot: opts.getSnapshot,
    setSnapshot: opts.setSnapshot,
    pushIntervalMs: opts.pushIntervalMs,
  });
  blobAdapters.set(opts.storeKey, adapter);
  syncEngine.register(adapter);
  // Wire the local change subscription so mutations schedule a push.
  // The unsubscribe is intentionally not tracked — registrations live
  // for the lifetime of the process.
  opts.subscribe(() => adapter.markDirty());
}

interface RegisterEntityOptions<T extends { id: string }> {
  kind: string;
  getEntities: () => readonly T[];
  setEntities: (next: T[]) => void;
  subscribe: (onChange: () => void) => () => void;
  pushIntervalMs?: number;
}

export function registerEntityCollection<T extends { id: string }>(
  opts: RegisterEntityOptions<T>
): void {
  if (entityAdapters.has(opts.kind)) return;
  const adapter = makeEntityAdapter<T>({
    kind: opts.kind,
    getEntities: opts.getEntities,
    setEntities: opts.setEntities,
    pushIntervalMs: opts.pushIntervalMs,
  });
  entityAdapters.set(opts.kind, adapter as unknown as EntitySyncAdapter<{ id: string }>);
  syncEngine.register(adapter);
  opts.subscribe(() => adapter.markDirty());
}

/** For tests / debugging only — never use in product code. */
export function _debugListAdapters(): { blobs: string[]; entities: string[] } {
  return {
    blobs: Array.from(blobAdapters.keys()),
    entities: Array.from(entityAdapters.keys()),
  };
}
