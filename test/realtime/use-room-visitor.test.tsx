import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import { GuestProfileProvider, type GuestProfile } from "@/lib/auth/guest-profile-provider";

/**
 * Public visitors must never open a Supabase Realtime channel: useRoom and
 * useCanvasPresence drop to their local-only paths unless the viewer is the
 * verified owner or an invited guest.
 */

const h = vi.hoisted(() => {
  const makeChannel = () => {
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(() => channel),
      track: vi.fn(async () => "ok"),
      untrack: vi.fn(async () => "ok"),
      unsubscribe: vi.fn(async () => "ok"),
      send: vi.fn(async () => "ok"),
      presenceState: vi.fn(() => ({})),
    };
    return channel;
  };
  return {
    auth: null as Partial<AuthContextValue> | null,
    makeChannel,
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

import { useRoom } from "@/lib/realtime/use-room";
import { useCanvasPresence } from "@/lib/whiteboard/use-canvas-presence";

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

function channelNames(): string[] {
  return h.client.channel.mock.calls.map((call) => call[0]);
}

beforeEach(() => {
  h.auth = null;
  h.client.channel.mockClear();
  h.client.removeChannel.mockClear();
});

describe("useRoom realtime gate", () => {
  it("keeps a public visitor local-only and never opens a channel", () => {
    h.auth = { status: "anonymous", user: null };
    const { result } = renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));

    expect(result.current.isLocalOnly).toBe(true);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.roomId).toBeNull();
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("opens the room channel for the verified owner", () => {
    h.auth = { status: "authenticated", user: owner };
    const { result } = renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));

    expect(result.current.isLocalOnly).toBe(false);
    expect(result.current.roomId).toBe("ABC123");
    expect(channelNames()).toEqual(["tool:planning-poker:room:ABC123"]);
  });

  it("opens the room channel for an invited guest", () => {
    const { result } = renderHook(() => useRoom<unknown>("canvas", "board-1", null), {
      wrapper: guestWrapper,
    });

    expect(result.current.isLocalOnly).toBe(false);
    expect(channelNames()).toEqual(["tool:canvas:room:board-1"]);
  });

  it("waits for the owner check, then connects", () => {
    h.auth = { status: "loading", user: null };
    const { result, rerender } = renderHook(() =>
      useRoom<unknown>("planning-poker", "ABC123", null)
    );
    expect(result.current.isLocalOnly).toBe(true);
    expect(h.client.channel).not.toHaveBeenCalled();

    h.auth = { status: "authenticated", user: owner };
    rerender();
    expect(result.current.isLocalOnly).toBe(false);
    expect(channelNames()).toEqual(["tool:planning-poker:room:ABC123"]);
  });

  it("tears the channel down when the owner stops being the owner", () => {
    h.auth = { status: "authenticated", user: owner };
    const { result, rerender } = renderHook(() =>
      useRoom<unknown>("planning-poker", "ABC123", null)
    );
    expect(h.client.channel).toHaveBeenCalledTimes(1);

    h.auth = { status: "anonymous", user: null };
    rerender();
    expect(result.current.isLocalOnly).toBe(true);
    expect(h.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(h.client.channel).toHaveBeenCalledTimes(1);
  });
});

describe("useCanvasPresence realtime gate", () => {
  it("never joins the presence channel for a public visitor", () => {
    h.auth = { status: "anonymous", user: null };
    const { result } = renderHook(() => useCanvasPresence("tool:canvas:presence:board-1"));

    expect(h.client.channel).not.toHaveBeenCalled();
    expect(result.current.members).toEqual([]);
    // publish stays a safe no-op without a channel.
    expect(() => result.current.publish({ cursor: { x: 1, y: 2 } })).not.toThrow();
  });

  it("joins for the verified owner", () => {
    h.auth = { status: "authenticated", user: owner };
    renderHook(() => useCanvasPresence("tool:canvas:presence:board-1"));
    expect(channelNames()).toEqual(["tool:canvas:presence:board-1"]);
  });

  it("joins for an invited guest", () => {
    renderHook(() => useCanvasPresence("tool:canvas:presence:board-1"), {
      wrapper: guestWrapper,
    });
    expect(channelNames()).toEqual(["tool:canvas:presence:board-1"]);
  });
});
