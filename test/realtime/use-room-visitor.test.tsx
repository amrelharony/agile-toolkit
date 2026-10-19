import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import { GuestProfileProvider, type GuestProfile } from "@/lib/auth/guest-profile-provider";

/**
 * Public visitors must never open a Supabase Realtime channel: useRoom and
 * useCanvasPresence drop to their local-only paths unless the viewer is the
 * verified owner or an invited guest. The one exception is a visitor live
 * room (`visitor: true`) with NEXT_PUBLIC_VISITOR_ROOMS=1: see the
 * "useRoom visitor rooms" block below.
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

afterEach(() => {
  vi.unstubAllEnvs();
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

// ── Visitor live rooms (Phase 6C) ────────────────────────────────────

const CODE = "ABCDEFGHJKMN"; // 12 symbols from the unambiguous alphabet
const visitorId = "Vis1tor_ident-16"; // nanoid(16) shape
const identity = { id: visitorId, name: "Sam" };

type MockChannel = ReturnType<typeof h.makeChannel>;

function lastChannel(): MockChannel {
  const results = h.client.channel.mock.results;
  return results[results.length - 1].value as MockChannel;
}

/** The callback the hook bound with `channel.on(type, { event }, cb)`. */
function handlerFor(channel: MockChannel, type: string, event: string) {
  const calls = channel.on.mock.calls as unknown as Array<
    [string, { event: string }, (p: unknown) => void]
  >;
  const call = calls.find((c) => c[0] === type && c[1]?.event === event);
  if (!call) throw new Error(`no ${type}:${event} binding`);
  return call[2];
}

describe("useRoom visitor rooms", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    h.auth = { status: "anonymous", user: null };
  });

  it("opens visitor:planning-poker:<code> keyed by the room identity", () => {
    const { result } = renderHook(() =>
      useRoom<unknown>("planning-poker", CODE, null, { visitor: true, identity })
    );
    expect(result.current.isLocalOnly).toBe(false);
    expect(result.current.roomId).toBe(CODE);
    expect(result.current.userId).toBe(visitorId);
    expect(result.current.roomFull).toBe(false);
    expect(channelNames()).toEqual([`visitor:planning-poker:${CODE}`]);
    expect(h.client.channel.mock.calls[0][1]).toEqual({
      config: { presence: { key: visitorId } },
    });
  });

  it("opens visitor:retro:<code> for the retro tool", () => {
    renderHook(() => useRoom<unknown>("retro", CODE, null, { visitor: true, identity }));
    expect(channelNames()).toEqual([`visitor:retro:${CODE}`]);
  });

  it.each([
    ["a 6-character owner code", "planning-poker", "ABCDEF"],
    ["a lowercase code", "planning-poker", CODE.toLowerCase()],
    ["a code with ambiguous symbols", "planning-poker", "ABCDEFGHJK10"],
    ["a tool outside the allowlist", "canvas", CODE],
    ["a tool that only looks similar", "planning-poker ", CODE],
  ])("opens nothing for %s", (_label, tool, code) => {
    const { result } = renderHook(() =>
      useRoom<unknown>(tool, code, null, { visitor: true, identity })
    );
    expect(result.current.isLocalOnly).toBe(true);
    expect(result.current.roomId).toBeNull();
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("opens nothing with the flag off, even for the owner", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    renderHook(() => useRoom<unknown>("planning-poker", CODE, null, { visitor: true, identity }));
    h.auth = { status: "authenticated", user: owner };
    renderHook(() => useRoom<unknown>("planning-poker", CODE, null, { visitor: true, identity }));
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("opens nothing before consent produced an identity", () => {
    renderHook(() => useRoom<unknown>("planning-poker", CODE, null, { visitor: true }));
    renderHook(() =>
      useRoom<unknown>("planning-poker", CODE, null, {
        visitor: true,
        identity: { id: "short", name: "Sam" },
      })
    );
    renderHook(() =>
      useRoom<unknown>("planning-poker", CODE, null, {
        visitor: true,
        identity: { id: visitorId, name: "Sam‮gnp.exe" },
      })
    );
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("a visitor without the opt-in stays local-only as before", () => {
    renderHook(() => useRoom<unknown>("planning-poker", CODE, null, { identity }));
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("leaves owner and guest rooms on their tool: channels with the flag on", () => {
    h.auth = { status: "authenticated", user: owner };
    renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    h.auth = null;
    renderHook(() => useRoom<unknown>("canvas", "board-1", null), { wrapper: guestWrapper });
    expect(channelNames()).toEqual(["tool:planning-poker:room:ABC123", "tool:canvas:room:board-1"]);
  });

  describe("inbound limiter", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function mount(opts: { visitor: boolean }) {
      const spy = vi.fn();
      const { result } = renderHook(() =>
        opts.visitor
          ? useRoom<unknown>("planning-poker", CODE, null, { visitor: true, identity })
          : useRoom<unknown>("planning-poker", "ABC123", null)
      );
      act(() => {
        result.current.subscribeToEvent("poker:state", spy);
      });
      const deliver = handlerFor(lastChannel(), "broadcast", "poker:state");
      return { spy, deliver };
    }

    it("drops a single sender's burst past its bucket", () => {
      const { spy, deliver } = mount({ visitor: true });
      for (let i = 0; i < 50; i++) deliver({ payload: { by: "peer-a", n: i } });
      expect(spy).toHaveBeenCalledTimes(20);
    });

    it("caps senders that rotate ids with the per-event budget", () => {
      const { spy, deliver } = mount({ visitor: true });
      for (let i = 0; i < 300; i++) deliver({ payload: { by: `peer-${i}`, n: i } });
      expect(spy).toHaveBeenCalledTimes(100);
    });

    it("refills over time", () => {
      const { spy, deliver } = mount({ visitor: true });
      for (let i = 0; i < 25; i++) deliver({ payload: { by: "peer-a" } });
      expect(spy).toHaveBeenCalledTimes(20);
      vi.setSystemTime(new Date("2026-10-19T10:00:01Z"));
      for (let i = 0; i < 25; i++) deliver({ payload: { by: "peer-a" } });
      expect(spy).toHaveBeenCalledTimes(24);
    });

    it("drops payloads over the size cap", () => {
      const { spy, deliver } = mount({ visitor: true });
      deliver({ payload: { by: "peer-a", text: "x".repeat(100_001) } });
      deliver({ payload: { by: "peer-a", text: "ok" } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ by: "peer-a", text: "ok" });
    });

    it("does not limit owner rooms", () => {
      h.auth = { status: "authenticated", user: owner };
      const { spy, deliver } = mount({ visitor: false });
      for (let i = 0; i < 50; i++) deliver({ payload: { by: "peer-a", n: i } });
      deliver({ payload: { by: "peer-a", text: "x".repeat(100_001) } });
      expect(spy).toHaveBeenCalledTimes(51);
    });
  });
});
