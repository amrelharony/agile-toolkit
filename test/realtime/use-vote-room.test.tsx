import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { HOST_MIGRATION_DELAY_MS } from "@/lib/realtime/host-election";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { ballotAad, type HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import {
  VOTE_LIMITS,
  VOTE_ROOM_EVENTS,
  signingInput,
  type Questionnaire,
  type VoteStateMessage,
} from "@/lib/realtime/vote-room/protocol";
import { fakeRealtime, type FakeChannel, type FakeMember } from "./fake-realtime";
import {
  CODE,
  NOW,
  QUESTIONNAIRE,
  ROUND,
  answerString,
  fakeVoteCrypto,
  signedEnd,
  signedKick,
  signedState,
  type FakeVoteCrypto,
} from "./vote-room-fixtures";

/**
 * The vote-round hook against a fake Realtime channel and a fake
 * VoteCrypto: what opens when, whom a participant trusts, what the host
 * counts and shares, the reveal rules, and the room's limits.
 */

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

import {
  useVoteRoom,
  type UseVoteRoomHostOptions,
  type UseVoteRoomParticipantOptions,
} from "@/lib/realtime/vote-room/use-vote-room";

const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo", joinedAt: "2026-10-26T09:02:00Z" };
const C: FakeMember = { id: "carol_0000000000", name: "Cy", joinedAt: "2026-10-26T09:03:00Z" };
const D: FakeMember = { id: "dave0_0000000000", name: "Dee", joinedAt: "2026-10-26T09:04:00Z" };
const SPOOF: FakeMember = { id: "spoof_0000000000", name: "Sly", joinedAt: "2026-10-26T09:05:00Z" };

const ident = (m: FakeMember) => ({ id: m.id, name: m.name });

/** Let queued promise chains (signing, verifying, sealing) run. */
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

function states(ch: FakeChannel): VoteStateMessage[] {
  return ch.sent(VOTE_ROOM_EVENTS.state) as VoteStateMessage[];
}

function lastState(ch: FakeChannel): VoteStateMessage {
  const s = states(ch).at(-1);
  if (!s) throw new Error("the host sent no state");
  return s;
}

let bidCounter = 0;
/** A ballot as `by` would send it for `state`'s round. */
async function ballotFor(
  crypto: FakeVoteCrypto,
  state: Pick<VoteStateMessage, "roundId" | "keys">,
  by: string,
  indexes: number[],
  over: { roundId?: string; aadBy?: string; bid?: string } = {}
) {
  const bid = over.bid ?? `bid_${String(++bidCounter).padStart(8, "0")}`;
  const roundId = over.roundId ?? state.roundId;
  const sealed = await crypto.seal(
    state.keys.ecdh,
    ballotAad(roundId, over.aadBy ?? by, bid),
    answerString(indexes)
  );
  return { v: 1, by, roundId, bid, ...sealed };
}

async function startHost(
  over: Partial<UseVoteRoomHostOptions> = {},
  present: FakeMember[] = [HOST, A, B, C]
) {
  const crypto = (over.crypto as FakeVoteCrypto | undefined) ?? fakeVoteCrypto();
  const opts: UseVoteRoomHostOptions = {
    role: "host",
    tool: "health-check",
    code: CODE,
    identity: ident(HOST),
    questionnaire: QUESTIONNAIRE,
    minN: 3,
    startedAt: NOW,
    ...over,
    crypto,
  };
  const view = renderHook(() => useVoteRoom(opts));
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

/** Deliver a ballot to the host and let it be decrypted and folded. */
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
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ── The gate ─────────────────────────────────────────────────────────

describe("useVoteRoom: the gate", () => {
  it("opens nothing while the flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    const { result } = renderHook(() =>
      useVoteRoom({
        role: "host",
        tool: "health-check",
        code: CODE,
        identity: ident(HOST),
        questionnaire: QUESTIONNAIRE,
        crypto: fakeVoteCrypto(),
      })
    );
    await flush();
    expect(result.current.status).toBe("unavailable");
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });

  it("opens nothing for a tool that doesn't run vote rounds, a bad identity, or no crypto", async () => {
    const cases: UseVoteRoomHostOptions[] = [
      {
        role: "host",
        tool: "retro" as "health-check",
        code: CODE,
        identity: ident(HOST),
        questionnaire: QUESTIONNAIRE,
        crypto: fakeVoteCrypto(),
      },
      {
        role: "host",
        tool: "health-check",
        code: CODE,
        identity: { id: "not-a-visitor", name: "Hana" },
        questionnaire: QUESTIONNAIRE,
        crypto: fakeVoteCrypto(),
      },
      {
        role: "host",
        tool: "health-check",
        code: CODE,
        identity: ident(HOST),
        questionnaire: QUESTIONNAIRE,
        crypto: null,
      },
      {
        role: "host",
        tool: "health-check",
        code: CODE,
        identity: ident(HOST),
        questionnaire: { ...QUESTIONNAIRE, questions: [] },
        crypto: fakeVoteCrypto(),
      },
    ];
    for (const opts of cases) {
      const { result, unmount } = renderHook(() => useVoteRoom(opts));
      await flush();
      expect(result.current.status).toBe("unavailable");
      unmount();
    }
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });

  it("gives a participant without the link's #k= key 'bad-link', and opens nothing", async () => {
    for (const fp of [null, "short", ""]) {
      const { result, unmount } = renderHook(() =>
        useVoteRoom({
          role: "participant",
          tool: "health-check",
          code: CODE,
          identity: ident(A),
          hostFingerprint: fp,
          crypto: fakeVoteCrypto(),
        })
      );
      await flush();
      expect(result.current.status).toBe("bad-link");
      unmount();
    }
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });

  it("opens visitor:<tool>:<code> for the host only once its keys exist", async () => {
    const crypto = fakeVoteCrypto();
    let release: (k: HostKeyPair) => void = () => {};
    const real = crypto.createHostKeys.bind(crypto);
    const keys = await real();
    crypto.createHostKeys = () =>
      new Promise<HostKeyPair>((resolve) => {
        release = resolve;
      });
    const { result } = renderHook(() =>
      useVoteRoom({
        role: "host",
        tool: "psych-safety",
        code: CODE,
        identity: ident(HOST),
        questionnaire: QUESTIONNAIRE,
        minN: VOTE_LIMITS.minNPsychSafety,
        crypto,
      })
    );
    await flush();
    expect(result.current.status).toBe("preparing");
    expect(result.current.joinPath).toBeNull();
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
    await act(async () => release(keys));
    await flush();
    expect(fakeRealtime.client.channel).toHaveBeenCalledTimes(1);
    expect(fakeRealtime.last().name).toBe(`visitor:psych-safety:${CODE}`);
    expect(result.current.joinPath).toBe(`/join/psych-safety/${CODE}#k=${keys.fingerprint}`);
    expect(result.current.minN).toBe(5);
  });
});

// ── Participant: whom it trusts ──────────────────────────────────────

describe("useVoteRoom: a participant pins the host's key", () => {
  let crypto: FakeVoteCrypto;
  let keys: HostKeyPair;

  beforeEach(async () => {
    crypto = fakeVoteCrypto();
    keys = await crypto.createHostKeys();
  });

  function participant(me: FakeMember = A, fp: string | null = keys.fingerprint) {
    const opts: UseVoteRoomParticipantOptions = {
      role: "participant",
      tool: "health-check",
      code: CODE,
      identity: ident(me),
      hostFingerprint: fp,
      crypto,
    };
    const view = renderHook(() => useVoteRoom(opts));
    const ch = fakeRealtime.last();
    return { ...view, ch };
  }

  async function joined(me: FakeMember = A, present = [HOST, A, B, SPOOF]) {
    const p = participant(me);
    act(() => {
      p.ch.connect();
      p.ch.setPresence(present);
    });
    await flush();
    await deliver(p.ch, VOTE_ROOM_EVENTS.state, await signedState(crypto, HOST.id, keys));
    return p;
  }

  it("joins visitor:<tool>:<code> and waits for the host", async () => {
    const { result, ch } = participant();
    expect(ch.name).toBe(`visitor:health-check:${CODE}`);
    expect(result.current.status).toBe("connecting");
    act(() => ch.connect());
    expect(result.current.status).toBe("waiting");
  });

  it("pins a state with the link's fingerprint, a valid signature and a present sender", async () => {
    const { result } = await joined();
    expect(result.current.status).toBe("live");
    expect(result.current.hostId).toBe(HOST.id);
    expect(result.current.hostName).toBe("Hana");
    expect(result.current.questionnaire).toEqual(QUESTIONNAIRE);
    expect(result.current.phase).toBe("open");
    expect(result.current.roundId).toBe(ROUND);
  });

  it("ignores another key, a broken signature, and holds a sender not yet in presence", async () => {
    const { result, ch } = participant();
    act(() => {
      ch.connect();
      ch.setPresence([A, SPOOF]);
    });
    await flush();
    // A present member's state under its own key: the fingerprint doesn't match.
    const spoofKeys = await crypto.createHostKeys();
    await deliver(ch, VOTE_ROOM_EVENTS.state, await signedState(crypto, SPOOF.id, spoofKeys));
    // The host's key, but the body changed after signing.
    const forged = { ...(await signedState(crypto, SPOOF.id, keys)), ballots: 7 };
    await deliver(ch, VOTE_ROOM_EVENTS.state, forged);
    expect(result.current.status).toBe("waiting");
    // The real host's state before its presence entry: held, then applied.
    await deliver(ch, VOTE_ROOM_EVENTS.state, await signedState(crypto, HOST.id, keys));
    expect(result.current.status).toBe("waiting");
    act(() => ch.setPresence([HOST, A, SPOOF]));
    await flush();
    expect(result.current.status).toBe("live");
    expect(result.current.hostId).toBe(HOST.id);
  });

  it("then accepts only the pinned sender and key, with a rising seq", async () => {
    const { result, ch } = await joined();
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, { seq: 3, ballots: 2 })
    );
    expect(result.current.ballots).toBe(2);
    // A replay, or an older state.
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, { seq: 3, ballots: 9 })
    );
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, { seq: 2, ballots: 1 })
    );
    expect(result.current.ballots).toBe(2);
    // Another present member with a valid key of its own.
    const spoofKeys = await crypto.createHostKeys();
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, SPOOF.id, spoofKeys, { seq: 9, ballots: 5 })
    );
    expect(result.current.ballots).toBe(2);
    expect(result.current.hostId).toBe(HOST.id);
  });

  it("ignores unsigned and foreign kicks and ends; obeys the pinned host's", async () => {
    const { result, ch } = await joined();
    const spoofKeys = await crypto.createHostKeys();
    await deliver(ch, VOTE_ROOM_EVENTS.kick, { v: 1, by: HOST.id, id: A.id });
    await deliver(ch, VOTE_ROOM_EVENTS.kick, await signedKick(crypto, HOST.id, spoofKeys, A.id));
    await deliver(ch, VOTE_ROOM_EVENTS.kick, await signedKick(crypto, SPOOF.id, spoofKeys, A.id));
    await deliver(ch, VOTE_ROOM_EVENTS.end, { v: 1, by: HOST.id, reason: "host" });
    await deliver(ch, VOTE_ROOM_EVENTS.end, await signedEnd(crypto, HOST.id, spoofKeys));
    // The real host removing someone else.
    await deliver(ch, VOTE_ROOM_EVENTS.kick, await signedKick(crypto, HOST.id, keys, B.id));
    expect(result.current.status).toBe("live");
    await deliver(ch, VOTE_ROOM_EVENTS.kick, await signedKick(crypto, HOST.id, keys, A.id));
    expect(result.current.status).toBe("kicked");
    expect(ch.removed).toBe(true);
  });

  it("ends when the pinned host ends the room, with its reason", async () => {
    const { result, ch } = await joined();
    await deliver(ch, VOTE_ROOM_EVENTS.end, await signedEnd(crypto, HOST.id, keys, "idle"));
    expect(result.current.status).toBe("ended");
    expect(result.current.endReason).toBe("idle");
    expect(ch.removed).toBe(true);
  });

  it("seals its answers once per round and keeps only the round id", async () => {
    const { result, ch } = await joined();
    let res = "";
    await act(async () => {
      res = await result.current.submit({ fun: 2, speed: null, learning: null });
    });
    expect(res).toBe("incomplete");
    await act(async () => {
      res = await result.current.submit({ fun: 2, speed: 0, learning: null });
    });
    expect(res).toBe("sent");
    const ballots = ch.sent(VOTE_ROOM_EVENTS.ballot) as Record<string, string>[];
    expect(ballots).toHaveLength(1);
    expect(Object.keys(ballots[0]).sort()).toEqual([
      "bid",
      "by",
      "ct",
      "epk",
      "iv",
      "roundId",
      "v",
    ]);
    expect(ballots[0].by).toBe(A.id);
    expect(ballots[0].roundId).toBe(ROUND);
    expect(result.current.awaitingAck).toBe(true);
    expect(result.current.answered).toBe(false);
    // Only the round id is kept in this tab.
    const stored = Object.keys(window.sessionStorage)
      .filter((k) => k.startsWith("agile-toolkit:vote-room:answered:"))
      .map((k) => window.sessionStorage.getItem(k));
    expect(stored).toEqual([JSON.stringify([ROUND])]);
    // The host's ack.
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, { seq: 2, ballots: 1, acks: [ballots[0].bid] })
    );
    expect(result.current.answered).toBe(true);
    expect(result.current.awaitingAck).toBe(false);
    await act(async () => {
      res = await result.current.submit({ fun: 1, speed: 1 });
    });
    expect(res).toBe("already-answered");
    expect(ch.sent(VOTE_ROOM_EVENTS.ballot)).toHaveLength(1);
    // A new round starts unanswered.
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, { seq: 3, roundId: "round_000002" })
    );
    expect(result.current.answered).toBe(false);
    expect(result.current.awaitingAck).toBe(false);
  });

  it("can't answer a revealed round", async () => {
    const { result, ch } = await joined();
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, {
        seq: 2,
        phase: "revealed",
        ballots: 3,
        revealed: [
          { responses: 3, distribution: [1, 1, 1] },
          { responses: 3, distribution: [3, 0, 0] },
          { responses: 0, distribution: null },
        ],
      })
    );
    expect(result.current.phase).toBe("revealed");
    expect(result.current.result?.questions[0].distribution).toEqual([1, 1, 1]);
    let res = "";
    await act(async () => {
      res = await result.current.submit({ fun: 2, speed: 2 });
    });
    expect(res).toBe("closed");
  });

  it("shows 'host-left' once the pinned host has been gone 10 s (no election)", async () => {
    const { result, ch } = await joined();
    act(() => ch.setPresence([A, B, SPOOF]));
    await tick(HOST_MIGRATION_DELAY_MS - 1);
    expect(result.current.status).toBe("live");
    await tick(1);
    expect(result.current.status).toBe("host-left");
    expect(result.current.endReason).toBe("host-left");
    expect(result.current.hostId).toBe(HOST.id);
    expect(ch.removed).toBe(true);
  });

  it("closes at the room's end time", async () => {
    const p = participant();
    act(() => {
      p.ch.connect();
      p.ch.setPresence([HOST, A]);
    });
    await flush();
    await deliver(
      p.ch,
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, { endsAt: NOW + 60 * 60 * 1000 })
    );
    await tick(60 * 60 * 1000 - 1_000);
    expect(p.result.current.status).toBe("live");
    await tick(1_000);
    expect(p.result.current.status).toBe("expired");
  });

  it("turns back when the room is already full", async () => {
    const { result, ch } = participant();
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

// ── Host: counting ───────────────────────────────────────────────────

describe("useVoteRoom: the host counts", () => {
  it("shares a signed state that participants can verify", async () => {
    const { ch, crypto, result } = await startHost();
    expect(result.current.status).toBe("live");
    const s = lastState(ch);
    const { sig, ...body } = s;
    expect(await crypto.verify(s.keys.sig, signingInput(VOTE_ROOM_EVENTS.state, body), sig)).toBe(
      true
    );
    expect(await crypto.fingerprint(s.keys.sig)).toBe(result.current.joinPath?.split("#k=")[1]);
    expect(s).toMatchObject({
      by: HOST.id,
      tool: "health-check",
      phase: "open",
      ballots: 0,
      revealed: null,
    });
  });

  it("folds admitted ballots once, acks them, and drops the rest", async () => {
    const { ch, crypto, result } = await startHost({}, [HOST, A, B, C, SPOOF]);
    const s = lastState(ch);
    const a = await ballotFor(crypto, s, A.id, [0, 1, 2]);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, a);
    expect(result.current.ballots).toBe(1);
    // Duplicates: the same ballot, and a second one from the same key.
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, a);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, A.id, [2, 2, 2]));
    // Not in the room; another round; sealed for someone else.
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, D.id, [0, 0, 0]));
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.ballot,
      await ballotFor(crypto, s, B.id, [0, 0, 0], { roundId: "round_999999" })
    );
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.ballot,
      await ballotFor(crypto, s, B.id, [0, 0, 0], { aadBy: C.id })
    );
    // Removed.
    act(() => result.current.kick(SPOOF.id));
    await flush();
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, SPOOF.id, [0, 0, 0]));
    expect(result.current.ballots).toBe(1);
    expect(result.current.removedIds.has(SPOOF.id)).toBe(true);
    // The kick is signed.
    const kick = ch.sent(VOTE_ROOM_EVENTS.kick)[0] as { v: 1; by: string; id: string; sig: string };
    expect(kick).toMatchObject({ by: HOST.id, id: SPOOF.id });
    const { sig, ...kickBody } = kick;
    expect(
      await crypto.verify(s.keys.sig, signingInput(VOTE_ROOM_EVENTS.kick, kickBody), sig)
    ).toBe(true);
    // The next state acknowledges only the counted ballot.
    await tick(VOTE_LIMITS.stateThrottleMs);
    expect(lastState(ch)).toMatchObject({ ballots: 1, acks: [a.bid] });
  });

  it("drops a ballot of the wrong size before decrypting it", async () => {
    const { ch, crypto, result } = await startHost();
    const s = lastState(ch);
    const a = await ballotFor(crypto, s, A.id, [0, 1, 2]);
    const opens = crypto.calls.open;
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, { ...a, ct: `${a.ct}AAAA` });
    expect(crypto.calls.open).toBe(opens);
    expect(result.current.ballots).toBe(0);
  });

  it("exposes no counts before Reveal, and sends none", async () => {
    const { ch, crypto, result } = await startHost();
    const s = lastState(ch);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, A.id, [0, 1, 2]));
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, B.id, [0, 1, -1]));
    await tick(VOTE_LIMITS.stateThrottleMs);
    expect(result.current.ballots).toBe(2);
    expect(result.current.revealed).toBeNull();
    expect(result.current.result).toBeNull();
    const surface = JSON.stringify(result.current);
    expect(surface).not.toMatch(/counts|responses|distribution|tally/);
    for (const st of states(ch)) {
      expect(st.revealed).toBeNull();
      expect(JSON.stringify(st)).not.toMatch(/counts|responses|distribution/);
    }
  });

  it("blocks Reveal below minN, with a reason", async () => {
    const { ch, crypto, result } = await startHost();
    const s = lastState(ch);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, A.id, [0, 1, 2]));
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, B.id, [0, 1, 2]));
    expect(result.current.canReveal).toBe(false);
    expect(result.current.revealBlockedReason).toBe("2 of 3 answers. Results show from 3.");
    act(() => result.current.reveal());
    await flush();
    expect(result.current.phase).toBe("open");
  });

  it("reveals at minN: distributions only from minN answers, acks cleared, later ballots refused", async () => {
    const { ch, crypto, result } = await startHost({}, [HOST, A, B, C, D]);
    const s = lastState(ch);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, A.id, [0, 0, 0]));
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, B.id, [1, 1, -1]));
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, C.id, [0, 2, -1]));
    expect(result.current.canReveal).toBe(true);
    expect(result.current.revealBlockedReason).toBeNull();
    act(() => result.current.reveal());
    await flush();
    const st = lastState(ch);
    expect(st.phase).toBe("revealed");
    expect(st.acks).toEqual([]);
    expect(st.revealed).toEqual([
      { responses: 3, distribution: [2, 1, 0] },
      { responses: 3, distribution: [1, 1, 1] },
      { responses: 1, distribution: null },
    ]);
    expect(result.current.phase).toBe("revealed");
    expect(result.current.result).toMatchObject({
      tool: "health-check",
      roundId: s.roundId,
      ballots: 3,
      minN: 3,
      source: "live",
    });
    expect(result.current.result?.questions[2].distribution).toBeNull();
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, D.id, [2, 2, 2]));
    expect(result.current.ballots).toBe(3);
  });

  it("counts the host's own answers through the same fold", async () => {
    const { result } = await startHost();
    let res = "";
    await act(async () => {
      res = await result.current.submit({ fun: 2, speed: 2 });
    });
    expect(res).toBe("sent");
    expect(result.current.ballots).toBe(1);
    expect(result.current.answered).toBe(true);
    await act(async () => {
      res = await result.current.submit({ fun: 1, speed: 1 });
    });
    expect(res).toBe("already-answered");
    expect(result.current.ballots).toBe(1);
  });

  it("starts a new round with a new round id and key, and refuses the old round's ballots", async () => {
    const { ch, crypto, result } = await startHost();
    const s1 = lastState(ch);
    for (const m of [A, B, C]) {
      await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s1, m.id, [0, 0, 0]));
    }
    act(() => result.current.reveal());
    await flush();
    const next: Questionnaire = { ...QUESTIONNAIRE, id: "health-check:next", title: "Next round" };
    act(() => result.current.newRound(next));
    await flush();
    const s2 = lastState(ch);
    expect(s2.roundId).not.toBe(s1.roundId);
    expect(s2.keys.ecdh).not.toBe(s1.keys.ecdh);
    expect(s2.keys.sig).toBe(s1.keys.sig);
    expect(s2).toMatchObject({ phase: "open", ballots: 0, acks: [], revealed: null });
    expect(s2.questionnaire.title).toBe("Next round");
    expect(result.current.result).toBeNull();
    // A ballot sealed for the old round (and key) doesn't count; one for the new does.
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.ballot,
      await ballotFor(crypto, s1, A.id, [0, 0, 0], { roundId: s2.roundId })
    );
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s1, B.id, [0, 0, 0]));
    expect(result.current.ballots).toBe(0);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s2, A.id, [1, 1, 1]));
    expect(result.current.ballots).toBe(1);
  });

  it("caps a round at 60 ballots", async () => {
    const { ch, crypto, result } = await startHost({}, [HOST]);
    const s = lastState(ch);
    const cap = VOTE_LIMITS.maxBallotsPerRound;
    for (let i = 0; i <= cap; i++) {
      // People come and go (new tabs): each holds a seat only while it answers.
      const m = {
        id: `voter${String(i).padStart(11, "0")}`,
        name: `Voter ${i}`,
        joinedAt: "2026-10-26T09:10:00Z",
      };
      act(() => ch.setPresence([HOST, m]));
      await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, m.id, [0, 0, 0]));
    }
    expect(result.current.ballots).toBe(cap);
  });

  it("warns when answers outnumber the names seen", async () => {
    const twin1 = { ...B, name: "Alex" };
    const twin2 = { ...C, name: "Alex" };
    const { ch, crypto, result } = await startHost({}, [HOST, A, twin1, twin2]);
    const s = lastState(ch);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, A.id, [0, 0, 0]));
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, twin1.id, [0, 0, 0]));
    expect(result.current.stuffingSuspected).toBe(false);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, twin2.id, [0, 0, 0]));
    expect(result.current.stuffingSuspected).toBe(true);
  });

  it("writes nothing to the workspace store", async () => {
    const before = JSON.stringify(useWorkspaceStore.getState());
    const { ch, crypto, result } = await startHost();
    const s = lastState(ch);
    for (const m of [A, B, C]) {
      await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, m.id, [0, 1, 2]));
    }
    act(() => result.current.reveal());
    await flush();
    act(() => result.current.end());
    await flush();
    expect(JSON.stringify(useWorkspaceStore.getState())).toBe(before);
  });
});

// ── Host: sending and the room's limits ──────────────────────────────

describe("useVoteRoom: the host's sends and limits", () => {
  it("throttles states to one per 500 ms", async () => {
    const { ch, crypto } = await startHost();
    const s = lastState(ch);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, A.id, [0, 0, 0]));
    await tick(0);
    const before = states(ch).length;
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, B.id, [0, 0, 0]));
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, C.id, [0, 0, 0]));
    await tick(VOTE_LIMITS.stateThrottleMs - 1);
    expect(states(ch).length).toBe(before);
    await tick(1);
    expect(states(ch).length).toBe(before + 1);
    expect(lastState(ch).ballots).toBe(3);
  });

  it("re-sends every 30 s", async () => {
    const { ch } = await startHost();
    const before = states(ch).length;
    await tick(VISITOR_LIMITS.keepaliveMs);
    expect(states(ch).length).toBe(before + 1);
    // startHost ran 600 ms past the connect that started the interval.
    await tick(VISITOR_LIMITS.keepaliveMs - 601);
    expect(states(ch).length).toBe(before + 1);
    await tick(1);
    expect(states(ch).length).toBe(before + 2);
  });

  it("re-sends 500 ms after the last of a burst of joins", async () => {
    const { ch } = await startHost({}, [HOST, A]);
    const before = states(ch).length;
    act(() => ch.setPresence([HOST, A, B]));
    await tick(300);
    act(() => ch.setPresence([HOST, A, B, C]));
    await tick(VOTE_LIMITS.joinDebounceMs - 1);
    expect(states(ch).length).toBe(before);
    await tick(1);
    expect(states(ch).length).toBe(before + 1);
  });

  it("doesn't send a state that's too big, and says so once", async () => {
    const quotes = '"'.repeat(200);
    const huge: Questionnaire = {
      ...QUESTIONNAIRE,
      questions: Array.from({ length: VOTE_LIMITS.maxQuestions }, (_, i) => ({
        id: `q${i}`,
        text: quotes,
        hint: quotes,
      })),
    };
    const { ch } = await startHost({ questionnaire: huge });
    await tick(VISITOR_LIMITS.keepaliveMs);
    expect(states(ch)).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error.mock.calls[0][0]).toMatch(/too long to share live/);
  });

  it("asks after 30 idle minutes, then ends the room with a signed end", async () => {
    const { ch, crypto, result } = await startHost();
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
    const end = ch.sent(VOTE_ROOM_EVENTS.end)[0] as {
      v: 1;
      by: string;
      reason: "idle";
      sig: string;
    };
    expect(end).toMatchObject({ v: 1, by: HOST.id, reason: "idle" });
    const { sig, ...body } = end;
    expect(
      await crypto.verify(lastState(ch).keys.sig, signingInput(VOTE_ROOM_EVENTS.end, body), sig)
    ).toBe(true);
    expect(ch.removed).toBe(true);
  });

  it("ends at the 3-hour limit", async () => {
    const { ch, result } = await startHost();
    await tick(VISITOR_LIMITS.hardTtlMs);
    expect(result.current.status).toBe("expired");
    expect(ch.sent(VOTE_ROOM_EVENTS.end)).toEqual([expect.objectContaining({ reason: "expired" })]);
  });

  it("keeps revealed results after the room ends", async () => {
    const { ch, crypto, result } = await startHost();
    const s = lastState(ch);
    for (const m of [A, B, C]) {
      await deliver(ch, VOTE_ROOM_EVENTS.ballot, await ballotFor(crypto, s, m.id, [0, 1, 2]));
    }
    act(() => result.current.reveal());
    await flush();
    act(() => result.current.end());
    await flush();
    expect(result.current.status).toBe("ended");
    expect(result.current.result?.ballots).toBe(3);
  });

  it("goes 'unavailable' when the channel can't open", async () => {
    const { result } = renderHook(() =>
      useVoteRoom({
        role: "participant",
        tool: "mood-tracker",
        code: "ABC123",
        identity: ident(A),
        hostFingerprint: "abcdefghijklmnopqrstuv",
        crypto: fakeVoteCrypto(),
      })
    );
    await flush();
    expect(result.current.status).toBe("unavailable");
  });
});
