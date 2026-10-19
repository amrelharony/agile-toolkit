import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AuthContextValue } from "@/lib/auth/types";
import {
  VISITOR_LIMITS,
  createAdmissionLedger,
  isRoomFull,
  readVisitorPresence,
} from "@/lib/realtime/visitor-rooms";

/**
 * Visitor rooms hold at most VISITOR_LIMITS.maxMembers people. Members are
 * seated in the order a client first saw them, a joiner whose first sync
 * already shows a full room turns back, and malformed or spoofing presence
 * entries never count.
 */

type Listener = (...args: unknown[]) => void;

const h = vi.hoisted(() => {
  const makeChannel = () => {
    const channel = {
      state: {} as Record<string, unknown[]>,
      on: vi.fn<(type: string, filter: { event: string }, cb: Listener) => unknown>(
        (): unknown => channel
      ),
      subscribe: vi.fn<(cb: (status: string) => void) => unknown>((): unknown => channel),
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
    client: {
      channel: vi.fn<(name: string, opts?: unknown) => ReturnType<typeof makeChannel>>(() =>
        makeChannel()
      ),
      removeChannel: vi.fn<(channel: unknown) => Promise<string>>(async () => "ok"),
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

const CODE = "ABCDEFGHJKMN";
const MAX = VISITOR_LIMITS.maxMembers;

/** A nanoid(16)-shaped id that sorts by `n`. */
function vid(n: number): string {
  return `member${String(n).padStart(10, "0")}`;
}

function entry(id: string, name = `Person ${id.slice(-3)}`) {
  return [{ id, name, color: "#00f0ff", joinedAt: "2026-10-19T10:00:00.000Z" }];
}

function stateOf(ids: string[]): Record<string, unknown[]> {
  return Object.fromEntries(ids.map((id) => [id, entry(id)]));
}

describe("createAdmissionLedger", () => {
  it("seats members in the order it first saw them", () => {
    const ledger = createAdmissionLedger(3);
    expect(ledger.update(["c"]).admitted).toEqual(["c"]);
    expect(ledger.update(["c", "a"]).admitted).toEqual(["c", "a"]);
    expect(ledger.update(["a", "c", "b"]).admitted).toEqual(["c", "a", "b"]);
  });

  it("puts members past the cap in overflow, then seats them when a place frees up", () => {
    const ledger = createAdmissionLedger(2);
    ledger.update(["a", "b"]);
    expect(ledger.update(["a", "b", "c", "d"])).toEqual({
      admitted: ["a", "b"],
      overflow: ["c", "d"],
    });
    expect(ledger.update(["b", "c", "d"])).toEqual({ admitted: ["b", "c"], overflow: ["d"] });
  });

  it("sends a returning member to the back of the line", () => {
    const ledger = createAdmissionLedger(2);
    ledger.update(["a", "b"]);
    ledger.update(["b"]);
    expect(ledger.update(["a", "b", "c"]).admitted).toEqual(["b", "a"]);
  });

  it("breaks ties in one batch by id, with the client itself last", () => {
    const ledger = createAdmissionLedger(3);
    expect(ledger.update(["z", "me", "b", "y"], "me")).toEqual({
      admitted: ["b", "y", "z"],
      overflow: ["me"],
    });
  });

  it("keeps the client's own place while its presence is still on the way", () => {
    const ledger = createAdmissionLedger(3);
    ledger.update(["a", "b"], "me");
    expect(ledger.update(["a", "b", "late"], "me")).toEqual({
      admitted: ["a", "b", "me"],
      overflow: ["late"],
    });
  });
});

describe("isRoomFull", () => {
  it(`turns a joiner back once ${MAX} other people are in`, () => {
    expect(isRoomFull(MAX - 1)).toBe(false);
    expect(isRoomFull(MAX)).toBe(true);
    expect(isRoomFull(MAX + 5)).toBe(true);
  });
});

describe("readVisitorPresence", () => {
  const good = { id: vid(1), name: "Sam", color: "#00f0ff", joinedAt: "2026-10-19T10:00:00Z" };

  it("keeps well-formed entries", () => {
    expect(readVisitorPresence({ [good.id]: [good] })).toEqual([good]);
  });

  it.each([
    ["a key that differs from the id", { [vid(2)]: [good] }],
    ["an id that isn't a visitor id", { "owner-1": [{ ...good, id: "owner-1" }] }],
    ["a bidi override in the name", { [good.id]: [{ ...good, name: "Sam‮evil" }] }],
    ["a control character in the name", { [good.id]: [{ ...good, name: "Sam\u0007" }] }],
    ["a blank name", { [good.id]: [{ ...good, name: "   " }] }],
    ["an over-long name", { [good.id]: [{ ...good, name: "x".repeat(81) }] }],
    ["an untrimmed name", { [good.id]: [{ ...good, name: " Sam" }] }],
    ["a non-string color", { [good.id]: [{ ...good, color: 7 }] }],
    ["an over-long color", { [good.id]: [{ ...good, color: "#".repeat(33) }] }],
    ["a joinedAt that isn't a time", { [good.id]: [{ ...good, joinedAt: "soon" }] }],
    ["a missing joinedAt", { [good.id]: [{ ...good, joinedAt: undefined }] }],
    ["no metas", { [good.id]: [] }],
    ["metas that aren't a list", { [good.id]: good }],
  ])("drops %s", (_label, state) => {
    expect(readVisitorPresence(state as Record<string, unknown>)).toEqual([]);
  });

  it("stops scanning a flooded presence state", () => {
    const flood = stateOf(Array.from({ length: MAX * 20 }, (_, i) => vid(i)));
    expect(readVisitorPresence(flood).length).toBe(MAX * 10);
  });
});

describe("useRoom visitor member cap", () => {
  const me = { id: "me00000000000000", name: "Me" };

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    h.auth = { status: "anonymous", user: null };
    h.client.channel.mockClear();
    h.client.removeChannel.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function mount() {
    const hook = renderHook(() =>
      useRoom<unknown>("planning-poker", CODE, null, { visitor: true, identity: me })
    );
    const channel = h.client.channel.mock.results[0].value as ReturnType<typeof h.makeChannel>;
    const syncCall = channel.on.mock.calls.find((c) => c[0] === "presence");
    const sync = () => act(() => syncCall?.[2]());
    return { hook, channel, sync };
  }

  it(`leaves and reports roomFull when the first sync shows ${MAX} others`, () => {
    const { hook, channel, sync } = mount();
    channel.state = stateOf(Array.from({ length: MAX }, (_, i) => vid(i)));
    sync();
    expect(hook.result.current.roomFull).toBe(true);
    expect(hook.result.current.members).toEqual([]);
    expect(hook.result.current.isConnected).toBe(false);
    expect(channel.untrack).toHaveBeenCalled();
    expect(h.client.removeChannel).toHaveBeenCalledWith(channel);
    // A late SUBSCRIBED must not take a seat.
    const onStatus = channel.subscribe.mock.calls[0][0];
    act(() => onStatus("SUBSCRIBED"));
    expect(channel.track).not.toHaveBeenCalled();
    expect(hook.result.current.isConnected).toBe(false);
  });

  it(`joins as the ${MAX}th member`, () => {
    const { hook, channel, sync } = mount();
    channel.state = stateOf(Array.from({ length: MAX - 1 }, (_, i) => vid(i)));
    sync();
    expect(hook.result.current.roomFull).toBe(false);
    channel.state = { ...channel.state, [me.id]: entry(me.id, me.name) };
    sync();
    expect(hook.result.current.members).toHaveLength(MAX);
    expect(hook.result.current.members.some((m) => m.id === me.id)).toBe(true);
    expect(h.client.removeChannel).not.toHaveBeenCalled();
  });

  it("does not count this client's own (ghost) entry towards a full room", () => {
    const { hook, channel, sync } = mount();
    channel.state = stateOf([...Array.from({ length: MAX - 1 }, (_, i) => vid(i)), me.id]);
    sync();
    expect(hook.result.current.roomFull).toBe(false);
  });

  it("only checks fullness on the first sync, then caps the member list", () => {
    const { hook, channel, sync } = mount();
    channel.state = stateOf([vid(1), vid(2), me.id]);
    sync();
    const crowd = Array.from({ length: MAX + 5 }, (_, i) => vid(100 + i));
    channel.state = stateOf([vid(1), vid(2), me.id, ...crowd]);
    sync();
    expect(hook.result.current.roomFull).toBe(false);
    const ids = hook.result.current.members.map((m) => m.id);
    expect(ids).toHaveLength(MAX);
    // Earlier arrivals (and this client) keep their seats.
    expect(ids.slice(0, 3)).toEqual([vid(1), vid(2), me.id]);
    expect(ids).not.toContain(vid(100 + MAX + 4));
  });

  it("drops members with bidi or control characters in their names", () => {
    const { hook, channel, sync } = mount();
    channel.state = {
      [vid(1)]: entry(vid(1), "Alice"),
      [vid(2)]: entry(vid(2), "Bob‮ecila"),
      [vid(3)]: entry(vid(3), "Eve\u0000"),
      [vid(4)]: entry(vid(4), "⁦Mallory"),
    };
    sync();
    expect(hook.result.current.members.map((m) => m.name)).toEqual(["Alice"]);
  });

  it("maps peer colors through the allowlist", () => {
    const { hook, channel, sync } = mount();
    channel.state = {
      [vid(1)]: [{ ...entry(vid(1))[0], color: "red;background:url(x)" }],
    };
    sync();
    expect(hook.result.current.members[0].color).toBe("#00f0ff");
  });

  it("invalid entries don't fill seats", () => {
    const { hook, channel, sync } = mount();
    channel.state = Object.fromEntries(
      Array.from({ length: MAX }, (_, i) => [vid(i), entry(vid(i), `Bad‮${i}`)])
    );
    sync();
    expect(hook.result.current.roomFull).toBe(false);
    expect(hook.result.current.members).toEqual([]);
  });
});
