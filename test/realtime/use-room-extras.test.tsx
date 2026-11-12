import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import {
  SHOW_ROOM_EVENTS,
  showStateInput,
  type ShowStateBody,
} from "@/lib/realtime/show-room/protocol";
import {
  ROOM_TIMER_EVENT,
  roomTimerInput,
  roomTimerLeft,
  startRoomTimer,
  type RoomTimerMessage,
} from "@/lib/realtime/room-timer";
import { REACTION_LIMITS, ROOM_REACT_EVENT } from "@/lib/realtime/room-reactions";
import {
  ROOM_TIMER_JOIN_DELAY_MS,
  ROOM_TIMER_RESEND_MS,
  useRoomExtras,
  type RoomExtrasPort,
  type RoomExtrasSigner,
} from "@/lib/realtime/use-room-extras";
import { fakeRealtime, type FakeMember } from "./fake-realtime";
import { CODE, NOW, fakeVoteCrypto, type FakeVoteCrypto } from "./vote-room-fixtures";

/**
 * The extras every visitor room shares: the host's countdown on everyone's
 * phone, synced from the end time (never a message a second), and emoji
 * reactions held to a per-member limit. First on a small in-memory bus,
 * then end to end in a signed show room on the fake Realtime channel.
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useShowRoom } from "@/lib/realtime/show-room/use-show-room";

const HOST_ID = "host_00000000000";
const A_ID = "alice_0000000000";
const B_ID = "bobby_0000000000";

async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

async function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

/** An in-memory channel: a broadcast reaches every other client, never its sender. */
function bus() {
  const handlers = new Map<string, Set<{ owner: string; fn: (p: unknown) => void }>>();
  const log: { from: string; event: string; payload: unknown }[] = [];
  const members: { id: string }[] = [];
  const channel = (owner: string) => ({
    broadcast: (event: string, payload: unknown) => {
      log.push({ from: owner, event, payload });
      handlers.get(event)?.forEach((h) => h.owner !== owner && h.fn(payload));
    },
    subscribeToEvent: (event: string, fn: (p: unknown) => void) => {
      const set = handlers.get(event) ?? new Set();
      const entry = { owner, fn };
      set.add(entry);
      handlers.set(event, set);
      return () => set.delete(entry);
    },
    isConnected: true,
    members,
  });
  return { channel, log, members, sent: (event: string) => log.filter((l) => l.event === event) };
}

type Bus = ReturnType<typeof bus>;

function port(
  b: Bus,
  selfId: string,
  role: "host" | "participant",
  o: Partial<RoomExtrasPort> = {}
): RoomExtrasPort {
  return {
    tool: "planning-poker",
    code: CODE,
    role,
    selfId,
    hostId: role === "host" ? selfId : HOST_ID,
    live: true,
    channel: b.channel(selfId),
    signer: null,
    ...o,
  };
}

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the room timer, synced from the end time", () => {
  it("reaches a participant whose clock is off, counted from the end time", async () => {
    const b = bus();
    b.members.push({ id: HOST_ID }, { id: A_ID });
    // The phone's clock runs 90 s behind the host's.
    const phoneNow = () => Date.now() - 90_000;
    const host = renderHook(() => useRoomExtras(port(b, HOST_ID, "host")));
    const phone = renderHook(() => useRoomExtras(port(b, A_ID, "participant"), { now: phoneNow }));
    expect(host.result.current.canSetTimer).toBe(true);
    expect(phone.result.current.canSetTimer).toBe(false);

    act(() => host.result.current.setTimer(startRoomTimer(120, Date.now(), { label: "Vote" })));
    await flush();
    const t = phone.result.current.timer!;
    expect(t).toMatchObject({ label: "Vote", totalSeconds: 120 });
    // On the phone's own clock: 2 minutes left now, 1 minute later on.
    expect(roomTimerLeft(t, phoneNow())).toBe(120);
    expect(roomTimerLeft(t, phoneNow() + 60_000)).toBe(60);
  });

  it("sends nothing while it counts: one message per change, plus joins and a slow keepalive", async () => {
    const b = bus();
    b.members.push({ id: HOST_ID }, { id: A_ID });
    const { result, rerender } = renderHook(() => useRoomExtras(port(b, HOST_ID, "host")));
    act(() => result.current.setTimer(startRoomTimer(300, Date.now())));
    await flush();
    expect(b.sent(ROOM_TIMER_EVENT)).toHaveLength(1);
    // Ten seconds of countdown: no messages.
    await tick(10_000);
    expect(b.sent(ROOM_TIMER_EVENT)).toHaveLength(1);
    // Someone joins: sent again shortly after.
    b.members.push({ id: B_ID });
    rerender();
    await tick(ROOM_TIMER_JOIN_DELAY_MS + 10);
    expect(b.sent(ROOM_TIMER_EVENT)).toHaveLength(2);
    // The keepalive.
    await tick(ROOM_TIMER_RESEND_MS);
    expect(b.sent(ROOM_TIMER_EVENT)).toHaveLength(3);
    const seqs = b.sent(ROOM_TIMER_EVENT).map((m) => (m.payload as RoomTimerMessage).seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("takes a timer only from the trusted host, newest first, and drops a stop's replay", async () => {
    const b = bus();
    b.members.push({ id: HOST_ID }, { id: A_ID }, { id: B_ID });
    const phone = renderHook(() => useRoomExtras(port(b, A_ID, "participant")));
    const send = (from: string, seq: number, seconds: number | null) =>
      act(() =>
        b.channel(from).broadcast(ROOM_TIMER_EVENT, {
          v: 1,
          by: from,
          seq,
          at: Date.now(),
          timer: seconds === null ? null : startRoomTimer(seconds, Date.now()),
        })
      );
    send(B_ID, 9, 60); // not the host
    await flush();
    expect(phone.result.current.timer).toBeNull();
    send(HOST_ID, 2, 300);
    await flush();
    expect(phone.result.current.timer?.totalSeconds).toBe(300);
    send(HOST_ID, 3, null); // stopped
    await flush();
    expect(phone.result.current.timer).toBeNull();
    send(HOST_ID, 2, 300); // an old one again
    await flush();
    expect(phone.result.current.timer).toBeNull();
  });

  it("holds a timer that beat the host's first state until the host is known", async () => {
    const b = bus();
    b.members.push({ id: HOST_ID }, { id: A_ID });
    let hostId: string | null = null;
    const phone = renderHook(() => useRoomExtras(port(b, A_ID, "participant", { hostId })));
    act(() =>
      b.channel(HOST_ID).broadcast(ROOM_TIMER_EVENT, {
        v: 1,
        by: HOST_ID,
        seq: 1,
        at: Date.now(),
        timer: startRoomTimer(90, Date.now()),
      })
    );
    await flush();
    expect(phone.result.current.timer).toBeNull();
    hostId = HOST_ID;
    phone.rerender();
    await flush();
    expect(phone.result.current.timer?.totalSeconds).toBe(90);
  });

  it("in a signed room, takes only timers signed by the pinned host", async () => {
    const b = bus();
    b.members.push({ id: HOST_ID }, { id: A_ID });
    const good = "g".repeat(86);
    const signer: RoomExtrasSigner = {
      sign: async () => good,
      verify: async (by, _input, sig) => by === HOST_ID && sig === good,
    };
    const host = renderHook(() => useRoomExtras(port(b, HOST_ID, "host", { signer })));
    const phone = renderHook(() => useRoomExtras(port(b, A_ID, "participant", { signer })));
    act(() => host.result.current.setTimer(startRoomTimer(60, Date.now())));
    await flush();
    expect((b.sent(ROOM_TIMER_EVENT)[0].payload as RoomTimerMessage).sig).toBe(good);
    expect(phone.result.current.timer?.totalSeconds).toBe(60);
    // Unsigned, or signed by anyone else: ignored.
    for (const sig of [undefined, "b".repeat(86)]) {
      act(() =>
        b.channel(HOST_ID).broadcast(ROOM_TIMER_EVENT, {
          v: 1,
          by: HOST_ID,
          seq: 50,
          at: Date.now(),
          timer: null,
          ...(sig ? { sig } : {}),
        })
      );
      await flush();
      expect(phone.result.current.timer?.totalSeconds).toBe(60);
    }
  });

  it("drops the old host's timer when another member takes over", async () => {
    const b = bus();
    b.members.push({ id: HOST_ID }, { id: A_ID }, { id: B_ID });
    let hostId = HOST_ID;
    const phone = renderHook(() => useRoomExtras(port(b, A_ID, "participant", { hostId })));
    act(() =>
      b.channel(HOST_ID).broadcast(ROOM_TIMER_EVENT, {
        v: 1,
        by: HOST_ID,
        seq: 4,
        at: Date.now(),
        timer: startRoomTimer(90, Date.now()),
      })
    );
    await flush();
    expect(phone.result.current.timer).not.toBeNull();
    hostId = B_ID;
    phone.rerender();
    await flush();
    expect(phone.result.current.timer).toBeNull();
  });

  it("can't be set by a participant, nor once the room is over", async () => {
    const b = bus();
    const phone = renderHook(() => useRoomExtras(port(b, A_ID, "participant")));
    act(() => phone.result.current.setTimer(startRoomTimer(60, Date.now())));
    const host = renderHook(() => useRoomExtras(port(b, HOST_ID, "host", { live: false })));
    act(() => host.result.current.setTimer(startRoomTimer(60, Date.now())));
    await flush();
    expect(b.sent(ROOM_TIMER_EVENT)).toHaveLength(0);
    expect(host.result.current.canSetTimer).toBe(false);
  });

  it("stays off when the room carries its own countdown (Retro)", async () => {
    const b = bus();
    const host = renderHook(() => useRoomExtras(port(b, HOST_ID, "host"), { timer: false }));
    expect(host.result.current.canSetTimer).toBe(false);
    act(() => host.result.current.setTimer(startRoomTimer(60, Date.now())));
    await flush();
    expect(b.sent(ROOM_TIMER_EVENT)).toHaveLength(0);
  });
});

describe("reactions", () => {
  it("show on everyone's screen, the sender's own at once, and leave after a moment", async () => {
    const b = bus();
    b.members.push({ id: HOST_ID }, { id: A_ID });
    const host = renderHook(() => useRoomExtras(port(b, HOST_ID, "host")));
    const phone = renderHook(() => useRoomExtras(port(b, A_ID, "participant")));
    let sent = false;
    act(() => {
      sent = phone.result.current.react(1);
    });
    expect(sent).toBe(true);
    expect(phone.result.current.reactions.map((r) => r.r)).toEqual([1]);
    expect(host.result.current.reactions.map((r) => r.r)).toEqual([1]);
    // Only an index goes on the wire.
    expect(b.sent(ROOM_REACT_EVENT)[0].payload).toEqual({ v: 1, by: A_ID, r: 1 });
    await tick(REACTION_LIMITS.showMs + 10);
    expect(phone.result.current.reactions).toHaveLength(0);
    expect(host.result.current.reactions).toHaveLength(0);
  });

  it("hold each member to a short burst, then one every couple of seconds", async () => {
    const b = bus();
    b.members.push({ id: HOST_ID }, { id: A_ID });
    const phone = renderHook(() => useRoomExtras(port(b, A_ID, "participant")));
    const results: boolean[] = [];
    act(() => {
      for (let i = 0; i < 10; i++) results.push(phone.result.current.react(0));
    });
    expect(results.filter(Boolean)).toHaveLength(REACTION_LIMITS.burst);
    await tick(REACTION_LIMITS.refillMs + 5);
    let again = false;
    act(() => {
      again = phone.result.current.react(0);
    });
    expect(again).toBe(true);
  });

  it("limit what a flooding sender puts on other screens, and ignore non-members and junk", async () => {
    const b = bus();
    b.members.push({ id: HOST_ID }, { id: A_ID });
    const host = renderHook(() => useRoomExtras(port(b, HOST_ID, "host")));
    act(() => {
      // A script skipping its own limit.
      for (let i = 0; i < 50; i++)
        b.channel(A_ID).broadcast(ROOM_REACT_EVENT, { v: 1, by: A_ID, r: 2 });
      // Someone not in the room, and things that aren't reactions.
      b.channel(B_ID).broadcast(ROOM_REACT_EVENT, { v: 1, by: B_ID, r: 0 });
      b.channel(A_ID).broadcast(ROOM_REACT_EVENT, { v: 1, by: A_ID, r: 9 });
      b.channel(A_ID).broadcast(ROOM_REACT_EVENT, { v: 1, by: A_ID, text: "<b>hi</b>" });
    });
    expect(host.result.current.reactions).toHaveLength(REACTION_LIMITS.burst);
    expect(host.result.current.reactions.every((r) => r.r === 2)).toBe(true);
  });

  it("can't be sent once the room is over", () => {
    const b = bus();
    const phone = renderHook(() => useRoomExtras(port(b, A_ID, "participant", { live: false })));
    let sent = true;
    act(() => {
      sent = phone.result.current.react(0);
    });
    expect(sent).toBe(false);
    expect(b.sent(ROOM_REACT_EVENT)).toHaveLength(0);
  });
});

describe("in a signed show room, end to end", () => {
  const HOST: FakeMember = { id: HOST_ID, name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
  const A: FakeMember = { id: A_ID, name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };

  it("the host signs its timer with the room key", async () => {
    const crypto = fakeVoteCrypto();
    const view = renderHook(() => {
      const room = useShowRoom({
        role: "host",
        tool: "picker",
        code: CODE,
        identity: { id: HOST.id, name: HOST.name },
        startedAt: NOW,
        crypto,
      });
      return { room, extras: useRoomExtras(room.extras) };
    });
    await flush();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    await tick(600);
    expect(view.result.current.extras.canSetTimer).toBe(true);
    act(() => view.result.current.extras.setTimer(startRoomTimer(180, Date.now())));
    await flush();
    const msg = ch.sent(ROOM_TIMER_EVENT).at(-1) as RoomTimerMessage;
    expect(msg).toMatchObject({ v: 1, by: HOST.id, seq: 1, timer: { totalSeconds: 180 } });
    const state = ch.sent(SHOW_ROOM_EVENTS.state).at(-1) as ShowStateBody;
    const { sig, ...unsigned } = msg;
    expect(
      await crypto.verify(state.keys.sig, roomTimerInput("picker", CODE, unsigned), sig!)
    ).toBe(true);
  });

  it("a participant counts down only a timer the pinned host signed", async () => {
    const crypto: FakeVoteCrypto = fakeVoteCrypto();
    const keys: HostKeyPair = await crypto.createHostKeys();
    const view = renderHook(() => {
      const room = useShowRoom({
        role: "participant",
        tool: "picker",
        code: CODE,
        identity: { id: A.id, name: A.name },
        hostFingerprint: keys.fingerprint,
        crypto,
      });
      return { room, extras: useRoomExtras(room.extras) };
    });
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    const body: ShowStateBody = {
      v: 1,
      by: HOST.id,
      seq: 1,
      tool: "picker",
      endsAt: Date.now() + 3 * 3_600_000,
      keys: keys.publicKeys,
      here: 0,
      frame: null,
    };
    const stateSig = await crypto.sign(keys, showStateInput(body));
    act(() => ch.deliver(SHOW_ROOM_EVENTS.state, { ...body, sig: stateSig }));
    await flush();
    expect(view.result.current.room.status).toBe("live");

    const timerMsg = {
      v: 1 as const,
      by: HOST.id,
      seq: 1,
      at: Date.now(),
      timer: startRoomTimer(60, Date.now()),
    };
    // Signed by another key: ignored.
    const other = await crypto.createHostKeys();
    const forged = await crypto.sign(other, roomTimerInput("picker", CODE, timerMsg));
    act(() => ch.deliver(ROOM_TIMER_EVENT, { ...timerMsg, sig: forged }));
    await flush();
    expect(view.result.current.extras.timer).toBeNull();
    // Signed by the pinned host: counted down here.
    const sig = await crypto.sign(keys, roomTimerInput("picker", CODE, timerMsg));
    act(() => ch.deliver(ROOM_TIMER_EVENT, { ...timerMsg, sig }));
    await flush();
    expect(view.result.current.extras.timer?.totalSeconds).toBe(60);
  });
});
