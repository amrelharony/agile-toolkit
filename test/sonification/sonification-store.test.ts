import { describe, expect, it, beforeEach } from "vitest";
import { useSonificationStore } from "@/lib/stores/sonification-store";

const KEY = "agile-toolkit:sonification";

describe("sonification store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is off by default", () => {
    expect(useSonificationStore.getInitialState().enabled).toBe(false);
  });

  it("switches off sound that v0 stored as the old default", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { enabled: true, masterVolume: 0.4, mode: "full", respectReducedMotion: true },
        version: 0,
      })
    );
    await useSonificationStore.persist.rehydrate();
    expect(useSonificationStore.getState().enabled).toBe(false);
    expect(useSonificationStore.getState().masterVolume).toBe(0.4);
  });

  it("keeps a choice made after the change", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { enabled: true, masterVolume: 0.7, mode: "full", respectReducedMotion: true },
        version: 1,
      })
    );
    await useSonificationStore.persist.rehydrate();
    expect(useSonificationStore.getState().enabled).toBe(true);
  });
});
