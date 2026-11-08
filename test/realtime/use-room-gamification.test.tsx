import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * useRoom tells the gamification engine about real company: `room-joined`
 * once a channel holds someone besides us (not on SUBSCRIBED, so a room
 * opened alone, like the owner's kudos room, earns nothing), and
 * `room-members` once per channel when it first holds 4 or more.
 */

type Handler = (payload?: unknown) => void;

const h = vi.hoisted(() => {
  const state = {
    presence: {} as Record<string, unknown[]>,
    presenceSync: null as Handler | null,
    subscribe: null as ((status: string) => void) | null,
    trackedId: "",
  };
  const channel = {
    on: vi.fn((type: string, filter: { event?: string }, cb: Handler) => {
      if (type === "presence" && filter?.event === "sync") state.presenceSync = cb;
      return channel;
    }),
    subscribe: vi.fn((cb: (status: string) => void) => {
      state.subscribe = cb;
      return channel;
    }),
    track: vi.fn(async (m: { id: string }) => {
      state.trackedId = m.id;
      return "ok";
    }),
    untrack: vi.fn(async () => "ok"),
    unsubscribe: vi.fn(async () => "ok"),
    send: vi.fn(async () => "ok"),
    presenceState: vi.fn(() => state.presence),
  };
  return {
    state,
    channel,
    signal: vi.fn(),
    auth: null as Partial<AuthContextValue> | null,
  };
});

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => true,
  getSupabaseClient: () => ({
    channel: () => h.channel,
    removeChannel: vi.fn(async () => "ok"),
  }),
}));
vi.mock("@/lib/gamification/signal", () => ({ signalGamification: h.signal }));

import { useRoom } from "@/lib/realtime/use-room";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

const member = (id: string) => ({ id, name: id, color: "#34d399" });

function present(...ids: string[]) {
  h.state.presence = Object.fromEntries(ids.map((id, i) => [`k${i}`, [member(id)]]));
  act(() => h.state.presenceSync?.());
}

function names(): string[] {
  return h.signal.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  h.auth = { status: "authenticated", user: owner };
  h.signal.mockClear();
  h.state.presence = {};
  h.state.presenceSync = null;
  h.state.subscribe = null;
});

describe("useRoom gamification signals", () => {
  it("doesn't count a room joined alone, or a reconnect", () => {
    renderHook(() => useRoom<unknown>("kudos", "workspace-abc", null));
    act(() => h.state.subscribe?.("SUBSCRIBED"));
    const me = h.state.trackedId;
    expect(me).not.toBe("");
    present(me);
    present(me, me); // a second tab of our own
    act(() => h.state.subscribe?.("CLOSED"));
    act(() => h.state.subscribe?.("SUBSCRIBED"));
    present(me);
    expect(names()).toEqual([]);
  });

  it("sends room-joined once, when someone else is there", () => {
    renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    act(() => h.state.subscribe?.("SUBSCRIBED"));
    const me = h.state.trackedId;
    present(me);
    present(me, "peer-1");
    present(me);
    present(me, "peer-1");
    expect(names()).toEqual(["room-joined"]);
    expect(h.signal).toHaveBeenCalledWith("room-joined", { toolId: "planning-poker" });
  });

  it("sends room-members once per channel, even if the room dips below 4", () => {
    renderHook(() => useRoom<unknown>("retro", "R1", null));
    act(() => h.state.subscribe?.("SUBSCRIBED"));
    const me = h.state.trackedId;
    present(me, "a", "b", "c");
    present(me, "a");
    present(me, "a", "b", "c", "d");
    expect(names().filter((n) => n === "room-members")).toHaveLength(1);
    expect(h.signal).toHaveBeenCalledWith("room-members", { memberCount: 4 });
  });
});
