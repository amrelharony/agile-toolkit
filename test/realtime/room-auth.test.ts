import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The private-rooms token manager (`room-auth.ts`): which token each kind
 * of room gets, how requests are shared and refreshed, and that every
 * failure resolves false (the room then stays local-only).
 */

const h = vi.hoisted(() => ({
  client: {
    realtime: { setAuth: vi.fn<(token?: string | null) => Promise<void>>(async () => {}) },
  } as { realtime: { setAuth: (token?: string | null) => Promise<void> } } | null,
  setAuth: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => true,
  getSupabaseClient: () => h.client,
}));

import {
  GUEST_ROOM_TOKEN_URL,
  MAX_GUEST_ROOM_TOPICS,
  OWNER_ROOM_TOKEN_URL,
  ROOM_TOKEN_REFRESH_LEAD_MS,
  acquireRoomAuth,
  activeRoomAuthTopics,
  ensureRoomAuth,
  resetRoomAuth,
  roomAuthKind,
} from "@/lib/realtime/room-auth";

const HOUR = 60 * 60_000;
const POKER = "tool:planning-poker:room:ABCDEF";
const CANVAS = "tool:canvas:room:board-1";
const PRESENCE = "tool:canvas:presence:board-1";

/** A canned response; a function body is built when the request is made. */
type Reply = { status: number; body?: unknown } | Error;

/** fetch stub: answers in order from `replies` (the last one repeats). */
function stubFetch(...replies: Reply[]) {
  let n = 0;
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const reply = replies[Math.min(n++, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => (typeof reply.body === "function" ? reply.body() : reply.body),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** A 200 whose token lives `lifeMs` from when it is issued. */
function grant(token: string, topics?: string[], lifeMs = HOUR): Reply {
  return { status: 200, body: () => ({ token, expiresAt: Date.now() + lifeMs, topics }) };
}

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

/** Settle a request that is waiting on a deferred reply. */
function deferredFetch() {
  let resolve!: (r: Response) => void;
  const fn = vi.fn(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      })
  );
  vi.stubGlobal("fetch", fn);
  return {
    fn,
    reply(token: string) {
      resolve({
        ok: true,
        status: 200,
        json: async () => ({ token, expiresAt: Date.now() + HOUR }),
      } as Response);
    },
  };
}

beforeEach(() => {
  resetRoomAuth();
  const setAuth = vi.fn<(token?: string | null) => Promise<void>>(async () => {});
  h.client = { realtime: { setAuth } };
  h.setAuth = setAuth;
});

afterEach(() => {
  resetRoomAuth();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("roomAuthKind", () => {
  it("visitor rooms first, then the owner, then a squad guest", () => {
    expect(roomAuthKind({ visitor: true, isOwner: true, isGuest: true })).toBe("visitor");
    expect(roomAuthKind({ visitor: false, isOwner: true, isGuest: true })).toBe("owner");
    expect(roomAuthKind({ visitor: false, isOwner: false, isGuest: true })).toBe("guest");
    expect(roomAuthKind({ visitor: false, isOwner: false, isGuest: false })).toBeNull();
  });
});

describe("owner tokens", () => {
  it("fetches one token, puts it on the client, and reuses it for every room", async () => {
    const fetchFn = stubFetch(grant("owner-1"));

    expect(await ensureRoomAuth("owner", POKER)).toBe(true);
    expect(await ensureRoomAuth("owner", CANVAS)).toBe(true);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(OWNER_ROOM_TOKEN_URL);
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(init.body).toBeUndefined();
    expect(h.setAuth).toHaveBeenCalledTimes(1);
    expect(h.setAuth).toHaveBeenCalledWith("owner-1");
  });

  it("concurrent rooms share the request in flight", async () => {
    const fetchFn = stubFetch(grant("owner-1"));
    const results = await Promise.all([
      ensureRoomAuth("owner", POKER),
      ensureRoomAuth("owner", CANVAS),
      ensureRoomAuth("owner", PRESENCE),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(h.setAuth).toHaveBeenCalledTimes(1);
  });

  it("re-mints and calls setAuth again before the token expires", async () => {
    vi.useFakeTimers();
    const fetchFn = stubFetch(grant("owner-1"), grant("owner-2"));
    expect(await ensureRoomAuth("owner", POKER)).toBe(true);
    const firstExpiry = Date.now() + HOUR;

    await vi.advanceTimersByTimeAsync(HOUR - ROOM_TOKEN_REFRESH_LEAD_MS - 1_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(h.setAuth).toHaveBeenLastCalledWith("owner-2");
    expect(Date.now()).toBeLessThan(firstExpiry);

    // And the new token is refreshed on its own schedule.
    await vi.advanceTimersByTimeAsync(HOUR - ROOM_TOKEN_REFRESH_LEAD_MS);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("retries a failed refresh while the old token lasts", async () => {
    vi.useFakeTimers();
    const fetchFn = stubFetch(grant("owner-1"), new Error("offline"), grant("owner-2"));
    await ensureRoomAuth("owner", POKER);

    await vi.advanceTimersByTimeAsync(HOUR - ROOM_TOKEN_REFRESH_LEAD_MS);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(h.setAuth).toHaveBeenLastCalledWith("owner-1");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(h.setAuth).toHaveBeenLastCalledWith("owner-2");
  });

  it("drops the token at refresh time once no room holds it, back to the anon key", async () => {
    vi.useFakeTimers();
    const fetchFn = stubFetch(grant("owner-1"));
    const lease = acquireRoomAuth("owner", POKER);
    expect(await lease.ready).toBe(true);
    lease.release();
    expect(activeRoomAuthTopics("owner")).toEqual([]);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(h.setAuth).toHaveBeenCalledTimes(2);
    expect(h.setAuth.mock.calls[1]).toEqual([]);
  });
});

describe("guest tokens", () => {
  it("POSTs the topics, and a new room re-mints for the union", async () => {
    const fetchFn = stubFetch(
      grant("guest-1", [CANVAS]),
      grant("guest-2", [CANVAS, PRESENCE]),
      grant("guest-3")
    );

    expect(await ensureRoomAuth("guest", CANVAS)).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe(GUEST_ROOM_TOKEN_URL);
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(bodyOf(fetchFn.mock.calls[0])).toEqual({ topics: [CANVAS] });
    expect(h.setAuth).toHaveBeenLastCalledWith("guest-1");

    expect(await ensureRoomAuth("guest", PRESENCE)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchFn.mock.calls[1])).toEqual({ topics: [CANVAS, PRESENCE] });
    expect(h.setAuth).toHaveBeenLastCalledWith("guest-2");

    // Both topics are covered now: no new request.
    expect(await ensureRoomAuth("guest", CANVAS)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a room asking while another's request is in flight gets the union next", async () => {
    const fetchFn = stubFetch(
      grant("guest-1", [CANVAS]),
      grant("guest-2", [CANVAS, PRESENCE, POKER])
    );
    const results = await Promise.all([
      ensureRoomAuth("guest", CANVAS),
      ensureRoomAuth("guest", PRESENCE),
      ensureRoomAuth("guest", POKER),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchFn.mock.calls[1])).toEqual({ topics: [CANVAS, PRESENCE, POKER] });
    expect(h.setAuth).toHaveBeenLastCalledWith("guest-2");
  });

  it("a closed room's topic leaves the next mint", async () => {
    const fetchFn = stubFetch(
      grant("guest-1", [CANVAS]),
      grant("guest-2", [CANVAS, PRESENCE]),
      grant("guest-3", [PRESENCE, POKER])
    );
    const canvas = acquireRoomAuth("guest", CANVAS);
    await canvas.ready;
    await acquireRoomAuth("guest", PRESENCE).ready;
    canvas.release();
    expect(await acquireRoomAuth("guest", POKER).ready).toBe(true);
    expect(bodyOf(fetchFn.mock.calls[2])).toEqual({ topics: [PRESENCE, POKER] });
  });

  it(`refuses a topic past the server's cap of ${MAX_GUEST_ROOM_TOPICS}`, async () => {
    stubFetch(grant("guest-n"));
    for (let i = 0; i < MAX_GUEST_ROOM_TOPICS; i++) {
      expect(await ensureRoomAuth("guest", `tool:canvas:room:b${i}`)).toBe(true);
    }
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(await ensureRoomAuth("guest", "tool:canvas:room:extra")).toBe(false);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    expect(activeRoomAuthTopics("guest")).not.toContain("tool:canvas:room:extra");
  });

  it("only trusts topics it asked for", async () => {
    stubFetch(grant("guest-1", ["tool:canvas:room:someone-else"]));
    expect(await ensureRoomAuth("guest", CANVAS)).toBe(false);
    expect(h.setAuth).not.toHaveBeenCalled();
  });
});

describe("visitor rooms", () => {
  it("need no token: no request, no setAuth", async () => {
    const fetchFn = stubFetch(grant("unused"));
    expect(await ensureRoomAuth("visitor", "visitor:planning-poker:ABCDEFGHJKMN")).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(h.setAuth).not.toHaveBeenCalled();
  });

  it("leave a live owner token on the shared client alone", async () => {
    stubFetch(grant("owner-1"));
    await ensureRoomAuth("owner", POKER);
    expect(await ensureRoomAuth("visitor", "visitor:retro:ABCDEFGHJKMN")).toBe(true);
    expect(h.setAuth).toHaveBeenCalledTimes(1);
  });
});

describe("failures resolve false", () => {
  it.each([
    ["503 (no SUPABASE_JWT_SECRET)", { status: 503, body: { error: "private_rooms_unavailable" } }],
    ["401", { status: 401, body: { error: "unauthenticated" } }],
    ["403 (no invite)", { status: 403, body: { error: "forbidden" } }],
    ["429", { status: 429, body: { error: "rate_limited" } }],
    ["a network error", new Error("offline")],
    ["a body without a token", { status: 200, body: { expiresAt: Date.now() + HOUR } }],
    ["an expiry in seconds", { status: 200, body: { token: "t", expiresAt: 1_700_000_000 } }],
  ] as Array<[string, Reply]>)("%s", async (_label, reply) => {
    stubFetch(reply);
    expect(await ensureRoomAuth("owner", POKER)).toBe(false);
    expect(await ensureRoomAuth("guest", CANVAS)).toBe(false);
    expect(h.setAuth).not.toHaveBeenCalled();
    // A failed lease releases itself.
    expect(activeRoomAuthTopics("owner")).toEqual([]);
    expect(activeRoomAuthTopics("guest")).toEqual([]);
  });

  it("without a Supabase client", async () => {
    h.client = null;
    stubFetch(grant("owner-1"));
    expect(await ensureRoomAuth("owner", POKER)).toBe(false);
  });

  it("when setAuth throws", async () => {
    h.client = {
      realtime: {
        setAuth: async () => {
          throw new Error("socket gone");
        },
      },
    };
    stubFetch(grant("owner-1"));
    expect(await ensureRoomAuth("owner", POKER)).toBe(false);
  });

  it("for a topic over the length cap", async () => {
    const fetchFn = stubFetch(grant("guest-1"));
    expect(await ensureRoomAuth("guest", `tool:canvas:room:${"x".repeat(300)}`)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sharing callers all get the failure", async () => {
    const fetchFn = stubFetch({ status: 503 });
    const results = await Promise.all([
      ensureRoomAuth("owner", POKER),
      ensureRoomAuth("owner", CANVAS),
    ]);
    expect(results).toEqual([false, false]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("leases", () => {
  it("a lease released before its token arrives resolves false and holds nothing", async () => {
    const d = deferredFetch();
    const lease = acquireRoomAuth("guest", CANVAS);
    expect(activeRoomAuthTopics("guest")).toEqual([CANVAS]);
    lease.release();
    expect(activeRoomAuthTopics("guest")).toEqual([]);
    d.reply("guest-1");
    expect(await lease.ready).toBe(false);
    lease.release(); // idempotent
    expect(activeRoomAuthTopics("guest")).toEqual([]);
  });

  it("resetRoomAuth ignores a response from before it", async () => {
    const d = deferredFetch();
    const pending = ensureRoomAuth("owner", POKER);
    resetRoomAuth();
    d.reply("stale");
    expect(await pending).toBe(false);
    expect(h.setAuth).not.toHaveBeenCalled();
  });
});
