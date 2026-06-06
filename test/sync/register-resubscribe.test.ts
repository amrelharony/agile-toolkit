import { describe, expect, it, vi } from "vitest";
import { registerBlobStore, _debugListAdapters } from "@/lib/sync/register";

/**
 * Regression: the blob adapter lives for the process lifetime, but
 * `useCloudPersisted`'s hook-side registry (registered + adapterDirty) is
 * wiped on sign-out / user-switch via `resetCloudPersistedRegistry`. When a
 * tool page re-mounts after that wipe, the hook calls `registerBlobStore`
 * again to re-establish the local-change wiring (which re-populates
 * `adapterDirty`). The old guard early-returned on the existing adapter
 * WITHOUT re-running `subscribe`, so `adapterDirty` was never repopulated and
 * edits after a re-sign-in silently stopped scheduling cloud pushes.
 *
 * The adapter itself must NOT be duplicated in the engine on re-registration.
 */
describe("registerBlobStore re-registration", () => {
  it("re-runs subscribe on a second registration without duplicating the adapter", () => {
    const storeKey = `test:register-resubscribe:${Math.random().toString(36).slice(2)}`;
    const firstSubscribe = vi.fn(() => () => {});
    const secondSubscribe = vi.fn(() => () => {});

    registerBlobStore({
      storeKey,
      getSnapshot: () => ({}),
      setSnapshot: () => {},
      subscribe: firstSubscribe,
    });

    const afterFirst = _debugListAdapters().blobs.filter((k) => k === storeKey);
    expect(afterFirst).toHaveLength(1);
    expect(firstSubscribe).toHaveBeenCalledTimes(1);

    // Simulates a hook re-mount after resetCloudPersistedRegistry().
    registerBlobStore({
      storeKey,
      getSnapshot: () => ({}),
      setSnapshot: () => {},
      subscribe: secondSubscribe,
    });

    // The new subscribe wiring MUST run so the hook's adapterDirty is rewired.
    expect(secondSubscribe).toHaveBeenCalledTimes(1);
    // ...but the adapter must still be registered exactly once.
    const afterSecond = _debugListAdapters().blobs.filter((k) => k === storeKey);
    expect(afterSecond).toHaveLength(1);
  });
});
