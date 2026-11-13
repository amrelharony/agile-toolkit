import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeBlobPayloads } from "@/lib/sync/unsynced-blobs";

/**
 * The Picker's store is created by the action registry on every page where
 * Amr's chat opens, not only on the Picker page, and cloud sync registers
 * it a moment later. It must hold this browser's saved copy before sync
 * can read it: a first sync after signing in merges the cloud row with what
 * is in memory, and merging with the defaults would write the cloud row
 * alone over the lists and turns saved while signed out.
 */

const sync = vi.hoisted(() => ({
  adapters: [] as {
    storeKey: string;
    getSnapshot: () => unknown;
    setSnapshot: (next: unknown) => void;
  }[],
}));
vi.mock("@/lib/sync/register", () => ({
  registerBlobStore: (opts: (typeof sync.adapters)[number]) => sync.adapters.push(opts),
}));

const KEY = "agile-toolkit:picker";
const LUNCH = {
  id: "l_lunch",
  name: "Lunch",
  entries: [
    { name: "Pizza", weight: 1 },
    { name: "Tacos", weight: 1 },
  ],
  updatedAt: "2026-11-10T12:00:00.000Z",
};
const TOPICS = {
  id: "l_topics",
  name: "Topics",
  entries: [
    { name: "Wins", weight: 1 },
    { name: "Puzzles", weight: 1 },
  ],
  updatedAt: "2026-11-11T12:00:00.000Z",
};

beforeEach(() => {
  localStorage.clear();
  sync.adapters.length = 0;
  vi.resetModules();
});
afterEach(() => localStorage.clear());

async function loadStore() {
  return import("@/lib/picker/store");
}

describe("the Picker store before the page opens", () => {
  it("holds this browser's saved copy as soon as it is created", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { lists: [LUNCH] }, version: 0 }));
    const { usePickerStore, readPicker } = await loadStore();
    expect(usePickerStore.persist.hasHydrated()).toBe(true);
    expect(readPicker().lists.map((l) => l.name)).toEqual(["Lunch"]);
  });

  it("gives sync the saved copy, so a merge with the cloud keeps the signed-out lists", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { lists: [LUNCH] }, version: 0 }));
    const { readPicker } = await loadStore();
    // createPersistedStore registers with sync through a dynamic import.
    await vi.waitFor(() => expect(sync.adapters.some((a) => a.storeKey === KEY)).toBe(true));
    const adapter = sync.adapters.find((a) => a.storeKey === KEY);
    const local = adapter!.getSnapshot() as { lists: unknown[] };
    expect(local.lists).toHaveLength(1);
    // What the blob adapter's first sync does with a key edited while signed out.
    adapter!.setSnapshot(mergeBlobPayloads(local, { lists: [TOPICS] }));
    expect(
      readPicker()
        .lists.map((l) => l.name)
        .sort()
    ).toEqual(["Lunch", "Topics"]);
    const saved = JSON.parse(localStorage.getItem(KEY)!) as {
      state: { lists: { name: string }[] };
    };
    expect(saved.state.lists.map((l) => l.name).sort()).toEqual(["Lunch", "Topics"]);
  });
});
