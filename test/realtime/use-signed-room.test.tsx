import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import { HOST_MIGRATION_DELAY_MS } from "@/lib/realtime/host-election";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { SIGNED_NO_HOST_TIMEOUT_MS } from "@/lib/realtime/use-signed-room";
import type { RoomEndBody, RoomKickBody } from "@/lib/realtime/signed-room";
import {
  SHOW_ROOM_EVENTS,
  showControlInput,
  showStateInput,
  type ShowStateBody,
} from "@/lib/realtime/show-room/protocol";
import {
  WALL_ROOM_EVENTS,
  wallControlInput,
  wallStateInput,
  type WallStateBody,
} from "@/lib/realtime/wall-room/protocol";
import { fakeRealtime, type FakeChannel, type FakeMember } from "./fake-realtime";
import { CODE, NOW, fakeVoteCrypto, type FakeVoteCrypto } from "./vote-room-fixtures";

/**
 * The signed-room core (`use-signed-room.ts`) that show and wall rooms run
 * on, through both kinds: a participant trusts a kick or an end only when
 * the pinned host's key signed it for this kind of room; it says "host
 * left" once the host has been gone 10 s, "no host" when no host's state
 * came within 90 s, "full" in a full room, and closes at the room's end
 * time. The host asks after 30 idle minutes and then ends the room with a
 * signed end, ends at the 3-hour limit, and tells a removed member again
 * when they come back under the same id.
 */

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() })
);
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

import { useShowRoom } from "@/lib/realtime/show-room/use-show-room";
import { useWallRoom } from "@/lib/realtime/wall-room/use-wall-room";

const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo", joinedAt: "2026-10-26T09:02:00Z" };
const SPOOF: FakeMember = {
  id: "spoof_0000000000",
  name: "Hana",
  joinedAt: "2026-10-26T08:00:00Z",
};
const ident = (m: FakeMember) => ({ id: m.id, name: m.name });

async function flush() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

async function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

async function deliver(ch: FakeChannel, event: string, payload: unknown) {
  act(() => ch.deliver(event, payload));
  await flush();
}

/** What differs between the two kinds of signed room, for these tests. */
interface Kind {
  name: string;
  events: { state: string; kick: string; end: string };
  controlInput: (event: string, body: RoomKickBody | RoomEndBody) => string;
  /** A signed host state for this kind. */
  state: (
    crypto: FakeVoteCrypto,
    by: string,
    keys: HostKeyPair,
    seq: number,
    endsAt?: number
  ) => Promise<unknown>;
  participant: (crypto: FakeVoteCrypto, fingerprint: string) => () => RoomView;
  host: (crypto: FakeVoteCrypto) => () => RoomView;
}

/** What both hooks give back that these tests read. */
interface RoomView {
  status: string;
  endReason: string | null;
  hostId: string | null;
  idlePrompt: boolean;
  keepOpen: () => void;
  kick: (id: string) => void;
  joinPath: string | null;
}

const head = (by: string, keys: HostKeyPair, seq: number, tool: string, endsAt?: number) => ({
  v: 1 as const,
  by,
  seq,
  tool,
  endsAt: endsAt ?? Date.now() + VISITOR_LIMITS.hardTtlMs,
  keys: keys.publicKeys,
});

const SHOW: Kind = {
  name: "show",
  events: SHOW_ROOM_EVENTS,
  controlInput: showControlInput,
  async state(crypto, by, keys, seq, endsAt) {
    const body = {
      ...head(by, keys, seq, "picker", endsAt),
      here: 0,
      frame: null,
    } as ShowStateBody;
    return JSON.parse(
      JSON.stringify({ ...body, sig: await crypto.sign(keys, showStateInput(body)) })
    );
  },
  participant: (crypto, fingerprint) => () =>
    useShowRoom({
      role: "participant",
      tool: "picker",
      code: CODE,
      identity: ident(A),
      hostFingerprint: fingerprint,
      crypto,
    }),
  host: (crypto) => () =>
    useShowRoom({
      role: "host",
      tool: "picker",
      code: CODE,
      identity: ident(HOST),
      startedAt: NOW,
      crypto,
    }),
};

const WALL: Kind = {
  name: "wall",
  events: WALL_ROOM_EVENTS,
  controlInput: wallControlInput,
  async state(crypto, by, keys, seq, endsAt) {
    const body = {
      ...head(by, keys, seq, "audience-wall", endsAt),
      round: null,
      hands: [],
      acks: [],
      nacks: [],
    } as WallStateBody;
    return JSON.parse(
      JSON.stringify({ ...body, sig: await crypto.sign(keys, wallStateInput(body)) })
    );
  },
  participant: (crypto, fingerprint) => () =>
    useWallRoom({
      role: "participant",
      tool: "audience-wall",
      code: CODE,
      identity: ident(A),
      hostFingerprint: fingerprint,
      crypto,
    }),
  host: (crypto) => () =>
    useWallRoom({
      role: "host",
      tool: "audience-wall",
      code: CODE,
      identity: ident(HOST),
      startedAt: NOW,
      crypto,
    }),
};

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  toastMock.error.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe.each([SHOW, WALL])("signed room core ($name room): participant", (kind) => {
  let crypto: FakeVoteCrypto;
  let keys: HostKeyPair;

  beforeEach(async () => {
    crypto = fakeVoteCrypto();
    keys = await crypto.createHostKeys();
  });

  async function signedKick(by: string, k: HostKeyPair, id: string) {
    const body: RoomKickBody = { v: 1, by, id };
    return { ...body, sig: await crypto.sign(k, kind.controlInput(kind.events.kick, body)) };
  }

  async function signedEnd(by: string, k: HostKeyPair, reason: RoomEndBody["reason"] = "host") {
    const body: RoomEndBody = { v: 1, by, reason };
    return { ...body, sig: await crypto.sign(k, kind.controlInput(kind.events.end, body)) };
  }

  /** A participant who has pinned the host. */
  async function joined() {
    const view = renderHook(kind.participant(crypto, keys.fingerprint));
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A, B]);
    });
    await flush();
    await deliver(ch, kind.events.state, await kind.state(crypto, HOST.id, keys, 1));
    expect(view.result.current.status).toBe("live");
    expect(view.result.current.hostId).toBe(HOST.id);
    return { ...view, ch };
  }

  it("ignores unsigned, foreign and tampered kicks and ends; obeys the pinned host's", async () => {
    const { result, ch } = await joined();
    const spoofKeys = await crypto.createHostKeys();
    await deliver(ch, kind.events.kick, { v: 1, by: HOST.id, id: A.id });
    await deliver(ch, kind.events.kick, await signedKick(HOST.id, spoofKeys, A.id));
    await deliver(ch, kind.events.kick, await signedKick(SPOOF.id, spoofKeys, A.id));
    const kickB = await signedKick(HOST.id, keys, B.id);
    // A real signature over someone else's kick, re-aimed at this tab.
    await deliver(ch, kind.events.kick, { ...kickB, id: A.id });
    await deliver(ch, kind.events.end, { v: 1, by: HOST.id, reason: "host" });
    await deliver(ch, kind.events.end, await signedEnd(HOST.id, spoofKeys));
    const idle = await signedEnd(HOST.id, keys, "idle");
    await deliver(ch, kind.events.end, { ...idle, reason: "host", sig: "x".repeat(86) });
    // The other kind of room's signature doesn't count here.
    const otherKind = kind === SHOW ? WALL : SHOW;
    const foreignBody: RoomEndBody = { v: 1, by: HOST.id, reason: "host" };
    await deliver(ch, kind.events.end, {
      ...foreignBody,
      sig: await crypto.sign(keys, otherKind.controlInput(kind.events.end, foreignBody)),
    });
    // The real host removing someone else.
    await deliver(ch, kind.events.kick, kickB);
    expect(result.current.status).toBe("live");
    await deliver(ch, kind.events.kick, await signedKick(HOST.id, keys, A.id));
    expect(result.current.status).toBe("kicked");
    expect(ch.removed).toBe(true);
  });

  it("ends when the pinned host ends the room, with its reason", async () => {
    const { result, ch } = await joined();
    await deliver(ch, kind.events.end, await signedEnd(HOST.id, keys, "idle"));
    expect(result.current.status).toBe("ended");
    expect(result.current.endReason).toBe("idle");
    expect(ch.removed).toBe(true);
  });

  it("reads a signed end at the 3-hour limit as expired", async () => {
    const { result, ch } = await joined();
    await deliver(ch, kind.events.end, await signedEnd(HOST.id, keys, "expired"));
    expect(result.current.status).toBe("expired");
    expect(result.current.endReason).toBe("expired");
  });

  it("says the host left once the pinned host has been gone 10 s", async () => {
    const { result, ch } = await joined();
    // Back within 10 s: nothing happens.
    act(() => ch.setPresence([A, B, SPOOF]));
    await tick(HOST_MIGRATION_DELAY_MS - 1_000);
    act(() => ch.setPresence([HOST, A, B, SPOOF]));
    await tick(5_000);
    expect(result.current.status).toBe("live");
    act(() => ch.setPresence([A, B, SPOOF]));
    await tick(HOST_MIGRATION_DELAY_MS - 1);
    expect(result.current.status).toBe("live");
    await tick(1);
    expect(result.current.status).toBe("host-left");
    expect(result.current.endReason).toBe("host-left");
    expect(result.current.hostId).toBe(HOST.id);
    expect(ch.removed).toBe(true);
  });

  it("says nobody is hosting when no host's state came within 90 s", async () => {
    const { result } = renderHook(kind.participant(crypto, keys.fingerprint));
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([A, B]);
    });
    await flush();
    expect(result.current.status).toBe("waiting");
    // A state signed by another key doesn't count as a host.
    await deliver(
      ch,
      kind.events.state,
      await kind.state(crypto, SPOOF.id, await crypto.createHostKeys(), 1)
    );
    await tick(SIGNED_NO_HOST_TIMEOUT_MS - 1);
    expect(result.current.status).toBe("waiting");
    await tick(1);
    expect(result.current.status).toBe("no-host");
    expect(ch.removed).toBe(true);
  });

  it("closes at the room's end time", async () => {
    const { result } = renderHook(kind.participant(crypto, keys.fingerprint));
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    await deliver(
      ch,
      kind.events.state,
      await kind.state(crypto, HOST.id, keys, 1, NOW + 3_600_000)
    );
    await tick(3_600_000 - 1_000);
    expect(result.current.status).toBe("live");
    await tick(1_000);
    expect(result.current.status).toBe("expired");
  });

  it("turns back when the room is already full", async () => {
    const { result } = renderHook(kind.participant(crypto, keys.fingerprint));
    const ch = fakeRealtime.last();
    const crowd = Array.from({ length: VISITOR_LIMITS.maxMembers }, (_, i) => ({
      id: `crowd${String(i).padStart(11, "0")}`,
      name: `P${i}`,
      joinedAt: "2026-10-26T09:00:00Z",
    }));
    act(() => {
      ch.connect();
      ch.setPresence([...crowd, A]);
    });
    await flush();
    expect(result.current.status).toBe("full");
  });
});

describe.each([SHOW, WALL])("signed room core ($name room): host", (kind) => {
  async function startHost(present: FakeMember[] = [HOST, A]) {
    const crypto = fakeVoteCrypto();
    const view = renderHook(kind.host(crypto));
    await flush();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence(present);
    });
    await flush();
    await tick(600);
    const sigKey = (ch.sent(kind.events.state).at(-1) as { keys: { sig: string } }).keys.sig;
    return { ...view, ch, crypto, sigKey };
  }

  it("asks after 30 idle minutes, then ends the room with a signed end", async () => {
    const { ch, crypto, result, sigKey } = await startHost();
    await tick(VISITOR_LIMITS.idleMs + 30_000);
    expect(result.current.idlePrompt).toBe(true);
    act(() => result.current.keepOpen());
    expect(result.current.idlePrompt).toBe(false);
    await tick(VISITOR_LIMITS.idleMs + 30_000);
    expect(result.current.idlePrompt).toBe(true);
    await tick(VISITOR_LIMITS.idleGraceMs - 1);
    expect(result.current.status).toBe("live");
    await tick(1);
    expect(result.current.status).toBe("ended");
    expect(result.current.endReason).toBe("idle");
    const end = ch.sent(kind.events.end)[0] as RoomEndBody & { sig: string };
    expect(end).toMatchObject({ v: 1, by: HOST.id, reason: "idle" });
    const { sig, ...body } = end;
    expect(await crypto.verify(sigKey, kind.controlInput(kind.events.end, body), sig)).toBe(true);
    expect(ch.removed).toBe(true);
  });

  it("ends at the 3-hour limit", async () => {
    const { ch, result } = await startHost();
    await tick(VISITOR_LIMITS.hardTtlMs);
    expect(result.current.status).toBe("expired");
    expect(ch.sent(kind.events.end)).toEqual([expect.objectContaining({ reason: "expired" })]);
  });

  it("signs a kick, and tells a removed member again when they come back under the same id", async () => {
    const { ch, crypto, result, sigKey } = await startHost([HOST, A, B]);
    act(() => result.current.kick(A.id));
    await flush();
    const kicks = () => ch.sent(kind.events.kick) as (RoomKickBody & { sig: string })[];
    expect(kicks()).toHaveLength(1);
    const { sig, ...body } = kicks()[0];
    expect(body).toEqual({ v: 1, by: HOST.id, id: A.id });
    expect(await crypto.verify(sigKey, kind.controlInput(kind.events.kick, body), sig)).toBe(true);
    // The host can't remove itself.
    act(() => result.current.kick(HOST.id));
    await flush();
    expect(kicks()).toHaveLength(1);
    act(() => ch.setPresence([HOST, B]));
    await flush();
    act(() => ch.setPresence([HOST, A, B]));
    await flush();
    expect(kicks()).toHaveLength(2);
    expect(kicks()[1]).toMatchObject({ id: A.id });
  });
});
