import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_ROOM_BEAT_MS,
  LIVE_ROOM_KEY_PREFIX,
  LIVE_ROOM_STALE_MS,
  enterLiveVisitorRoom,
  inLiveVisitorRoom,
  subscribeLiveVisitorRoom,
} from "@/lib/realtime/live-visitor-room";

/**
 * The marker across tabs. The host's board is saved in localStorage, which
 * every tab of the site reads, so a tab without a room must see the mark of
 * the tab that has one. The room's tab keeps a time stamp in localStorage and
 * the others read it. Here "another tab" is a stamp this test writes itself.
 */

const OTHER = `${LIVE_ROOM_KEY_PREFIX}another-tab`;

/** Every live room stamp in storage, this tab's included. */
function stamps(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(LIVE_ROOM_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  expect(inLiveVisitorRoom()).toBe(false);
});

describe("live visitor room marker, across tabs", () => {
  it("is on while another tab's stamp is fresh, and off once that tab removes it", () => {
    expect(inLiveVisitorRoom()).toBe(false);
    window.localStorage.setItem(OTHER, String(Date.now()));
    expect(inLiveVisitorRoom()).toBe(true);
    window.localStorage.removeItem(OTHER);
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("stops counting a stamp that is no longer renewed, and tidies it away", () => {
    window.localStorage.setItem(OTHER, String(Date.now()));
    vi.advanceTimersByTime(LIVE_ROOM_STALE_MS - 1);
    expect(inLiveVisitorRoom()).toBe(true);
    // The tab crashed or was frozen: nothing renewed its stamp.
    vi.advanceTimersByTime(1);
    expect(inLiveVisitorRoom()).toBe(false);
    expect(window.localStorage.getItem(OTHER)).toBeNull();
  });

  it("does not count a stamp that is not a time", () => {
    window.localStorage.setItem(OTHER, "yes");
    expect(inLiveVisitorRoom()).toBe(false);
    expect(window.localStorage.getItem(OTHER)).toBeNull();
  });

  it("leaves the rest of storage alone", () => {
    window.localStorage.setItem("agile-toolkit:workspace", "{}");
    window.localStorage.setItem("agile-toolkit:live-rooms", String(Date.now()));
    expect(inLiveVisitorRoom()).toBe(false);
    expect(window.localStorage.getItem("agile-toolkit:workspace")).toBe("{}");
    expect(window.localStorage.getItem("agile-toolkit:live-rooms")).not.toBeNull();
  });

  it("writes this tab's stamp when its first room opens and removes it when the last one closes", () => {
    expect(stamps()).toEqual([]);
    const first = enterLiveVisitorRoom();
    const second = enterLiveVisitorRoom();
    const own = stamps();
    expect(own).toHaveLength(1);
    expect(Number(window.localStorage.getItem(own[0]))).toBe(Date.now());
    first();
    expect(stamps()).toEqual(own);
    second();
    expect(stamps()).toEqual([]);
  });

  it("renews its stamp often enough to stay fresh for the other tabs", () => {
    expect(LIVE_ROOM_BEAT_MS * 2).toBeLessThan(LIVE_ROOM_STALE_MS);
    const leave = enterLiveVisitorRoom();
    const [own] = stamps();
    const opened = Date.now();
    vi.advanceTimersByTime(LIVE_ROOM_BEAT_MS);
    expect(Number(window.localStorage.getItem(own))).toBe(opened + LIVE_ROOM_BEAT_MS);
    vi.advanceTimersByTime(LIVE_ROOM_STALE_MS * 3);
    // Still renewed after several stale periods.
    expect(Date.now() - Number(window.localStorage.getItem(own))).toBeLessThan(LIVE_ROOM_STALE_MS);
    leave();
    // The renewal stops with the room: no stamp comes back later.
    vi.advanceTimersByTime(LIVE_ROOM_BEAT_MS * 2);
    expect(stamps()).toEqual([]);
  });

  it("takes its stamp away when the tab is closed or reloaded with the room open", () => {
    const leave = enterLiveVisitorRoom();
    expect(stamps()).toHaveLength(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(stamps()).toEqual([]);
    leave();
  });

  it("its own stamp does not keep the mark on after its room has closed", () => {
    const leave = enterLiveVisitorRoom();
    expect(inLiveVisitorRoom()).toBe(true);
    leave();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("tells listeners when another tab's stamp is written or removed", () => {
    const seen: boolean[] = [];
    const stop = subscribeLiveVisitorRoom(() => seen.push(inLiveVisitorRoom()));

    window.localStorage.setItem(OTHER, String(Date.now()));
    window.dispatchEvent(new StorageEvent("storage", { key: OTHER }));
    window.localStorage.removeItem(OTHER);
    window.dispatchEvent(new StorageEvent("storage", { key: OTHER }));
    expect(seen).toEqual([true, false]);

    // Another key changing says nothing; storage being cleared (no key) does.
    window.dispatchEvent(new StorageEvent("storage", { key: "agile-toolkit:workspace" }));
    expect(seen).toHaveLength(2);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(seen).toEqual([true, false, false]);

    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: OTHER }));
    expect(seen).toHaveLength(3);
  });
});
