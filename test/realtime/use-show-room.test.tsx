import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import {
  SHOW_ROOM_EVENTS,
  showStateInput,
  type ShowStateBody,
} from "@/lib/realtime/show-room/protocol";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { ShowFrameView } from "@/components/collab/show-room/show-frame-view";
import { fakeRealtime, type FakeChannel, type FakeMember } from "./fake-realtime";
import { CODE, NOW, fakeVoteCrypto, type FakeVoteCrypto } from "./vote-room-fixtures";

/**
 * The show-room hook on a fake Realtime channel and a fake VoteCrypto: the
 * host's frames are parsed before they go and signed; a late joiner gets
 * the latest frame; participants pin the host by the link's key, read only
 * newer states, and draw only payloads their parser accepts; "I'm here" is
 * counted per seat, in the host's memory only.
 */

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

import { useShowRoom } from "@/lib/realtime/show-room/use-show-room";

const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo", joinedAt: "2026-10-26T09:02:00Z" };
const ident = (m: FakeMember) => ({ id: m.id, name: m.name });

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

function states(ch: FakeChannel): (ShowStateBody & { sig: string })[] {
  return ch.sent(SHOW_ROOM_EVENTS.state) as (ShowStateBody & { sig: string })[];
}

async function deliver(ch: FakeChannel, event: string, payload: unknown) {
  act(() => ch.deliver(event, payload));
  await flush();
}

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

async function startHost(present: FakeMember[] = [HOST, A]) {
  const crypto = fakeVoteCrypto();
  const view = renderHook(() =>
    useShowRoom({
      role: "host",
      tool: "picker",
      code: CODE,
      identity: ident(HOST),
      startedAt: NOW,
      crypto,
    })
  );
  await flush();
  const ch = fakeRealtime.last();
  act(() => {
    ch.connect();
    ch.setPresence(present);
  });
  await flush();
  await tick(600);
  return { ...view, ch, crypto };
}

describe("useShowRoom: host", () => {
  it("opens the tool's visitor channel and signs a state with no frame yet", async () => {
    const { ch, crypto, result } = await startHost();
    expect(ch.name).toBe(`visitor:picker:${CODE}`);
    expect(result.current.status).toBe("live");
    expect(result.current.joinPath).toMatch(
      new RegExp(`^/join/picker/${CODE}#k=[A-Za-z0-9_-]{22}$`)
    );
    const s = states(ch).at(-1)!;
    expect(s).toMatchObject({ v: 1, tool: "picker", frame: null, here: 0 });
    const { sig, ...unsigned } = s;
    expect(await crypto.verify(s.keys.sig, showStateInput(unsigned as ShowStateBody), sig)).toBe(
      true
    );
  });

  it("shows only frames its parser accepts, numbered, and clears them", async () => {
    const { ch, result } = await startHost();
    let ok = false;
    act(() => {
      ok = result.current.show("bogus", { title: "x" });
    });
    expect(ok).toBe(false);
    act(() => {
      ok = result.current.show("text", { title: "" });
    });
    expect(ok).toBe(false);
    act(() => {
      ok = result.current.show("text", { title: "Sam", body: "is up next", extra: "dropped" });
    });
    expect(ok).toBe(true);
    await tick(400);
    expect(states(ch).at(-1)!.frame).toMatchObject({
      n: 1,
      kind: "text",
      data: '{"title":"Sam","body":"is up next"}',
    });
    expect(result.current.frame).toMatchObject({
      n: 1,
      supported: true,
      payload: { title: "Sam", body: "is up next" },
    });
    // The same frame again is a new frame.
    act(() => {
      result.current.show("text", { title: "Sam", body: "is up next" });
    });
    await tick(400);
    expect(states(ch).at(-1)!.frame?.n).toBe(2);
    act(() => result.current.clear());
    await tick(400);
    expect(states(ch).at(-1)!.frame).toBeNull();
    expect(result.current.frame).toBeNull();
  });

  it("sends the latest frame to someone who joins late", async () => {
    const { ch, result } = await startHost([HOST, A]);
    act(() => {
      result.current.show("text", { title: "Team names" });
    });
    await tick(400);
    const before = states(ch).length;
    act(() => ch.setPresence([HOST, A, B]));
    await flush();
    await tick(600);
    const after = states(ch);
    expect(after.length).toBeGreaterThan(before);
    expect(after.at(-1)!.frame).toMatchObject({ n: 1, kind: "text" });
  });

  it("counts I'm here per seat, only for people still in, and never a removed one", async () => {
    const { ch, result } = await startHost([HOST, A, B]);
    await deliver(ch, SHOW_ROOM_EVENTS.here, { v: 1, by: A.id, here: true });
    await deliver(ch, SHOW_ROOM_EVENTS.here, { v: 1, by: A.id, here: true });
    expect(result.current.hereCount).toBe(1);
    // Someone not in the room can't add to it.
    await deliver(ch, SHOW_ROOM_EVENTS.here, { v: 1, by: "ghost_0000000000", here: true });
    expect(result.current.hereCount).toBe(1);
    await tick(400);
    expect(states(ch).at(-1)!.here).toBe(1);
    act(() => result.current.kick(B.id));
    await flush();
    await deliver(ch, SHOW_ROOM_EVENTS.here, { v: 1, by: B.id, here: true });
    expect(result.current.hereCount).toBe(1);
    act(() => ch.setPresence([HOST, B]));
    await flush();
    expect(result.current.hereCount).toBe(0);
    // What the state carries is a count: no member id.
    await tick(400);
    expect(JSON.stringify(states(ch).at(-1))).not.toContain(A.id);
  });
});

describe("useShowRoom: participant", () => {
  let crypto: FakeVoteCrypto;
  let keys: HostKeyPair;

  beforeEach(async () => {
    crypto = fakeVoteCrypto();
    keys = await crypto.createHostKeys();
  });

  async function signed(o: Partial<ShowStateBody> = {}, k: HostKeyPair = keys) {
    const body: ShowStateBody = {
      v: 1,
      by: HOST.id,
      seq: 1,
      tool: "picker",
      endsAt: Date.now() + 3 * 3_600_000,
      keys: k.publicKeys,
      here: 0,
      frame: null,
      ...o,
    };
    const sig = await crypto.sign(k, showStateInput(body));
    return JSON.parse(JSON.stringify({ ...body, sig }));
  }

  function joined(fingerprint: string | null = keys.fingerprint) {
    const view = renderHook(() =>
      useShowRoom({
        role: "participant",
        tool: "picker",
        code: CODE,
        identity: ident(A),
        hostFingerprint: fingerprint,
        crypto,
      })
    );
    return view;
  }

  it("opens nothing without the host key in the link", async () => {
    const { result } = joined(null);
    await flush();
    expect(result.current.status).toBe("bad-link");
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });

  it("pins the host by its key, reads only newer states, and draws a parsed frame", async () => {
    const { result } = joined();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    // A state signed by another key is never trusted.
    const other = await crypto.createHostKeys();
    await deliver(ch, SHOW_ROOM_EVENTS.state, await signed({}, other));
    expect(result.current.status).toBe("waiting");
    await deliver(
      ch,
      SHOW_ROOM_EVENTS.state,
      await signed({
        seq: 3,
        frame: { n: 2, kind: "text", data: '{"title":"Sam","body":""}', at: NOW },
      })
    );
    expect(result.current.status).toBe("live");
    expect(result.current.hostName).toBe("Hana");
    expect(result.current.frame).toMatchObject({
      n: 2,
      supported: true,
      payload: { title: "Sam" },
    });
    // An older state is dropped.
    await deliver(
      ch,
      SHOW_ROOM_EVENTS.state,
      await signed({
        seq: 2,
        frame: { n: 1, kind: "text", data: '{"title":"Old","body":""}', at: NOW },
      })
    );
    expect(result.current.frame?.n).toBe(2);
    // A frame this page can't draw shows as unsupported, never as raw data.
    await deliver(
      ch,
      SHOW_ROOM_EVENTS.state,
      await signed({ seq: 4, frame: { n: 3, kind: "spin", data: '{"winner":"x"}', at: NOW } })
    );
    expect(result.current.frame).toMatchObject({ n: 3, supported: false, payload: null });
    // A tampered state fails its signature.
    const good = await signed({ seq: 5, here: 1 });
    await deliver(ch, SHOW_ROOM_EVENTS.state, { ...good, here: 2 });
    expect(result.current.hereCount).toBe(0);
    await deliver(ch, SHOW_ROOM_EVENTS.state, good);
    expect(result.current.hereCount).toBe(1);
  });

  it("says I'm here, and sends nothing else", async () => {
    const { result } = joined();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    await deliver(ch, SHOW_ROOM_EVENTS.state, await signed());
    act(() => result.current.sayHere(true));
    expect(result.current.iAmHere).toBe(true);
    expect(ch.sent(SHOW_ROOM_EVENTS.here)).toEqual([{ v: 1, by: A.id, here: true }]);
    const events = ch.send.mock.calls.map((c) => c[0].event);
    expect(new Set(events)).toEqual(new Set([SHOW_ROOM_EVENTS.here]));
    // show() is the host's alone.
    expect(result.current.show("text", { title: "x" })).toBe(false);
  });
});

describe("ShowFrameView", () => {
  it("draws a text frame, a waiting line, or a reload line for what it can't draw", () => {
    const { rerender } = render(
      <LiveAnnouncerProvider>
        <ShowFrameView tool="picker" frame={null} />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the host to show something");
    rerender(
      <LiveAnnouncerProvider>
        <ShowFrameView
          tool="picker"
          frame={{
            n: 1,
            kind: "text",
            payload: { title: "Sam", body: "is next" },
            supported: true,
            at: NOW,
          }}
        />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("is next")).toBeInTheDocument();
    rerender(
      <LiveAnnouncerProvider>
        <ShowFrameView
          tool="picker"
          frame={{ n: 2, kind: "spin", payload: null, supported: false, at: NOW }}
        />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByText(/can't display\. Reload the page/)).toBeInTheDocument();
  });
});
