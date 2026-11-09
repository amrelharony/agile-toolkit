import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import { GuestProfileProvider, type GuestProfile } from "@/lib/auth/guest-profile-provider";
import type { RoomAuthLease } from "@/lib/realtime/room-auth";

/**
 * useRoom marks the tab as in a visitor live room (live-visitor-room.ts)
 * while one of its visitor channels is open, so the visitor chat can offer
 * Amr no actions meanwhile:
 *
 *  - marked from the moment a visitor room opens until the hook unmounts or
 *    its room id goes away, on both the public and the private-rooms path;
 *  - never marked for an owner or guest room, nor when the visitor gate
 *    refuses the room (flag off, bad code, no consented identity);
 *  - one mark per open room, also after React's mount, cleanup, mount.
 */

type Listener = (...args: unknown[]) => void;

const h = vi.hoisted(() => {
  const makeChannel = () => {
    const channel = {
      state: {} as Record<string, unknown[]>,
      on: vi.fn<(type: string, filter: { event: string }, cb: Listener) => unknown>(
        (): unknown => channel
      ),
      subscribe: vi.fn(() => channel),
      track: vi.fn(async () => "ok"),
      untrack: vi.fn(async () => "ok"),
      unsubscribe: vi.fn(async () => "ok"),
      send: vi.fn(async () => "ok"),
      presenceState: vi.fn((): Record<string, unknown[]> => channel.state),
    };
    return channel;
  };
  return {
    auth: null as Partial<AuthContextValue> | null,
    makeChannel,
    /** Set by a test to stand in for acquireRoomAuth (private rooms). */
    lease: null as (() => RoomAuthLease) | null,
    client: {
      channel: vi.fn<(name: string, opts?: unknown) => ReturnType<typeof makeChannel>>(() =>
        makeChannel()
      ),
      removeChannel: vi.fn(async () => "ok"),
    },
  };
});

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => true,
  getSupabaseClient: () => h.client,
}));

vi.mock("@/lib/realtime/room-auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/realtime/room-auth")>();
  return {
    ...real,
    acquireRoomAuth: (...args: Parameters<typeof real.acquireRoomAuth>) =>
      h.lease ? h.lease() : real.acquireRoomAuth(...args),
  };
});

import { useRoom } from "@/lib/realtime/use-room";
import { inLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

const guest: GuestProfile = {
  id: "guest-1",
  displayName: "Sam",
  color: "#34d399",
  squadId: "squad-1",
  squadOwnerId: "owner-1",
};

function guestWrapper({ children }: { children: ReactNode }) {
  return <GuestProfileProvider profile={guest}>{children}</GuestProfileProvider>;
}

function strictWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

const CODE = "ABCDEFGHJKMN"; // 12 symbols from the visitor alphabet
const OTHER_CODE = "NMKJHGFEDCBA";
const identity = { id: "Vis1tor_ident-16", name: "Sam" };

const useVisitorRoom = (code: string | null = CODE) =>
  useRoom<unknown>("planning-poker", code, null, { visitor: true, identity });

/** Let the token promise's `then` run. */
const settle = () => act(async () => {});

beforeEach(() => {
  h.auth = { status: "anonymous", user: null };
  h.lease = null;
  h.client.channel.mockClear();
  h.client.removeChannel.mockClear();
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  expect(inLiveVisitorRoom()).toBe(false);
});

afterEach(() => {
  // Every hook still mounted leaves its room, so no test hands a mark on.
  cleanup();
  expect(inLiveVisitorRoom()).toBe(false);
  vi.unstubAllEnvs();
});

describe("useRoom marks a visitor live room", () => {
  it("is marked while a visitor room is open and cleared on unmount", () => {
    const { unmount } = renderHook(() => useVisitorRoom());
    expect(h.client.channel).toHaveBeenCalledTimes(1);
    expect(inLiveVisitorRoom()).toBe(true);

    unmount();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("is cleared when the room id goes to null, and set again for the next room", () => {
    const { rerender } = renderHook(({ code }: { code: string | null }) => useVisitorRoom(code), {
      initialProps: { code: CODE as string | null },
    });
    expect(inLiveVisitorRoom()).toBe(true);

    rerender({ code: null });
    expect(inLiveVisitorRoom()).toBe(false);

    rerender({ code: OTHER_CODE });
    expect(inLiveVisitorRoom()).toBe(true);
    expect(h.client.channel).toHaveBeenCalledTimes(2);
  });

  it("stays marked until the last of two rooms closes", () => {
    const first = renderHook(() => useVisitorRoom(CODE));
    const second = renderHook(() => useVisitorRoom(OTHER_CODE));
    expect(inLiveVisitorRoom()).toBe(true);

    first.unmount();
    expect(inLiveVisitorRoom()).toBe(true);
    second.unmount();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("holds one mark after mount, cleanup, mount (StrictMode)", () => {
    const { unmount } = renderHook(() => useVisitorRoom(), { wrapper: strictWrapper });
    // StrictMode ran the effect twice: two channels were opened, one is left.
    expect(h.client.channel).toHaveBeenCalledTimes(2);
    expect(h.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(inLiveVisitorRoom()).toBe(true);

    unmount();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("never marks for an owner room or a guest room", () => {
    h.auth = { status: "authenticated", user: owner };
    renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    h.auth = null;
    renderHook(() => useRoom<unknown>("canvas", "board-1", null), { wrapper: guestWrapper });
    expect(h.client.channel).toHaveBeenCalledTimes(2);
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("never marks with the visitor rooms flag off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    renderHook(() => useVisitorRoom());
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it.each([
    ["a 6-character owner code", "planning-poker", "ABCDEF"],
    ["a code with ambiguous symbols", "planning-poker", "ABCDEFGHJK10"],
    ["a tool outside the allowlist", "canvas", CODE],
  ])("never marks for %s", (_label, tool, code) => {
    renderHook(() => useRoom<unknown>(tool, code, null, { visitor: true, identity }));
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("never marks before consent produced an identity", () => {
    renderHook(() => useRoom<unknown>("planning-poker", CODE, null, { visitor: true }));
    renderHook(() =>
      useRoom<unknown>("planning-poker", CODE, null, {
        visitor: true,
        identity: { id: "short", name: "Sam" },
      })
    );
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("never marks for a visitor who did not opt in to a visitor room", () => {
    renderHook(() => useRoom<unknown>("planning-poker", CODE, null, { identity }));
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("stays marked for a room left because it was full, until the room id goes", () => {
    const { result, rerender } = renderHook(
      ({ code }: { code: string | null }) => useVisitorRoom(code),
      { initialProps: { code: CODE as string | null } }
    );
    const channel = h.client.channel.mock.results[0].value as ReturnType<typeof h.makeChannel>;
    channel.state = Object.fromEntries(
      Array.from({ length: VISITOR_LIMITS.maxMembers }, (_, i) => {
        const id = `member${String(i).padStart(10, "0")}`;
        return [id, [{ id, name: "Peer", color: "#00f0ff", joinedAt: "2026-11-09T08:00:00.000Z" }]];
      })
    );
    const sync = channel.on.mock.calls.find((c) => c[0] === "presence")?.[2];
    act(() => sync?.());
    expect(result.current.roomFull).toBe(true);
    expect(h.client.removeChannel).toHaveBeenCalledTimes(1);
    // The channel was open for a moment and may have heard the room.
    expect(inLiveVisitorRoom()).toBe(true);

    rerender({ code: null });
    expect(inLiveVisitorRoom()).toBe(false);
  });
});

describe("useRoom marks a visitor live room with private rooms on", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "1");
  });

  /** A lease whose token arrives when the test says so. */
  function pendingLease() {
    let resolve: (ok: boolean) => void = () => {};
    const ready = new Promise<boolean>((r) => {
      resolve = r;
    });
    const release = vi.fn();
    h.lease = () => ({ ready, release });
    return { resolve, release };
  }

  it("is marked once the private channel opens and cleared on unmount", async () => {
    const { unmount } = renderHook(() => useVisitorRoom());
    await settle();
    expect(h.client.channel).toHaveBeenCalledTimes(1);
    expect(inLiveVisitorRoom()).toBe(true);

    unmount();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("is marked while the token is on its way, before any channel opens", async () => {
    const lease = pendingLease();
    renderHook(() => useVisitorRoom());
    await settle();
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(inLiveVisitorRoom()).toBe(true);

    lease.resolve(true);
    await settle();
    expect(h.client.channel).toHaveBeenCalledTimes(1);
    expect(inLiveVisitorRoom()).toBe(true);
  });

  it("is cleared by an unmount before the token arrives, and no channel opens after it", async () => {
    const lease = pendingLease();
    const { unmount } = renderHook(() => useVisitorRoom());
    expect(inLiveVisitorRoom()).toBe(true);

    unmount();
    expect(inLiveVisitorRoom()).toBe(false);
    expect(lease.release).toHaveBeenCalledTimes(1);

    lease.resolve(true);
    await settle();
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("is cleared when the token is refused: no channel, no live room", async () => {
    const lease = pendingLease();
    const { result, unmount } = renderHook(() => useVisitorRoom());
    expect(inLiveVisitorRoom()).toBe(true);

    lease.resolve(false);
    await settle();
    expect(result.current.authFailed).toBe(true);
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(inLiveVisitorRoom()).toBe(false);

    // The later cleanup must not take a second mark away from another room.
    const other = renderHook(() => useVisitorRoom(OTHER_CODE));
    unmount();
    expect(inLiveVisitorRoom()).toBe(true);
    other.unmount();
  });

  it("holds one mark after mount, cleanup, mount (StrictMode)", async () => {
    const { unmount } = renderHook(() => useVisitorRoom(), { wrapper: strictWrapper });
    await settle();
    expect(h.client.channel).toHaveBeenCalledTimes(1);
    expect(inLiveVisitorRoom()).toBe(true);

    unmount();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("never marks for an owner room", async () => {
    h.lease = () => ({ ready: Promise.resolve(true), release: () => {} });
    h.auth = { status: "authenticated", user: owner };
    renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    await settle();
    expect(h.client.channel).toHaveBeenCalledTimes(1);
    expect(inLiveVisitorRoom()).toBe(false);
  });
});
