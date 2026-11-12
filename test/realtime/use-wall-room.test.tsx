import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import {
  WALL_LIMITS,
  WALL_ROOM_EVENTS,
  intentAad,
  intentCiphertextChars,
  lockOf,
  padIntent,
  wallStateInput,
  type WallIntent,
  type WallStateBody,
} from "@/lib/realtime/wall-room/protocol";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { fakeRealtime, type FakeChannel, type FakeMember } from "./fake-realtime";
import { CODE, NOW, fakeVoteCrypto, type FakeVoteCrypto } from "./vote-room-fixtures";

/**
 * The wall-room hook (and the host's panel) on a fake Realtime channel and
 * a fake VoteCrypto: requests are sealed to the host at one size and
 * answered by id; a hidden round shares no post text, on the wire or in
 * the host's page, until Reveal; the saved result has no ids; a
 * participant marks its own posts and votes from memory only.
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

import { useWallRoom } from "@/lib/realtime/wall-room/use-wall-room";
import { WallRoomHost } from "@/components/collab/wall-room/wall-room-host";

const HOST: FakeMember = {
  id: "host_00000000000",
  name: "Hana Ito",
  joinedAt: "2026-10-26T09:00:00Z",
};
const A: FakeMember = { id: "alice_0000000000", name: "Alex Ng", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo Li", joinedAt: "2026-10-26T09:02:00Z" };
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

type State = WallStateBody & { sig: string };
const states = (ch: FakeChannel) => ch.sent(WALL_ROOM_EVENTS.state) as State[];

async function deliver(ch: FakeChannel, event: string, payload: unknown) {
  act(() => ch.deliver(event, payload));
  await flush();
}

let iidN = 0;
async function request(crypto: FakeVoteCrypto, s: State, by: string, intent: WallIntent) {
  const iid = `iid_${String(++iidN).padStart(8, "0")}`;
  const sealed = await crypto.seal(s.keys.ecdh, intentAad(by, iid), padIntent(intent)!);
  return { v: 1, by, iid, ...sealed };
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

async function startHost() {
  const crypto = fakeVoteCrypto();
  const view = renderHook(() =>
    useWallRoom({
      role: "host",
      tool: "audience-wall",
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
    ch.setPresence([HOST, A, B]);
  });
  await flush();
  await tick(600);
  return { ...view, ch, crypto };
}

describe("useWallRoom: host", () => {
  it("opens a hidden round, takes sealed posts, and shares only the count until Reveal", async () => {
    const { ch, crypto, result } = await startHost();
    expect(ch.name).toBe(`visitor:audience-wall:${CODE}`);
    let opened = false;
    act(() => {
      opened = result.current.openRound("What should we stop doing?", "hidden");
    });
    expect(opened).toBe(true);
    await tick(600);
    const s = states(ch).at(-1)!;
    expect(s.round).toMatchObject({
      prompt: "What should we stop doing?",
      mode: "hidden",
      posts: null,
    });
    const { sig, ...unsigned } = s;
    expect(await crypto.verify(s.keys.sig, wallStateInput(unsigned as WallStateBody), sig)).toBe(
      true
    );

    const env = await request(crypto, s, A.id, {
      t: "post",
      r: s.round!.id,
      pid: "pid_00000001",
      text: "Status meetings",
      lock: lockOf("keyA_0123456789abcdef"),
    });
    expect(env.ct).toHaveLength(intentCiphertextChars());
    // A request of another size never reaches decryption.
    const opens = crypto.calls.open;
    await deliver(ch, WALL_ROOM_EVENTS.intent, { ...env, ct: `${env.ct}AAAA` });
    expect(crypto.calls.open).toBe(opens);
    await deliver(ch, WALL_ROOM_EVENTS.intent, env);
    await tick(600);
    const after = states(ch).at(-1)!;
    expect(after.acks).toContain(env.iid);
    expect(after.round).toMatchObject({ count: 1, posts: null });
    expect(JSON.stringify(after)).not.toContain("Status meetings");
    expect(result.current.round).toMatchObject({ count: 1, posts: null });
    expect(result.current.result()).toBeNull();

    act(() => result.current.reveal());
    await tick(600);
    const revealed = states(ch).at(-1)!;
    expect(revealed.round!.posts).toEqual([
      { id: "pid_00000001", text: "Status meetings", votes: 0, merged: [] },
    ]);
    const saved = result.current.result()!;
    expect(saved.posts).toEqual([{ text: "Status meetings", votes: 0, merged: [] }]);
    expect(JSON.stringify(saved)).not.toContain(A.id);
    expect(JSON.stringify(saved)).not.toContain("pid_00000001");
  });

  it("answers a refused request by id, and applies a resend once", async () => {
    const { ch, crypto, result } = await startHost();
    act(() => {
      result.current.openRound("Questions?", "live");
    });
    await tick(600);
    const s = states(ch).at(-1)!;
    const first = await request(crypto, s, A.id, {
      t: "post",
      r: s.round!.id,
      pid: "pid_00000001",
      text: "One",
      lock: lockOf("keyA_0123456789abcdef"),
    });
    await deliver(ch, WALL_ROOM_EVENTS.intent, first);
    await deliver(ch, WALL_ROOM_EVENTS.intent, first);
    const tooSoon = await request(crypto, s, A.id, {
      t: "post",
      r: s.round!.id,
      pid: "pid_00000002",
      text: "Two",
      lock: lockOf("keyA_0123456789abcdef"),
    });
    await deliver(ch, WALL_ROOM_EVENTS.intent, tooSoon);
    await tick(600);
    const after = states(ch).at(-1)!;
    expect(after.round!.count).toBe(1);
    expect(after.acks).toEqual([first.iid]);
    expect(after.nacks).toEqual([{ iid: tooSoon.iid, why: "rate" }]);
    await tick(WALL_LIMITS.postIntervalMs);
  });

  it("names raised hands in the queue, and ignores a removed member", async () => {
    const { ch, crypto, result } = await startHost();
    await tick(600);
    const s = states(ch).at(-1)!;
    await deliver(
      ch,
      WALL_ROOM_EVENTS.intent,
      await request(crypto, s, B.id, { t: "hand", up: true })
    );
    expect(result.current.hands).toEqual([{ id: B.id, name: "Bo Li" }]);
    act(() => result.current.kick(A.id));
    await flush();
    await deliver(
      ch,
      WALL_ROOM_EVENTS.intent,
      await request(crypto, s, A.id, { t: "hand", up: true })
    );
    expect(result.current.hands.map((h) => h.id)).toEqual([B.id]);
    act(() => result.current.lowerHand(B.id));
    expect(result.current.hands).toEqual([]);
  });
});

describe("useWallRoom: participant", () => {
  let crypto: FakeVoteCrypto;
  let keys: HostKeyPair;
  let seq = 0;

  beforeEach(async () => {
    crypto = fakeVoteCrypto();
    keys = await crypto.createHostKeys();
    seq = 0;
  });

  async function hostState(over: Partial<WallStateBody> = {}) {
    const body: WallStateBody = {
      v: 1,
      by: HOST.id,
      seq: ++seq,
      tool: "audience-wall",
      endsAt: Date.now() + 3 * 3_600_000,
      keys: keys.publicKeys,
      round: {
        id: "round_000001",
        prompt: "Questions?",
        open: true,
        mode: "live",
        revealed: false,
        count: 0,
        posts: [],
      },
      hands: [],
      acks: [],
      nacks: [],
      ...over,
    };
    const sig = await crypto.sign(keys, wallStateInput(body));
    return JSON.parse(JSON.stringify({ ...body, sig }));
  }

  it("seals each request to the host's key at one size, and marks its own post from memory", async () => {
    const { result } = renderHook(() =>
      useWallRoom({
        role: "participant",
        tool: "audience-wall",
        code: CODE,
        identity: ident(A),
        hostFingerprint: keys.fingerprint,
        crypto,
      })
    );
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    await deliver(ch, WALL_ROOM_EVENTS.state, await hostState());
    expect(result.current.status).toBe("live");
    let res = "";
    await act(async () => {
      res = await result.current.post("x".repeat(WALL_LIMITS.maxPostChars + 1));
    });
    expect(res).toBe("too-long");
    await act(async () => {
      res = await result.current.post("  Why so many meetings?  ");
    });
    expect(res).toBe("sent");
    const [env] = ch.sent(WALL_ROOM_EVENTS.intent) as { ct: string; iid: string; by: string }[];
    expect(env.ct).toHaveLength(intentCiphertextChars());
    expect(JSON.stringify(env)).not.toContain("meetings");
    expect(result.current.mine).toEqual([
      expect.objectContaining({ text: "Why so many meetings?", status: "sending" }),
    ]);
    // A second post within 5 seconds is held back here already.
    await act(async () => {
      res = await result.current.post("Another");
    });
    expect(res).toBe("too-soon");
    // The host's acknowledgement settles it.
    const mineId = result.current.mine[0].id;
    await deliver(
      ch,
      WALL_ROOM_EVENTS.state,
      await hostState({
        round: {
          id: "round_000001",
          prompt: "Questions?",
          open: true,
          mode: "live",
          revealed: false,
          count: 1,
          posts: [{ id: mineId, text: "Why so many meetings?", votes: 0, merged: [] }],
        },
        acks: [env.iid],
      })
    );
    expect(result.current.mine[0].status).toBe("posted");
    // Its own post can't be upvoted, someone else's can, once.
    await act(async () => {
      res = await result.current.vote(mineId);
    });
    expect(res).toBe("not-yours");
  });

  it("gives up after three resends and says the post wasn't confirmed", async () => {
    const { result } = renderHook(() =>
      useWallRoom({
        role: "participant",
        tool: "audience-wall",
        code: CODE,
        identity: ident(A),
        hostFingerprint: keys.fingerprint,
        crypto,
      })
    );
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    await deliver(ch, WALL_ROOM_EVENTS.state, await hostState());
    await act(async () => {
      await result.current.post("Hello");
    });
    await tick(2_000);
    await tick(4_000);
    await tick(8_000);
    const sent = ch.sent(WALL_ROOM_EVENTS.intent) as { iid: string; ct: string }[];
    expect(sent.length).toBe(3);
    expect(new Set(sent.map((e) => e.iid)).size).toBe(1);
    expect(new Set(sent.map((e) => e.ct)).size).toBe(1);
    expect(result.current.mine[0].status).toBe("unconfirmed");
  });

  it("shows a refusal from the host once", async () => {
    const { result } = renderHook(() =>
      useWallRoom({
        role: "participant",
        tool: "audience-wall",
        code: CODE,
        identity: ident(A),
        hostFingerprint: keys.fingerprint,
        crypto,
      })
    );
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    await deliver(ch, WALL_ROOM_EVENTS.state, await hostState());
    await act(async () => {
      await result.current.raiseHand(true);
    });
    const [env] = ch.sent(WALL_ROOM_EVENTS.intent) as { iid: string }[];
    await deliver(
      ch,
      WALL_ROOM_EVENTS.state,
      await hostState({ nacks: [{ iid: env.iid, why: "closed" }] })
    );
    expect(result.current.lastRefusal).toBe("closed");
  });
});

describe("WallRoomHost: hidden until reveal", () => {
  it("keeps every post's text out of the host's page until Reveal", async () => {
    const crypto = fakeVoteCrypto();
    const onSave = vi.fn(() => undefined);
    render(
      <LiveAnnouncerProvider>
        <WallRoomHost
          tool="audience-wall"
          toolName="Audience Wall"
          onSave={onSave}
          crypto={crypto}
        />
      </LiveAnnouncerProvider>
    );
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open a live wall" }));
    });
    const dialog = screen.getByRole("dialog");
    const name = dialog.querySelector("input:not([type=checkbox])") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(name, { target: { value: "Hana Ito" } });
      fireEvent.click(dialog.querySelector("input[type=checkbox]")!);
      fireEvent.click(screen.getByRole("button", { name: "Start room" }));
    });
    await flush();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
    });
    await flush();
    const hostId = (ch.track.mock.calls.at(-1) as unknown as [{ id: string }])[0].id;
    act(() => {
      ch.setPresence([{ ...HOST, id: hostId }, A]);
    });
    await flush();
    await tick(600);
    fireEvent.change(screen.getByLabelText(/Prompt/), { target: { value: "What worries you?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open the wall" }));
    });
    await tick(600);
    const s = states(ch).at(-1)!;
    await deliver(
      ch,
      WALL_ROOM_EVENTS.intent,
      await request(crypto, s, A.id, {
        t: "post",
        r: s.round!.id,
        pid: "pid_00000001",
        text: "The release date",
        lock: lockOf("keyA_0123456789abcdef"),
      })
    );
    await tick(600);
    expect(screen.getByText(/1 post so far\. They stay hidden, here too/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("The release date");
    expect(screen.queryByRole("button", { name: "Save round" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal posts" }));
    });
    await flush();
    expect(screen.getByText("The release date")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = (onSave.mock.calls[0] as unknown as [object])[0];
    expect(saved).toMatchObject({
      prompt: "What worries you?",
      posts: [{ text: "The release date", votes: 0, merged: [] }],
    });
    expect(JSON.stringify(saved)).not.toContain(A.id);
    expect(JSON.stringify(saved)).not.toContain(hostId);
  });
});
