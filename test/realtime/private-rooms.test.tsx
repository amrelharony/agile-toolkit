import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContextValue } from "@/lib/auth/types";
import { GuestProfileProvider, type GuestProfile } from "@/lib/auth/guest-profile-provider";

/**
 * Private Realtime rooms (`NEXT_PUBLIC_PRIVATE_ROOMS=1`), from the hooks'
 * side: with the flag off every channel opens exactly as before; with it on,
 * rooms get their token onto the shared client first, join as private
 * channels, and stay local-only (no channel at all) when the token is
 * refused. The owner's own feeds go private only with the flag on.
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
  const setAuth = vi.fn<(token?: string | null) => Promise<void>>(async () => {});
  return {
    auth: null as Partial<AuthContextValue> | null,
    makeChannel,
    setAuth,
    client: {
      channel: vi.fn<(name: string, opts?: unknown) => ReturnType<typeof makeChannel>>(() =>
        makeChannel()
      ),
      removeChannel: vi.fn(async () => "ok"),
      realtime: { setAuth },
    },
    authClient: {
      channel: vi.fn<(name: string, opts?: unknown) => ReturnType<typeof makeChannel>>(() =>
        makeChannel()
      ),
      removeChannel: vi.fn(async () => "ok"),
      getChannels: vi.fn(() => []),
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

vi.mock("@/lib/auth/supabase-browser", () => ({
  getAuthBrowserClient: () => h.authClient,
}));

vi.mock("@/lib/agent/persist", () => ({
  listConversations: async () => [],
  loadMessages: async () => [],
  deleteConversation: async () => {},
  renameConversation: async () => {},
  conversationToMarkdown: () => "",
  titleSlug: () => "thread",
}));

import { useRoom } from "@/lib/realtime/use-room";
import { useCanvasPresence } from "@/lib/whiteboard/use-canvas-presence";
import { activeRoomAuthTopics, resetRoomAuth } from "@/lib/realtime/room-auth";
import { ownerFeedChannel, privateRoomsEnabled } from "@/lib/realtime/private-rooms";
import { syncEngine } from "@/lib/sync/engine";
import { subscribeToHistory } from "@/lib/history/sync";
import { ConversationList } from "@/components/agent/conversation-list";

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

const POKER = "tool:planning-poker:room:ABC123";
const CODE = "ABCDEFGHJKMN"; // 12 symbols from the visitor alphabet
const visitorIdentity = { id: "Vis1tor_ident-16", name: "Sam" };
const HOUR = 60 * 60_000;

type FetchReply = { status: number; body?: unknown };

/** fetch stub answering every request with `reply` (body built per call). */
function stubFetch(reply: (url: string, init?: RequestInit) => FetchReply) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = reply(url, init);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const tokenReply = (token: string) => () => ({
  status: 200,
  body: { token, expiresAt: Date.now() + HOUR },
});

function postedTopics(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body ? (JSON.parse(String(init.body)) as { topics: unknown }).topics : undefined;
}

function channelCalls() {
  return h.client.channel.mock.calls;
}

beforeEach(() => {
  resetRoomAuth();
  h.auth = null;
  h.client.channel.mockClear();
  h.client.removeChannel.mockClear();
  h.setAuth.mockClear();
  h.authClient.channel.mockClear();
  h.authClient.removeChannel.mockClear();
});

afterEach(() => {
  resetRoomAuth();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("flag off (NEXT_PUBLIC_PRIVATE_ROOMS unset)", () => {
  it("is off unless the build set it to exactly 1", () => {
    expect(privateRoomsEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "true");
    expect(privateRoomsEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "1");
    expect(privateRoomsEnabled()).toBe(true);
  });

  it("opens owner rooms with the same channel() arguments as before, and no token", () => {
    const fetchFn = stubFetch(tokenReply("unused"));
    h.auth = { status: "authenticated", user: owner };
    const { result } = renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));

    expect(channelCalls()).toEqual([
      [POKER, { config: { presence: { key: result.current.userId } } }],
    ]);
    expect(result.current.authFailed).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(h.setAuth).not.toHaveBeenCalled();
  });

  it("opens canvas presence with the same channel() arguments as before", () => {
    h.auth = { status: "authenticated", user: owner };
    const { result } = renderHook(() =>
      useCanvasPresence("tool:canvas:presence:board-1", { id: "me", name: "Me" })
    );
    expect(channelCalls()).toEqual([
      ["tool:canvas:presence:board-1", { config: { presence: { key: "me" } } }],
    ]);
    expect(result.current.authFailed).toBe(false);
  });

  it("opens the owner's feeds with the name alone", () => {
    ownerFeedChannel(h.authClient as unknown as SupabaseClient, "user-sync:u1");
    expect(h.authClient.channel.mock.calls).toEqual([["user-sync:u1"]]);
  });
});

describe("flag on: owner rooms", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "1");
    h.auth = { status: "authenticated", user: owner };
  });

  it("fetches the owner token once, calls setAuth, then joins privately", async () => {
    const fetchFn = stubFetch(tokenReply("owner-token"));
    const { result } = renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    // Nothing joins before the token is on the client.
    expect(h.client.channel).not.toHaveBeenCalled();

    await waitFor(() => expect(h.client.channel).toHaveBeenCalledTimes(1));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe("/api/realtime/token");
    expect(h.setAuth).toHaveBeenCalledWith("owner-token");
    expect(h.setAuth.mock.invocationCallOrder[0]).toBeLessThan(
      h.client.channel.mock.invocationCallOrder[0]
    );
    expect(channelCalls()[0]).toEqual([
      POKER,
      { config: { private: true, presence: { key: result.current.userId } } },
    ]);
    expect(result.current.isLocalOnly).toBe(false);
    expect(result.current.authFailed).toBe(false);
  });

  it("a second owner room reuses the token", async () => {
    const fetchFn = stubFetch(tokenReply("owner-token"));
    renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    await waitFor(() => expect(h.client.channel).toHaveBeenCalledTimes(1));
    renderHook(() => useCanvasPresence("tool:canvas:presence:board-1", { id: "me", name: "Me" }));
    await waitFor(() => expect(h.client.channel).toHaveBeenCalledTimes(2));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(h.setAuth).toHaveBeenCalledTimes(1);
    expect(channelCalls()[1]).toEqual([
      "tool:canvas:presence:board-1",
      { config: { private: true, presence: { key: "me" } } },
    ]);
  });

  it("a refused token creates no channel and reads as local-only", async () => {
    stubFetch(() => ({ status: 503, body: { error: "private_rooms_unavailable" } }));
    const { result } = renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    await waitFor(() => expect(result.current.authFailed).toBe(true));
    expect(result.current.isLocalOnly).toBe(true);
    expect(result.current.isConnected).toBe(false);
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(h.setAuth).not.toHaveBeenCalled();
    expect(activeRoomAuthTopics("owner")).toEqual([]);
  });

  it("a refused token leaves canvas presence without a channel", async () => {
    stubFetch(() => ({ status: 503 }));
    const { result } = renderHook(() =>
      useCanvasPresence("tool:canvas:presence:board-1", { id: "me", name: "Me" })
    );
    await waitFor(() => expect(result.current.authFailed).toBe(true));
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("unmounting before the token arrives joins nothing and holds nothing", async () => {
    let answer!: (r: Response) => void;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchFn);
    const { unmount } = renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(activeRoomAuthTopics("owner")).toEqual([POKER]);

    unmount();
    expect(activeRoomAuthTopics("owner")).toEqual([]);
    await act(async () => {
      answer({
        ok: true,
        status: 200,
        json: async () => ({ token: "late", expiresAt: Date.now() + HOUR }),
      } as Response);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(h.client.removeChannel).not.toHaveBeenCalled();
  });

  it("leaving the room removes the channel and drops its lease", async () => {
    stubFetch(tokenReply("owner-token"));
    const { unmount } = renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    await waitFor(() => expect(h.client.channel).toHaveBeenCalledTimes(1));
    unmount();
    expect(h.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(activeRoomAuthTopics("owner")).toEqual([]);
  });
});

describe("flag on: guest rooms", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "1");
  });

  it("POSTs its topic, and a second room re-mints with the union", async () => {
    let n = 0;
    const fetchFn = stubFetch(() => ({
      status: 200,
      body: { token: `guest-${++n}`, expiresAt: Date.now() + HOUR },
    }));
    const identity = { id: guest.id, name: guest.displayName };
    renderHook(() => useRoom<unknown>("canvas", "board-1", null, { identity }), {
      wrapper: guestWrapper,
    });
    await waitFor(() => expect(h.client.channel).toHaveBeenCalledTimes(1));
    expect(fetchFn.mock.calls[0][0]).toBe("/api/guest/realtime-token");
    expect(postedTopics(fetchFn.mock.calls[0])).toEqual(["tool:canvas:room:board-1"]);
    expect(h.setAuth).toHaveBeenLastCalledWith("guest-1");
    expect(channelCalls()[0]).toEqual([
      "tool:canvas:room:board-1",
      { config: { private: true, presence: { key: "guest-1" } } },
    ]);

    renderHook(
      () => useCanvasPresence("tool:canvas:presence:board-1", { id: "guest-1", name: "Sam" }),
      { wrapper: guestWrapper }
    );
    await waitFor(() => expect(h.client.channel).toHaveBeenCalledTimes(2));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(postedTopics(fetchFn.mock.calls[1])).toEqual([
      "tool:canvas:room:board-1",
      "tool:canvas:presence:board-1",
    ]);
    expect(h.setAuth).toHaveBeenLastCalledWith("guest-2");
    expect(channelCalls()[1][1]).toEqual({
      config: { private: true, presence: { key: "guest-1" } },
    });
  });

  it("a topic without an invite (403) stays local-only", async () => {
    stubFetch(() => ({ status: 403, body: { error: "forbidden" } }));
    const { result } = renderHook(() => useRoom<unknown>("canvas", "board-1", null), {
      wrapper: guestWrapper,
    });
    await waitFor(() => expect(result.current.authFailed).toBe(true));
    expect(result.current.isLocalOnly).toBe(true);
    expect(h.client.channel).not.toHaveBeenCalled();
  });
});

describe("flag on: visitor rooms", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "1");
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    h.auth = { status: "anonymous", user: null };
  });

  it("joins privately with the anon key: no token request", async () => {
    const fetchFn = stubFetch(tokenReply("unused"));
    renderHook(() =>
      useRoom<unknown>("planning-poker", CODE, null, { visitor: true, identity: visitorIdentity })
    );
    await waitFor(() => expect(h.client.channel).toHaveBeenCalledTimes(1));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(h.setAuth).not.toHaveBeenCalled();
    expect(channelCalls()[0]).toEqual([
      `visitor:planning-poker:${CODE}`,
      { config: { private: true, presence: { key: visitorIdentity.id } } },
    ]);
  });

  it("keeps the visitor guards: no consented identity, no channel", async () => {
    stubFetch(tokenReply("unused"));
    const { result } = renderHook(() =>
      useRoom<unknown>("planning-poker", CODE, null, { visitor: true })
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.isLocalOnly).toBe(true);
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("a public visitor without a visitor room still opens nothing", async () => {
    stubFetch(tokenReply("unused"));
    renderHook(() => useRoom<unknown>("planning-poker", "ABC123", null));
    renderHook(() => useCanvasPresence("tool:canvas:presence:board-1"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.client.channel).not.toHaveBeenCalled();
  });
});

// ── The owner's own feeds ────────────────────────────────────────────

describe("owner feeds", () => {
  afterEach(() => {
    syncEngine.stop();
  });

  async function syncChannelArgs(): Promise<unknown[]> {
    await syncEngine.start(h.authClient as unknown as SupabaseClient, "u1");
    await waitFor(() => expect(h.authClient.channel).toHaveBeenCalled());
    return h.authClient.channel.mock.calls[0];
  }

  it("sync engine: user-sync:<id> is private only with the flag on", async () => {
    expect(await syncChannelArgs()).toEqual(["user-sync:u1"]);
    syncEngine.stop();
    h.authClient.channel.mockClear();

    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "1");
    expect(await syncChannelArgs()).toEqual(["user-sync:u1", { config: { private: true } }]);
  });

  it("history: history:<id> is private only with the flag on", () => {
    const off = subscribeToHistory({ userId: "u1", onInsert: () => {} });
    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "1");
    const on = subscribeToHistory({ userId: "u1", onInsert: () => {} });
    expect(h.authClient.channel.mock.calls).toEqual([
      ["history:u1"],
      ["history:u1", { config: { private: true } }],
    ]);
    off();
    on();
  });

  it("agent conversations: the live channel is private only with the flag on", () => {
    const first = render(<ConversationList onClose={() => {}} />);
    first.unmount();
    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "1");
    const second = render(<ConversationList onClose={() => {}} />);
    second.unmount();
    expect(h.authClient.channel.mock.calls).toEqual([
      ["agent-conversations-live"],
      ["agent-conversations-live", { config: { private: true } }],
    ]);
  });

  it("no feed asks for a room token", () => {
    const fetchFn = stubFetch(tokenReply("unused"));
    vi.stubEnv("NEXT_PUBLIC_PRIVATE_ROOMS", "1");
    subscribeToHistory({ userId: "u1", onInsert: () => {} })();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(h.setAuth).not.toHaveBeenCalled();
  });
});
